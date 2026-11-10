package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mindsift-app/mindsift/internal/auth"
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
