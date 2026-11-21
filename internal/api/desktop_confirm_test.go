package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func deleteJSON(t *testing.T, router http.Handler, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// The app's account has no password and no provider to confirm at; the person at the machine is the
// account, so the actions that ask a normal server for the password (or the provider) go through without.
func TestDesktopConfirmsDangerousActionsWithoutCredentials(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	var res struct {
		Token string      `json:"token"`
		User  domain.User `json:"user"`
	}
	if err := json.Unmarshal(desktopSession(t, router, desktopTestOrigin).Body.Bytes(), &res); err != nil || res.Token == "" {
		t.Fatalf("desktop session: %v", err)
	}
	if u, _ := store.GetUserByID(res.User.ID); u == nil || auth.HasPassword(u.PasswordHash) {
		t.Fatal("the app's account must have no password of its own")
	}
	if !srv.confirmsWithoutCredentials() {
		t.Error("desktop mode must confirm without credentials")
	}

	// Deleting all own data, without any password
	if _, err := store.CreateThought(res.User.ID, "Wegwerfen", "medium", "test", ""); err != nil {
		t.Fatalf("CreateThought: %v", err)
	}
	if rec := deleteJSON(t, router, "/api/v1/user/data", res.Token, ""); rec.Code != http.StatusOK {
		t.Fatalf("deleting the own data: %d %s", rec.Code, rec.Body.String())
	}
	if th, _ := store.GetThoughts(res.User.ID, "", 10); len(th) != 0 {
		t.Errorf("%d thoughts left after deleting the own data", len(th))
	}

	// The one account cannot be deleted (last administrator), but not for want of a password
	rec := deleteJSON(t, router, "/api/v1/user/account", res.Token, "")
	if rec.Code != http.StatusForbidden || strings.Contains(rec.Body.String(), "Passwort") || responseCode(t, rec.Body.Bytes()) == "oidc_confirm_required" {
		t.Errorf("deleting the account: %d %s, want the last-administrator refusal", rec.Code, rec.Body.String())
	}
	if n, _ := store.CountUsers(); n != 1 {
		t.Errorf("accounts: %d, want 1", n)
	}
}

// A normal server keeps asking: an account without a password (and without a provider) cannot confirm
// by nothing, and the answer is the request for the password.
func TestNormalServerStillAsksToConfirmDangerousActions(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	if srv.confirmsWithoutCredentials() {
		t.Fatal("a normal server must not confirm without credentials")
	}
	hash, err := auth.NoPasswordHash()
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.CreateUser("ohne@example.com", hash, "Ohne Passwort", "member")
	if err != nil {
		t.Fatal(err)
	}
	token, err := auth.GenerateToken(srv.cfg.JWTSecret, user.ID, user.Email, user.DisplayName, user.TokenVersion, testSession(t, store, user.ID))
	if err != nil {
		t.Fatal(err)
	}
	router := srv.Router()
	for _, path := range []string{"/api/v1/user/data", "/api/v1/user/account"} {
		if rec := deleteJSON(t, router, path, token, `{"password":""}`); rec.Code != http.StatusForbidden {
			t.Errorf("DELETE %s without confirmation: %d %s, want 403", path, rec.Code, rec.Body.String())
		}
	}
	if u, _ := store.GetUserByID(user.ID); u == nil {
		t.Error("the account was deleted without a confirmation")
	}
}
