package storage

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Backup names carry seconds, so two backups in the same minute keep both; names from before (minutes
// only) are still listed, opened, deleted and pruned, sorted by time among the new ones
func TestBackupNamesWithSeconds(t *testing.T) {
	dir := t.TempDir()
	first := time.Date(2026, 11, 15, 3, 0, 5, 0, time.UTC)
	for _, at := range []time.Time{first, first.Add(30 * time.Second)} {
		name := "mindsift-db-" + at.Format(backupStampFmt) + ".db.gz"
		if err := WriteFileAtomically(filepath.Join(dir, name), []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	old := "mindsift-db-2026-11-15-0300.db.gz"
	older := "mindsift-db-2026-11-14-2359.db.gz"
	for _, n := range []string{old, older} {
		if err := WriteFileAtomically(filepath.Join(dir, n), []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	files, err := ListBackups(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range files {
		names = append(names, f.Name)
	}
	want := []string{"mindsift-db-2026-11-15-030035.db.gz", "mindsift-db-2026-11-15-030005.db.gz", old, older}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("newest first, old names included:\n got %v\nwant %v", names, want)
	}
	if _, err := BackupPath(dir, old); err != nil {
		t.Fatalf("an old name must still open: %v", err)
	}
	if _, err := BackupPath(dir, "mindsift-db-2026-11-15-03000.db.gz"); err == nil {
		t.Fatal("a stamp with an odd number of digits is not ours")
	}
	// Pruning goes by the file time, old names as well
	past := time.Now().Add(-10 * 24 * time.Hour)
	_ = os.Chtimes(filepath.Join(dir, older), past, past)
	if err := PruneBackups(dir, 3, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, older)); !os.IsNotExist(err) {
		t.Fatal("an old-style backup past the retention must be pruned")
	}
	if err := DeleteBackup(dir, old); err != nil {
		t.Fatalf("an old name must still delete: %v", err)
	}
}

// Backups are written through a temporary file, flushed to disk: complete or not at all, nothing left behind
func TestWriteFileAtomically(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "mindsift-backup-2026-11-14-0300.zip")
	if err := WriteFileAtomically(dst, []byte("inhalt")); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(dst); err != nil || string(b) != "inhalt" {
		t.Fatalf("got %q (%v)", b, err)
	}
	failed := errors.New("abgebrochen")
	if err := writeFileAtomically(filepath.Join(dir, "half.zip"), func(w io.Writer) error {
		_, _ = w.Write([]byte("halb"))
		return failed
	}); !errors.Is(err, failed) {
		t.Fatalf("expected the write error, got %v", err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("a failed write must leave nothing behind, got %d entries", len(entries))
	}
	if err := SyncDir(filepath.Join(dir, "fehlt")); err == nil {
		t.Fatal("syncing a missing folder must fail")
	}
	if err := WriteFileAtomically(filepath.Join(dir, "fehlt", "x.zip"), nil); err == nil {
		t.Fatal("writing into a missing folder must fail")
	}
}
