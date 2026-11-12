package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

const initialAdminPassword = "Kr0k0dil-im-Keller"

// captureLog collects the server's log lines for the rest of the test.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	before := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(before) })
	return &buf
}

// freshStore is an empty database (no account), as on the very first start.
func freshStore(t *testing.T) (*storage.Store, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "first_start.db")
	store, err := storage.NewStore(dbPath)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, dbPath
}

// startWith is one start of the server with these variables: NewServer and CreateInitialAdmin, as in main.
func startWith(t *testing.T, store *storage.Store, dbPath string, admin config.InitialAdmin, demo bool) (*Server, error) {
	t.Helper()
	srv := NewServer(&config.Config{
		Port:         "8080",
		DatabasePath: dbPath,
		JWTSecret:    "initial-admin-test-secret-0123456789abcdef",
		DemoMode:     demo,
		InitialAdmin: admin,
	}, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	return srv, srv.CreateInitialAdmin()
}

func postJSON(t *testing.T, router http.Handler, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func loginToken(t *testing.T, router http.Handler, login, password string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"login": login, "password": password})
	rec := postJSON(t, router, "/api/v1/auth/login", "", string(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("login as %q: %d %s", login, rec.Code, rec.Body.String())
	}
	var res struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	return res.Token
}

func meSetupPending(t *testing.T, router http.Handler, token string) bool {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("/auth/me: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		SetupPending bool `json:"setupPending"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	return res.SetupPending
}

// ADMIN_USER / ADMIN_PASSWORD / ADMIN_EMAIL create the admin on the first start; the setup endpoint is
// closed, the admin signs in with the username, the password appears nowhere in the log, and a second
// start with the same variables creates nothing more.
func TestInitialAdminFromEnvironment(t *testing.T) {
	logs := captureLog(t)
	store, dbPath := freshStore(t)
	admin := config.InitialAdmin{User: "Chef", Password: initialAdminPassword, Email: " Chef@Example.com "}
	srv, err := startWith(t, store, dbPath, admin, false)
	if err != nil {
		t.Fatalf("CreateInitialAdmin: %v", err)
	}
	if srv.cfg.InitialAdmin.Password != "" {
		t.Error("the password stays in memory after the start")
	}
	if n, _ := store.CountUsers(); n != 1 {
		t.Fatalf("accounts after the first start: %d, want 1", n)
	}
	u, err := store.GetUserByLogin("chef")
	if err != nil {
		t.Fatalf("admin not found by username: %v", err)
	}
	if u.Role != "admin" || u.Username != "chef" || u.Email != "chef@example.com" || u.DisplayName != "Chef" || !u.IsActive {
		t.Fatalf("admin = %+v", u)
	}
	if !store.SetupPending() {
		t.Error("the rest of the setup is not marked as pending")
	}

	router := srv.Router()
	// The status no longer asks for the wizard, and the setup endpoint is closed
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/status", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if strings.Contains(rec.Body.String(), `"needsSetup":true`) {
		t.Fatalf("status still needs setup: %s", rec.Body.String())
	}
	rec = postJSON(t, router, "/api/v1/auth/setup", "", `{"email":"evil@example.com","password":"secretpassword"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("setup after the admin from the environment: %d, want 403", rec.Code)
	}
	// Signing in works with the username and with the address
	token := loginToken(t, router, "Chef", initialAdminPassword)
	loginToken(t, router, "chef@example.com", initialAdminPassword)
	if !meSetupPending(t, router, token) {
		t.Error("/auth/me does not report setupPending to the admin")
	}

	if !strings.Contains(logs.String(), "First administrator created") || !strings.Contains(logs.String(), "username=chef") {
		t.Errorf("no log line about the new admin:\n%s", logs.String())
	}

	// Second start, same variables: nothing new, an info line instead
	logs.Reset()
	if _, err := startWith(t, store, dbPath, admin, false); err != nil {
		t.Fatalf("second start: %v", err)
	}
	if n, _ := store.CountUsers(); n != 1 {
		t.Fatalf("accounts after the second start: %d, want 1", n)
	}
	if !strings.Contains(logs.String(), "accounts already exist") {
		t.Errorf("no info line on the second start:\n%s", logs.String())
	}
	if strings.Contains(logs.String(), initialAdminPassword) {
		t.Fatal("the password is in the log")
	}
}

// Unusable variables stop the start with a message naming the variable (never the password) and create
// nothing, so the setup wizard is not left open by accident.
func TestInitialAdminRefusesBadValues(t *testing.T) {
	cases := []struct {
		name  string
		admin config.InitialAdmin
		want  string
	}{
		{"short password", config.InitialAdmin{User: "admin", Password: "kurz12"}, "ADMIN_PASSWORD is too short"},
		{"only spaces", config.InitialAdmin{User: "admin", Password: "          "}, "ADMIN_PASSWORD is not set"},
		{"password missing", config.InitialAdmin{User: "admin"}, "ADMIN_PASSWORD is not set"},
		{"user missing", config.InitialAdmin{Password: initialAdminPassword}, "ADMIN_USER is not set"},
		{"only email", config.InitialAdmin{Email: "admin@example.com"}, "ADMIN_USER is not set"},
		{"email as user", config.InitialAdmin{User: "admin@example.com", Password: initialAdminPassword}, "ADMIN_USER is not a valid username"},
		{"user with space", config.InitialAdmin{User: "Sandro Dach", Password: initialAdminPassword}, "ADMIN_USER is not a valid username"},
		{"bad email", config.InitialAdmin{User: "admin", Password: initialAdminPassword, Email: "Admin <admin@example.com>"}, "ADMIN_EMAIL is not a valid email address"},
		{"too long", config.InitialAdmin{User: "admin", Password: strings.Repeat("x", auth.MaxPasswordLength+1)}, "ADMIN_PASSWORD is too long"},
		{"password and file", config.InitialAdmin{User: "admin", Password: initialAdminPassword, PasswordFile: "/run/secrets/admin_password"}, "ADMIN_PASSWORD and ADMIN_PASSWORD_FILE are both set"},
		{"unreadable file", config.InitialAdmin{User: "admin", PasswordFile: "/nonexistent/admin_password"}, "reading ADMIN_PASSWORD_FILE failed: open /nonexistent/admin_password"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			logs := captureLog(t)
			store, dbPath := freshStore(t)
			_, err := startWith(t, store, dbPath, c.admin, false)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("error = %v, want %q", err, c.want)
			}
			if c.admin.Password != "" && strings.TrimSpace(c.admin.Password) != "" && strings.Contains(err.Error()+logs.String(), c.admin.Password) {
				t.Fatal("the password is in the error or the log")
			}
			if n, _ := store.CountUsers(); n != 0 {
				t.Fatalf("%d accounts created", n)
			}
		})
	}
}

// ADMIN_PASSWORD_FILE instead of ADMIN_PASSWORD (Docker secrets): the password from the file, without the
// line break at its end, signs in; neither it nor the file's content reaches the log.
func TestInitialAdminFromPasswordFile(t *testing.T) {
	logs := captureLog(t)
	store, dbPath := freshStore(t)
	path := filepath.Join(t.TempDir(), "admin_password")
	if err := os.WriteFile(path, []byte(initialAdminPassword+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	srv, err := startWith(t, store, dbPath, config.InitialAdmin{User: "admin", PasswordFile: path}, false)
	if err != nil {
		t.Fatalf("CreateInitialAdmin: %v", err)
	}
	u, err := store.GetUserByLogin("admin")
	if err != nil || u.Role != "admin" {
		t.Fatalf("admin from the file: %+v, %v", u, err)
	}
	loginToken(t, srv.Router(), "admin", initialAdminPassword)
	if strings.Contains(logs.String(), initialAdminPassword) {
		t.Fatal("the password is in the log")
	}
}

// With accounts in the database the variables do nothing, even unusable ones: they only act on the first
// start, and a leftover weak value must not stop a running instance.
func TestInitialAdminIgnoredWhenAccountsExist(t *testing.T) {
	logs := captureLog(t)
	store, dbPath := freshStore(t)
	if _, err := store.EnsureDefaultUser(); err != nil {
		t.Fatal(err)
	}
	for _, admin := range []config.InitialAdmin{
		{User: "neuer.admin", Password: initialAdminPassword},
		{User: "neuer.admin", Password: "kurz"},
		{User: "neuer.admin", PasswordFile: "/nonexistent/admin_password"},
	} {
		if _, err := startWith(t, store, dbPath, admin, false); err != nil {
			t.Fatalf("start with existing accounts: %v", err)
		}
	}
	if n, _ := store.CountUsers(); n != 1 {
		t.Fatalf("accounts: %d, want 1", n)
	}
	if _, err := store.GetUserByLogin("neuer.admin"); err == nil {
		t.Fatal("the variables created an account although accounts exist")
	}
	if store.SetupPending() {
		t.Fatal("setup marked as pending on an installed server")
	}
	if !strings.Contains(logs.String(), "accounts already exist") {
		t.Errorf("no info line:\n%s", logs.String())
	}
}

// The demo has its own accounts: the variables are ignored there (with a warning), even unusable ones.
func TestInitialAdminIgnoredInDemo(t *testing.T) {
	logs := captureLog(t)
	store, dbPath := freshStore(t)
	if _, err := startWith(t, store, dbPath, config.InitialAdmin{User: "admin", Password: "kurz"}, true); err != nil {
		t.Fatalf("demo start: %v", err)
	}
	if n, _ := store.CountUsers(); n != 0 {
		t.Fatalf("demo: %d accounts from the variables", n)
	}
	if !strings.Contains(logs.String(), "ignored in demo mode") {
		t.Errorf("no warning in demo mode:\n%s", logs.String())
	}
}

// Without ADMIN_EMAIL the admin has no address and signs in with the username; the wizard's instance
// settings come afterwards through /admin/setup, once.
func TestInitialAdminWithoutEmailFinishesSetup(t *testing.T) {
	captureLog(t)
	store, dbPath := freshStore(t)
	srv, err := startWith(t, store, dbPath, config.InitialAdmin{User: "admin", Password: initialAdminPassword}, false)
	if err != nil {
		t.Fatalf("CreateInitialAdmin: %v", err)
	}
	u, err := store.GetUserByLogin("admin")
	if err != nil || u.Email != "" {
		t.Fatalf("admin without address: %+v, %v", u, err)
	}
	router := srv.Router()
	token := loginToken(t, router, "admin", initialAdminPassword)

	// Not without signing in (the route sits behind the admin check)
	rec := postJSON(t, router, "/api/v1/admin/setup", "", `{}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("without sign-in: %d", rec.Code)
	}

	rec = postJSON(t, router, "/api/v1/admin/setup", token, `{"instanceName":"Zuhause","sharingMode":"organizations","allowRegistration":true,"defaultLanguage":"xx"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown language: %d", rec.Code)
	}
	rec = postJSON(t, router, "/api/v1/admin/setup", token, `{"instanceName":"Zuhause","sharingMode":"organizations","allowRegistration":true,"defaultLanguage":"en","createSampleData":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	sys, _ := store.GetSystemSettings()
	if sys.InstanceName != "Zuhause" || sys.RegistrationMode != storage.RegistrationOpen || sys.SharingMode != storage.SharingOrganizations || store.DefaultLanguageSetting() != "en" {
		t.Fatalf("settings not applied: %+v", sys)
	}
	orgs, _ := store.GetOrganizations()
	if len(orgs) != 1 || orgs[0].Name != "Zuhause" {
		t.Fatalf("first organization: %+v", orgs)
	}
	if store.Language(u.ID) != "en" {
		t.Errorf("admin language %q, want en", store.Language(u.ID))
	}
	if store.SetupPending() || meSetupPending(t, router, token) {
		t.Fatal("setup still pending after finishing it")
	}
	// Only once
	rec = postJSON(t, router, "/api/v1/admin/setup", token, `{"instanceName":"Anders"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("second finish: %d, want 409", rec.Code)
	}
}

// /auth/setup takes JSON only: a text/plain POST (what a form of another site can send without a CORS
// preflight) creates no admin.
func TestFirstBootSetupNeedsJSONContentType(t *testing.T) {
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
	router := srv.Router()
	body := `{"email":"owner@example.com","password":"secretpassword"}`
	for _, ct := range []string{"text/plain", "application/x-www-form-urlencoded", ""} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", strings.NewReader(body))
		if ct != "" {
			req.Header.Set("Content-Type", ct)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("Content-Type %q: %d, want 415", ct, rec.Code)
		}
	}
	if n, _ := store.CountUsers(); n != 0 {
		t.Fatalf("%d accounts created without JSON", n)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("JSON with charset: %d %s", rec.Code, rec.Body.String())
	}
}
