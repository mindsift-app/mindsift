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

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Audit 2026-11-22 F1: the hourly sweep of backups/deleted/ removes only what keepUserBackups wrote (a
// folder named after an account id with its account.json), never other folders, also old ones, in a
// folder the person chose. A chosen folder only gets MindSift's subfolder; nothing is swept beside it.
func TestDeletedBackupSweepLeavesForeignFolders(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)

	chosen := filepath.Join(t.TempDir(), "Nextcloud")
	old := time.Now().Add(-400 * 24 * time.Hour)
	plant := func(dir string, files map[string]string) {
		t.Helper()
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		for name, content := range files {
			if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		_ = os.Chtimes(dir, old, old)
	}
	// The person's own deleted/ folder right in the chosen folder
	plant(filepath.Join(chosen, "deleted", "Urlaubsfotos 2019"), map[string]string{"IMG_0001.jpg": "precious"})

	body, _ := json.Marshal(map[string]string{"dir": chosen})
	if rec := putJSONWith(t, router, "/api/v1/admin/backups/location", token, string(body)); rec.Code != http.StatusOK {
		t.Fatalf("set location: %d %s", rec.Code, rec.Body.String())
	}
	root := srv.backupRoot()
	if root == chosen {
		t.Fatalf("the backups go straight into the chosen folder %q", chosen)
	}
	gone := time.Now().Add(-300 * 24 * time.Hour).UTC().Format(time.RFC3339)
	// Inside MindSift's own folder: neither a foreign name, nor a missing, broken or mismatched account.json
	plant(filepath.Join(root, "deleted", "Fotos"), map[string]string{"account.json": `{"userId":"Fotos","deletedAt":"` + gone + `"}`})
	plant(filepath.Join(root, "deleted", "usr_0123456789ab"), map[string]string{"notes.txt": "x"})
	plant(filepath.Join(root, "deleted", "usr_1123456789ab"), map[string]string{"account.json": "{"})
	plant(filepath.Join(root, "deleted", "usr_2123456789ab"), map[string]string{"account.json": `{"userId":"usr_other","deletedAt":"` + gone + `"}`})
	expired := filepath.Join(root, "deleted", "usr_3123456789ab")
	plant(expired, map[string]string{"account.json": `{"userId":"usr_3123456789ab","deletedAt":"` + gone + `"}`})

	if rec := getWith(t, router, "/api/v1/admin/backups/deleted", token); rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "Fotos") || strings.Contains(rec.Body.String(), "usr_0123") {
		t.Errorf("foreign folders listed: %d %s", rec.Code, rec.Body.String())
	}
	srv.runDeletedBackupSweep(time.Now())
	for _, keep := range []string{
		filepath.Join(chosen, "deleted", "Urlaubsfotos 2019", "IMG_0001.jpg"),
		filepath.Join(root, "deleted", "Fotos"),
		filepath.Join(root, "deleted", "usr_0123456789ab"),
		filepath.Join(root, "deleted", "usr_1123456789ab"),
		filepath.Join(root, "deleted", "usr_2123456789ab"),
	} {
		if _, err := os.Stat(keep); err != nil {
			t.Errorf("the sweep removed %s: %v", keep, err)
		}
	}
	if _, err := os.Stat(expired); !os.IsNotExist(err) {
		t.Errorf("expired backups of a deleted account kept: %v", err)
	}
}

