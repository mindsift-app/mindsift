package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

func TestReleaseVersions(t *testing.T) {
	for _, v := range []string{"v1.2.3", "1.2.3", "v0.80.0", " v10.0.1 "} {
		if _, ok := parseReleaseVersion(v); !ok {
			t.Errorf("%q is a release", v)
		}
	}
	for _, v := range []string{"", "dev", "v0.80.0-dev", "v1.2.3-rc.1", "v1.2", "v1.2.3.4", "v1.x.3", "v1..3", "v-1.2.3", "v1.2.3+build"} {
		if _, ok := parseReleaseVersion(v); ok {
			t.Errorf("%q is not a release", v)
		}
	}
	cases := []struct {
		current, latest string
		newer           bool
	}{
		{"v1.2.3", "v1.2.4", true},
		{"v1.2.3", "v1.3.0", true},
		{"v1.9.9", "v2.0.0", true},
		{"v0.9.0", "v0.10.0", true}, // numbers, not text
		{"v1.2.3", "v1.2.3", false},
		{"v1.3.0", "v1.2.9", false},
		{"v0.80.0-dev", "v0.81.0", false}, // a dev build never shows the hint
		{"", "v1.0.0", false},
		{"v1.0.0", "v1.1.0-rc.1", false}, // pre-releases do not count
		{"v1.0.0", "", false},
	}
	for _, c := range cases {
		if got := newerRelease(c.current, c.latest); got != c.newer {
			t.Errorf("newerRelease(%q, %q) = %v, want %v", c.current, c.latest, got, c.newer)
		}
	}
}

// fakeGitHub answers like the releases API: the release with an ETag, 304 when the client sends it back.
type fakeGitHub struct {
	hits     atomic.Int32
	status   int    // other than 0: answer only this
	body     string // the release
	header   http.Header
	lastReq  atomic.Pointer[http.Request]
	etag     string
	notModOK bool
}

func (f *fakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.hits.Add(1)
	f.lastReq.Store(r.Clone(context.Background()))
	for k, v := range f.header {
		w.Header()[k] = v
	}
	if f.status != 0 {
		w.WriteHeader(f.status)
		return
	}
	if f.etag != "" {
		if f.notModOK && r.Header.Get("If-None-Match") == f.etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", f.etag)
	}
	_, _ = w.Write([]byte(f.body))
}

const releaseBody = `{"tag_name":"v1.2.0","html_url":"https://github.com/mindsift-app/mindsift/releases/tag/v1.2.0",
	"published_at":"2026-11-10T09:30:00Z","draft":false,"prerelease":false,"body":"…"}`

func testChecker(t *testing.T, f *fakeGitHub) (*updateChecker, *[]updateState) {
	t.Helper()
	gh := httptest.NewServer(f)
	t.Cleanup(gh.Close)
	var saved []updateState
	u := newUpdateChecker("v1.1.0", "", func(st updateState) { saved = append(saved, st) })
	u.url, u.client = gh.URL, gh.Client()
	return u, &saved
}

func TestUpdateCheckFetchesAndRemembers(t *testing.T) {
	f := &fakeGitHub{body: releaseBody, etag: `"abc"`, notModOK: true}
	u, saved := testChecker(t, f)
	clock := time.Date(2026, 11, 15, 8, 0, 0, 0, time.UTC)
	u.now = func() time.Time { return clock }

	if err := u.check(context.Background()); err != nil {
		t.Fatal(err)
	}
	st := u.snapshot()
	if st.Latest != "v1.2.0" || st.URL != "https://github.com/mindsift-app/mindsift/releases/tag/v1.2.0" ||
		st.PublishedAt != "2026-11-10T09:30:00Z" || st.ETag != `"abc"` || !st.CheckedAt.Equal(clock) {
		t.Fatalf("state: %+v", st)
	}
	if len(*saved) != 1 {
		t.Fatalf("the answer must be kept for the next start: %d saves", len(*saved))
	}
	// Nothing about the instance goes out: the version as User-Agent, nothing else of ours
	req := f.lastReq.Load()
	if ua := req.Header.Get("User-Agent"); ua != "MindSift/v1.1.0" {
		t.Errorf("User-Agent %q", ua)
	}
	for _, h := range []string{"Authorization", "Cookie", "Referer", "X-Forwarded-For", "If-None-Match"} {
		if req.Header.Get(h) != "" {
			t.Errorf("first request carries %s", h)
		}
	}

	// The next day: the same ETag, GitHub answers 304; the release stays, the time moves on
	clock = clock.Add(24 * time.Hour)
	if err := u.check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := f.lastReq.Load().Header.Get("If-None-Match"); got != `"abc"` {
		t.Fatalf("If-None-Match %q", got)
	}
	st = u.snapshot()
	if st.Latest != "v1.2.0" || !st.CheckedAt.Equal(clock) {
		t.Fatalf("after 304: %+v", st)
	}

	// A restart takes the stored answer and does not ask again before a day has passed
	b, _ := json.Marshal((*saved)[len(*saved)-1])
	again := newUpdateChecker("v1.1.0", string(b), nil)
	again.now = func() time.Time { return clock.Add(2 * time.Hour) }
	if again.snapshot().Latest != "v1.2.0" {
		t.Fatal("the stored answer is lost on restart")
	}
	if w := again.firstWait(); w < 21*time.Hour || w > 22*time.Hour {
		t.Fatalf("first wait after a fresh answer: %v", w)
	}
	again.now = func() time.Time { return clock.Add(30 * time.Hour) }
	if w := again.firstWait(); w < updateFirstDelayMin || w > updateFirstDelayMax {
		t.Fatalf("first wait after an old answer: %v", w)
	}
}

