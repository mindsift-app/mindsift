package storage

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var (
	backupKeyA = bytes.Repeat([]byte{0xa1}, 32)
	backupKeyB = bytes.Repeat([]byte{0xb2}, 32)
)

func writeKeyFile(t *testing.T, path string, key []byte) {
	t.Helper()
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

// A full backup carries the key given with WithBackupSecretsKey as secrets.key, 0600 in the folder and in
// the archive, and says so in its manifest; without a key (BACKUP_EXCLUDE_SECRETS_KEY, SECRETS_KEY) it has none.
func TestFullBackupCarriesSecretsKey(t *testing.T) {
	st, dbPath, _ := storeWithMedia(t)
	dir := filepath.Join(filepath.Dir(dbPath), "backups", "system")
	at := time.Date(2026, 11, 22, 3, 0, 0, 0, time.UTC)

	st.backupSecretsKey = backupKeyA
	with, err := st.WriteFullBackup(dir, at, "")
	if err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(dir, with, FullBackupSecretsKey)
	info, err := os.Stat(keyPath)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("secrets.key in the backup folder: %v %v", info, err)
	}
	if key, err := ReadSecretsKeyFile(keyPath); err != nil || !bytes.Equal(key, backupKeyA) {
		t.Fatalf("the key in the backup: %x %v", key, err)
	}
	var m FullBackupManifestData
	raw, _ := os.ReadFile(filepath.Join(dir, with, FullBackupManifest))
	if json.Unmarshal(raw, &m) != nil || !m.SecretsKey {
		t.Fatalf("manifest: %s", raw)
	}
	size, write, err := WriteFullBackupTar(filepath.Join(dir, with))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := write(&buf); err != nil {
		t.Fatal(err)
	}
	if int64(buf.Len()) != size {
		t.Fatalf("archive %d bytes, announced %d", buf.Len(), size)
	}
	tr := tar.NewReader(&buf)
	found := false
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if h.Name == FullBackupSecretsKey {
			found = true
			if h.Mode != 0o600 {
				t.Errorf("secrets.key in the archive: mode %o", h.Mode)
			}
		}
	}
	if !found {
		t.Error("the archive must hold secrets.key")
	}

	st.backupSecretsKey = nil
	without, err := st.WriteFullBackup(dir, at.Add(time.Hour), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(dir, without, FullBackupSecretsKey)); !os.IsNotExist(err) {
		t.Errorf("a backup without the key must have no secrets.key: %v", err)
	}
	m = FullBackupManifestData{}
	raw, _ = os.ReadFile(filepath.Join(dir, without, FullBackupManifest))
	if json.Unmarshal(raw, &m) != nil || m.SecretsKey {
		t.Fatalf("manifest without the key: %s", raw)
	}
}

