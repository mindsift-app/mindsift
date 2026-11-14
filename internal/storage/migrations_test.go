package storage

import (
	"compress/gzip"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"
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

// withExtraMigration adds a step after the known ones for the rest of the test; it returns its id.
func withExtraMigration(t *testing.T, run func(*Store) error) int {
	t.Helper()
	saved := migrations
	t.Cleanup(func() { migrations = saved })
	id := saved[len(saved)-1].id + 1
	migrations = append(append([]migration{}, saved...), migration{id, "Testschritt", run})
	return id
}

func preMigrationFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "pre-migration-") && strings.HasSuffix(e.Name(), ".db.gz") {
			names = append(names, e.Name())
		}
	}
	return names
}

// stepClock: every copy gets a time one minute after the previous one
func stepClock(t *testing.T) {
	t.Helper()
	at := time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)
	t.Cleanup(func() { migrationNow = time.Now })
	migrationNow = func() time.Time { at = at.Add(time.Minute); return at }
}

func gunzipTo(t *testing.T, src, dst string) {
	t.Helper()
	in, err := os.Open(src)
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	gz, err := gzip.NewReader(in)
	if err != nil {
		t.Fatal(err)
	}
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	if _, err := io.Copy(out, gz); err != nil {
		t.Fatal(err)
	}
}

