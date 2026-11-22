package api

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

// restoreEnv: a test server with a note and a picture, whose restarter hands the reopen to the test.
type restoreEnv struct {
	t        *testing.T
	srv      *Server
	store    *storage.Store
	token    string
	uid      string
	media    string
	reopened chan struct{}
}

func newRestoreEnv(t *testing.T) *restoreEnv {
	t.Helper()
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, _ := store.CreateDocument(claims.UserID, "", "Vor der Sicherung", "📄", "", nil, nil, false)
	m, err := store.CreateMedia(doc.ID, claims.UserID, "image", "image/png", 5, "")
	if err != nil {
		t.Fatal(err)
	}
	p := store.MediaFilePath(m)
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte("bild1"), 0o644); err != nil {
		t.Fatal(err)
	}
	e := &restoreEnv{t: t, srv: srv, store: store, token: token, uid: claims.UserID, media: p, reopened: make(chan struct{}, 1)}
	srv.SetRestarter(func() { e.reopened <- struct{}{} })
	return e
}

func (e *restoreEnv) call(method, path, body string) *httptest.ResponseRecorder {
	return sessionCall(e.srv.Router(), method, path, e.token, body, "")
}

func (e *restoreEnv) runBackup() storage.BackupFile {
	e.t.Helper()
	rec := e.call(http.MethodPost, "/api/v1/admin/backups", "")
	var files []storage.BackupFile
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &files) != nil || len(files) == 0 || !files[0].Full {
		e.t.Fatalf("backup run: %d %s", rec.Code, rec.Body.String())
	}
	return files[0]
}

// reopen waits for the restarter, then does what the runner does: close, open through
// OpenStoreWithRestore, a new server. The env points at the new one.
func (e *restoreEnv) reopen() error {
	e.t.Helper()
	select {
	case <-e.reopened:
	case <-time.After(10 * time.Second):
		e.t.Fatal("the restarter was not called")
	}
	return e.reopenNow()
}

// reopenNow closes and opens the store and server as the runner does (keys from the configuration).
func (e *restoreEnv) reopenNow() error {
	e.t.Helper()
	e.srv.Close()
	_ = e.store.Close()
	cfg := e.srv.cfg
	st, restoreErr, err := storage.OpenStoreWithRestore(cfg.DatabasePath, storage.WithSecretsKey(cfg.SecretsKey), storage.WithBackupSecretsKey(cfg.BackupSecretsKey()))
	if err != nil {
		e.t.Fatal(err)
	}
	cfg.TakeRestoredSecretsKey(st.SecretsKey())
	e.t.Cleanup(func() { _ = st.Close() })
	srv := NewServer(e.srv.cfg, st, ws.NewHub(), nil)
	e.t.Cleanup(srv.Close)
	srv.SetRestarter(func() { e.reopened <- struct{}{} })
	e.srv, e.store = srv, st
	return restoreErr
}

func (e *restoreEnv) titles() []string {
	docs, _ := e.store.GetDocuments(e.uid)
	return titles(docs)
}

func confirmBody(name string) string {
	b, _ := json.Marshal(map[string]string{"confirm": name})
	return string(b)
}

