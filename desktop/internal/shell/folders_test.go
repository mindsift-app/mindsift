package shell

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFindInstances(t *testing.T) {
	base := t.TempDir()
	writeFile(t, filepath.Join(base, "data", DatabaseFile), "x")
	writeFile(t, filepath.Join(base, "instances", "Arbeit", DatabaseFile), "x")
	writeFile(t, filepath.Join(base, "instances", "leer", "notes.txt"), "x")
	writeFile(t, filepath.Join(base, "instances", "datei"), "x")
	got := FindInstances(base)
	if len(got) != 2 || got[0].Name != "Arbeit" || got[1].Name != "MindSift" || got[1].Path != filepath.Join(base, "data") {
		t.Fatalf("found = %+v", got)
	}
}

func TestInBase(t *testing.T) {
	base := t.TempDir()
	for dir, want := range map[string]bool{
		filepath.Join(base, "data"):                     true,
		filepath.Join(base, "instances", "A"):           true,
		filepath.Join(base, "instances", "A", "b"):      false,
		filepath.Join(base, "instances"):                false,
		filepath.Join(base, "instances", "..", "other"): false,
		filepath.Join(base, "other"):                    false,
		"/etc":                                          false,
	} {
		if got := InBase(base, dir); got != want {
			t.Errorf("InBase(%q) = %v, want %v", dir, got, want)
		}
	}
}

func TestNewInstanceFolder(t *testing.T) {
	base := t.TempDir()
	first := NewInstanceFolder(base, "Arbeit")
	if first != filepath.Join(base, "instances", "Arbeit") {
		t.Fatalf("folder = %q", first)
	}
	if err := CreateFolder(first); err != nil {
		t.Fatal(err)
	}
	if got := NewInstanceFolder(base, "Arbeit"); got != filepath.Join(base, "instances", "Arbeit 2") {
		t.Fatalf("folder = %q", got)
	}
}

func TestFolderName(t *testing.T) {
	for in, want := range map[string]string{
		"Arbeit":           "Arbeit",
		"  Privat  ":       "Privat",
		"a/b\\c:d":         "a-b-c-d",
		"..":               "MindSift",
		"":                 "MindSift",
		"Notizen.":         "Notizen",
		"con":              "_con",
		"Über & Ähnliches": "Über & Ähnliches",
	} {
		if got := FolderName(in); got != want {
			t.Errorf("FolderName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSyncService(t *testing.T) {
	root := t.TempDir()
	t.Setenv("OneDrive", filepath.Join(root, "od"))
	for dir, want := range map[string]string{
		filepath.Join(root, "Nextcloud", "MindSift"):       "Nextcloud",
		filepath.Join(root, "Dropbox (Firma)", "x"):        "Dropbox",
		filepath.Join(root, "OneDrive - Contoso", "x"):     "OneDrive",
		filepath.Join(root, "od", "Dokumente"):             "OneDrive",
		filepath.Join(root, "MEGA", "x"):                   "MEGA",
		filepath.Join(root, "megaproject", "x"):            "",
		filepath.Join(root, "Google Drive", "x"):           "Google Drive",
		"/run/user/1000/gvfs/google-drive:host=x/MindSift": "GVFS",
		filepath.Join(root, "plain", "x"):                  "",
	} {
		if got := SyncService(dir); got != want {
			t.Errorf("SyncService(%q) = %q, want %q", dir, got, want)
		}
	}
	// Marker files in a folder above
	writeFile(t, filepath.Join(root, "st", ".stfolder", "x"), "")
	if got := SyncService(filepath.Join(root, "st", "a", "b")); got != "Syncthing" {
		t.Errorf("Syncthing = %q", got)
	}
	writeFile(t, filepath.Join(root, "nc", ".sync_0123abcd.db"), "")
	if got := SyncService(filepath.Join(root, "nc", "MindSift")); got != "Nextcloud" {
		t.Errorf("Nextcloud journal = %q", got)
	}
}

func TestLockInstance(t *testing.T) {
	dir := t.TempDir()
	first, err := lockInstance(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lockInstance(dir); !errors.Is(err, ErrLocked) {
		t.Fatalf("second lock: %v", err)
	}
	first.release()
	again, err := lockInstance(dir)
	if err != nil {
		t.Fatalf("after release: %v", err)
	}
	again.release()
	if _, err := os.Stat(filepath.Join(dir, LockFile)); err != nil {
		t.Fatal(err)
	}
}