// stageFullBackup puts the backup's database (and its secrets.key) into the staging folder token.
func stageFullBackup(t *testing.T, dbPath, backupDir, token string, withKey bool) {
	t.Helper()
	sdir := RestoreStagingPath(dbPath, token)
	_ = os.MkdirAll(sdir, 0o700)
	in, err := os.Open(filepath.Join(backupDir, FullBackupDBName))
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	zr, _ := gzip.NewReader(in)
	out, _ := os.Create(filepath.Join(sdir, filepath.Base(dbPath)))
	_, _ = io.Copy(out, zr)
	out.Close()
	if withKey {
		raw, err := os.ReadFile(filepath.Join(backupDir, FullBackupSecretsKey))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(sdir, FullBackupSecretsKey), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// A restore with a key swaps it in with the database: the reopened store seals and opens with the restored
// key although the caller passed the old one, and the SMTP password sealed with it opens. A restore that fails
// puts the previous key back with the previous database.
func TestOpenStoreWithRestoreSwapsSecretsKey(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "mindsift.db")
	keyFile := filepath.Join(filepath.Dir(dbPath), FullBackupSecretsKey)
	writeKeyFile(t, keyFile, backupKeyA)
	st, err := NewStore(dbPath, WithSecretsKey(backupKeyA), WithBackupSecretsKey(backupKeyA))
	if err != nil {
		t.Fatal(err)
	}
	sys, err := st.GetSystemSettings()
	if err != nil {
		t.Fatal(err)
	}
	sys.SMTPHost, sys.SMTPUser, sys.SMTPPass = "mail.example.com", "anna", "geheim"
	if err := st.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(filepath.Dir(dbPath), "backups", "system")
	name, err := st.WriteFullBackup(dir, time.Now(), "")
	if err != nil {
		t.Fatal(err)
	}
	_ = st.Close()

	// A new server: its own key B
	writeKeyFile(t, keyFile, backupKeyB)
	stageFullBackup(t, dbPath, filepath.Join(dir, name), "t1", true)
	if err := WriteRestorePlan(dbPath, RestorePlan{Staging: "t1", SecretsKey: true, Backup: name}); err != nil {
		t.Fatal(err)
	}
	st2, restoreErr, err := OpenStoreWithRestore(dbPath, WithSecretsKey(backupKeyB), WithBackupSecretsKey(backupKeyB))
	if err != nil || restoreErr != nil {
		t.Fatalf("open: %v / %v", err, restoreErr)
	}
	if !bytes.Equal(st2.SecretsKey(), backupKeyA) || !bytes.Equal(st2.backupSecretsKey, backupKeyA) {
		t.Errorf("the reopened store must use the restored key")
	}
	if key, err := ReadSecretsKeyFile(keyFile); err != nil || !bytes.Equal(key, backupKeyA) {
		t.Errorf("secrets.key of the data folder after the restore: %x %v", key, err)
	}
	if info, err := os.Stat(keyFile); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("secrets.key permissions: %v %v", info, err)
	}
	sys, err = st2.GetSystemSettings()
	if err != nil || sys.SMTPPassUnreadable || sys.SMTPPass != "geheim" {
		t.Errorf("the SMTP password sealed with the restored key: %+v %v", sys, err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dbPath), restorePrevDir)); !os.IsNotExist(err) {
		t.Errorf("restore-previous left over: %v", err)
	}
	_ = st2.Close()

	// A staged database that does not open: database and key from before come back
	writeKeyFile(t, keyFile, backupKeyB)
	sdir := RestoreStagingPath(dbPath, "t2")
	_ = os.MkdirAll(sdir, 0o700)
	_ = os.WriteFile(filepath.Join(sdir, filepath.Base(dbPath)), []byte("kaputt, keine Datenbank, aber lang genug für eine Kopfzeile von SQLite"), 0o600)
	writeKeyFile(t, filepath.Join(sdir, FullBackupSecretsKey), backupKeyA)
	_ = WriteRestorePlan(dbPath, RestorePlan{Staging: "t2", SecretsKey: true, Backup: "kaputt"})
	st3, restoreErr, err := OpenStoreWithRestore(dbPath, WithSecretsKey(backupKeyB))
	if err != nil || restoreErr == nil {
		t.Fatalf("expected the restore to fail and the old data to open: %v / %v", err, restoreErr)
	}
	defer st3.Close()
	if !bytes.Equal(st3.SecretsKey(), backupKeyB) {
		t.Error("after a failed restore the store keeps the previous key")
	}
	if key, err := ReadSecretsKeyFile(keyFile); err != nil || !bytes.Equal(key, backupKeyB) {
		t.Errorf("the previous secrets.key must be back: %x %v", key, err)
	}
}

// A swap cut off after the key moved aside: the start generated a new key file meanwhile; the resumed swap
// puts the backup's key in place and keeps the saved one for a rollback.
func TestRestoreKeySwapResumesAfterCrash(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "mindsift.db")
	dataDir := filepath.Dir(dbPath)
	st, err := NewStore(dbPath, WithSecretsKey(backupKeyA), WithBackupSecretsKey(backupKeyA))
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(dataDir, "backups", "system")
	name, err := st.WriteFullBackup(dir, time.Now(), "")
	if err != nil {
		t.Fatal(err)
	}
	_ = st.Close()
	stageFullBackup(t, dbPath, filepath.Join(dir, name), "t1", true)
	_ = WriteRestorePlan(dbPath, RestorePlan{Staging: "t1", SecretsKey: true, Backup: name})
	// Database swapped, the old key B moved aside, then the power went; the next start generated key C
	prev := filepath.Join(dataDir, restorePrevDir)
	_ = os.MkdirAll(prev, 0o700)
	_ = os.Rename(filepath.Join(RestoreStagingPath(dbPath, "t1"), filepath.Base(dbPath)), dbPath)
	writeKeyFile(t, filepath.Join(prev, FullBackupSecretsKey), backupKeyB)
	writeKeyFile(t, filepath.Join(dataDir, FullBackupSecretsKey), bytes.Repeat([]byte{0xcc}, 32))
	plan, err := applyRestore(dbPath)
	if err != nil || plan == nil {
		t.Fatalf("resume: %v", err)
	}
	if key, _ := ReadSecretsKeyFile(filepath.Join(dataDir, FullBackupSecretsKey)); !bytes.Equal(key, backupKeyA) {
		t.Errorf("the backup's key must be in place: %x", key)
	}
	if key, _ := ReadSecretsKeyFile(filepath.Join(prev, FullBackupSecretsKey)); !bytes.Equal(key, backupKeyB) {
		t.Errorf("the saved key must stay for a rollback: %x", key)
	}
}
