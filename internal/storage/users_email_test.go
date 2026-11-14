package storage

import (
	"context"
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
	s = withUniqueEmailColumn(t, s, path, "email TEXT UNIQUE NOT NULL")
	defer s.Close()
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

// withUniqueEmailColumn gives the users table a definition from before migration 40 (the column spelled
// as given), rebuilt for real so SQLite keeps the constraint's index, and reopens the store with migration
// 40 to run again.
func withUniqueEmailColumn(t *testing.T, s *Store, path, column string) *Store {
	t.Helper()
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var create string
	if err := conn.QueryRowContext(ctx, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`).Scan(&create); err != nil {
		t.Fatal(err)
	}
	old := strings.Replace(create, "email TEXT NOT NULL DEFAULT ''", column, 1)
	old = strings.Replace(strings.Replace(old, `CREATE TABLE "users"`, "CREATE TABLE users_old", 1), "CREATE TABLE users ", "CREATE TABLE users_old ", 1)
	if !strings.Contains(old, column) || !strings.Contains(old, "users_old") {
		t.Fatalf("unexpected definition: %s", create)
	}
	var indexes []string
	rows, err := conn.QueryContext(ctx, `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users' AND sql IS NOT NULL AND name != 'idx_users_email'`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var q string
		_ = rows.Scan(&q)
		indexes = append(indexes, q)
	}
	_ = rows.Close()
	steps := append([]string{`PRAGMA foreign_keys = OFF`, old, `INSERT INTO users_old SELECT * FROM users`, `DROP TABLE users`,
		`ALTER TABLE users_old RENAME TO users`}, indexes...)
	for _, q := range append(steps, `PRAGMA foreign_keys = ON`) {
		if _, err := conn.ExecContext(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	if unique, err := emailUnique(ctx, conn); err != nil || !unique {
		t.Fatalf("the old definition must have UNIQUE on email: %v %v", unique, err)
	}
	_ = conn.Close()
	_ = s.Close()
	s, err = NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`DELETE FROM schema_migrations WHERE id = 40`); err != nil {
		t.Fatal(err)
	}
	return s
}

// Migration 40 finds the constraint by the schema's index, not by how the definition spells it.
func TestMigrationFindsUniqueEmailSpelledOtherwise(t *testing.T) {
	for _, column := range []string{"email TEXT NOT NULL UNIQUE", "email text unique not null", "email TEXT NOT NULL UNIQUE DEFAULT ''"} {
		path := filepath.Join(t.TempDir(), "spelled.db")
		s, err := NewStore(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateUser("dora@example.com", "x", "Dora", "member"); err != nil {
			t.Fatal(err)
		}
		s = withUniqueEmailColumn(t, s, path, column)
		if err := s.migrateEmailOptional(); err != nil {
			t.Fatalf("%s: %v", column, err)
		}
		if unique, _ := emailUnique(context.Background(), s.db); unique {
			t.Fatalf("%s: the column keeps UNIQUE", column)
		}
		for _, name := range []string{"Ohne Eins", "Ohne Zwei"} {
			if _, err := s.CreateUser("", "x", name, "member"); err != nil {
				t.Fatalf("%s: account without address after the rebuild: %v", column, err)
			}
		}
		if _, err := s.CreateUser("dora@example.com", "x", "Dora Zwei", "member"); err == nil {
			t.Fatalf("%s: an address that is there must stay unique", column)
		}
		_ = s.Close()
	}
}

// Old orphans elsewhere in the database (a log entry of a note that no longer exists) do not stop the
// rebuild; foreign_key_check only fails it for references the rebuild broke.
func TestMigrationToleratesOldOrphans(t *testing.T) {
	path := filepath.Join(t.TempDir(), "orphans.db")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.CreateUser("carla@example.com", "x", "Carla", "member")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{`PRAGMA foreign_keys = OFF`,
		`INSERT INTO doc_ops (doc_id, seq, kind, payload, created_at) VALUES ('doc_gone', 1, 'insert', '{}', '2026-01-01T00:00:00Z')`,
		`PRAGMA foreign_keys = ON`} {
		if _, err := conn.ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	_ = conn.Close()
	s = withUniqueEmailColumn(t, s, path, "email TEXT UNIQUE NOT NULL")
	defer s.Close()
	if err := s.migrateEmailOptional(); err != nil {
		t.Fatalf("an old orphan stopped the migration: %v", err)
	}
	if got, err := s.GetUserByID(u.ID); err != nil || got.Email != "carla@example.com" {
		t.Fatalf("account after the rebuild: %v %v", got, err)
	}
	var orphans int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM doc_ops WHERE doc_id = 'doc_gone'`).Scan(&orphans)
	if orphans != 1 {
		t.Fatal("the migration is not meant to clean up old orphans")
	}
	if _, err := s.CreateUser("", "x", "Ohne", "member"); err != nil {
		t.Fatalf("account without address after the rebuild: %v", err)
	}
}
