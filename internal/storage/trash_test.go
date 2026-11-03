package storage

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestTrashHidesRestoresAndPurgesNotes(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "trash.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	blocks := []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "Zebrastreifen", Level: 0}}
	doc, _ := store.CreateDocument(anna.ID, "", "Verkehr", "🚦", "Projekte/Stadt", blocks, nil, false)
	_, _ = store.CreateFolder(anna.ID, "Projekte/Stadt")
	if _, err := store.CreateDocShare(anna.ID, doc.ID, ben.ID, "write"); err != nil {
		t.Fatalf("share: %v", err)
	}

	if err := store.DeleteDocument(anna.ID, doc.ID); err != nil {
		t.Fatalf("trash: %v", err)
	}
	visible := func(uid string) bool {
		docs, _ := store.GetDocuments(uid)
		for _, d := range docs {
			if d.ID == doc.ID {
				return true
			}
		}
		return false
	}
	if visible(anna.ID) || visible(ben.ID) {
		t.Errorf("trashed note must leave the tree of owner and shared users")
	}
	if res, _ := store.SearchGlobal(anna.ID, "Zebrastreifen"); len(res.Documents) != 0 {
		t.Errorf("trashed note must not be found: %+v", res.Documents)
	}
	if store.DocRole(anna.ID, doc.ID) != DocRoleViewer || store.DocRole(ben.ID, doc.ID) != "" {
		t.Errorf("trash is read-only for the owner and hidden from others")
	}
	if got, err := store.GetDocumentByID(anna.ID, doc.ID); err != nil || !got.IsArchived || got.Permission != "read" {
		t.Errorf("owner reads the trashed note read-only: %+v %v", got, err)
	}
	if _, err := store.GetDocumentByID(ben.ID, doc.ID); err == nil {
		t.Errorf("shared user must not open a trashed note")
	}
	title := "Neu"
	if _, err := store.UpdateDocument(anna.ID, doc.ID, &title, nil, nil, nil); err == nil {
		t.Errorf("trashed note must not be renamed")
	}
	trash, _ := store.GetTrash(anna.ID)
	if len(trash) != 1 || trash[0].FolderPath != "Projekte/Stadt" || trash[0].DeletedAt == "" {
		t.Fatalf("trash list wrong: %+v", trash)
	}
	if err := store.RestoreDocument(ben.ID, doc.ID); err == nil {
		t.Errorf("only the owner may restore")
	}

	// The folder was deleted meanwhile; restoring creates it again
	_, _ = store.db.Exec(`DELETE FROM workspace_folders WHERE user_id = ?`, anna.ID)
	if err := store.RestoreDocument(anna.ID, doc.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !visible(anna.ID) || !visible(ben.ID) || store.DocRole(ben.ID, doc.ID) != DocRoleEditor {
		t.Errorf("restored note is back for everyone, shares intact")
	}
	if folders, _ := store.GetFolders(anna.ID); len(folders) == 0 {
		t.Errorf("folder should be created again on restore")
	}

	// Deleting a folder moves its notes to the trash; emptying deletes them for good
	if _, err := store.DeleteFolder(anna.ID, "Projekte"); err != nil {
		t.Fatalf("DeleteFolder: %v", err)
	}
	if trash, _ := store.GetTrash(anna.ID); len(trash) != 1 {
		t.Fatalf("folder deletion should trash the note, got %+v", trash)
	}
	if ids, err := store.EmptyTrash(anna.ID); err != nil || len(ids) != 1 {
		t.Fatalf("EmptyTrash: %v %v", ids, err)
	}
	var docs, shares int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE id = ?`, doc.ID).Scan(&docs)
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM doc_shares WHERE doc_id = ?`, doc.ID).Scan(&shares)
	if docs+shares != 0 {
		t.Errorf("purge must remove the note and its shares")
	}
}