// From the list: a full backup brings back database and media; the current state is backed up first, and
// the restore is in the audit log of the restored database.
func TestRestoreFullBackupFromList(t *testing.T) {
	e := newRestoreEnv(t)
	backup := e.runBackup()
	if backup.Media != 1 {
		t.Fatalf("media in the backup: %+v", backup)
	}
	_, _ = e.store.CreateDocument(e.uid, "", "Nach der Sicherung", "📄", "", nil, nil, false)
	_ = os.Remove(e.media)

	if rec := e.call(http.MethodPost, "/api/v1/admin/backups/"+backup.Name+"/restore", confirmBody("falsch")); rec.Code != http.StatusBadRequest {
		t.Fatalf("without the confirmation: %d", rec.Code)
	}
	rec := e.call(http.MethodPost, "/api/v1/admin/backups/"+backup.Name+"/restore", confirmBody(backup.Name))
	var ans struct {
		Restarting       bool   `json:"restarting"`
		PreRestoreBackup string `json:"preRestoreBackup"`
	}
	if rec.Code != http.StatusAccepted || json.Unmarshal(rec.Body.Bytes(), &ans) != nil || !ans.Restarting || ans.PreRestoreBackup == "" {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
	if err := e.reopen(); err != nil {
		t.Fatalf("restore failed: %v", err)
	}
	if got := e.titles(); !hasTitleIn(got, "Vor der Sicherung") || hasTitleIn(got, "Nach der Sicherung") {
		t.Errorf("notes after the restore: %v", got)
	}
	if b, err := os.ReadFile(e.media); err != nil || string(b) != "bild1" {
		t.Errorf("picture after the restore: %q %v", b, err)
	}
	files, _ := storage.ListBackups(filepath.Join(e.srv.backupRoot(), "system"))
	var pre *storage.BackupFile
	for i := range files {
		if files[i].Name == ans.PreRestoreBackup {
			pre = &files[i]
		}
	}
	if pre == nil || pre.Reason != storage.FullBackupPreRestore {
		t.Fatalf("the backup before the restore must be listed: %+v", files)
	}
	entries, _ := e.store.AuditEntries(storage.AuditFilter{Action: storage.AuditBackupRestored})
	if len(entries) != 1 || entries[0].TargetName != backup.Name || entries[0].ActorID != e.uid {
		t.Errorf("audit log of the restored database: %+v", entries)
	}

	// And back: the pre-restore backup has the note from after the first backup
	e.token = sessionToken(t, e.store, e.uid)
	rec = e.call(http.MethodPost, "/api/v1/admin/backups/"+pre.Name+"/restore", confirmBody(pre.Name))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("undo: %d %s", rec.Code, rec.Body.String())
	}
	if err := e.reopen(); err != nil {
		t.Fatal(err)
	}
	if got := e.titles(); !hasTitleIn(got, "Nach der Sicherung") {
		t.Errorf("notes after undoing the restore: %v", got)
	}
	if _, err := os.Stat(e.media); !os.IsNotExist(err) {
		t.Errorf("the picture was gone before the first restore: %v", err)
	}
}

