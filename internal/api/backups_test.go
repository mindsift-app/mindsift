package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func TestBackupsRunListDownloadAndRestoreSections(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	uid := claims.UserID
	_, _ = store.CreateDocument(uid, "", "Notiz vom Montag", "📝", "", nil, nil, false)
	list, _ := store.CreateList(uid, "Einkauf", "🛒", "shopping")
	_, _ = store.CreateListItem(list.ID, "Milch", "", "", 0, uid)
	_, _ = store.SaveUserTheme(uid, "", "Mein Theme", ":root[data-theme=\"x\"] { --accent-primary: #f00; }")

	call := func(method, path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	// Admin starts a run: one database snapshot plus a backup for the user
	rec := call("POST", "/api/v1/admin/backups")
	if rec.Code != http.StatusOK {
		t.Fatalf("run backups: %d %s", rec.Code, rec.Body.String())
	}
	var sysFiles []storage.BackupFile
	_ = json.Unmarshal(rec.Body.Bytes(), &sysFiles)
	if len(sysFiles) != 1 || !strings.HasSuffix(sysFiles[0].Name, ".db.gz") || sysFiles[0].Size == 0 {
		t.Fatalf("expected one snapshot, got %+v", sysFiles)
	}
	if rec := call("GET", "/api/v1/admin/backups/"+sysFiles[0].Name); rec.Code != http.StatusOK || rec.Body.Len() == 0 {
		t.Fatalf("download snapshot: %d", rec.Code)
	}
	if rec := call("GET", "/api/v1/admin/backups/..%2F..%2Fmindsift.db"); rec.Code != http.StatusNotFound {
		t.Fatalf("path tricks must be refused, got %d", rec.Code)
	}

	var mine []storage.BackupFile
	_ = json.Unmarshal(call("GET", "/api/v1/backups").Body.Bytes(), &mine)
	if len(mine) != 1 {
		t.Fatalf("expected one user backup, got %+v", mine)
	}

	// Lose data, then restore only the lists: notes stay as they are now
	listsBefore, _ := store.GetAllListsForUser(uid)
	docsBefore, _ := store.GetDocuments(uid)
	_ = store.PurgeUserSections(uid, map[string]bool{storage.SectionLists: true, storage.SectionThemes: true})
	_, _ = store.CreateDocument(uid, "", "Notiz vom Dienstag", "📝", "", nil, nil, false)
	rec = call("POST", "/api/v1/backups/"+mine[0].Name+"/restore?mode=restore&sections=lists,themes")
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
	lists, _ := store.GetAllListsForUser(uid)
	themes, _ := store.GetUserThemes(uid)
	docs, _ := store.GetDocuments(uid)
	if len(lists) != len(listsBefore) || len(themes) != 1 {
		t.Fatalf("lists and themes should be back: %d of %d lists, %d themes", len(lists), len(listsBefore), len(themes))
	}
	if len(docs) != len(docsBefore)+1 {
		t.Fatalf("notes were not selected and must stay untouched (plus Dienstag), got %d of %d", len(docs), len(docsBefore)+1)
	}

	// Retention: old files go
	dir := filepath.Join(srv.backupRoot(), "system")
	old := filepath.Join(dir, "mindsift-db-2000-01-01-0300.db.gz")
	_ = os.WriteFile(old, []byte("x"), 0o600)
	_ = os.Chtimes(old, mustTime("2000-01-01"), mustTime("2000-01-01"))
	_, _ = srv.runBackups()
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("backups older than the retention must be deleted")
	}
}

func mustTime(day string) (t time.Time) {
	t, _ = time.Parse("2006-01-02", day)
	return t
}

// Admins can delete database snapshots; members cannot, and only real backup names are accepted
func TestAdminDeletesBackups(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	call := func(method, path, tok string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	var files []storage.BackupFile
	_ = json.Unmarshal(call("POST", "/api/v1/admin/backups", token).Body.Bytes(), &files)
	if len(files) != 1 {
		t.Fatalf("expected one snapshot, got %+v", files)
	}
	name := files[0].Name

	_, memberToken := newTestUser(t, store, "member@example.com")
	if rec := call("DELETE", "/api/v1/admin/backups/"+name, memberToken); rec.Code != http.StatusForbidden {
		t.Fatalf("members must not delete backups, got %d", rec.Code)
	}
	if rec := call("DELETE", "/api/v1/admin/backups/..%2F..%2Fmindsift.db", token); rec.Code != http.StatusNotFound {
		t.Fatalf("path tricks must be refused, got %d", rec.Code)
	}
	rec := call("DELETE", "/api/v1/admin/backups/"+name, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &files)
	if len(files) != 0 {
		t.Fatalf("snapshot should be gone, got %+v", files)
	}
	if _, err := os.Stat(filepath.Join(srv.backupRoot(), "system", name)); !os.IsNotExist(err) {
		t.Fatalf("file must be removed from disk")
	}
}
