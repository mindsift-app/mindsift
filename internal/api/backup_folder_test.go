package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
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