// A new database gets no copy; pending migrations on one with content first write a complete copy of it
func TestBackupBeforePendingMigrations(t *testing.T) {
	stepClock(t)
	dataDir := t.TempDir()
	path := filepath.Join(dataDir, "mindsift.db")
	backups := filepath.Join(dataDir, "backups", "system")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if files := preMigrationFiles(t, backups); len(files) != 0 {
		t.Fatalf("a new database must not be backed up, got %v", files)
	}
	known := migrations[len(migrations)-1].id
	if _, err := store.db.Exec(`INSERT INTO system_settings (key, value) VALUES ('test_marker', 'vorher')`); err != nil {
		t.Fatal(err)
	}
	_ = store.Close()

	// Reopening without pending migrations writes nothing either
	store, err = NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	_ = store.Close()
	if files := preMigrationFiles(t, backups); len(files) != 0 {
		t.Fatalf("no pending migration, no copy expected, got %v", files)
	}

	withExtraMigration(t, func(s *Store) error {
		_, err := s.db.Exec(`UPDATE system_settings SET value = 'nachher' WHERE key = 'test_marker'`)
		return err
	})
	store, err = NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	files := preMigrationFiles(t, backups)
	want := fmt.Sprintf("pre-migration-%d-", known)
	if len(files) != 1 || !strings.HasPrefix(files[0], want) {
		t.Fatalf("expected one copy %s…, got %v", want, files)
	}
	if _, err := os.Stat(filepath.Join(backups, preMigrationMarker)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the marker must be gone after the migrations ran through: %v", err)
	}
	// Not one of the daily backups: those are listed and expire after days
	if list, _ := ListBackups(backups); len(list) != 0 {
		t.Fatalf("pre-migration copies must not show up among the daily backups, got %v", list)
	}

	// The copy is the database before the step: unpacked it has the old value and ends at the old step
	copyPath := filepath.Join(t.TempDir(), "copy.db")
	gunzipTo(t, filepath.Join(backups, files[0]), copyPath)
	db, err := sql.Open("sqlite", copyPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	var last int
	if err := db.QueryRow(`SELECT value FROM system_settings WHERE key = 'test_marker'`).Scan(&value); err != nil || value != "vorher" {
		t.Fatalf("copy must hold the state before the migration, got %q (%v)", value, err)
	}
	if err := db.QueryRow(`SELECT MAX(id) FROM schema_migrations`).Scan(&last); err != nil || last != known {
		t.Fatalf("copy must end at migration %d, got %d (%v)", known, last, err)
	}
	if err := store.db.QueryRow(`SELECT value FROM system_settings WHERE key = 'test_marker'`).Scan(&value); err != nil || value != "nachher" {
		t.Fatalf("the migration must have run after the copy, got %q (%v)", value, err)
	}
}

// Only the last three copies stay
func TestPreMigrationBackupsKeepThree(t *testing.T) {
	stepClock(t)
	dataDir := t.TempDir()
	path := filepath.Join(dataDir, "mindsift.db")
	backups := filepath.Join(dataDir, "backups", "system")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	_ = store.Close()
	saved := migrations
	defer func() { migrations = saved }()
	first := saved[len(saved)-1].id
	migrations = append([]migration{}, saved...)
	for i := 1; i <= 5; i++ {
		migrations = append(migrations, migration{first + i, fmt.Sprintf("Schritt %d", i), func(*Store) error { return nil }})
		store, err := NewStore(path)
		if err != nil {
			t.Fatalf("start %d: %v", i, err)
		}
		_ = store.Close()
	}
	names := preMigrationFiles(t, backups)
	if len(names) != preMigrationKeep {
		t.Fatalf("expected %d copies, got %v", preMigrationKeep, names)
	}
	sort.Strings(names)
	for i, n := range names {
		if want := fmt.Sprintf("pre-migration-%d-", first+2+i); !strings.HasPrefix(n, want) {
			t.Fatalf("expected the newest copies, %s… at %d, got %v", want, i, names)
		}
	}
}

// A step that keeps failing (restart loop): the copy from before the first attempt is not rotated away
func TestPreMigrationBackupOfFailedAttemptKept(t *testing.T) {
	stepClock(t)
	dataDir := t.TempDir()
	path := filepath.Join(dataDir, "mindsift.db")
	backups := filepath.Join(dataDir, "backups", "system")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	_ = store.Close()
	fail := true
	withExtraMigration(t, func(*Store) error {
		if fail {
			return errors.New("kaputt")
		}
		return nil
	})
	var first string
	for i := 0; i < 5; i++ {
		if _, err := NewStore(path); err == nil {
			t.Fatal("the failing step must stop the start")
		}
		if i == 0 {
			first = preMigrationFiles(t, backups)[0]
		}
	}
	files := preMigrationFiles(t, backups)
	if len(files) != preMigrationKeep || !slices.Contains(files, first) {
		t.Fatalf("expected %d copies including the first one %s, got %v", preMigrationKeep, first, files)
	}
	fail = false
	store, err = NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	_ = store.Close()
	if _, err := os.Stat(filepath.Join(backups, preMigrationMarker)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the marker must be gone once the migrations went through: %v", err)
	}
}

// Without the copy nothing is migrated (e.g. a full disk)
func TestNoMigrationWithoutBackup(t *testing.T) {
	dataDir := t.TempDir()
	path := filepath.Join(dataDir, "mindsift.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	_ = store.Close()
	// backups/system cannot be created: a file is in the way
	if err := os.MkdirAll(filepath.Join(dataDir, "backups"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "backups", "system"), []byte("im Weg"), 0o600); err != nil {
		t.Fatal(err)
	}
	ran := false
	withExtraMigration(t, func(*Store) error { ran = true; return nil })
	if _, err := NewStore(path); err == nil || !strings.Contains(err.Error(), "backup before the database migration") {
		t.Fatalf("expected the start to stop for the missing backup, got %v", err)
	}
	if ran {
		t.Fatal("the migration must not run without a backup")
	}
}

// An older binary on a database a newer one has migrated refuses to start
func TestNewerDatabaseRefused(t *testing.T) {
	dataDir := t.TempDir()
	path := filepath.Join(dataDir, "mindsift.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	known := migrations[len(migrations)-1].id
	if _, err := store.db.Exec(`INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, 'Aus der Zukunft', '2027-01-01T00:00:00Z')`, known+3); err != nil {
		t.Fatal(err)
	}
	_ = store.Close()
	_, err = NewStore(path)
	var newer *NewerDatabaseError
	if !errors.As(err, &newer) {
		t.Fatalf("expected NewerDatabaseError, got %v", err)
	}
	if newer.DatabaseID != known+3 || newer.KnownID != known {
		t.Fatalf("wrong ids: %+v", newer)
	}
	for _, part := range []string{fmt.Sprintf("migration %d", known+3), fmt.Sprintf("up to %d", known), "older version", "pre-migration backup", "newer image"} {
		if !strings.Contains(err.Error(), part) {
			t.Fatalf("message must mention %q: %v", part, err)
		}
	}
	if files := preMigrationFiles(t, filepath.Join(dataDir, "backups", "system")); len(files) != 0 {
		t.Fatalf("a refused start writes no copy, got %v", files)
	}
}

// Copies from before migrations expire after 90 days, the newest one too; an unfinished attempt's stays
func TestPreMigrationBackupsExpire(t *testing.T) {
	dataDir := t.TempDir()
	store, err := NewStore(filepath.Join(dataDir, "mindsift.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	backups := filepath.Join(dataDir, "backups", "system")
	if err := os.MkdirAll(backups, 0o700); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 14, 12, 0, 0, 0, time.Local)
	write := func(name string) {
		if err := os.WriteFile(filepath.Join(backups, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	copyName := func(id, days int) string {
		return fmt.Sprintf("pre-migration-%d-%s.db.gz", id, now.AddDate(0, 0, -days).Format("2006-01-02-150405"))
	}
	write(copyName(38, 120))
	write(copyName(39, 95))
	write(copyName(40, 91))
	write("mindsift-db-2020-01-01-0300.db.gz") // daily backups have their own retention
	n, err := store.ExpirePreMigrationBackups(now)
	if err != nil || n != 3 {
		t.Fatalf("all three copies are older than 90 days, the newest included: removed %d (%v)", n, err)
	}
	if files := preMigrationFiles(t, backups); len(files) != 0 {
		t.Fatalf("expected no copy left, got %v", files)
	}
	if _, err := os.Stat(filepath.Join(backups, "mindsift-db-2020-01-01-0300.db.gz")); err != nil {
		t.Fatalf("a daily backup must be left to its own retention: %v", err)
	}

	young, pinned := copyName(41, 89), copyName(39, 200)
	write(young)
	write(pinned)
	if err := os.WriteFile(filepath.Join(backups, preMigrationMarker), []byte(pinned+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if n, err := store.ExpirePreMigrationBackups(now); err != nil || n != 0 {
		t.Fatalf("a copy younger than 90 days and the one of an unfinished attempt stay: removed %d (%v)", n, err)
	}
	if files := preMigrationFiles(t, backups); len(files) != 2 {
		t.Fatalf("expected both copies kept, got %v", files)
	}

	// A store without a backup folder (in memory) has nothing to do
	mem, err := NewStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer mem.Close()
	if n, err := mem.ExpirePreMigrationBackups(now); n != 0 || err != nil {
		t.Fatalf("in memory: %d, %v", n, err)
	}
}
