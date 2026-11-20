package storage

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A folder that came into being through a note (made in it, moved there) stays when its last note
// goes, like a folder made with "New folder".
func TestFoldersOfNotesStay(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "folders-keep.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	block := func(id string) []domain.DocumentBlock {
		return []domain.DocumentBlock{{ID: id, Type: "bullet", Content: "Text", Level: 0}}
	}
	folders := func() []string {
		t.Helper()
		f, err := store.GetFolders(anna.ID)
		if err != nil {
			t.Fatalf("GetFolders: %v", err)
		}
		return f
	}

	made, err := store.CreateDocument(anna.ID, "", "Agentennotiz", "", "Projekte / Neu", block("a1"), nil, false)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	moved, _ := store.CreateDocument(anna.ID, "", "Verschoben", "", "", block("a2"), nil, false)
	if _, err := store.MoveDocument(anna.ID, moved.ID, "Archiv"); err != nil {
		t.Fatalf("move: %v", err)
	}
	if _, err := store.MoveDocument(anna.ID, moved.ID, ""); err != nil {
		t.Fatalf("move back: %v", err)
	}
	if err := store.DeleteDocument(anna.ID, made.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	got := folders()
	for _, want := range []string{"Projekte", "Projekte/Neu", "Archiv"} {
		if !slices.Contains(got, want) {
			t.Errorf("folder %q is gone after its last note left: %v", want, got)
		}
	}

	// Moving a folder still leaves one folder behind, at the new place
	again, _ := store.CreateDocument(anna.ID, "", "Wieder da", "", "Archiv", block("a3"), nil, false)
	if _, _, err := store.MoveFolder(anna.ID, "Archiv", "Projekte"); err != nil {
		t.Fatalf("MoveFolder: %v", err)
	}
	got = folders()
	if slices.Contains(got, "Archiv") || !slices.Contains(got, "Projekte/Archiv") {
		t.Errorf("after moving the folder: %v", got)
	}
	if err := store.DeleteDocument(anna.ID, again.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if !slices.Contains(folders(), "Projekte/Archiv") {
		t.Errorf("moved folder gone with its last note: %v", folders())
	}
}

// The migration keeps the folders that so far only existed through their notes.
func TestMigrateKeepNoteFolders(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "folders-migrate.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	doc, _ := store.CreateDocument(anna.ID, "", "Alt", "", "", []domain.DocumentBlock{{ID: "m1", Type: "bullet", Content: "Text", Level: 0}}, nil, false)
	// A note in a folder as an older version left it: no folder row
	if _, err := store.db.Exec(`UPDATE documents SET folder_path = 'Altbestand / Unter' WHERE id = ?`, doc.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.migrateKeepNoteFolders(); err != nil {
		t.Fatalf("migration: %v", err)
	}
	if err := store.migrateKeepNoteFolders(); err != nil {
		t.Fatalf("migration again: %v", err)
	}
	var n int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM workspace_folders WHERE user_id = ? AND path = 'Altbestand/Unter'`, anna.ID).Scan(&n)
	if n != 1 {
		t.Fatalf("want one folder row, got %d", n)
	}
	if err := store.DeleteDocument(anna.ID, doc.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	got, _ := store.GetFolders(anna.ID)
	if !slices.Contains(got, "Altbestand/Unter") {
		t.Errorf("folder gone after its last note: %v", got)
	}
}
