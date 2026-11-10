package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func requestFrom(t *testing.T, srv *Server, peer string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/status", nil)
	req.RemoteAddr = peer + ":40000"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)
	return rec
}

// HSTS when the visitor came over https, and only a trusted proxy can say so (SA-09, SA-05)
func TestHSTSOnlyOverHTTPS(t *testing.T) {
	srv, _, _ := setupTestServer(t)
	https := map[string]string{"X-Forwarded-Proto": "https"}
	if got := requestFrom(t, srv, "10.0.0.2", https).Header().Get("Strict-Transport-Security"); got != "max-age=31536000" {
		t.Errorf("via trusted proxy over https: HSTS %q", got)
	}
	if got := requestFrom(t, srv, "203.0.113.9", https).Header().Get("Strict-Transport-Security"); got != "" {
		t.Errorf("a visitor cannot claim https: HSTS %q", got)
	}
	if got := requestFrom(t, srv, "10.0.0.2", nil).Header().Get("Strict-Transport-Security"); got != "" {
		t.Errorf("plain http: HSTS %q", got)
	}
}

// X-Forwarded-Host counts only from a trusted proxy and must look like a host (SA-05)
func TestRequestOriginTrustsOnlyProxies(t *testing.T) {
	srv, _, _ := setupTestServer(t)
	var got string
	handler := srv.clientIPMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = requestOrigin(r) }))
	try := func(peer, fwdHost string) string {
		req := httptest.NewRequest(http.MethodGet, "http://intern:8080/", nil)
		req.RemoteAddr = peer + ":40000"
		req.Header.Set("X-Forwarded-Host", fwdHost)
		req.Header.Set("X-Forwarded-Proto", "https")
		handler.ServeHTTP(httptest.NewRecorder(), req)
		return got
	}
	if o := try("10.0.0.2", "notes.example.com"); o != "https://notes.example.com" {
		t.Errorf("trusted proxy: %q", o)
	}
	if o := try("203.0.113.9", "evil.example"); o != "http://intern:8080" {
		t.Errorf("untrusted peer: %q", o)
	}
	if o := try("10.0.0.2", `x" onmouseover="alert(1)`); o != "" {
		t.Errorf("host with markup: %q", o)
	}
}

// Outgoing requests never step down from https to http (SA-16)
func TestRedirectNoDowngrade(t *testing.T) {
	check := guardedClient(false).CheckRedirect
	from, _ := http.NewRequest(http.MethodGet, "https://example.com/a", nil)
	to, _ := http.NewRequest(http.MethodGet, "http://example.com/b", nil)
	if err := check(to, []*http.Request{from}); err == nil {
		t.Errorf("https → http must be refused")
	}
	same, _ := http.NewRequest(http.MethodGet, "https://example.org/b", nil)
	if err := check(same, []*http.Request{from}); err != nil {
		t.Errorf("https → https: %v", err)
	}
}

// The admin can narrow web push down to the services of the big browsers (SA-18)
func TestPushKnownServices(t *testing.T) {
	for _, ep := range []string{"https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/x", "https://wns2-db5p.notify.windows.com/w/?token=x"} {
		if err := validPushEndpoint(ep, true); err != nil {
			t.Errorf("%s: %v", ep, err)
		}
	}
	if err := validPushEndpoint("https://push.example.org/x", true); err == nil {
		t.Errorf("other service accepted with the setting on")
	}
	if err := validPushEndpoint("https://push.example.org/x", false); err != nil {
		t.Errorf("other service refused with the setting off: %v", err)
	}
	if err := validPushEndpoint("https://evilfcm.googleapis.com.example/x", true); err == nil || !strings.Contains(err.Error(), "Push") {
		t.Errorf("look-alike host accepted")
	}
}

// The consent page warns when the way back does not lead to a known AI service or this computer (SA-10)
func TestKnownRedirectHost(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://claude.ai/api/mcp/auth_callback":      true,
		"https://chatgpt.com/connector_platform_oauth": true,
		"http://localhost:33418/callback":              true,
		"http://127.0.0.1:8765/cb":                     true,
		"https://claude.ai.evil.example/cb":            false,
		"https://evil.example/claude.ai":               false,
		"https://notclaude.ai/cb":                      false,
	} {
		if got := knownRedirectHost(raw); got != want {
			t.Errorf("knownRedirectHost(%q) = %v, want %v", raw, got, want)
		}
	}
}
