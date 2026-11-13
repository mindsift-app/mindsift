package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mindsift-app/mindsift/internal/config"
)

func TestStreamTicketsReplaceTokensInURLs(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	ticket := func(tok string) string {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/stream-ticket", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		var out struct{ Ticket string }
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out.Ticket
	}
	stream := func(query string) string {
		u, _ := srv.authenticateUserFromReq(httptest.NewRequest(http.MethodGet, "/api/v1/events?"+query, nil))
		if u == nil {
			return ""
		}
		return u.ID
	}

	tk := ticket(token)
	if tk == "" {
		t.Fatal("no ticket issued")
	}
	if stream("ticket="+tk) == "" {
		t.Fatal("a fresh ticket must open the stream")
	}
	if stream("ticket="+tk) != "" {
		t.Fatal("a ticket works only once")
	}
	if stream("token="+token) != "" {
		t.Fatal("session tokens in the URL are no longer accepted")
	}

	// Ending all sessions makes unused tickets worthless as well
	tk = ticket(token)
	uid := stream("ticket=" + ticket(token))
	_ = store.RevokeAllUserTokens(uid)
	if stream("ticket="+tk) != "" {
		t.Fatal("ticket from before 'all sessions ended' must be refused")
	}
}

func TestStreamOriginCheck(t *testing.T) {
	srv := &Server{cfg: &config.Config{BaseURL: "https://notes.example.com", BaseURLSet: true}}
	check := func(host, origin string) bool {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/ws", nil)
		r.Host = host
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		return srv.streamOriginAllowed(r)
	}
	if !check("mindsift:8080", "https://notes.example.com") {
		t.Error("BASE_URL origin must pass even if the proxy rewrote Host")
	}
	if !check("notes.example.com", "https://notes.example.com") {
		t.Error("same host must pass")
	}
	if check("notes.example.com", "https://evil.example.org") {
		t.Error("foreign origin must be refused")
	}
	if !check("notes.example.com", "") {
		t.Error("non-browser clients without Origin pass (they still need a ticket)")
	}
}
