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
	if st.DemoNextReset == "" || st.DemoResetInSeconds < 85 || st.DemoResetInSeconds > 90 {
		t.Errorf("status should announce the next reset: %+v", st)
	}
}
