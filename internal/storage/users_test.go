package storage

import (
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A new role or a lock raises the token version (every session of the account is signed out); other
// changes, the same role again or unlocking do not
func TestUpdateUserBumpsTokenVersionOnRoleAndLock(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	u, _ := store.CreateUser("bert@example.com", "hash", "Bert", domain.RoleMember)
	version := func() int {
		t.Helper()
		got, err := store.GetUserByID(u.ID)
		if err != nil {
			t.Fatal(err)
		}
		return got.TokenVersion
	}
	str := func(v string) *string { return &v }
	boolean := func(v bool) *bool { return &v }

	v := version()
	if _, err := store.UpdateUser(u.ID, str("Bert B."), nil, nil, nil, nil, nil); err != nil || version() != v {
		t.Fatalf("a new display name must not sign out: %v, version %d → %d", err, v, version())
	}
	if _, err := store.UpdateUser(u.ID, nil, nil, str(domain.RoleMember), nil, nil, nil); err != nil || version() != v {
		t.Fatalf("the same role again must not sign out: %v", err)
	}
	if _, err := store.UpdateUser(u.ID, nil, nil, str(domain.RoleAdmin), nil, nil, nil); err != nil || version() != v+1 {
		t.Fatalf("a new role must sign out: %v, version %d → %d", err, v, version())
	}
	if _, err := store.UpdateUser(u.ID, nil, nil, str("kaiser"), nil, nil, nil); err != nil || version() != v+1 {
		t.Fatalf("an unknown role changes nothing: %v", err)
	}
	if _, err := store.UpdateUser(u.ID, nil, nil, nil, boolean(false), nil, nil); err != nil || version() != v+2 {
		t.Fatalf("locking must sign out: %v, version %d", err, version())
	}
	if _, err := store.UpdateUser(u.ID, nil, nil, nil, boolean(false), nil, nil); err != nil || version() != v+2 {
		t.Fatalf("locking a locked account again changes nothing: %v", err)
	}
	if _, err := store.UpdateUser(u.ID, nil, nil, nil, boolean(true), nil, nil); err != nil || version() != v+2 {
		t.Fatalf("unlocking must not raise the version: %v", err)
	}
}

// A reset by the administration may ask for a new own password; any password the person sets (in the
// settings or through the mail link) clears the request, as does a reset without it
func TestMustChangePasswordFlag(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "must.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	u, _ := store.CreateUser("bert@example.com", "hash", "Bert", domain.RoleMember)
	must := func() bool {
		t.Helper()
		got, err := store.GetUserByID(u.ID)
		if err != nil {
			t.Fatal(err)
		}
		return got.MustChangePassword
	}
	if must() {
		t.Fatal("not asked for by default")
	}
	if err := store.ResetPassword(u.ID, "admin", true); err != nil || !must() {
		t.Fatalf("reset with the request: %v", err)
	}
	if err := store.UpdateUserPassword(u.ID, "own"); err != nil || must() {
		t.Fatalf("own password clears it: %v", err)
	}
	_ = store.ResetPassword(u.ID, "admin", true)
	if err := store.ResetPassword(u.ID, "admin2", false); err != nil || must() {
		t.Fatalf("reset without the request clears it: %v", err)
	}
	_ = store.ResetPassword(u.ID, "admin", true)
	raw, err := store.CreatePasswordResetToken(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResetPasswordWithToken(raw, "via-mail"); err != nil || must() {
		t.Fatalf("the mail link clears it: %v", err)
	}
	// Listed accounts carry it as well
	_ = store.ResetPassword(u.ID, "admin", true)
	all, _ := store.GetAllUsers()
	for _, a := range all {
		if a.ID == u.ID && !a.MustChangePassword {
			t.Fatal("GetAllUsers must read the flag")
		}
	}
	// No keys: nothing to revoke, no error
	if keys, grants, err := store.RevokeAPIAccess(u.ID); err != nil || keys != 0 || grants != 0 {
		t.Fatalf("revoke without keys: %d %d %v", keys, grants, err)
	}
}
