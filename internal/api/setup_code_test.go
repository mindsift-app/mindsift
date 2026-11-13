package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/config"
)

// withSetupCode adds the server's setup code to a /auth/setup body (a JSON object), as the wizard does
// after reading it from the log; without a code the body stays as it is.
func withSetupCode(srv *Server, body string) string {
	srv.setupCode.mu.Lock()
	code := srv.setupCode.code
	srv.setupCode.mu.Unlock()
	if code == "" {
		return body
	}
	return `{"setupCode":"` + code + `",` + strings.TrimPrefix(strings.TrimSpace(body), "{")
}

func setupCodeOf(srv *Server) string {
	srv.setupCode.mu.Lock()
	defer srv.setupCode.mu.Unlock()
	return srv.setupCode.code
}

func authStatusOf(t *testing.T, router http.Handler) map[string]any {
	t.Helper()
	rec := getWith(t, router, "/api/v1/auth/status", "")
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("status: %v %s", err, rec.Body.String())
	}
	return out
}

func responseCode(t *testing.T, body []byte) string {
	t.Helper()
	var out struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(body, &out)
	return out.Code
}

var setupCodeFormat = regexp.MustCompile(`^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$`)

func TestSetupCodeFormat(t *testing.T) {
	seen := map[string]bool{}
	for range 200 {
		c := newSetupCode()
		if !setupCodeFormat.MatchString(c) {
			t.Fatalf("code %q: want three groups of four unambiguous signs", c)
		}
		seen[c] = true
	}
	if len(seen) < 200 {
		t.Fatal("codes repeat")
	}
	if got := normalizeSetupCode(" abcd-efgh jkmn "); got != "ABCDEFGHJKMN" {
		t.Fatalf("normalize: %q", got)
	}
}

