package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// newTestUserWithRole is newTestUser with another role. The token is made after the role is set: a new
// role signs the account out (token version).
func newTestUserWithRole(t *testing.T, store *storage.Store, email, role string) (*domain.User, string) {
	t.Helper()
	u, err := store.CreateUser(email, "hash", strings.Split(email, "@")[0], role)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	tok, err := auth.GenerateToken(testJWTSecret, u.ID, u.Email, u.DisplayName, u.TokenVersion, testSession(t, store, u.ID))
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	return u, tok
}

// A new role from the administration signs the account out everywhere (token version), so its sessions
// start again with the new rights; a change of the display name does not
func TestAdminRoleChangeSignsOut(t *testing.T) {
	srv, store, admin := setupTestServer(t)
	router := srv.Router()
	member, token := newTestUser(t, store, "rolle@example.com")
	if rec := sessionCall(router, "GET", "/api/v1/auth/me", token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("session before: %d", rec.Code)
	}
	if rec := sessionCall(router, "PATCH", "/api/v1/admin/users/"+member.ID, admin, `{"displayName":"Rolle R."}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, "GET", "/api/v1/auth/me", token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("a new display name must keep the session: %d", rec.Code)
	}
	if rec := sessionCall(router, "PATCH", "/api/v1/admin/users/"+member.ID, admin, `{"role":"manager"}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("role change: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, "GET", "/api/v1/auth/me", token, "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("a new role must sign the account out: %d", rec.Code)
	}
}
