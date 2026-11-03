package storage

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrationsRunOnceAndRepairOldDatabases(t *testing.T) {
	path := filepath.Join(t.TempDir(), "migrate.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n)
	if n != len(migrations) {
		t.Fatalf("expected %d recorded migrations, got %d", len(migrations), n)
	}

	// A database from before the migration table, missing a later column
	if _, err := store.db.Exec(`ALTER TABLE thoughts DROP COLUMN alarm_failures`); err != nil {
		t.Fatal(err)
	}
	_, _ = store.db.Exec(`DROP TABLE schema_migrations`)
	_ = store.Close()

	store, err = NewStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if ok, _ := store.columnExists("thoughts", "alarm_failures"); !ok {
		t.Fatal("baseline must add missing columns to older databases")
	}

	// A failing step stops the start with its error and is not recorded
	saved := migrations
	defer func() { migrations = saved }()
	migrations = append(append([]migration{}, saved...), migration{999, "kaputt", func(*Store) error { return errors.New("boom") }})
	_ = store.Close()
	if _, err := NewStore(path); err == nil || !strings.Contains(err.Error(), "Migration 999") {
		t.Fatalf("failing migration must abort the start, got %v", err)
	}
}