// A fresh server without ADMIN_USER logs a code; the setup needs it, and once the admin exists it is gone.
func TestFirstBootSetupNeedsSetupCode(t *testing.T) {
	var logged bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logged, nil)))
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
	slog.SetDefault(prev)
	router := srv.Router()

	m := regexp.MustCompile(`Setup code: ([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}) – enter it in the setup wizard`).FindStringSubmatch(logged.String())
	if m == nil {
		t.Fatalf("no setup code in the log: %s", logged.String())
	}
	code := m[1]
	if normalizeSetupCode(code) != setupCodeOf(srv) {
		t.Fatalf("logged code %s is not the one the server checks", code)
	}
	if st := authStatusOf(t, router); st["needsSetup"] != true || st["setupCodeRequired"] != true {
		t.Fatalf("status must ask for the code: %+v", st)
	}

	body := func(extra string) string {
		return `{"email":"chefin@example.com","password":"secretpassword"` + extra + `}`
	}
	rec := postJSONLang(t, router, "/api/v1/auth/setup", "", body(""), "de")
	if rec.Code != http.StatusForbidden || responseCode(t, rec.Body.Bytes()) != "setup_code_required" || !strings.Contains(rec.Body.String(), "Einrichtungscode erforderlich") {
		t.Fatalf("without code: %d %s, want 403 setup_code_required", rec.Code, rec.Body.String())
	}
	rec = postJSONLang(t, router, "/api/v1/auth/setup", "", body(`,"setupCode":"AAAA-BBBB-CCCC"`), "de")
	if rec.Code != http.StatusForbidden || responseCode(t, rec.Body.Bytes()) != "setup_code_invalid" || !strings.Contains(rec.Body.String(), "Der Einrichtungscode stimmt nicht") {
		t.Fatalf("wrong code: %d %s, want 403 setup_code_invalid", rec.Code, rec.Body.String())
	}
	// English for an English browser
	rec = postJSONLang(t, router, "/api/v1/auth/setup", "", body(`,"setupCode":"AAAA-BBBB-CCCD"`), "en")
	if !strings.Contains(rec.Body.String(), "The setup code is wrong") {
		t.Fatalf("English message: %s", rec.Body.String())
	}
	if n, _ := store.CountUsers(); n != 0 {
		t.Fatalf("%d accounts created without the right code", n)
	}
	// Typed in lower case without dashes still counts
	typed := strings.ToLower(strings.ReplaceAll(code, "-", ""))
	rec = postJSON(t, router, "/api/v1/auth/setup", "", body(`,"setupCode":"`+typed+`"`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("right code: %d %s", rec.Code, rec.Body.String())
	}
	if u, _ := store.GetUserByEmail("chefin@example.com"); u == nil || u.Role != "admin" {
		t.Fatalf("admin not created: %+v", u)
	}
	if setupCodeOf(srv) != "" {
		t.Fatal("the code must be gone once the admin exists")
	}
	if st := authStatusOf(t, router); st["setupCodeRequired"] != false {
		t.Fatalf("status after setup: %+v", st)
	}
	rec = postJSON(t, router, "/api/v1/auth/setup", "", `{"email":"zweite@example.com","password":"secretpassword","setupCode":"`+code+`"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("code after the setup: %d, want 403", rec.Code)
	}
}

// Wrong codes lock the address like failed sign-ins; other addresses can still set up.
func TestSetupCodeRateLimited(t *testing.T) {
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
	router := srv.Router()
	post := func(ip, code string) int {
		body := `{"email":"chefin@example.com","password":"secretpassword","setupCode":"` + code + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = ip + ":40000"
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}
	for i := 0; i < loginLimitAccountIP; i++ {
		if c := post("203.0.113.7", "AAAA-BBBB-CCCC"); c != http.StatusForbidden {
			t.Fatalf("wrong code %d: %d", i+1, c)
		}
	}
	if c := post("203.0.113.7", setupCodeOf(srv)); c != http.StatusTooManyRequests {
		t.Fatalf("after %d wrong codes: %d, want 429", loginLimitAccountIP, c)
	}
	if n, _ := store.CountUsers(); n != 0 {
		t.Fatal("a locked address created the admin")
	}
	// The real admin from another address is not locked out
	if c := post("198.51.100.20", setupCodeOf(srv)); c != http.StatusCreated {
		t.Fatalf("other address with the right code: %d, want 201", c)
	}
}

// The demo and a server with ADMIN_USER need no code, and register no first admin either.
func TestSetupCodeNotInDemoOrWithAdminUser(t *testing.T) {
	store, dbPath := freshStore(t)
	demo, _ := startWith(t, store, dbPath, config.InitialAdmin{}, true)
	if setupCodeOf(demo) != "" {
		t.Fatal("the demo needs no setup code")
	}
	if st := authStatusOf(t, demo.Router()); st["setupCodeRequired"] != false {
		t.Fatalf("demo status: %+v", st)
	}
	if rec := postJSON(t, demo.Router(), "/api/v1/auth/setup", "", `{"email":"demo@example.com","password":"secretpassword"}`); rec.Code != http.StatusCreated {
		t.Fatalf("demo setup without code: %d %s", rec.Code, rec.Body.String())
	}

	store, dbPath = freshStore(t)
	srv, err := startWith(t, store, dbPath, config.InitialAdmin{User: "chef", Password: "Geheimes-Passwort-1"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if setupCodeOf(srv) != "" {
		t.Fatal("ADMIN_USER needs no setup code")
	}
	if st := authStatusOf(t, srv.Router()); st["setupCodeRequired"] != false || st["needsSetup"] != false {
		t.Fatalf("status with ADMIN_USER: %+v", st)
	}
	loginToken(t, srv.Router(), "chef", "Geheimes-Passwort-1")
}

// A restart with an existing account makes no code.
func TestNoSetupCodeOnceAnAccountExists(t *testing.T) {
	srv, _, _ := setupTestServer(t)
	if setupCodeOf(srv) != "" {
		t.Fatal("a server with accounts needs no setup code")
	}
}

// Registration cannot create the first account past the setup and its code.
func TestRegisterRefusedBeforeSetup(t *testing.T) {
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
	rec := sessionCall(srv.Router(), "POST", "/api/v1/auth/register", "", `{"email":"frueh@example.com","password":"secretpassword"}`, "")
	if rec.Code != http.StatusForbidden || responseCode(t, rec.Body.Bytes()) != "setup_required" {
		t.Fatalf("register before the setup: %d %s, want 403 setup_required", rec.Code, rec.Body.String())
	}
	if n, _ := store.CountUsers(); n != 0 {
		t.Fatal("registration created the first account")
	}
}
