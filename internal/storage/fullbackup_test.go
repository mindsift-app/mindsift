package storage

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// storeWithMedia: a store in a data folder of its own with one note and a media file.
func storeWithMedia(t *testing.T) (*Store, string, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "mindsift.db")
	st, err := NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	u, err := st.CreateUser("anna@example.com", "hash", "Anna", domain.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := st.CreateDocument(u.ID, "", "Urlaub", "📄", "", nil, nil, false)
	m, err := st.CreateMedia(doc.ID, u.ID, "image", "image/png", 5, "")
	if err != nil {
		t.Fatal(err)
	}
	p := st.MediaFilePath(m)
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte("bild1"), 0o644); err != nil {
		t.Fatal(err)
	}
	return st, dbPath, p
}

func inode(t *testing.T, p string) uint64 {
	t.Helper()
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	return info.Sys().(*syscall.Stat_t).Ino
}

// A full backup holds the database and every media file; unchanged media are hard links (to the live file,
// then to the previous backup's), the list shows it with the exact size of its tar download.
func TestWriteFullBackupContentsAndLinks(t *testing.T) {
	st, dbPath, media := storeWithMedia(t)
	dir := filepath.Join(filepath.Dir(dbPath), "backups", "system")
	at := time.Date(2026, 11, 20, 3, 0, 0, 0, time.UTC)
	first, err := st.WriteFullBackup(dir, at, "")
	if err != nil {
		t.Fatal(err)
	}
	rel, _ := filepath.Rel(filepath.Join(filepath.Dir(dbPath), "media"), media)
	inFirst := filepath.Join(dir, first, FullBackupMedia, rel)
	if b, err := os.ReadFile(inFirst); err != nil || string(b) != "bild1" {
		t.Fatalf("media in the backup: %q %v", b, err)
	}
	if inode(t, inFirst) != inode(t, media) {
		t.Error("the media file should be a hard link to the live one")
	}
	gz, err := os.Open(filepath.Join(dir, first, FullBackupDBName))
	if err != nil {
		t.Fatal(err)
	}
	zr, err := gzip.NewReader(gz)
	if err != nil {
		t.Fatal(err)
	}
	head := make([]byte, 16)
	_, _ = io.ReadFull(zr, head)
	gz.Close()
	if string(head) != "SQLite format 3\x00" {
		t.Fatalf("database in the backup: %q", head)
	}

	// The second backup links from the first; a new media file comes in as well
	_ = os.WriteFile(filepath.Join(filepath.Dir(media), "neu.png"), []byte("bild2"), 0o644)
	second, err := st.WriteFullBackup(dir, at.Add(time.Hour), FullBackupPreRestore)
	if err != nil {
		t.Fatal(err)
	}
	if inode(t, filepath.Join(dir, second, FullBackupMedia, rel)) != inode(t, inFirst) {
		t.Error("an unchanged media file should share the previous backup's file")
	}
	files, err := ListBackups(dir)
	if err != nil || len(files) != 2 {
		t.Fatalf("list: %+v %v", files, err)
	}
	if files[0].Name != second || !files[0].Full || files[0].Media != 2 || files[0].Reason != FullBackupPreRestore {
		t.Fatalf("newest first, with its counts: %+v", files[0])
	}
	size, write, err := WriteFullBackupTar(filepath.Join(dir, second))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := write(&buf); err != nil {
		t.Fatal(err)
	}
	if int64(buf.Len()) != size || size != files[0].Size {
		t.Fatalf("archive %d bytes, announced %d, listed %d", buf.Len(), size, files[0].Size)
	}
	tr := tar.NewReader(&buf)
	var names []string
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, h.Name)
	}
	if len(names) != 4 || names[0] != FullBackupManifest || names[1] != FullBackupDBName {
		t.Fatalf("archive entries: %v", names)
	}
	var m FullBackupManifestData
	raw, _ := os.ReadFile(filepath.Join(dir, second, FullBackupManifest))
	if json.Unmarshal(raw, &m) != nil || m.Format != fullBackupFormat || m.MediaFiles != 2 || m.MediaBytes != 10 {
		t.Fatalf("manifest: %s", raw)
	}
}

// Old database snapshots stay listed next to the full backups (sorted by time), can be deleted and are
// pruned; full backups past the retention go as whole folders; a half-written one is never listed.
func TestFullBackupsListPruneAndOldSnapshots(t *testing.T) {
	st, dbPath, _ := storeWithMedia(t)
	dir := filepath.Join(filepath.Dir(dbPath), "backups", "system")
	_ = os.MkdirAll(dir, 0o700)
	old := "mindsift-db-2026-11-21-0300.db.gz"
	_ = os.WriteFile(filepath.Join(dir, old), []byte("x"), 0o600)
	full, err := st.WriteFullBackup(dir, time.Date(2026, 11, 20, 3, 0, 0, 0, time.UTC), "")
	if err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(filepath.Join(dir, ".mindsift-full-2026-11-22-030000.part"), 0o700)
	_ = os.MkdirAll(filepath.Join(dir, "mindsift-full-2026-11-23-030000"), 0o700) // no manifest
	files, _ := ListBackups(dir)
	if len(files) != 2 || files[0].Name != old || files[1].Name != full {
		t.Fatalf("by time, only complete ones: %+v", files)
	}
	if BackupDate(full) != "2026-11-20" || BackupDate(old) != "2026-11-21" {
		t.Fatalf("dates: %s %s", BackupDate(full), BackupDate(old))
	}
	if _, err := BackupPath(dir, "mindsift-full-2026-11-23-030000/../.."); err == nil {
		t.Fatal("path tricks must be refused")
	}
	past := time.Now().Add(-10 * 24 * time.Hour)
	_ = os.Chtimes(filepath.Join(dir, full), past, past)
	if err := PruneBackups(dir, 3, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, full)); !os.IsNotExist(err) {
		t.Fatal("a full backup past the retention must go")
	}
	if err := DeleteBackup(dir, old); err != nil {
		t.Fatal(err)
	}
}

