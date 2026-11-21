package shell

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOwnPage(t *testing.T) {
	for _, tc := range []struct {
		address, origin string
		own             bool
	}{
		{"wails://localhost/", "wails://localhost", true},
		{"wails://localhost/__desktop/start", "wails://localhost", true},
		{"wails://localhost/notes/abc?x=1#y", "wails://localhost", true},
		{"WAILS://LocalHost/", "wails://localhost", true},
		{"http://wails.localhost/", "http://wails.localhost", true},
		{"http://wails.localhost/settings", "http://wails.localhost", true},
		// Servers, look-alikes and the other platform's origin
		{"https://demo.mindsift.app/", "wails://localhost", false},
		{"https://wails.localhost/", "http://wails.localhost", false},
		{"http://wails.localhost.evil.example/", "http://wails.localhost", false},
		{"http://wails.localhost:8080/", "http://wails.localhost", false},
		{"http://user@wails.localhost/", "http://wails.localhost", false},
		{"wails://localhost.evil/", "wails://localhost", false},
		{"http://localhost/", "wails://localhost", false},
		{"wails://localhost/", "http://wails.localhost", false},
		{"about:blank", "wails://localhost", false},
		{"data:text/html,<p>x</p>", "wails://localhost", false},
		{"/relative", "wails://localhost", false},
		{"", "wails://localhost", false},
		{"%zz", "wails://localhost", false},
	} {
		if got := OwnPage(tc.address, tc.origin); got != tc.own {
			t.Errorf("OwnPage(%q, %q) = %v, want %v", tc.address, tc.origin, got, tc.own)
		}
	}
}

func TestGuardWailsRoutes(t *testing.T) {
	const origin = "wails://localhost"
	reached := false
	h := GuardWailsRoutes(origin)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusNoContent)
	}))
	for _, tc := range []struct {
		name, method, path string
		headers            map[string]string
		pass               bool
	}{
		{"app route", "POST", "/api/v1/auth/desktop", map[string]string{"Origin": "https://evil.example"}, true},
		{"start view", "GET", "/__desktop/start", nil, true},
		{"runtime script", "GET", "/wails/runtime.js", map[string]string{"Sec-Fetch-Site": "cross-site"}, true},
		{"transport script", "GET", "/wails/transport.js", nil, true},
		{"runtime call of the own page", "POST", "/wails/runtime", map[string]string{"Origin": origin, "Sec-Fetch-Site": "same-origin"}, true},
		{"runtime call, origin in other case", "POST", "/wails/runtime", map[string]string{"Origin": "WAILS://localhost"}, true},
		{"runtime call of a server's page", "POST", "/wails/runtime", map[string]string{"Origin": "https://demo.mindsift.app"}, false},
		{"runtime call with origin null", "POST", "/wails/runtime", map[string]string{"Origin": "null"}, false},
		{"runtime call without origin", "POST", "/wails/runtime", nil, false},
		{"runtime call as an image", "GET", "/wails/runtime?object=2&method=2", map[string]string{"Sec-Fetch-Site": "cross-site"}, false},
		{"runtime call as a plain GET", "GET", "/wails/runtime?object=9&method=0", nil, false},
		{"own origin but cross-site", "POST", "/wails/runtime", map[string]string{"Origin": origin, "Sec-Fetch-Site": "cross-site"}, false},
		{"event payload", "GET", "/wails/eventpayload/1", map[string]string{"Origin": "https://evil.example"}, false},
		{"stream", "GET", "/wails/stream/x", nil, false},
		{"script posted to", "POST", "/wails/runtime.js", map[string]string{"Origin": "https://evil.example"}, false},
	} {
		reached = false
		req := httptest.NewRequest(tc.method, tc.path, nil)
		for k, v := range tc.headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if reached != tc.pass {
			t.Errorf("%s: reached = %v, want %v (status %d)", tc.name, reached, tc.pass, rec.Code)
		}
		if !tc.pass && rec.Code != http.StatusForbidden {
			t.Errorf("%s: status %d, want 403", tc.name, rec.Code)
		}
	}
}