// An install from before the subfolder stored a folder that holds the backups directly: it stays in use,
// so the backups written there are still listed, restored and pruned.
func TestBackupFolderOfOlderInstallStays(t *testing.T) {
	store, dbPath := freshStore(t)
	chosen := filepath.Join(t.TempDir(), "Sicherungen")
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	if _, err := store.WriteSystemSnapshot(filepath.Join(chosen, "system"), time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := store.SetBackupDir(chosen); err != nil {
		t.Fatal(err)
	}
	if got := srv.backupRoot(); got != chosen {
		t.Fatalf("backup folder of an older install: %q, want %q", got, chosen)
	}
	if _, err := srv.runBackups(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(chosen, ".mindsift-backups")); err != nil {
		t.Errorf("older backup folder not marked: %v", err)
	}
	if _, err := os.Stat(filepath.Join(chosen, "MindSift-Backups")); !os.IsNotExist(err) {
		t.Errorf("a subfolder appeared in the older backup folder: %v", err)
	}
}

// A chosen backup folder on a drive that is not mounted does not exist: a run must neither create the path
// on the system disk nor fail silently. It is skipped with a message, the location says so (the
// administration shows a warning), and the next run writes again once the folder is back.
func TestBackupSkippedWhileChosenFolderMissing(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)

	chosen := filepath.Join(t.TempDir(), "usb-drive", "Backups")
	if err := os.MkdirAll(chosen, 0o755); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"dir": chosen})
	if rec := putJSONWith(t, router, "/api/v1/admin/backups/location", token, string(body)); rec.Code != http.StatusOK {
		t.Fatalf("set location: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := srv.runBackups(); err != nil {
		t.Fatalf("backup into an existing folder: %v", err)
	}

	// The drive goes away
	if err := os.RemoveAll(filepath.Dir(chosen)); err != nil {
		t.Fatal(err)
	}
	_, err := srv.runBackups()
	if err == nil || !strings.Contains(err.Error(), chosen) {
		t.Fatalf("run with the folder missing: %v, want an error naming %q", err, chosen)
	}
	if _, statErr := os.Stat(filepath.Dir(chosen)); !os.IsNotExist(statErr) {
		t.Fatalf("the run created the missing folder: %v", statErr)
	}
	rec := getWith(t, router, "/api/v1/admin/backups/location", token)
	var loc backupLocation
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &loc) != nil || !loc.ChosenMissing {
		t.Fatalf("location should report the missing folder: %d %s", rec.Code, rec.Body.String())
	}

	// Back again: the next run writes
	if err := os.MkdirAll(chosen, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.runBackups(); err != nil {
		t.Fatalf("run after the folder is back: %v", err)
	}
	rec = getWith(t, router, "/api/v1/admin/backups/location", token)
	loc = backupLocation{}
	if json.Unmarshal(rec.Body.Bytes(), &loc) != nil || loc.ChosenMissing {
		t.Errorf("warning stays although the folder is back: %s", rec.Body.String())
	}
}

// Under Flatpak a folder chosen in the system's dialog is a path of the document portal: the app keeps
// writing there, but the location and the message of a skipped run show the host's path (ShownPath), and
// what is stored and sent back stays the portal's path.
func TestBackupLocationShowsHostPath(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	portal := t.TempDir() // stands for /run/user/1000/doc/<id>
	srv.cfg.Desktop.ShownPath = func(p string) string {
		if rest, ok := strings.CutPrefix(p, portal); ok {
			return "/home/anna" + rest
		}
		return p
	}
	router := srv.Router()
	token := desktopToken(t, router)

	chosen := filepath.Join(portal, "Backups")
	if err := os.MkdirAll(chosen, 0o755); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"dir": chosen})
	rec := putJSONWith(t, router, "/api/v1/admin/backups/location", token, string(body))
	var loc backupLocation
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &loc) != nil {
		t.Fatalf("set location: %d %s", rec.Code, rec.Body.String())
	}
	if loc.Chosen != chosen || loc.ChosenShown != "/home/anna/Backups" {
		t.Errorf("chosen %q shown as %q", loc.Chosen, loc.ChosenShown)
	}
	if !strings.HasPrefix(loc.Dir, chosen) || loc.DirShown != "/home/anna/Backups/MindSift-Backups/"+srv.instanceBackupFolder() {
		t.Errorf("dir %q shown as %q", loc.Dir, loc.DirShown)
	}
	if loc.DefaultDir != srv.defaultBackupRoot() {
		t.Errorf("default folder %q", loc.DefaultDir)
	}

	if err := os.RemoveAll(chosen); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.runBackups(); err == nil || !strings.Contains(err.Error(), "/home/anna/Backups") || strings.Contains(err.Error(), portal) {
		t.Errorf("skipped run: %v, want the host's path", err)
	}
}

// A second "Jetzt sichern" while the first is still running (a double click, a second tab) makes no second
// backup: it waits for the running one and answers with its list.
func TestManualBackupWhileOneRunsMakesNoSecond(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)
	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/backups", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	snapshots := func() int {
		files, _ := storage.ListBackups(filepath.Join(srv.backupRoot(), "system"))
		return len(files)
	}

	// A run started by hand is going
	manualBackupMu.Lock()
	done := make(chan *httptest.ResponseRecorder)
	go func() { done <- post() }()
	select {
	case rec := <-done:
		manualBackupMu.Unlock()
		t.Fatalf("the second request did not wait for the running one: %d %s", rec.Code, rec.Body.String())
	case <-time.After(100 * time.Millisecond):
	}
	manualBackupMu.Unlock()
	if rec := <-done; rec.Code != http.StatusOK {
		t.Fatalf("second request: %d %s", rec.Code, rec.Body.String())
	}
	if n := snapshots(); n != 0 {
		t.Errorf("the second request made a backup of its own (%d snapshots)", n)
	}
	if rec := post(); rec.Code != http.StatusOK || snapshots() != 1 {
		t.Errorf("a request on its own: %d, %d snapshots", rec.Code, snapshots())
	}
}
