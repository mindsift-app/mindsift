package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Unknown API paths answer 404 with JSON, not the app's page (P-04)
func TestUnknownAPIPathIs404(t *testing.T) {
	srv, _, token := setupTestServer(t)
	srv.staticFS = fstest.MapFS{"index.html": {Data: []byte("<html><head></head></html>")}}
	router := srv.Router()
	rec := getWith(t, router, "/api/v1/gibt-es-nicht", token)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Header().Get("Content-Type"), "json") {
		t.Fatalf("unknown API path: %d %s %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	if rec := getWith(t, router, "/irgendeine/seite", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<html>") {
		t.Fatalf("app routes still get the page: %d", rec.Code)
	}
}

// HEAD answers like GET without a body (curl -I, uptime monitors); paths that are neither in the build
// nor a page of the app answer 404 instead of index.html, so scanners do not read them as hits.
func TestHeadAndUnknownFiles(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	srv.staticFS = fstest.MapFS{
		"index.html":          {Data: []byte("<html><head></head></html>")},
		"sw.js":               {Data: []byte("// worker")},
		"manifest.json":       {Data: []byte(`{"name":"MindSift"}`)},
		"favicon.ico":         {Data: []byte("ico")},
		"assets/index-abc.js": {Data: []byte("console.log(1)")},
	}
	ts := httptest.NewServer(srv.Router())
	t.Cleanup(ts.Close)

	for _, p := range []string{"/", "/api/v1/health", "/p/abc123", "/sw.js", "/assets/index-abc.js"} {
		req, _ := http.NewRequest(http.MethodHead, ts.URL+p, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("HEAD %s: %v", p, err)
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || len(body) != 0 {
			t.Errorf("HEAD %s: %d with %d bytes, want 200 without a body", p, resp.StatusCode, len(body))
		}
	}

	router := srv.Router()
	for _, p := range []string{"/.env", "/.git/config", "/data/mindsift.db", "/wp-login.php", "/backup.zip",
		"/metrics", "/debug/pprof/", "/assets/gone.js", "/assets/", "/assets", "/p/.env"} {
		if rec := getWith(t, router, p, ""); rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "<html>") {
			t.Errorf("GET %s: %d, want 404 without the page", p, rec.Code)
		}
	}
	for _, p := range []string{"/", "/?note=abc", "/p/abc123", "/oauth/authorize?client_id=x", "/irgendeine/seite"} {
		if rec := getWith(t, router, p, ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<html>") {
			t.Errorf("GET %s: %d, want the app's page", p, rec.Code)
		}
	}
	for p, want := range map[string]string{"/sw.js": "worker", "/manifest.json": "MindSift", "/favicon.ico": "ico",
		"/assets/index-abc.js": "console.log"} {
		if rec := getWith(t, router, p, ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), want) {
			t.Errorf("GET %s: %d %q", p, rec.Code, rec.Body)
		}
	}

	// An API key with read rights may also ask with HEAD
	u, _ := store.CreateUser("kai@example.com", "hash", "Kai", "member")
	key, err := store.CreateAPIKey(u.ID, "Monitor", []string{storage.ScopeTasksRead})
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest(http.MethodHead, ts.URL+"/api/v1/tasks", nil)
	req.Header.Set("X-API-Key", key.RawKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("HEAD /api/v1/tasks with a read key: %d", resp.StatusCode)
	}
}

// A broken body does not quietly create an API key; an empty one still gives the default (P-05)
func TestCreateKeyRefusesBrokenJSON(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	u, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	tok, _ := auth.GenerateToken(srv.cfg.JWTSecret, u.ID, u.Email, u.DisplayName, u.TokenVersion, testSession(t, store, u.ID))
	post := func(body string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/keys", bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := post(`{"name": "Haus", "scopes": ["tasks:read"]`); code != http.StatusBadRequest {
		t.Fatalf("broken JSON: want 400, got %d", code)
	}
	if code := post(``); code != http.StatusCreated {
		t.Fatalf("empty body: want 201, got %d", code)
	}
	var keys []map[string]any
	_ = json.Unmarshal(getWith(t, router, "/api/v1/keys", tok).Body.Bytes(), &keys)
	if len(keys) != 1 {
		t.Fatalf("want exactly the one key from the empty body, got %d", len(keys))
	}
}
