package storage

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestSeveralAccountsWithoutAddress(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, name := range []string{"Ohne Eins", "Ohne Zwei"} {
		if _, err := s.CreateUser("", "x", name, "member"); err != nil {
			t.Fatalf("account without address %q: %v", name, err)
		}
	}
	if _, err := s.CreateUser("anna@example.com", "x", "Anna", "member"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("anna@example.com", "x", "Anna Zwei", "member"); err == nil {
		t.Fatal("an address that is there must stay unique")
	}
	if s.EmailInUse("") {
		t.Fatal("no address is never in use")
	}
}

// When two requests take the same address at once, the second one past the check meets the unique index:
// that is ErrEmailTaken (409 for clients), not a raw database error (500)
func TestTakenAddressIsErrEmailTaken(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.CreateUser("anna@example.com", "x", "Anna", "member"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("Anna@Example.com", "x", "Anna Zwei", "member"); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("create with a taken address: %v", err)
	}
	ben, err := s.CreateUser("ben@example.com", "x", "Ben", "member")
	if err != nil {
		t.Fatal(err)
	}
	taken := "anna@example.com"
	if _, err := s.UpdateUser(ben.ID, nil, &taken, nil, nil, nil, nil); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("update to a taken address: %v", err)
	}
	name := "Ben\nBcc: x@example.com"
	if u, err := s.UpdateUser(ben.ID, &name, nil, nil, nil, nil, nil); err != nil || u.DisplayName != "Ben Bcc: x@example.com" {
		t.Fatalf("display name not stored in one line: %v %+v", err, u)
	}
}

// A database from before migration 40 (UNIQUE on the column) is rebuilt with its rows and references.
func TestMigrationKeepsAccountsAndReferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.CreateUser("bert@example.com", "x", "Bert", "member")
	if err != nil {
		t.Fatal(err)
	}
	sid, err := s.CreateSession(u.ID, "test", "127.0.0.1", SessionViaPassword)
	if err != nil {
		t.Fatal(err)
	}
	// Back to the old definition, as databases of earlier versions have it, and the migration run again
	if _, err := s.db.Exec(`DROP INDEX IF EXISTS idx_users_email`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`PRAGMA writable_schema = ON`); err != nil {
		t.Fatal(err)
	}
	var create string
	if err := s.db.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`).Scan(&create); err != nil {
		t.Fatal(err)
	}
	old := strings.Replace(create, "email TEXT NOT NULL DEFAULT ''", "email TEXT UNIQUE NOT NULL", 1)
	if _, err := s.db.Exec(`UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = 'users'`, old); err != nil {
		t.Fatal(err)
	}
	_, _ = s.db.Exec(`PRAGMA writable_schema = OFF`)
	_ = s.Close()
	s, err = NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.db.Exec(`DELETE FROM schema_migrations WHERE id = 40`); err != nil {
		t.Fatal(err)
	}
	if err := s.migrateEmailOptional(); err != nil {
		t.Fatal(err)
	}
	if got, err := s.GetUserByID(u.ID); err != nil || got.Email != "bert@example.com" {
		t.Fatalf("account after the rebuild: %v %v", got, err)
	}
	if !s.SessionActive(sid, u.ID) {
		t.Fatal("the session must survive the rebuild")
	}
	for _, name := range []string{"Ohne Eins", "Ohne Zwei"} {
		if _, err := s.CreateUser("", "x", name, "member"); err != nil {
			t.Fatalf("account without address after the rebuild: %v", err)
		}
	}
}
