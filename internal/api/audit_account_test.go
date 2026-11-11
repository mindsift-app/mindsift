package api

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func sendWith(t *testing.T, router http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// userWithPassword creates a member with a real password and a token for them.
func userWithPassword(t *testing.T, srv *Server, store *storage.Store, email, password, role string) (string, string) {
	t.Helper()
	hash, _ := auth.HashPassword(password)
	u, err := store.CreateUser(email, hash, "Anna", role)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	tok, _ := auth.GenerateToken(srv.cfg.JWTSecret, u.ID, u.Email, u.DisplayName, u.TokenVersion, testSession(t, store, u.ID))
	return u.ID, tok
}

// Deleting data or the account asks for the password: wrong guesses count like failed logins (SA-01)
func TestPasswordConfirmationIsGuarded(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	_, tok := userWithPassword(t, srv, store, "anna@example.com", "richtig-geheim", "member")
	for i := 0; i < loginLimitAccountIP; i++ {
		if rec := sendWith(t, router, http.MethodDelete, "/api/v1/user/data", tok, map[string]string{"password": "falsch"}); rec.Code != http.StatusForbidden {
			t.Fatalf("guess %d: want 403, got %d", i+1, rec.Code)
		}
	}
	// Locked now, even the right password is refused for a while
	if rec := sendWith(t, router, http.MethodDelete, "/api/v1/user/data", tok, map[string]string{"password": "richtig-geheim"}); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("after too many guesses: want 429, got %d: %s", rec.Code, rec.Body)
	}
}

// Mail alarms and test mails go to the confirmed login address, never to a target in the request, and
// follow a confirmed change of that address (SA-02, SA-11); only a few test mails at a time
func TestAlarmMailsGoToTheLoginAddress(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	id, tok := userWithPassword(t, srv, store, "anna@example.com", "richtig-geheim", "member")
	f := startFakeSMTP(t, "")
	host, port, _ := net.SplitHostPort(f.addr)
	sys, _ := store.GetSystemSettings()
	sys.SMTPHost, sys.SMTPPort, sys.SMTPUser, sys.SMTPPass, sys.SMTPFrom = host, port, "alarm@firma.de", "geheim", "alarm@firma.de"
	sys.SMTPTLS, sys.SMTPSkipVerify = true, true
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	rcpts := func() string {
		f.mu.Lock()
		defer f.mu.Unlock()
		return strings.Join(f.rcpts, " ")
	}

	rec := sendWith(t, router, http.MethodPost, "/api/v1/auth/alarms/test", tok, map[string]string{"channel": "email", "target": "fremd@example.org"})
	if rec.Code != http.StatusOK || !strings.Contains(rcpts(), "anna@example.com") || strings.Contains(rcpts(), "fremd") {
		t.Fatalf("test mail with a stranger as target: %d %s, sent to %q", rec.Code, rec.Body, rcpts())
	}
	raw, err := store.RequestEmailChange(id, storage.EmailChangeAccount, "anna.neu@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if rec := sendWith(t, router, http.MethodPost, "/api/v1/auth/confirm-email", "", map[string]string{"token": raw}); rec.Code != http.StatusOK {
		t.Fatalf("confirm: %d %s", rec.Code, rec.Body)
	}
	if rec := sendWith(t, router, http.MethodPost, "/api/v1/auth/alarms/test", tok, map[string]string{"channel": "email"}); rec.Code != http.StatusOK || !strings.Contains(rcpts(), "anna.neu@example.com") {
		t.Fatalf("after the change of the login address: %d %s, sent to %q", rec.Code, rec.Body, rcpts())
	}
	for i := 2; i < limitTestAlarmPerUser; i++ {
		sendWith(t, router, http.MethodPost, "/api/v1/auth/alarms/test", tok, map[string]string{"channel": "email"})
	}
	if rec := sendWith(t, router, http.MethodPost, "/api/v1/auth/alarms/test", tok, map[string]string{"channel": "email"}); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("too many tests: want 429, got %d", rec.Code)
	}
}

// A new login address waits for its link; the old one stays in use until then (SA-02, SA-11)
func TestNewAddressesWaitForConfirmation(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	id, tok := userWithPassword(t, srv, store, "anna@example.com", "richtig-geheim", "member")
	other, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")

	if rec := sendWith(t, router, http.MethodPatch, "/api/v1/auth/settings", tok, map[string]string{"email": other.Email, "currentPassword": "richtig-geheim"}); rec.Code != http.StatusConflict {
		t.Fatalf("taken address: want 409, got %d", rec.Code)
	}
	rec := sendWith(t, router, http.MethodPatch, "/api/v1/auth/settings", tok, map[string]string{
		"email": "Anna.Neu@example.com", "currentPassword": "richtig-geheim", "alarmEmail": "alarm@example.org",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("settings: %d %s", rec.Code, rec.Body)
	}
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["email"] != "anna@example.com" || got["pendingEmail"] != "anna.neu@example.com" || strings.Contains(rec.Body.String(), "alarm@example.org") {
		t.Fatalf("the login address must wait, an alarm address is ignored: %v", got)
	}

	// The login address: taken once confirmed, a link works once, unless someone else got the address
	raw, _ := store.RequestEmailChange(id, storage.EmailChangeAccount, "anna2@example.com")
	if rec := sendWith(t, router, http.MethodPost, "/api/v1/auth/confirm-email", "", map[string]string{"token": raw}); rec.Code != http.StatusOK {
		t.Fatalf("confirm login address: %d %s", rec.Code, rec.Body)
	}
	if u, _ := store.GetUserByID(id); u.Email != "anna2@example.com" {
		t.Fatalf("login address not taken: %q", u.Email)
	}
	if rec := sendWith(t, router, http.MethodPost, "/api/v1/auth/confirm-email", "", map[string]string{"token": raw}); rec.Code != http.StatusBadRequest {
		t.Fatalf("a link works once: got %d", rec.Code)
	}
	raw, _ = store.RequestEmailChange(id, storage.EmailChangeAccount, "ben@example.com")
	if rec := sendWith(t, router, http.MethodPost, "/api/v1/auth/confirm-email", "", map[string]string{"token": raw}); rec.Code != http.StatusConflict {
		t.Fatalf("address taken meanwhile: want 409, got %d", rec.Code)
	}
}

// The admin user list leaves out alarm targets and the token version (SA-03)
func TestAdminUserListHidesAlarmTargets(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	router := srv.Router()
	_, adminTok := userWithPassword(t, srv, store, "chef@example.com", "richtig-geheim", "admin")
	memberID, _ := userWithPassword(t, srv, store, "anna@example.com", "richtig-geheim", "member")
	discord := "https://discord.com/api/webhooks/42/SECRET-TOKEN"
	custom := "https://hook.example.com/secret"
	if _, err := store.UpdateUserFull(memberID, nil, nil, nil, nil, nil, &discord, &custom, nil, nil); err != nil {
		t.Fatalf("set webhooks: %v", err)
	}
	rec := getWith(t, router, "/api/v1/admin/users", adminTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin users: %d", rec.Code)
	}
	body := rec.Body.String()
	for _, leaked := range []string{"SECRET-TOKEN", "hook.example.com", "privat@example.org", "tokenVersion", "alarmChannels"} {
		if strings.Contains(body, leaked) {
			t.Errorf("admin list leaks %q", leaked)
		}
	}
	if !strings.Contains(body, "anna@example.com") {
		t.Errorf("the login address stays: %s", body)
	}
}
