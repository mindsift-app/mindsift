package api

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
)

var otherSecretsKey = bytes.Repeat([]byte{0x5b}, 32)

func writeSecretsKeyFile(t *testing.T, dataDir string, key []byte) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dataDir, storage.FullBackupSecretsKey), []byte(hex.EncodeToString(key)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

// useKeyFile: the server's key comes from secrets.key of the data folder, as on a server without SECRETS_KEY.
func (e *restoreEnv) useKeyFile(key []byte) {
	e.t.Helper()
	writeSecretsKeyFile(e.t, filepath.Dir(e.srv.cfg.DatabasePath), key)
	e.srv.cfg.SecretsKey, e.srv.cfg.SecretsKeySource = key, "secrets.key"
	if err := e.reopenNow(); err != nil {
		e.t.Fatal(err)
	}
}

// addSecret: a hidden value in a note of its own, sealed with the server's key.
func (e *restoreEnv) addSecret() {
	e.t.Helper()
	doc, err := e.store.CreateDocument(e.uid, "", "Zugänge", "📄", "", nil, nil, false)
	if err != nil {
		e.t.Fatal(err)
	}
	createSecretIn(e.t, e.srv.Router(), e.token, doc.ID, "pin-1234")
}

func (e *restoreEnv) restoreBody(name string, accept bool) string {
	b, _ := json.Marshal(map[string]any{"confirm": name, "acceptKeyMismatch": accept})
	return string(b)
}

// A backup carries the server's key; restored on a server with another key (a move), the key comes along:
// the reopened server opens the hidden values, secrets.key of the data folder is the backup's (0600), and
// the backup before the restore kept the key it replaced.
func TestRestoreBringsSecretsKey(t *testing.T) {
	e := newRestoreEnv(t)
	dataDir := filepath.Dir(e.srv.cfg.DatabasePath)
	e.useKeyFile(testSecretsKey)
	e.addSecret()
	backup := e.runBackup()
	inBackup := filepath.Join(e.srv.backupRoot(), "system", backup.Name, storage.FullBackupSecretsKey)
	if info, err := os.Stat(inBackup); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("secrets.key in the backup: %v %v", info, err)
	}

	// The new server: its own key
	e.useKeyFile(otherSecretsKey)
	if _, unreadable := e.srv.CheckSecretsKey(); unreadable == 0 {
		t.Fatal("with the other key the hidden value must not open (test setup)")
	}
	rec := e.call(http.MethodPost, "/api/v1/admin/backups/"+backup.Name+"/restore", confirmBody(backup.Name))
	var ans struct {
		PreRestoreBackup string `json:"preRestoreBackup"`
	}
	if rec.Code != http.StatusAccepted || json.Unmarshal(rec.Body.Bytes(), &ans) != nil {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
	if err := e.reopen(); err != nil {
		t.Fatalf("restore failed: %v", err)
	}
	if !bytes.Equal(e.srv.cfg.SecretsKey, testSecretsKey) || !bytes.Equal(e.store.SecretsKey(), testSecretsKey) {
		t.Error("server and store must use the restored key")
	}
	if checked, unreadable := e.srv.CheckSecretsKey(); checked == 0 || unreadable != 0 {
		t.Errorf("hidden values after the restore: %d checked, %d unreadable", checked, unreadable)
	}
	keyFile := filepath.Join(dataDir, storage.FullBackupSecretsKey)
	if key, err := storage.ReadSecretsKeyFile(keyFile); err != nil || !bytes.Equal(key, testSecretsKey) {
		t.Errorf("secrets.key of the data folder: %x %v", key, err)
	}
	if info, err := os.Stat(keyFile); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("secrets.key permissions: %v %v", info, err)
	}
	pre := filepath.Join(e.srv.backupRoot(), "system", ans.PreRestoreBackup, storage.FullBackupSecretsKey)
	if key, err := storage.ReadSecretsKeyFile(pre); err != nil || !bytes.Equal(key, otherSecretsKey) {
		t.Errorf("the backup before the restore must keep the replaced key: %x %v", key, err)
	}
}