// sessionToken: a new session for the account (the restored database has other sessions).
func sessionToken(t *testing.T, store *storage.Store, uid string) string {
	t.Helper()
	u, err := store.GetUserByID(uid)
	if err != nil || u == nil {
		t.Fatalf("account %s: %v", uid, err)
	}
	token, err := auth.GenerateToken(testJWTSecret, u.ID, u.Email, u.DisplayName, u.TokenVersion, testSession(t, store, u.ID))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func hasTitleIn(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

// An old database snapshot (.db.gz) restores the database and leaves the media as they are.
func TestRestoreOldSnapshotKeepsMedia(t *testing.T) {
	e := newRestoreEnv(t)
	e.useKeyFile(testSecretsKey)
	e.addSecret()
	dir := filepath.Join(e.srv.backupRoot(), "system")
	name, err := e.store.WriteSystemSnapshot(dir, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	_, _ = e.store.CreateDocument(e.uid, "", "Nach der Sicherung", "📄", "", nil, nil, false)
	later := filepath.Join(filepath.Dir(e.media), "spaeter.png")
	_ = os.WriteFile(later, []byte("bild2"), 0o644)
	if rec := e.call(http.MethodPost, "/api/v1/admin/backups/"+name+"/restore", confirmBody(name)); rec.Code != http.StatusAccepted {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
	if err := e.reopen(); err != nil {
		t.Fatal(err)
	}
	if got := e.titles(); hasTitleIn(got, "Nach der Sicherung") {
		t.Errorf("notes: %v", got)
	}
	for _, p := range []string{e.media, later} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("media must stay with a database snapshot: %v", err)
		}
	}
	// No key in an old snapshot: the server's stays and opens the restored hidden values
	keyFile := filepath.Join(filepath.Dir(e.srv.cfg.DatabasePath), storage.FullBackupSecretsKey)
	if key, err := storage.ReadSecretsKeyFile(keyFile); err != nil || !bytes.Equal(key, testSecretsKey) || !bytes.Equal(e.srv.cfg.SecretsKey, testSecretsKey) {
		t.Errorf("the key must stay: %x %v", key, err)
	}
	if checked, unreadable := e.srv.CheckSecretsKey(); checked == 0 || unreadable != 0 {
		t.Errorf("hidden values after the restore: %d checked, %d unreadable", checked, unreadable)
	}
}

// Refused before anything changes: no restarter (the capability is off), a backup without an active admin,
// and a broken file; the staging folder does not stay.
func TestRestoreRefusals(t *testing.T) {
	e := newRestoreEnv(t)
	dir := filepath.Join(e.srv.backupRoot(), "system")

	// A database whose only account is a member
	other, err := storage.NewStore(filepath.Join(t.TempDir(), "mindsift.db"))
	if err != nil {
		t.Fatal(err)
	}
	_, _ = other.CreateUser("ben@example.com", "hash", "Ben", domain.RoleMember)
	noAdmin, err := other.WriteSystemSnapshot(dir, time.Now().Add(-2*time.Hour))
	_ = other.Close()
	if err != nil {
		t.Fatal(err)
	}
	rec := e.call(http.MethodPost, "/api/v1/admin/backups/"+noAdmin+"/restore", confirmBody(noAdmin))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Administrator") {
		t.Errorf("backup without an admin: %d %s", rec.Code, rec.Body.String())
	}
	broken := "mindsift-db-2026-01-01-030000.db.gz"
	_ = os.WriteFile(filepath.Join(dir, broken), []byte("kein gzip"), 0o600)
	if rec := e.call(http.MethodPost, "/api/v1/admin/backups/"+broken+"/restore", confirmBody(broken)); rec.Code != http.StatusBadRequest {
		t.Errorf("broken backup: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(e.srv.cfg.DatabasePath), storage.RestoreStagingDir)); err == nil {
		entries, _ := os.ReadDir(filepath.Join(filepath.Dir(e.srv.cfg.DatabasePath), storage.RestoreStagingDir))
		if len(entries) > 0 {
			t.Errorf("staging left over: %v", entries)
		}
	}
	select {
	case <-e.reopened:
		t.Error("a refused restore must not reopen")
	default:
	}
	files, _ := storage.ListBackups(dir)
	for _, f := range files {
		if f.Reason == storage.FullBackupPreRestore {
			t.Errorf("no backup of the current state for a refused restore: %s", f.Name)
		}
	}

	e.srv.SetRestarter(nil)
	if rec := e.call(http.MethodPost, "/api/v1/admin/backups/"+noAdmin+"/restore", confirmBody(noAdmin)); rec.Code != http.StatusNotFound {
		t.Errorf("without a restarter: %d", rec.Code)
	}
	if e.srv.can(capRestore) {
		t.Error("capability restore without a restarter")
	}
}

// The download of a full backup is one tar archive with the exact length; the browser's link download
// takes a one-time ticket instead of the header, admins only.
func TestDownloadFullBackupStreamsTar(t *testing.T) {
	e := newRestoreEnv(t)
	backup := e.runBackup()
	rec := e.call(http.MethodGet, "/api/v1/admin/backups/"+backup.Name, "")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Length") != fmt.Sprint(backup.Size) || int64(rec.Body.Len()) != backup.Size {
		t.Fatalf("download: %d, length %s, body %d, listed %d", rec.Code, rec.Header().Get("Content-Length"), rec.Body.Len(), backup.Size)
	}
	if !strings.Contains(rec.Header().Get("Content-Disposition"), backup.Name+".tar") {
		t.Errorf("file name: %s", rec.Header().Get("Content-Disposition"))
	}
	tr := tar.NewReader(bytes.NewReader(rec.Body.Bytes()))
	n := 0
	for {
		_, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		n++
	}
	if n != 3 {
		t.Errorf("entries: %d", n)
	}

	router := e.srv.Router()
	if rec := sessionCall(router, http.MethodGet, "/api/v1/admin/backup-download/"+backup.Name, "", "", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("without a ticket: %d", rec.Code)
	}
	var tk struct {
		Ticket string `json:"ticket"`
	}
	_ = json.Unmarshal(e.call(http.MethodPost, "/api/v1/auth/stream-ticket", "").Body.Bytes(), &tk)
	url := "/api/v1/admin/backup-download/" + backup.Name + "?ticket=" + tk.Ticket
	if rec := sessionCall(router, http.MethodGet, url, "", "", ""); rec.Code != http.StatusOK || int64(rec.Body.Len()) != backup.Size {
		t.Errorf("with a ticket: %d %d", rec.Code, rec.Body.Len())
	}
	if rec := sessionCall(router, http.MethodGet, url, "", "", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("a ticket works once: %d", rec.Code)
	}
}

// blockChecksum: the checksum the app computes (SHA-256 over the SHA-256 of each 32 MiB block).
func blockChecksum(data []byte) string {
	outer := sha256.New()
	for len(data) > 0 {
		n := min(len(data), uploadHashBlock)
		h := sha256.Sum256(data[:n])
		outer.Write(h[:])
		data = data[n:]
	}
	return hex.EncodeToString(outer.Sum(nil))
}

// The upload in chunks: a chunk at the wrong offset is refused with the real one, a damaged chunk is cut
// off again, the status tells where to resume, a wrong checksum refuses the restore, the right one restores.
func TestUploadInChunksAndRestore(t *testing.T) {
	e := newRestoreEnv(t)
	backup := e.runBackup()
	file := e.call(http.MethodGet, "/api/v1/admin/backups/"+backup.Name, "").Body.Bytes()
	_, _ = e.store.CreateDocument(e.uid, "", "Nach der Sicherung", "📄", "", nil, nil, false)
	_ = os.Remove(e.media)

	router := e.srv.Router()
	rec := e.call(http.MethodPost, "/api/v1/admin/backups/uploads", fmt.Sprintf(`{"name":"umzug.tar","size":%d}`, len(file)))
	var up struct {
		ID     string `json:"id"`
		Offset int64  `json:"offset"`
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &up) != nil || up.ID == "" {
		t.Fatalf("start: %d %s", rec.Code, rec.Body.String())
	}
	put := func(offset int, chunk []byte, sum string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/v1/admin/backups/uploads/%s?offset=%d", up.ID, offset), bytes.NewReader(chunk))
		req.Header.Set("Authorization", "Bearer "+e.token)
		if sum != "" {
			req.Header.Set("X-Chunk-SHA256", sum)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	sum := func(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
	half := len(file) / 2
	if rec := put(0, file[:half], sum(file[:half])); rec.Code != http.StatusOK {
		t.Fatalf("first chunk: %d %s", rec.Code, rec.Body.String())
	}
	if rec := put(0, file[:half], ""); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), fmt.Sprintf(`"offset":%d`, half)) {
		t.Errorf("a chunk at the wrong offset: %d %s", rec.Code, rec.Body.String())
	}
	if rec := put(half, file[half:], sum([]byte("anders"))); rec.Code != http.StatusBadRequest {
		t.Errorf("a damaged chunk: %d %s", rec.Code, rec.Body.String())
	}
	var st struct {
		Offset int64 `json:"offset"`
	}
	_ = json.Unmarshal(e.call(http.MethodGet, "/api/v1/admin/backups/uploads/"+up.ID, "").Body.Bytes(), &st)
	if st.Offset != int64(half) {
		t.Fatalf("resume at %d, want %d", st.Offset, half)
	}
	restoreURL := "/api/v1/admin/backups/uploads/" + up.ID + "/restore"
	body := func(sha string) string { return fmt.Sprintf(`{"confirm":"umzug.tar","sha256":"%s"}`, sha) }
	if rec := e.call(http.MethodPost, restoreURL, body(blockChecksum(file))); rec.Code != http.StatusConflict {
		t.Errorf("restore of an incomplete upload: %d", rec.Code)
	}
	if rec := put(half, file[half:], sum(file[half:])); rec.Code != http.StatusOK {
		t.Fatalf("second chunk: %d %s", rec.Code, rec.Body.String())
	}
	if rec := e.call(http.MethodPost, restoreURL, body(blockChecksum([]byte("x")))); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Prüfsumme") {
		t.Errorf("wrong checksum: %d %s", rec.Code, rec.Body.String())
	}
	if rec := e.call(http.MethodPost, restoreURL, body(blockChecksum(file))); rec.Code != http.StatusAccepted {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(e.srv.uploadsRoot(), up.ID)); !os.IsNotExist(err) {
		t.Errorf("the upload must go once staged: %v", err)
	}
	if err := e.reopen(); err != nil {
		t.Fatal(err)
	}
	if got := e.titles(); hasTitleIn(got, "Nach der Sicherung") || !hasTitleIn(got, "Vor der Sicherung") {
		t.Errorf("notes: %v", got)
	}
	if b, err := os.ReadFile(e.media); err != nil || string(b) != "bild1" {
		t.Errorf("picture: %q %v", b, err)
	}
	entries, _ := e.store.AuditEntries(storage.AuditFilter{Action: storage.AuditBackupRestored})
	if len(entries) != 1 || entries[0].TargetName != "umzug.tar" {
		t.Errorf("audit: %+v", entries)
	}
}

// An upload too large for the limit is refused at the start; one nobody touched for a day goes.
func TestUploadLimitAndAbandonedCleanup(t *testing.T) {
	e := newRestoreEnv(t)
	e.srv.cfg.RestoreUploadMaxGB = 1
	if rec := e.call(http.MethodPost, "/api/v1/admin/backups/uploads", fmt.Sprintf(`{"name":"gross.tar","size":%d}`, int64(2)<<30)); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("too large: %d %s", rec.Code, rec.Body.String())
	}
	rec := e.call(http.MethodPost, "/api/v1/admin/backups/uploads", `{"name":"alt.tar","size":10}`)
	var up struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &up)
	dir := filepath.Join(e.srv.uploadsRoot(), up.ID)
	e.srv.runUploadCleanup(time.Now())
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("a fresh upload must stay: %v", err)
	}
	past := time.Now().Add(-25 * time.Hour)
	_ = os.Chtimes(dir, past, past)
	e.srv.runUploadCleanup(time.Now())
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("an abandoned upload must go: %v", err)
	}
}
