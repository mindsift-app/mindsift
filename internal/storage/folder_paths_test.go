package storage

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestCleanFolderPath(t *testing.T) {
	for in, want := range map[string]string{
		"Rancher / Kubernetes":  "Rancher/Kubernetes",
		" Rancher ":             "Rancher",
		"/Projekte//Stadt/":     "Projekte/Stadt",
		"Mein Ordner / Unter 1": "Mein Ordner/Unter 1",
		".":                     "",
		"":                      "",
	} {
		if got := cleanFolderPath(in); got != want {
			t.Errorf("cleanFolderPath(%q) = %q, want %q", in, got, want)
		}
	}
}

// "Rancher / Kubernetes" in one go: a note moved into "Rancher" lands in the same folder, not in a
// second "Rancher" next to it.
func TestFolderWithSpacesAroundSlashIsOneFolder(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "folders.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	path, err := store.CreateFolder(anna.ID, "Rancher / Kubernetes")
	if err != nil || path != "Rancher/Kubernetes" {
		t.Fatalf("CreateFolder: %q %v", path, err)
	}
	doc, _ := store.CreateDocument(anna.ID, "", "Cluster", "", "", nil, nil, false)
	moved, err := store.MoveDocument(anna.ID, doc.ID, "Rancher ")
	if err != nil || moved.FolderPath != "Rancher" {
		t.Fatalf("MoveDocument: %+v %v", moved, err)
	}
	folders, _ := store.GetFolders(anna.ID)
	if strings.Join(folders, "|") != "Rancher|Rancher/Kubernetes" {
		t.Fatalf("folders: %q", folders)
	}
}

// Paths stored before the cleanup lose their spaces; folder entries that become the same are merged.
func TestMigrateFolderPathsCleansOldData(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "migrate.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	doc, _ := store.CreateDocument(anna.ID, "", "Cluster", "", "Rancher", nil, nil, false)
	for i, p := range []string{"Rancher / Kubernetes", "Rancher/Kubernetes", "Rancher", "Mein Ordner"} {
		if _, err := store.db.Exec(`INSERT INTO workspace_folders (id, user_id, shared_folder_id, path, sub_path, created_at) VALUES (?, ?, '', ?, '', '')`,
			"wfld_old"+string(rune('a'+i)), anna.ID, p); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.db.Exec(`UPDATE documents SET folder_path = 'Rancher / Kubernetes ' WHERE id = ?`, doc.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.migrateFolderPaths(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	folders, _ := store.GetFolders(anna.ID)
	if strings.Join(folders, "|") != "Mein Ordner|Rancher|Rancher/Kubernetes" {
		t.Fatalf("folders: %q", folders)
	}
	var n int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM workspace_folders WHERE user_id = ? AND path = 'Rancher/Kubernetes'`, anna.ID).Scan(&n)
	if n != 1 {
		t.Fatalf("duplicate folder entries left: %d", n)
	}
	d, _ := store.GetDocumentByID(anna.ID, doc.ID)
	if d.FolderPath != "Rancher/Kubernetes" {
		t.Fatalf("note folder: %q", d.FolderPath)
	}
}