// The swap of a staged restore: database and media in place, the previous ones removed once the store
// opened; a restored database that does not open puts the previous data back.
func TestOpenStoreWithRestore(t *testing.T) {
	st, dbPath, media := storeWithMedia(t)
	dir := filepath.Join(filepath.Dir(dbPath), "backups", "system")
	name, err := st.WriteFullBackup(dir, time.Now(), "")
	if err != nil {
		t.Fatal(err)
	}
	// After the backup: a new account and the media file gone
	_, _ = st.CreateUser("ben@example.com", "hash", "Ben", domain.RoleMember)
	_ = os.Remove(media)
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	stage := func(token string) {
		sdir := RestoreStagingPath(dbPath, token)
		_ = os.MkdirAll(sdir, 0o700)
		in, _ := os.Open(filepath.Join(dir, name, FullBackupDBName))
		zr, _ := gzip.NewReader(in)
		out, _ := os.Create(filepath.Join(sdir, filepath.Base(dbPath)))
		_, _ = io.Copy(out, zr)
		out.Close()
		in.Close()
		if err := LinkMediaTree(filepath.Join(dir, name, FullBackupMedia), filepath.Join(sdir, "media")); err != nil {
			t.Fatal(err)
		}
		if err := WriteRestorePlan(dbPath, RestorePlan{Staging: token, Media: true, Backup: name, ActorName: "anna"}); err != nil {
			t.Fatal(err)
		}
	}
	stage("t1")
	st2, restoreErr, err := OpenStoreWithRestore(dbPath)
	if err != nil || restoreErr != nil {
		t.Fatalf("open: %v / %v", err, restoreErr)
	}
	users, _ := st2.GetAllUsers()
	if len(users) != 1 {
		t.Errorf("the account added after the backup must be gone: %d accounts", len(users))
	}
	if b, err := os.ReadFile(media); err != nil || string(b) != "bild1" {
		t.Errorf("media back: %q %v", b, err)
	}
	for _, p := range []string{restorePrevDir, RestoreStagingDir, restorePendingFile} {
		if _, err := os.Stat(filepath.Join(filepath.Dir(dbPath), p)); !os.IsNotExist(err) {
			t.Errorf("%s left over: %v", p, err)
		}
	}
	if done := TakeRestoreDone(dbPath); done == nil || done.Backup != name || done.Error != "" {
		t.Errorf("restore record: %+v", done)
	}
	_, _ = st2.CreateUser("carla@example.com", "hash", "Carla", domain.RoleMember)
	if err := st2.Close(); err != nil {
		t.Fatal(err)
	}

	// A staged database that is no database: the previous data (with Carla) stay
	sdir := RestoreStagingPath(dbPath, "t2")
	_ = os.MkdirAll(filepath.Join(sdir, "media"), 0o700)
	_ = os.WriteFile(filepath.Join(sdir, filepath.Base(dbPath)), []byte("kaputt, keine Datenbank, aber lang genug für eine Kopfzeile von SQLite"), 0o600)
	_ = WriteRestorePlan(dbPath, RestorePlan{Staging: "t2", Media: true, Backup: "kaputt"})
	st3, restoreErr, err := OpenStoreWithRestore(dbPath)
	if err != nil || restoreErr == nil {
		t.Fatalf("expected the restore to fail and the old data to open: %v / %v", err, restoreErr)
	}
	defer st3.Close()
	users, _ = st3.GetAllUsers()
	if len(users) != 2 {
		t.Errorf("the data from before the failed restore: %d accounts", len(users))
	}
	if b, err := os.ReadFile(media); err != nil || string(b) != "bild1" {
		t.Errorf("media from before: %q %v", b, err)
	}
	if done := TakeRestoreDone(dbPath); done == nil || done.Error == "" {
		t.Errorf("the failed restore must be recorded: %+v", done)
	}
}

// A swap cut off halfway (the database moved aside, a crash) completes at the next open.
func TestOpenStoreWithRestoreResumesAfterCrash(t *testing.T) {
	st, dbPath, _ := storeWithMedia(t)
	dir := filepath.Join(filepath.Dir(dbPath), "backups", "system")
	name, _ := st.WriteFullBackup(dir, time.Now(), "")
	_, _ = st.CreateUser("ben@example.com", "hash", "Ben", domain.RoleMember)
	_ = st.Close()
	sdir := RestoreStagingPath(dbPath, "t1")
	_ = os.MkdirAll(sdir, 0o700)
	in, _ := os.Open(filepath.Join(dir, name, FullBackupDBName))
	zr, _ := gzip.NewReader(in)
	out, _ := os.Create(filepath.Join(sdir, filepath.Base(dbPath)))
	_, _ = io.Copy(out, zr)
	out.Close()
	in.Close()
	_ = WriteRestorePlan(dbPath, RestorePlan{Staging: "t1", Backup: name})
	// Step 1 done, then the power went
	prev := filepath.Join(filepath.Dir(dbPath), restorePrevDir)
	_ = os.MkdirAll(prev, 0o700)
	if err := os.Rename(dbPath, filepath.Join(prev, filepath.Base(dbPath))); err != nil {
		t.Fatal(err)
	}
	st2, restoreErr, err := OpenStoreWithRestore(dbPath)
	if err != nil || restoreErr != nil {
		t.Fatalf("open: %v / %v", err, restoreErr)
	}
	defer st2.Close()
	if users, _ := st2.GetAllUsers(); len(users) != 1 {
		t.Errorf("the restored database: %d accounts", len(users))
	}
}
