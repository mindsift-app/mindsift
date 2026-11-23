package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// Admins learn when a new MindSift release is out: once a day (and a few minutes after the start) the
// server asks GitHub for the latest release and compares it with its own version. The request carries
// nothing about the instance: no address, no user count, only "MindSift/<version>" as User-Agent, which
// GitHub's API requires. UPDATE_CHECK=false switches it off completely; the demo and builds that are not
// a release (local builds, "-dev" images) never ask.

const (
	// Release pages the hint may link to; anything else in the answer is replaced by the page of the tag
	updateReleasePages = "https://github.com/mindsift-app/mindsift/releases/"
	updateCheckEvery   = 24 * time.Hour
	// After a failed check (network, GitHub down) the next one comes this much later, not at once
	updateRetryAfterError = 6 * time.Hour
	updateMaxBody         = 256 << 10
)

// Variables only so the tests can point the check at a local server and start it at once
var (
	updateReleaseAPI = "https://api.github.com/repos/mindsift-app/mindsift/releases/latest"
	// The same guarded client as webhooks and link previews: no internal addresses, no step down to http
	updateHTTPClient = func() *http.Client { return guardedClient(false) }
	// The first check after the start: a few minutes in, spread so a fleet restarted together does not ask at once
	updateFirstDelayMin = time.Minute
	updateFirstDelayMax = 5 * time.Minute
)

// releaseVersion is a plain release version vX.Y.Z; pre-releases and dev builds have none.
type releaseVersion struct{ major, minor, patch int }

// parseReleaseVersion accepts "v1.2.3" and "1.2.3" only: "v1.2.3-dev", "v1.2.3-rc.1", "dev" and "" are
// not releases.
func parseReleaseVersion(v string) (releaseVersion, bool) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return releaseVersion{}, false
	}
	var n [3]int
	for i, p := range parts {
		if p == "" || len(p) > 9 || strings.TrimLeft(p, "0123456789") != "" {
			return releaseVersion{}, false
		}
		n[i], _ = strconv.Atoi(p)
	}
	return releaseVersion{n[0], n[1], n[2]}, true
}

func (a releaseVersion) less(b releaseVersion) bool {
	if a.major != b.major {
		return a.major < b.major
	}
	if a.minor != b.minor {
		return a.minor < b.minor
	}
	return a.patch < b.patch
}

func (a releaseVersion) String() string { return fmt.Sprintf("%d.%d.%d", a.major, a.minor, a.patch) }

// newerRelease: latest is a release and newer than current (which must be a release as well).
func newerRelease(current, latest string) bool {
	c, ok := parseReleaseVersion(current)
	if !ok {
		return false
	}
	l, ok := parseReleaseVersion(latest)
	return ok && c.less(l)
}

// updateState is the last answer of GitHub, kept in memory and in the system settings (storage/update.go).
type updateState struct {
	Latest      string    `json:"latest,omitempty"` // tag, e.g. "v1.2.0"
	URL         string    `json:"url,omitempty"`    // its release page
	PublishedAt string    `json:"publishedAt,omitempty"`
	ETag        string    `json:"etag,omitempty"`
	CheckedAt   time.Time `json:"checkedAt"` // last answer from GitHub (200 or 304)
}

type updateChecker struct {
	mu      sync.Mutex
	state   updateState
	current string
	url     string
	client  *http.Client
	now     func() time.Time
	save    func(updateState) // keeps the state for the next start
}

// errUpdateRateLimited: GitHub refused for now (403/429); the next check waits at least until until.
type errUpdateRateLimited struct{ until time.Time }

func (e errUpdateRateLimited) Error() string {
	return "GitHub rate limit, next try after " + e.until.UTC().Format(time.RFC3339)
}

func newUpdateChecker(current string, stored string, save func(updateState)) *updateChecker {
	u := &updateChecker{
		current: current,
		url:     updateReleaseAPI,
		client:  updateHTTPClient(),
		now:     time.Now,
		save:    save,
	}
	if stored != "" {
		_ = json.Unmarshal([]byte(stored), &u.state)
	}
	return u
}

func (u *updateChecker) snapshot() updateState {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.state
}

