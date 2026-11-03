package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	srv, _, _ := setupTestServer(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	req.Host = "notes.example.com"
	srv.Router().ServeHTTP(rec, req)
	csp := rec.Header().Get("Content-Security-Policy")
	for _, want := range []string{"script-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "wss://notes.example.com"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP lacks %q: %s", want, csp)
		}
	}
	if strings.Contains(csp, "unsafe-eval") || strings.Contains(strings.Split(strings.Split(csp, "script-src")[1], ";")[0], "unsafe-inline") {
		t.Errorf("scripts must not allow inline or eval: %s", csp)
	}
	for k, v := range map[string]string{"X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin"} {
		if rec.Header().Get(k) != v {
			t.Errorf("%s = %q, want %q", k, rec.Header().Get(k), v)
		}
	}
	// A Host header with quotes or semicolons must not be able to extend the policy
	if p := contentSecurityPolicy("evil.com; script-src *"); strings.Contains(p, "evil.com") {
		t.Errorf("host must not be copied into the policy unchecked: %s", p)
	}
}
