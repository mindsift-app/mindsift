package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func autoVacuumOf(t *testing.T, s *Store) int {
	t.Helper()
	mode, err := s.autoVacuumMode()
	if err != nil {
		t.Fatal(err)
	}
	return mode
}

// fillAndEmpty writes about 12 MB into a table of its own and drops it, so that many pages are free.
func fillAndEmpty(t *testing.T, s *Store) {
	t.Helper()
	for _, q := range []string{`CREATE TABLE junk (x BLOB)`,
		`WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 3000) INSERT INTO junk SELECT randomblob(4096) FROM c`,
		`DROP TABLE junk`} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
}

// A new database has incremental auto_vacuum, and ReclaimFreePages gives the pages freed by deletes back
// to the file system, at most reclaimMaxBytes per call and only when enough of the file is free.
func TestReclaimFreePages(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "reclaim.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if mode := autoVacuumOf(t, s); mode != 2 {
		t.Fatalf("a new database should have incremental auto_vacuum, has %d", mode)
	}
	if n, err := s.ReclaimFreePages(); err != nil || n != 0 {
		t.Fatalf("nothing to give back yet: %d %v", n, err)
	}
	fillAndEmpty(t, s)
	var pageSize, before, free int64
	_ = s.db.QueryRow(`PRAGMA page_size`).Scan(&pageSize)
	_ = s.db.QueryRow(`PRAGMA page_count`).Scan(&before)
	_ = s.db.QueryRow(`PRAGMA freelist_count`).Scan(&free)
	if free*pageSize < reclaimMinBytes {
		t.Fatalf("only %d free pages", free)
	}
	n, err := s.ReclaimFreePages()
	if err != nil {
		t.Fatal(err)
	}
	var after, freeAfter int64
	_ = s.db.QueryRow(`PRAGMA page_count`).Scan(&after)
	_ = s.db.QueryRow(`PRAGMA freelist_count`).Scan(&freeAfter)
	if n != (before-after)*pageSize || n < free*pageSize*9/10 || freeAfter != 0 {
		t.Fatalf("gave back %d bytes: pages %d -> %d, free %d -> %d", n, before, after, free, freeAfter)
	}
	requireIntegrity(t, s)
}

// Migration 49 switches an existing database without auto_vacuum with one VACUUM, unless there is no
// room for VACUUM's copies; then it stays as it is and the start goes on.
func TestIncrementalVacuumMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing.db")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.CreateUser("anna@test.local", "hash", "Anna", "member")
	if err != nil {
		t.Fatal(err)
	}
	// Back to a database from before migration 49, created without auto_vacuum
	toNone := func() {
		ctx := context.Background()
		conn, err := s.db.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, q := range []string{`PRAGMA auto_vacuum = NONE`, `VACUUM`, `DELETE FROM schema_migrations WHERE id = 49`} {
			if _, err := conn.ExecContext(ctx, q); err != nil {
				t.Fatalf("%s: %v", q, err)
			}
		}
		_ = conn.Close()
		if mode := autoVacuumOf(t, s); mode != 0 {
			t.Fatalf("auto_vacuum still %d", mode)
		}
		_ = s.Close()
	}
	toNone()

	defer func(orig func(string) (int64, bool)) { diskFreeOf = orig }(diskFreeOf)
	diskFreeOf = func(string) (int64, bool) { return 1 << 10, true }
	if s, err = NewStore(path); err != nil {
		t.Fatalf("start without room: %v", err)
	}
	if mode := autoVacuumOf(t, s); mode != 0 {
		t.Fatalf("switched without room for VACUUM: %d", mode)
	}
	if n, err := s.ReclaimFreePages(); err != nil || n != 0 {
		t.Fatalf("a database without incremental auto_vacuum gives nothing back: %d %v", n, err)
	}
	toNone()

	diskFreeOf = func(string) (int64, bool) { return 1 << 40, true }
	if s, err = NewStore(path); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if mode := autoVacuumOf(t, s); mode != 2 {
		t.Fatalf("existing database not switched: %d", mode)
	}
	if got, err := s.GetUserByID(u.ID); err != nil || got.Email != u.Email {
		t.Fatalf("data after switching: %+v %v", got, err)
	}
	requireIntegrity(t, s)
}