// check asks GitHub once. A 304 (same ETag) only renews CheckedAt; rate limits and errors keep the last answer.
func (u *updateChecker) check(ctx context.Context) error {
	prev := u.snapshot()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "MindSift/"+u.current)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if prev.ETag != "" {
		req.Header.Set("If-None-Match", prev.ETag)
	}
	resp, err := u.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotModified:
		u.store(func(s *updateState) { s.CheckedAt = u.now() })
		return nil
	case resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests:
		return errUpdateRateLimited{until: rateLimitUntil(resp.Header, u.now())}
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("GitHub answered %d", resp.StatusCode)
	}

	var rel struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		PublishedAt string `json:"published_at"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, updateMaxBody)).Decode(&rel); err != nil {
		return fmt.Errorf("reading the release: %w", err)
	}
	v, ok := parseReleaseVersion(rel.TagName)
	if rel.Draft || rel.Prerelease || !ok {
		return fmt.Errorf("the latest release %q is not a release version", rel.TagName)
	}
	tag := "v" + v.String()
	page := rel.HTMLURL
	if !strings.HasPrefix(page, updateReleasePages) {
		page = updateReleasePages + "tag/" + tag
	}
	published := ""
	if t, err := time.Parse(time.RFC3339, rel.PublishedAt); err == nil {
		published = t.UTC().Format(time.RFC3339)
	}
	etag := resp.Header.Get("ETag")
	u.store(func(s *updateState) {
		*s = updateState{Latest: tag, URL: page, PublishedAt: published, ETag: etag, CheckedAt: u.now()}
	})
	return nil
}

func (u *updateChecker) store(change func(*updateState)) {
	u.mu.Lock()
	change(&u.state)
	st := u.state
	u.mu.Unlock()
	if u.save != nil {
		u.save(st)
	}
}

// rateLimitUntil reads when GitHub takes requests again: Retry-After (seconds) or X-RateLimit-Reset (Unix
// time). Without either, in an hour.
func rateLimitUntil(h http.Header, now time.Time) time.Time {
	if s, err := strconv.Atoi(strings.TrimSpace(h.Get("Retry-After"))); err == nil && s > 0 {
		return now.Add(time.Duration(s) * time.Second)
	}
	if h.Get("X-RateLimit-Remaining") == "0" {
		if reset, err := strconv.ParseInt(strings.TrimSpace(h.Get("X-RateLimit-Reset")), 10, 64); err == nil {
			if t := time.Unix(reset, 0); t.After(now) {
				return t
			}
		}
	}
	return now.Add(time.Hour)
}

// nextWait is the pause before the next check after one that ended with err: a day after an answer, a few
// hours after an error, and never before GitHub's rate limit ends. Always a little random.
func (u *updateChecker) nextWait(err error) time.Duration {
	jitter := time.Duration(rand.Int64N(int64(time.Hour)))
	var rl errUpdateRateLimited
	switch {
	case err == nil:
		return updateCheckEvery + jitter
	case errors.As(err, &rl):
		wait := rl.until.Sub(u.now())
		return max(wait, updateRetryAfterError) + jitter
	default:
		return updateRetryAfterError + jitter
	}
}

// firstWait: a few minutes after the start, or later when the stored answer is still fresh, so restarts do
// not ask GitHub each time.
func (u *updateChecker) firstWait() time.Duration {
	wait := updateFirstDelayMin + time.Duration(rand.Int64N(int64(updateFirstDelayMax-updateFirstDelayMin)))
	if checked := u.snapshot().CheckedAt; !checked.IsZero() {
		if due := checked.Add(updateCheckEvery).Sub(u.now()); due > wait {
			return due
		}
	}
	return wait
}

// updateCheckOff says why the server does not look for releases ("" when it does).
func (s *Server) updateCheckOff() string {
	switch {
	case s.cfg.UpdateCheckOff:
		return "off"
	case s.cfg.DemoMode:
		return "demo"
	}
	if _, ok := parseReleaseVersion(s.cfg.AppVersion); !ok {
		return "devBuild"
	}
	return ""
}

func (s *Server) startUpdateCheck() {
	u := s.update
	wait := u.firstWait()
	for {
		if !s.wait(wait) {
			return
		}
		ctx, cancel := s.stopContext()
		err := u.check(ctx)
		cancel()
		if err != nil {
			slog.Info("Looking for a new MindSift release failed; trying again later", "error", err)
		} else if st := u.snapshot(); newerRelease(u.current, st.Latest) {
			slog.Info("A new MindSift release is out", "installed", u.current, "latest", st.Latest, "url", st.URL)
		}
		wait = u.nextWait(err)
	}
}

// updateStatus is GET /api/v1/admin/update.
type updateStatus struct {
	Enabled bool `json:"enabled"`
	// Reason when not enabled: off (UPDATE_CHECK=false), demo, devBuild (no release version)
	Reason      string `json:"reason,omitempty"`
	Current     string `json:"current"`
	Latest      string `json:"latest,omitempty"`
	URL         string `json:"url,omitempty"`
	PublishedAt string `json:"publishedAt,omitempty"`
	CheckedAt   string `json:"checkedAt,omitempty"`
	// Available: Latest is newer than Current; Dismissed: this admin put the hint for Latest aside
	Available bool `json:"available"`
	Dismissed bool `json:"dismissed"`
}

func (s *Server) updateStatusFor(userID string) updateStatus {
	out := updateStatus{Current: s.cfg.AppVersion, Reason: s.updateCheckOff()}
	if out.Reason != "" {
		return out
	}
	st := s.update.snapshot()
	out.Enabled = true
	out.Latest, out.URL, out.PublishedAt = st.Latest, st.URL, st.PublishedAt
	if !st.CheckedAt.IsZero() {
		out.CheckedAt = st.CheckedAt.UTC().Format(time.RFC3339)
	}
	out.Available = newerRelease(out.Current, out.Latest)
	out.Dismissed = out.Available && s.store.UpdateDismissed(userID) == out.Latest
	return out
}

func (s *Server) handleAdminUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.updateStatusFor(auth.GetUserID(r.Context())))
}

// handleAdminDismissUpdate puts the hint for one release aside for this admin; a newer release shows it again.
func (s *Server) handleAdminDismissUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Version string `json:"version"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	v, ok := parseReleaseVersion(req.Version)
	if !ok {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	userID := auth.GetUserID(r.Context())
	if err := s.store.SetUpdateDismissed(userID, "v"+v.String()); err != nil {
		writeError(w, http.StatusInternalServerError, "Einstellungen konnten nicht gespeichert werden")
		return
	}
	writeJSON(w, http.StatusOK, s.updateStatusFor(userID))
}
