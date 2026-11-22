package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The desktop app's listener for local programs (LocalAPIOnly in front of the server's router): what an API
// key may call is reachable with a key, everything else is not there at all, and no session gets in.
func TestLocalAPIOnlyReachesWhatAPIKeysMay(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	local := LocalAPIOnly(router)

	rec := desktopSession(t, router, desktopTestOrigin)
	var sess struct {
		Token string `json:"token"`
		User  struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &sess) != nil || sess.Token == "" {
		t.Fatalf("desktop session: %d %s", rec.Code, rec.Body.String())
	}
	key, err := store.CreateAPIKey(sess.User.ID, "Agent", []string{storage.ScopeTasksRead, storage.ScopeNotesRead, storage.ScopeTriage})
	if err != nil {
		t.Fatal(err)
	}

	type hdr = map[string]string
	call := func(method, target, body string, h hdr) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Host = "127.0.0.1:18890"
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		for k, v := range h {
			if k == "Host" {
				req.Host = v
				continue
			}
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		local.ServeHTTP(rec, req)
		return rec
	}
	withKey := hdr{"X-API-Key": key.RawKey}
	const toolsList = `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`

	cases := []struct {
		name         string
		method, path string
		body         string
		h            hdr
		want         int
	}{
		// Reachable with a key: MCP, the REST routes of its rights, the webhook delivery
		{"MCP with X-API-Key", http.MethodPost, mcpPath, toolsList, withKey, http.StatusOK},
		{"MCP with Bearer key", http.MethodPost, mcpPath, toolsList, hdr{"Authorization": "Bearer " + key.RawKey}, http.StatusOK},
		{"MCP via localhost", http.MethodPost, mcpPath, toolsList, hdr{"X-API-Key": key.RawKey, "Host": "localhost:18890"}, http.StatusOK},
		// MCP has no server stream: other methods answer 405 as on a server, not 403
		{"MCP GET", http.MethodGet, mcpPath, "", withKey, http.StatusMethodNotAllowed},
		{"MCP DELETE", http.MethodDelete, mcpPath, "", withKey, http.StatusMethodNotAllowed},
		{"tasks", http.MethodGet, "/api/v1/tasks", "", withKey, http.StatusOK},
		{"webhook with ?token=", http.MethodPost, "/api/v1/webhooks/ingest?token=" + key.RawKey, `{"title":"Vom Skript"}`, nil, http.StatusCreated},
		// The key's rights still hold: lists need lists:read
		{"lists without the right", http.MethodGet, "/api/v1/lists", "", withKey, http.StatusForbidden},
		// No key, or a session: not on this listener
		{"MCP without key", http.MethodPost, mcpPath, toolsList, nil, http.StatusUnauthorized},
		{"tasks with a session", http.MethodGet, "/api/v1/tasks", "", hdr{"Authorization": "Bearer " + sess.Token}, http.StatusUnauthorized},
		{"key plus a session", http.MethodGet, "/api/v1/tasks", "", hdr{"X-API-Key": key.RawKey, "Authorization": "Bearer " + sess.Token}, http.StatusUnauthorized},
		{"webhook with a session in the URL", http.MethodPost, "/api/v1/webhooks/ingest?token=" + sess.Token, `{"title":"x"}`, withKey, http.StatusUnauthorized},
		// What an API key cannot call does not exist here, key or not
		{"the app", http.MethodGet, "/", "", withKey, http.StatusNotFound},
		{"an app file", http.MethodGet, "/index.html", "", nil, http.StatusNotFound},
		{"desktop sign-in", http.MethodPost, "/api/v1/auth/desktop", `{}`, nil, http.StatusNotFound},
		{"sign-in", http.MethodPost, "/api/v1/auth/login", `{"username":"sandra","password":"x"}`, nil, http.StatusNotFound},
		{"auth status", http.MethodGet, "/api/v1/auth/status", "", nil, http.StatusNotFound},
		{"me", http.MethodGet, "/api/v1/auth/me", "", withKey, http.StatusNotFound},
		{"notes over REST", http.MethodGet, "/api/v1/documents", "", withKey, http.StatusNotFound},
		{"keys", http.MethodGet, "/api/v1/keys", "", withKey, http.StatusNotFound},
		{"event stream", http.MethodGet, "/api/v1/events", "", withKey, http.StatusNotFound},
		{"health", http.MethodGet, "/api/v1/health", "", nil, http.StatusNotFound},
		// DNS rebinding: a site's name that resolves to 127.0.0.1
		{"foreign host", http.MethodPost, mcpPath, toolsList, hdr{"X-API-Key": key.RawKey, "Host": "evil.example:18890"}, http.StatusMisdirectedRequest},
		{"foreign host without port", http.MethodGet, "/api/v1/tasks", "", hdr{"X-API-Key": key.RawKey, "Host": "127.0.0.1.evil.example"}, http.StatusMisdirectedRequest},
		// Browsers: no CORS, not even the window's origin
		{"page of a site", http.MethodPost, mcpPath, toolsList, hdr{"X-API-Key": key.RawKey, "Origin": "https://evil.example"}, http.StatusForbidden},
		{"the window's origin", http.MethodGet, "/api/v1/tasks", "", hdr{"X-API-Key": key.RawKey, "Origin": desktopTestOrigin}, http.StatusForbidden},
		{"preflight", http.MethodOptions, mcpPath, "", hdr{"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}, http.StatusForbidden},
		{"browser navigation", http.MethodGet, "/api/v1/tasks", "", hdr{"X-API-Key": key.RawKey, "Sec-Fetch-Site": "none"}, http.StatusForbidden},
	}
	for _, c := range cases {
		rec := call(c.method, c.path, c.body, c.h)
		if rec.Code != c.want {
			t.Errorf("%s: %s %s → %d, want %d (%s)", c.name, c.method, c.path, rec.Code, c.want, strings.TrimSpace(rec.Body.String()))
		}
		if acao := rec.Header().Get("Access-Control-Allow-Origin"); acao != "" {
			t.Errorf("%s: CORS header %q on the local listener", c.name, acao)
		}
	}

	// tools/list over the listener lists the key's tools
	rec = call(http.MethodPost, mcpPath, toolsList, withKey)
	var res map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if names := toolNames(res); len(names) == 0 {
		t.Errorf("tools/list over the local listener: no tools (%s)", rec.Body.String())
	}
}

func TestLoopbackHost(t *testing.T) {
	for host, want := range map[string]bool{
		"127.0.0.1": true, "127.0.0.1:18890": true, "localhost": true, "LocalHost:1": true,
		"": false, "[::1]:18890": false, "0.0.0.0:18890": false, "evil.example": false, "localhost.evil.example:18890": false,
		"127.0.0.2:18890": false,
	} {
		if got := loopbackHost(host); got != want {
			t.Errorf("loopbackHost(%q) = %v, want %v", host, got, want)
		}
	}
}
