package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// API_KEYS_ENABLED=false: keys are refused on the REST API (403) but keep working on MCP; sessions
// are unaffected, and new keys can only be created while MCP is on.
func TestRESTAPIKeysOff(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	key, _ := store.CreateAPIKey(claims.UserID, "Skript", []string{"tasks:read", "webhook:triage"})
	const list = `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	bearer := func(path string) int {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+key.RawKey)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}
	restAPIKeys := func() any {
		_, _, st := oauthDo(t, router, http.MethodGet, "/api/v1/auth/status", "", "", "")
		return st["restApiKeys"]
	}

	// On (default): REST and MCP take the key
	if code, _ := keyRequest(t, router, key.RawKey, http.MethodGet, "/api/v1/tasks", ""); code != http.StatusOK {
		t.Fatalf("REST with key while on: %d", code)
	}
	if code := bearer("/api/v1/tasks"); code != http.StatusOK {
		t.Fatalf("REST with Bearer key while on: %d", code)
	}
	if code, _ := rpc(t, router, key.RawKey, list); code != http.StatusOK {
		t.Fatalf("MCP with key while on: %d", code)
	}
	if restAPIKeys() != true {
		t.Fatalf("status must say REST keys are on")
	}

	srv.cfg.RESTAPIKeysOff = true
	code, body := keyRequest(t, router, key.RawKey, http.MethodGet, "/api/v1/tasks", "")
	if code != http.StatusForbidden || !strings.Contains(string(body), "MCP") {
		t.Fatalf("REST with X-API-Key while off: %d %s", code, body)
	}
	if code := bearer("/api/v1/tasks"); code != http.StatusForbidden {
		t.Fatalf("REST with Bearer key while off: %d", code)
	}
	if code, body := keyRequest(t, router, key.RawKey, http.MethodPost, "/api/v1/webhooks/ingest", `{"content":"Waschmaschine fertig"}`); code != http.StatusForbidden {
		t.Fatalf("webhook with key while off: %d %s", code, body)
	}
	if code, _ := rpc(t, router, key.RawKey, list); code != http.StatusOK {
		t.Fatalf("MCP with key while REST keys are off: %d", code)
	}
	if restAPIKeys() != false {
		t.Fatalf("status must say REST keys are off")
	}
	// The app's own session is unaffected
	if rec := sessionCall(router, http.MethodGet, "/api/v1/tasks", token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("session while REST keys are off: %d", rec.Code)
	}
	if rec := sessionCall(router, http.MethodPost, "/api/v1/webhooks/ingest", token, `{"content":"Aus der App"}`, ""); rec.Code >= 300 {
		t.Fatalf("session webhook while REST keys are off: %d %s", rec.Code, rec.Body.String())
	}
	// A key for MCP can still be made
	if rec := sessionCall(router, http.MethodPost, "/api/v1/keys", token, `{"name":"Claude"}`, ""); rec.Code != http.StatusCreated {
		t.Fatalf("create key while MCP is on: %d %s", rec.Code, rec.Body.String())
	}
	// MCP off as well: no key could be used anywhere, so none is made
	off := false
	srv.cfg.MCPEnabled = &off
	if rec := sessionCall(router, http.MethodPost, "/api/v1/keys", token, `{"name":"Nutzlos"}`, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("create key with REST keys and MCP off: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, http.MethodGet, "/api/v1/keys", token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("listing keys stays possible: %d", rec.Code)
	}
	// REST keys on again: creating works without MCP
	srv.cfg.RESTAPIKeysOff = false
	if rec := sessionCall(router, http.MethodPost, "/api/v1/keys", token, `{"name":"REST"}`, ""); rec.Code != http.StatusCreated {
		t.Fatalf("create key with REST keys on and MCP off: %d", rec.Code)
	}
}