func TestUpdateCheckErrors(t *testing.T) {
	t.Run("server error keeps the last answer", func(t *testing.T) {
		f := &fakeGitHub{body: releaseBody}
		u, _ := testChecker(t, f)
		if err := u.check(context.Background()); err != nil {
			t.Fatal(err)
		}
		f.status = http.StatusBadGateway
		err := u.check(context.Background())
		if err == nil || u.snapshot().Latest != "v1.2.0" {
			t.Fatalf("err %v, state %+v", err, u.snapshot())
		}
		if w := u.nextWait(err); w < updateRetryAfterError || w > updateRetryAfterError+time.Hour {
			t.Fatalf("wait after an error: %v", w)
		}
		if w := u.nextWait(nil); w < updateCheckEvery || w > updateCheckEvery+time.Hour {
			t.Fatalf("wait after an answer: %v", w)
		}
	})

	t.Run("rate limit waits for the reset", func(t *testing.T) {
		now := time.Date(2026, 11, 15, 8, 0, 0, 0, time.UTC)
		reset := now.Add(20 * time.Hour)
		f := &fakeGitHub{status: http.StatusForbidden, header: http.Header{
			"X-Ratelimit-Remaining": {"0"}, "X-Ratelimit-Reset": {strconv.FormatInt(reset.Unix(), 10)},
		}}
		u, saved := testChecker(t, f)
		u.now = func() time.Time { return now }
		err := u.check(context.Background())
		var rl errUpdateRateLimited
		if !errors.As(err, &rl) || !rl.until.Equal(reset) {
			t.Fatalf("err %v", err)
		}
		if w := u.nextWait(err); w < 20*time.Hour {
			t.Fatalf("must wait for the reset: %v", w)
		}
		if len(*saved) != 0 {
			t.Fatal("a refusal changes nothing")
		}
		f.status, f.header = http.StatusTooManyRequests, http.Header{"Retry-After": {"120"}}
		if err := u.check(context.Background()); !errors.As(err, &rl) || !rl.until.Equal(now.Add(2*time.Minute)) {
			t.Fatalf("Retry-After: %v", err)
		}
		// Never sooner than after an ordinary error
		if w := u.nextWait(err); w < updateRetryAfterError {
			t.Fatalf("wait %v", w)
		}
	})

	t.Run("pre-releases, drafts and junk are not taken", func(t *testing.T) {
		for _, body := range []string{
			`{"tag_name":"v1.3.0-rc.1","prerelease":true}`,
			`{"tag_name":"v1.3.0","draft":true}`,
			`{"tag_name":"nightly"}`,
			`not json`,
		} {
			f := &fakeGitHub{body: body}
			u, saved := testChecker(t, f)
			if err := u.check(context.Background()); err == nil || len(*saved) != 0 || u.snapshot().Latest != "" {
				t.Errorf("%s: err %v, state %+v", body, err, u.snapshot())
			}
		}
	})

	t.Run("a release page elsewhere is replaced by the tag's page", func(t *testing.T) {
		f := &fakeGitHub{body: `{"tag_name":"v1.2.0","html_url":"https://evil.example/x"}`}
		u, _ := testChecker(t, f)
		if err := u.check(context.Background()); err != nil {
			t.Fatal(err)
		}
		if got := u.snapshot().URL; got != "https://github.com/mindsift-app/mindsift/releases/tag/v1.2.0" {
			t.Fatalf("url %q", got)
		}
	})
}

