package storage

import (
	"path/filepath"
	"testing"
)

// Accounts from before the language choice keep German; new ones start without a choice.
func TestLanguageMigrationKeepsGerman(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "lang.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	old, _ := store.CreateUser("old@example.com", "hash", "Old", "member")
	if got := store.Language(old.ID); got != "" {
		t.Fatalf("new account should start without a choice, got %q", got)
	}
	// As if the account had existed when migration 19 ran
	if err := store.migrateLanguage(); err != nil {
		t.Fatal(err)
	}
	if got := store.Language(old.ID); got != "de" {
		t.Fatalf("existing account should keep German, got %q", got)
	}
	if err := store.SetLanguage(old.ID, "xx"); err != ErrInvalidLanguage {
		t.Fatalf("unknown language must be refused, got %v", err)
	}
	if err := store.SetLanguage(old.ID, ""); err != nil || store.Language(old.ID) != "" {
		t.Fatalf("empty choice follows the browser again: %v", err)
	}
}
