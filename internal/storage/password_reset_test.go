package storage

import (
	"path/filepath"
	"testing"
)

func TestPasswordResetToken(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "reset.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	u, _ := store.CreateUser("anna@example.com", "old", "Anna", "member")

	raw, err := store.CreatePasswordResetToken(u.ID)
	if err != nil || len(raw) != 64 {
		t.Fatalf("token: %q %v", raw, err)
	}
	var stored string
	_ = store.db.QueryRow(`SELECT token_hash FROM password_reset_tokens`).Scan(&stored)
	if stored == raw {
		t.Fatalf("only the hash may be stored")
	}
	if _, err := store.CreatePasswordResetToken(u.ID); err != ErrResetTooSoon {
		t.Errorf("second request within the cooldown must be refused, got %v", err)
	}

	before, _ := store.GetUserByID(u.ID)
	if _, err := store.ResetPasswordWithToken("falsch", "new"); err != ErrResetTokenInvalid {
		t.Errorf("unknown token must fail")
	}
	if id, err := store.ResetPasswordWithToken(raw, "new"); err != nil || id != u.ID {
		t.Fatalf("reset: %v", err)
	}
	after, _ := store.GetUserByID(u.ID)
	if after.PasswordHash != "new" || after.TokenVersion != before.TokenVersion+1 {
		t.Errorf("password not changed or sessions not ended: %+v", after)
	}
	if _, err := store.ResetPasswordWithToken(raw, "again"); err != ErrResetTokenInvalid {
		t.Errorf("a token works only once")
	}

	// Expired tokens fail
	_, _ = store.db.Exec(`DELETE FROM password_reset_tokens`)
	raw2, _ := store.CreatePasswordResetToken(u.ID)
	_, _ = store.db.Exec(`UPDATE password_reset_tokens SET expires_at = '2000-01-01T00:00:00Z'`)
	if _, err := store.ResetPasswordWithToken(raw2, "x"); err != ErrResetTokenInvalid {
		t.Errorf("expired token must fail")
	}
}
