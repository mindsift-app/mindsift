package storage

import (
	"path/filepath"
	"testing"
	"time"
)

// Unconfirmed accounts disappear once their link expired, so the address is free again
func TestUnverifiedAccountsArePurged(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "verify.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	u, _ := store.CreateUser("neu@example.com", "hash", "Neu", "member")
	keep, _ := store.CreateUser("bleibt@example.com", "hash", "Bleibt", "member")
	if _, err := store.CreateEmailVerification(u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateEmailVerification(u.ID); err != ErrResetTooSoon {
		t.Fatalf("second mail within the cooldown must be refused, got %v", err)
	}
	if n := store.PurgeUnverifiedAccounts(time.Now()); n != 0 {
		t.Fatalf("nothing expired yet, purged %d", n)
	}
	if n := store.PurgeUnverifiedAccounts(time.Now().Add(EmailVerificationTTL + time.Hour)); n != 1 {
		t.Fatalf("want 1 purged, got %d", n)
	}
	if got, _ := store.GetUserByID(u.ID); got != nil {
		t.Fatal("unconfirmed account must be gone")
	}
	if got, _ := store.GetUserByID(keep.ID); got == nil {
		t.Fatal("other accounts stay")
	}
}
