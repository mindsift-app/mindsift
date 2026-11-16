package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

func TestDemoResetKeepsSessionsAndRestoresSampleData(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "demo_reset.db")
	store, err := storage.NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatal(err)
	}
	srv := NewServer(&config.Config{DatabasePath: dbPath, JWTSecret: "demo-secret", DemoMode: true}, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	router := srv.Router()
	call := func(method, path, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	var login struct{ Token string }
	_ = json.Unmarshal(call("POST", "/api/v1/auth/login", "", `{"login":"admin","password":"admin"}`).Body.Bytes(), &login)
	countDocs := func() int {
		var docs []json.RawMessage
		_ = json.Unmarshal(call("GET", "/api/v1/documents", login.Token, "").Body.Bytes(), &docs)
		return len(docs)
	}
	seeded := countDocs()
	if seeded == 0 {
		t.Fatal("expected sample notes")
	}
	if rec := call("POST", "/api/v1/documents", login.Token, `{"title":"Testnotiz"}`); rec.Code >= 300 {
		t.Fatalf("create note: %d %s", rec.Code, rec.Body.String())
	}

	// Requests running during the reset must neither fail half-way nor see missing tables
	var wg sync.WaitGroup
	failures := make(chan int, 50)
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if rec := call("GET", "/api/v1/documents", login.Token, ""); rec.Code != http.StatusOK {
				failures <- rec.Code
			}
		}()
	}
	srv.resetDemo()
	wg.Wait()
	close(failures)
	for code := range failures {
		t.Errorf("request during reset failed with %d", code)
	}

	if rec := call("GET", "/api/v1/auth/me", login.Token, ""); rec.Code != http.StatusOK {
		t.Fatalf("session must survive the reset, got %d", rec.Code)
	}
	if n := countDocs(); n != seeded {
		t.Errorf("reset should restore the %d sample notes, got %d", seeded, n)
	}

	srv.setDemoNextReset(time.Now().Add(90 * time.Second))
	var st struct {
		DemoNextReset      string `json:"demoNextReset"`
		DemoResetInSeconds int    `json:"demoResetInSeconds"`
	}
	_ = json.Unmarshal(call("GET", "/api/v1/auth/status", "", "").Body.Bytes(), &st)
	if st.DemoNextReset == "" || st.DemoResetInSeconds < 60 || st.DemoResetInSeconds > 90 {
		t.Errorf("status should announce the next reset: %+v", st)
	}
}

// A demo reset waits for a running pass of a background job, and neither the jobs nor readers outside the
// gate (static pages, streams, the language lookup) log anything while the tables are dropped and created anew.
func TestDemoResetIsQuietForBackgroundJobs(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "demo_quiet.db")
	store, err := storage.NewStore(dbPath, storage.WithDemoMode())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatal(err)
	}
	srv := NewServer(&config.Config{DatabasePath: dbPath, JWTSecret: "demo-secret", DemoMode: true}, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)

	// A pass holds the reset off until it is done
	done := srv.demoPass()
	reset := make(chan struct{})
	go func() {
		srv.resetDemo()
		close(reset)
	}()
	select {
	case <-reset:
		done()
		t.Fatal("the reset must wait for the running pass")
	case <-time.After(100 * time.Millisecond):
	}
	done()
	select {
	case <-reset:
	case <-time.After(30 * time.Second):
		t.Fatal("the reset must run once the pass is done")
	}

	log := captureLog(t)
	stop := make(chan struct{})
	var wg sync.WaitGroup
	repeat := func(pass func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					pass()
				}
			}
		}()
	}
	gated := func(pass func()) func() {
		return func() {
			done := srv.demoPass()
			defer done()
			pass()
		}
	}
	repeat(gated(func() { srv.checkAlarms(time.Now()) }))
	repeat(gated(srv.compactOnce))
	repeat(gated(srv.drawTickOnce))
	// Outside the gate, like index.html or a stream
	repeat(func() { _ = srv.defaultLanguage(); _ = srv.userLanguage(storage.DemoUserID) })
	for range 3 {
		srv.resetDemo()
	}
	close(stop)
	wg.Wait()
	for _, line := range strings.Split(log.String(), "\n") {
		if strings.Contains(line, "level=ERROR") || strings.Contains(line, "level=WARN") {
			t.Errorf("logged during a demo reset: %s", line)
		}
	}
}

// A client that asks for the status during or right after a reset (held by the gate, or woken by
// DEMO_RESET) gets the following deadline, not the one just passed; otherwise its countdown stays at
// "resetting" until the page is reloaded.
func TestDemoResetAnnouncesNextDeadlineBeforeGateOpens(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "demo_deadline.db")
	store, err := storage.NewStore(dbPath, storage.WithDemoMode())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatal(err)
	}
	srv := NewServer(&config.Config{DatabasePath: dbPath, JWTSecret: "demo-secret", DemoMode: true, DemoResetMinutes: 20}, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	router := srv.Router()
	status := func() int {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/auth/status", nil))
		var st struct {
			DemoResetInSeconds int `json:"demoResetInSeconds"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &st)
		return st.DemoResetInSeconds
	}

	// The deadline has just passed and the reset is due
	srv.setDemoNextReset(time.Now().Add(-time.Second))
	if got := status(); got != 0 {
		t.Errorf("a passed deadline should read as 0 seconds, got %d", got)
	}

	// A pass holds the reset back; a status request arriving meanwhile waits behind the reset
	done := srv.demoPass()
	reset := make(chan struct{})
	go func() {
		srv.resetDemo()
		close(reset)
	}()
	time.Sleep(100 * time.Millisecond)
	answer := make(chan int, 1)
	go func() { answer <- status() }()
	time.Sleep(100 * time.Millisecond)
	done()
	<-reset
	select {
	case got := <-answer:
		if got < 19*60 || got > 20*60 {
			t.Errorf("status during the reset should announce the next deadline in 20 minutes, got %d s", got)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("status request did not finish")
	}
	if got := status(); got < 19*60 {
		t.Errorf("status after the reset should announce the next deadline, got %d s", got)
	}
}