// A deleted personal folder goes to the trash as one entry with its notes and subfolders (empty ones too)
// and comes back as it was; deleting it for good or letting it expire removes it with its notes.
func TestDeletedFolderGoesToTrashAsAWhole(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "foldertrash.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	for _, p := range []string{"Projekte", "Projekte/Stadt", "Projekte/Leer", "Privat"} {
		if _, err := store.CreateFolder(anna.ID, p); err != nil {
			t.Fatal(err)
		}
	}
	top, _ := store.CreateDocument(anna.ID, "", "Übersicht", "", "Projekte", nil, nil, false)
	inner, _ := store.CreateDocument(anna.ID, "", "Verkehr", "", "Projekte/Stadt", nil, nil, false)
	loose, _ := store.CreateDocument(anna.ID, "", "Einzeln", "", "Privat", nil, nil, false)
	_ = store.DeleteDocument(anna.ID, loose.ID)

	if _, err := store.DeleteFolder(anna.ID, "Projekte"); err != nil {
		t.Fatalf("DeleteFolder: %v", err)
	}
	folders, _ := store.GetFolders(anna.ID)
	for _, f := range folders {
		if f == "Projekte" || f == "Projekte/Leer" {
			t.Fatalf("deleted folders must be gone from the tree: %v", folders)
		}
	}
	trash, _ := store.GetTrash(anna.ID)
	var folderEntry *TrashedDocument
	for i := range trash {
		if trash[i].Kind == "folder" {
			folderEntry = &trash[i]
		} else if trash[i].ID != loose.ID {
			t.Errorf("notes of the folder belong to its entry, not to the list: %+v", trash[i])
		}
	}
	if len(trash) != 2 || folderEntry == nil || folderEntry.Title != "Projekte" || folderEntry.NoteCount != 2 {
		t.Fatalf("trash should list the folder with 2 notes and the single note: %+v", trash)
	}

	if _, err := store.RestoreFolder(ben.ID, folderEntry.ID); err != ErrNotInTrash {
		t.Errorf("someone else must not restore the folder: %v", err)
	}
	restored, err := store.RestoreFolder(anna.ID, folderEntry.ID)
	if err != nil || len(restored) != 2 {
		t.Fatalf("RestoreFolder: %v %v", restored, err)
	}
	folders, _ = store.GetFolders(anna.ID)
	want := map[string]bool{"Projekte": false, "Projekte/Stadt": false, "Projekte/Leer": false}
	for _, f := range folders {
		if _, ok := want[f]; ok {
			want[f] = true
		}
	}
	for f, ok := range want {
		if !ok {
			t.Errorf("folder %q should be back (empty ones too): %v", f, folders)
		}
	}
	for _, id := range []string{top.ID, inner.ID} {
		if d, err := store.GetDocumentByID(anna.ID, id); err != nil || d.IsArchived {
			t.Errorf("note %s should be back: %+v %v", id, d, err)
		}
	}
	if trash, _ = store.GetTrash(anna.ID); len(trash) != 1 || trash[0].ID != loose.ID {
		t.Fatalf("only the single note stays in the trash: %+v", trash)
	}

	// Deleted for good: folder entry and notes are gone
	_, _ = store.DeleteFolder(anna.ID, "Projekte")
	trash, _ = store.GetTrash(anna.ID)
	for _, e := range trash {
		if e.Kind == "folder" {
			if ids, err := store.PurgeFolder(anna.ID, e.ID); err != nil || len(ids) != 2 {
				t.Fatalf("PurgeFolder: %v %v", ids, err)
			}
		}
	}
	var n int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE id IN (?, ?)`, top.ID, inner.ID).Scan(&n)
	if n != 0 {
		t.Errorf("notes of a purged folder must be gone")
	}

	// Expired like notes: entry and notes vanish with the notes trash delay
	again, _ := store.CreateDocument(anna.ID, "", "Neu", "", "Archiv", nil, nil, false)
	_, _ = store.CreateFolder(anna.ID, "Archiv")
	_, _ = store.DeleteFolder(anna.ID, "Archiv")
	if _, err := store.PurgeExpired(time.Now().AddDate(0, 2, 0), true); err != nil {
		t.Fatal(err)
	}
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM trashed_folders`).Scan(&n)
	var docs int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE id = ?`, again.ID).Scan(&docs)
	if n != 0 || docs != 0 {
		t.Errorf("expired folder and its note should be gone: folders %d, notes %d", n, docs)
	}
}
