package storage

import (
	"path/filepath"
	"testing"
)

// A new account is not asked yet; the answer is kept per account.
func TestTourOfferedFlag(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "tour.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	if store.TourOffered(anna.ID) {
		t.Fatal("a new account must not count as asked")
	}
	if err := store.SetTourOffered(anna.ID, true); err != nil || !store.TourOffered(anna.ID) {
		t.Fatalf("answer not stored: %v", err)
	}
	if store.TourOffered(ben.ID) {
		t.Fatal("the answer belongs to one account only")
	}
	if err := store.SetTourOffered(anna.ID, false); err != nil || store.TourOffered(anna.ID) {
		t.Fatalf("reset not stored: %v", err)
	}
}

// Accounts from before the update count as asked, accounts created afterwards do not.
func TestTourOfferMigrationMarksExistingAccounts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tour-migrate.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	old, _ := store.CreateUser("old@example.com", "hash", "Old", "member")
	// The database as it was before migration 36
	if _, err := store.db.Exec(`ALTER TABLE users DROP COLUMN tour_offered`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`DELETE FROM schema_migrations WHERE id = 36`); err != nil {
		t.Fatal(err)
	}
	_ = store.Close()

	store, err = NewStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer store.Close()
	if !store.TourOffered(old.ID) {
		t.Fatal("an existing account must count as asked after the update")
	}
	fresh, _ := store.CreateUser("new@example.com", "hash", "New", "member")
	if store.TourOffered(fresh.ID) {
		t.Fatal("an account created after the update must be asked")
	}
	// Opening again does not run the step twice: the new account stays unasked
	_ = store.Close()
	store, err = NewStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if store.TourOffered(fresh.ID) {
		t.Fatal("the migration must run only once")
	}
}