// UPDATE_CHECK=false, the demo and builds without a release version send no request at all; a release does.
func TestUpdateCheckSwitch(t *testing.T) {
	f := &fakeGitHub{body: releaseBody}
	gh := httptest.NewServer(f)
	defer gh.Close()
	oldURL, oldClient, oldMin, oldMax := updateReleaseAPI, updateHTTPClient, updateFirstDelayMin, updateFirstDelayMax
	updateReleaseAPI, updateHTTPClient = gh.URL, gh.Client
	updateFirstDelayMin, updateFirstDelayMax = time.Millisecond, 2*time.Millisecond
	defer func() {
		updateReleaseAPI, updateHTTPClient, updateFirstDelayMin, updateFirstDelayMax = oldURL, oldClient, oldMin, oldMax
	}()

	start := func(cfg config.Config) *Server {
		store, err := storage.NewStore(t.TempDir()+"/u.db", storage.WithSecretsKey(testSecretsKey))
		if err != nil {
			t.Fatal(err)
		}
		cfg.JWTSecret, cfg.SecretsKey = "test-jwt-secret-key", testSecretsKey
		srv := NewServer(&cfg, store, ws.NewHub(), nil)
		t.Cleanup(func() { srv.Close(); _ = store.Close() })
		return srv
	}

	for _, c := range []struct {
		name   string
		cfg    config.Config
		reason string
	}{
		{"off", config.Config{AppVersion: "v1.1.0", UpdateCheckOff: true}, "off"},
		{"demo", config.Config{AppVersion: "v1.1.0", DemoMode: true}, "demo"},
		{"dev build", config.Config{AppVersion: "v1.1.0-dev"}, "devBuild"},
		{"local build", config.Config{}, "devBuild"},
	} {
		if got := start(c.cfg).updateCheckOff(); got != c.reason {
			t.Errorf("%s: reason %q, want %q", c.name, got, c.reason)
		}
	}
	time.Sleep(200 * time.Millisecond)
	if n := f.hits.Load(); n != 0 {
		t.Fatalf("switched off, yet %d requests went out", n)
	}

	srv := start(config.Config{AppVersion: "v1.1.0"})
	deadline := time.Now().Add(5 * time.Second)
	for srv.update.snapshot().Latest == "" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if f.hits.Load() != 1 || srv.update.snapshot().Latest != "v1.2.0" {
		t.Fatalf("a release checks once after the start: %d requests, %+v", f.hits.Load(), srv.update.snapshot())
	}
}

func TestAdminUpdateEndpoint(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	get := func(tok string) (int, updateStatus) {
		rec := sessionCall(router, http.MethodGet, "/api/v1/admin/update", tok, "", "")
		var st updateStatus
		_ = json.Unmarshal(rec.Body.Bytes(), &st)
		return rec.Code, st
	}

	// The test server is a local build: no check, no release shown
	if code, st := get(token); code != http.StatusOK || st.Enabled || st.Reason != "devBuild" || st.Available {
		t.Fatalf("local build: %d %+v", code, st)
	}

	srv.cfg.AppVersion = "v1.1.0"
	srv.update.state = updateState{Latest: "v1.2.0", URL: "https://github.com/mindsift-app/mindsift/releases/tag/v1.2.0",
		PublishedAt: "2026-11-10T09:30:00Z", CheckedAt: time.Now()}
	code, st := get(token)
	if code != http.StatusOK || !st.Enabled || st.Current != "v1.1.0" || st.Latest != "v1.2.0" || !st.Available || st.Dismissed ||
		st.URL == "" || st.PublishedAt == "" || st.CheckedAt == "" {
		t.Fatalf("release: %d %+v", code, st)
	}

	// Members see nothing of it
	_, member := userWithPassword(t, srv, store, "anna@example.com", "richtig-geheim", "member")
	if code, _ := get(member); code != http.StatusForbidden {
		t.Fatalf("member: %d", code)
	}
	if rec := sessionCall(router, http.MethodPost, "/api/v1/admin/update/dismiss", member, `{"version":"v1.2.0"}`, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("member dismiss: %d", rec.Code)
	}

	// "Später" puts this release aside for this admin; a newer one shows again
	if rec := sessionCall(router, http.MethodPost, "/api/v1/admin/update/dismiss", token, `{"version":"latest"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("junk version: %d", rec.Code)
	}
	rec := sessionCall(router, http.MethodPost, "/api/v1/admin/update/dismiss", token, `{"version":"v1.2.0"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("dismiss: %d %s", rec.Code, rec.Body.String())
	}
	if _, st := get(token); !st.Dismissed || !st.Available {
		t.Fatalf("after dismiss: %+v", st)
	}
	srv.update.state.Latest = "v1.3.0"
	if _, st := get(token); st.Dismissed || !st.Available {
		t.Fatalf("newer release after dismiss: %+v", st)
	}

	// Installed the latest: nothing to show
	srv.cfg.AppVersion = "v1.3.0"
	if _, st := get(token); st.Available {
		t.Fatalf("up to date: %+v", st)
	}

	// Switched off: no release in the answer, even one stored earlier
	srv.cfg.UpdateCheckOff = true
	if _, st := get(token); st.Enabled || st.Reason != "off" || st.Latest != "" {
		t.Fatalf("off: %+v", st)
	}
}
