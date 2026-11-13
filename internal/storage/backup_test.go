package storage

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

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
