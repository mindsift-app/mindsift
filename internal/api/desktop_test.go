package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

const desktopTestOrigin = "wails://localhost"

// startDesktop is one start of the desktop app's server on the store: the environment's settings first,
// then config.ApplyDesktop, as desktop/main.go does.
func startDesktop(t *testing.T, store *storage.Store, dbPath, platform string, env func(*config.Config)) *Server {
	t.Helper()
	cfg := &config.Config{
		Port:         "8080",
		DatabasePath: dbPath,
		JWTSecret:    "desktop-test-secret-0123456789abcdef",
	}
	if env != nil {
		env(cfg)
	}
	cfg.ApplyDesktop(config.Desktop{Platform: platform, Origin: desktopTestOrigin, Username: "Sandra", DisplayName: "Sandra Muster"})
	srv := NewServer(cfg, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	return srv
}

func desktopSession(t *testing.T, router http.Handler, origin string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/desktop", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// The first start creates the one account (admin, named after the system's user, no password of its own)
// with the short setup wizard still to come; the window gets a session for it without any sign-in, and a
// restart adds no account.
func TestDesktopFirstStartCreatesAccountAndSignsIn(t *testing.T) {
	t.Parallel()
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()

	users, err := store.GetAllUsers()
	if err != nil || len(users) != 1 {
		t.Fatalf("accounts after the first start: %d (%v), want 1", len(users), err)
	}
	u := users[0]
	if u.Role != domain.RoleAdmin || u.Username != "sandra" || u.DisplayName != "Sandra Muster" || u.Email != "" {
		t.Errorf("account: role %q username %q name %q email %q", u.Role, u.Username, u.DisplayName, u.Email)
	}
	if setupCodeOf(srv) != "" {
		t.Error("the desktop app must not make a setup code")
	}
	if !store.SetupPending() {
		t.Error("the desktop app's short setup wizard must follow the first start")
	}
	if sys, _ := store.GetSystemSettings(); store.SharingMode() != storage.SharingPrivate || sys == nil || sys.RegistrationMode != storage.RegistrationClosed {
		t.Errorf("first start: sharing %q, registration %v; want private and closed", store.SharingMode(), sys)
	}

	st := authStatusOf(t, router)
	if st["needsSetup"] != false {
		t.Errorf("needsSetup = %v", st["needsSetup"])
	}
	d, _ := st["desktop"].(map[string]any)
	if d["platform"] != "linux" || d["realtime"] != "sse" {
		t.Errorf("desktop status = %v, want linux with sse", st["desktop"])
	}
	for key, want := range map[string]any{"allowRegistration": false, "passkeys": false, "publicLinks": false, "passwordReset": false, "demoMode": false} {
		if st[key] != want {
			t.Errorf("status %s = %v, want %v", key, st[key], want)
		}
	}

	rec := desktopSession(t, router, desktopTestOrigin)
	if rec.Code != http.StatusOK {
		t.Fatalf("desktop session: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Token string      `json:"token"`
		User  domain.User `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil || res.Token == "" || res.User.ID != u.ID {
		t.Fatalf("session answer: %v %s", err, rec.Body.String())
	}
	if me := getWith(t, router, "/api/v1/auth/me", res.Token); me.Code != http.StatusOK {
		t.Fatalf("/auth/me with the desktop session: %d %s", me.Code, me.Body.String())
	}

	// Restart on the same database
	srv2 := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	if n, _ := store.CountUsers(); n != 1 {
		t.Errorf("accounts after a restart: %d, want 1", n)
	}
	if rec := desktopSession(t, srv2.Router(), desktopTestOrigin); rec.Code != http.StatusOK {
		t.Errorf("desktop session after a restart: %d %s", rec.Code, rec.Body.String())
	}
}

// Windows' webview buffers whole responses: the app polls instead of streaming.
func TestDesktopRealtimeOnWindowsIsPolling(t *testing.T) {
	t.Parallel()
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopWindows, nil)
	d, _ := authStatusOf(t, srv.Router())["desktop"].(map[string]any)
	if d["platform"] != "windows" || d["realtime"] != "poll" {
		t.Errorf("desktop status = %v, want windows with poll", d)
	}
}

// Only the app's own window gets a session: another origin or a cross-site request is refused, and a
// normal server has no such route at all.
func TestDesktopSessionOnlyForTheAppWindow(t *testing.T) {
	t.Parallel()
	store, dbPath := freshStore(t)
	router := startDesktop(t, store, dbPath, config.DesktopLinux, nil).Router()
	if rec := desktopSession(t, router, "https://evil.example"); rec.Code != http.StatusForbidden {
		t.Errorf("other origin: %d, want 403", rec.Code)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/desktop", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("cross-site: %d, want 403", rec.Code)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/desktop", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "text/plain")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("text/plain: %d, want 415", rec.Code)
	}

	srv, _, _ := setupTestServer(t)
	if rec := desktopSession(t, srv.Router(), ""); rec.Code != http.StatusNotFound {
		t.Errorf("normal server: %d, want 404", rec.Code)
	}
	if _, ok := authStatusOf(t, srv.Router())["desktop"]; ok {
		t.Error("a normal server must not report desktop mode")
	}
}

// What the environment sets cannot switch the demo, registration, mail or ADMIN_USER on in the app; the
// routes for registration, invites, the setup wizard and web push refuse.
func TestDesktopSwitchesOffWhatItCannotUse(t *testing.T) {
	store, dbPath := freshStore(t)
	on := true
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, func(c *config.Config) {
		c.DemoMode = true
		c.RegistrationMode = "open"
		c.SMTPHost = "mail.example.com"
		c.PublicLinks = &on
		c.CalendarFeeds = &on
		c.InitialAdmin = config.InitialAdmin{User: "root", Password: initialAdminPassword}
		c.BaseURL, c.BaseURLSet = "https://notes.example.com", true
	})
	router := srv.Router()
	if srv.cfg.DemoMode || !srv.cfg.SMTPDisabled || srv.publicLinksEnabled() || srv.calendarFeedsEnabled() || srv.cfg.InitialAdmin.Set() || srv.passkeysOn() {
		t.Error("desktop mode left something on that the app cannot use")
	}
	if err := srv.CreateInitialAdmin(); err != nil {
		t.Fatalf("CreateInitialAdmin: %v", err)
	}
	if n, _ := store.CountUsers(); n != 1 {
		t.Errorf("accounts: %d, want only the app's own", n)
	}

	token := func() string {
		var res struct{ Token string }
		_ = json.Unmarshal(desktopSession(t, router, desktopTestOrigin).Body.Bytes(), &res)
		return res.Token
	}()
	for _, path := range []string{"/api/v1/auth/register", "/api/v1/auth/setup", "/api/v1/admin/invites", "/api/v1/admin/users", "/api/v1/push/subscribe"} {
		rec := postJSON(t, router, path, token, `{"email":"a@example.com","password":"Kr0k0dil-im-Keller"}`)
		if rec.Code != http.StatusForbidden || responseCode(t, rec.Body.Bytes()) != "desktop_off" {
			t.Errorf("%s: %d %s, want 403 desktop_off", path, rec.Code, rec.Body.String())
		}
	}
	if rec := getWith(t, router, "/api/v1/push/key", token); rec.Code != http.StatusForbidden {
		t.Errorf("push key: %d, want 403", rec.Code)
	}
	// Kept: API keys for MCP
	if rec := postJSON(t, router, "/api/v1/keys", token, `{"name":"Agent"}`); rec.Code/100 != 2 {
		t.Errorf("creating an API key: %d %s", rec.Code, rec.Body.String())
	}

	// Cross-origin requests only from the app's window
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/status", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Access-Control-Request-Method", "GET")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("CORS for another origin: %q", got)
	}
}

func TestDesktopUsername(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{"sandra": "sandra", "Sandra": "sandra", `WORK\Sandra`: "sandra", "": "me", "Jürgen Öz": "me"} {
		if got := desktopUsername(in); got != want {
			t.Errorf("desktopUsername(%q) = %q, want %q", in, got, want)
		}
	}
}