// A backup without a key (left out, or an old one) restored on a server whose key does not open its
// encrypted values: the admin is asked first (409 secrets_key_mismatch, nothing changed); confirmed, the
// restore runs and the server keeps its key.
func TestRestoreWithoutKeyWarnsOnMismatch(t *testing.T) {
	e := newRestoreEnv(t)
	e.addSecret()
	e.srv.cfg.BackupExcludeSecretsKey = true
	if err := e.reopenNow(); err != nil {
		t.Fatal(err)
	}
	backup := e.runBackup()
	if _, err := os.Lstat(filepath.Join(e.srv.backupRoot(), "system", backup.Name, storage.FullBackupSecretsKey)); !os.IsNotExist(err) {
		t.Fatalf("BACKUP_EXCLUDE_SECRETS_KEY: the backup must have no key: %v", err)
	}
	body := e.call(http.MethodGet, "/api/v1/admin/settings", "").Body.String()
	if !strings.Contains(body, `"backupSecretsKeyExcluded":true`) {
		t.Errorf("the Data page must learn that the key is left out: %s", body)
	}

	e.useKeyFile(otherSecretsKey)
	path := "/api/v1/admin/backups/" + backup.Name + "/restore"
	rec := e.call(http.MethodPost, path, confirmBody(backup.Name))
	var refused struct{ Error, Code string }
	if rec.Code != http.StatusConflict || json.Unmarshal(rec.Body.Bytes(), &refused) != nil || refused.Code != "secrets_key_mismatch" || refused.Error == "" {
		t.Fatalf("expected the question first: %d %s", rec.Code, rec.Body.String())
	}
	dataDir := filepath.Dir(e.srv.cfg.DatabasePath)
	if _, err := os.Stat(filepath.Join(dataDir, "restore-pending.json")); !os.IsNotExist(err) {
		t.Errorf("restore-pending.json left after the question: %v", err)
	}
	if staged, _ := os.ReadDir(filepath.Join(dataDir, storage.RestoreStagingDir)); len(staged) != 0 {
		t.Errorf("staging folder left after the question: %v", staged)
	}
	if rec := e.call(http.MethodPost, path, e.restoreBody(backup.Name, true)); rec.Code != http.StatusAccepted {
		t.Fatalf("confirmed: %d %s", rec.Code, rec.Body.String())
	}
	if err := e.reopen(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(e.srv.cfg.SecretsKey, otherSecretsKey) {
		t.Error("without a key in the backup the server keeps its own")
	}
	if key, _ := storage.ReadSecretsKeyFile(filepath.Join(dataDir, storage.FullBackupSecretsKey)); !bytes.Equal(key, otherSecretsKey) {
		t.Errorf("secrets.key of the data folder must stay: %x", key)
	}
}

// SECRETS_KEY wins at every start: a key in the backup is not put in place, and when SECRETS_KEY does not open
// the backup's values the admin is asked.
func TestRestoreKeepsSecretsKeyFromEnv(t *testing.T) {
	e := newRestoreEnv(t)
	dataDir := filepath.Dir(e.srv.cfg.DatabasePath)
	e.useKeyFile(testSecretsKey)
	e.addSecret()
	backup := e.runBackup()

	e.srv.cfg.SecretsKey, e.srv.cfg.SecretsKeySource = otherSecretsKey, config.SecretsKeyFromEnv
	if err := e.reopenNow(); err != nil {
		t.Fatal(err)
	}
	if body := e.call(http.MethodGet, "/api/v1/admin/settings", "").Body.String(); !strings.Contains(body, `"backupSecretsKeyExcluded":true`) {
		t.Errorf("with SECRETS_KEY backups carry no key: %s", body)
	}
	path := "/api/v1/admin/backups/" + backup.Name + "/restore"
	if rec := e.call(http.MethodPost, path, confirmBody(backup.Name)); rec.Code != http.StatusConflict {
		t.Fatalf("expected the question: %d %s", rec.Code, rec.Body.String())
	}
	if rec := e.call(http.MethodPost, path, e.restoreBody(backup.Name, true)); rec.Code != http.StatusAccepted {
		t.Fatalf("confirmed: %d %s", rec.Code, rec.Body.String())
	}
	if err := e.reopen(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(e.srv.cfg.SecretsKey, otherSecretsKey) || !bytes.Equal(e.store.SecretsKey(), otherSecretsKey) {
		t.Error("SECRETS_KEY must stay the key")
	}
	if key, _ := storage.ReadSecretsKeyFile(filepath.Join(dataDir, storage.FullBackupSecretsKey)); !bytes.Equal(key, testSecretsKey) {
		t.Errorf("the data folder's secrets.key must not be replaced: %x", key)
	}
}

// An uploaded full backup (the downloaded tar) brings its key into the staging folder, 0600; a secrets.key that
// is no key refuses the backup.
func TestStageUploadedBackupWithKey(t *testing.T) {
	e := newRestoreEnv(t)
	e.useKeyFile(testSecretsKey)
	backup := e.runBackup()
	src := filepath.Join(e.srv.backupRoot(), "system", backup.Name)
	_, write, err := storage.WriteFullBackupTar(src)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := write(&buf); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "upload")
	_ = os.WriteFile(file, buf.Bytes(), 0o600)
	dir := t.TempDir()
	if _, err := stageUploadedBackup(file)(dir, "mindsift.db"); err != nil {
		t.Fatal(err)
	}
	staged := filepath.Join(dir, storage.FullBackupSecretsKey)
	if key, err := storage.ReadSecretsKeyFile(staged); err != nil || !bytes.Equal(key, testSecretsKey) {
		t.Fatalf("staged key: %x %v", key, err)
	}
	if info, _ := os.Stat(staged); info.Mode().Perm() != 0o600 {
		t.Errorf("staged key permissions: %o", info.Mode().Perm())
	}
	if withKey, key := e.srv.restoreKey(dir); !withKey || !bytes.Equal(key, testSecretsKey) {
		t.Errorf("restoreKey: %v %x", withKey, key)
	}

	// A broken key file in a listed backup
	_ = os.WriteFile(filepath.Join(src, storage.FullBackupSecretsKey), []byte("kein schlüssel"), 0o600)
	if _, err := stageListedBackup(src)(t.TempDir(), "mindsift.db"); !errors.Is(err, storage.ErrNotFullBackup) {
		t.Errorf("a broken secrets.key must refuse the backup: %v", err)
	}
}
