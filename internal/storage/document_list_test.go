package storage

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The note list carries no bullets but the counts the app shows from them; to-dos and single bullets
// come from their own queries, each only for notes the person may see.
func TestDocumentListWithoutBullets(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "list.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")

	doc, err := store.CreateDocument(anna.ID, "", "Einkauf", "", "", []domain.DocumentBlock{
		{ID: "t1", Type: "todo", Content: "Milch #laden"},
		{ID: "t2", Type: "todo", Content: "Brot #laden", Checked: true},
		{ID: "t3", Type: "todo", Content: "   "},
		{ID: "b1", Type: "bullet", Content: "Notiz #laden #idee"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := store.CreateDocument(anna.ID, "", "Leer", "", "", []domain.DocumentBlock{{ID: "x1", Type: "bullet", Content: "nichts"}}, nil, false)
	bensDoc, _ := store.CreateDocument(ben.ID, "", "Bens", "", "", []domain.DocumentBlock{{ID: "z1", Type: "todo", Content: "Geheim #ben"}}, nil, false)

	list, err := store.GetDocumentList(anna.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("Anna sees %d notes, want 2", len(list))
	}
	var got *domain.Document
	for i := range list {
		if len(list[i].Blocks) != 0 || list[i].Content != "" {
			t.Fatalf("note list carries bullets: %+v", list[i])
		}
		if list[i].ID == doc.ID {
			got = &list[i]
		}
	}
	if got == nil {
		t.Fatal("note missing from the list")
	}
	if got.OpenTodos != 1 {
		t.Errorf("OpenTodos = %d, want 1 (empty and checked ones do not count)", got.OpenTodos)
	}
	if got.TagCounts["laden"] != 3 || got.TagCounts["idee"] != 1 {
		t.Errorf("TagCounts = %v", got.TagCounts)
	}
	if got.TagOpenTodos["laden"] != 1 || got.TagOpenTodos["idee"] != 0 {
		t.Errorf("TagOpenTodos = %v", got.TagOpenTodos)
	}
	for i := range list {
		if list[i].ID == other.ID && (list[i].OpenTodos != 0 || len(list[i].TagCounts) != 0) {
			t.Errorf("note without to-dos or tags got counts: %+v", list[i])
		}
	}

	// The full list for server code still has the bullets
	full, _ := store.GetDocuments(anna.ID)
	for i := range full {
		if full[i].ID == doc.ID && len(full[i].Blocks) != 4 {
			t.Fatalf("GetDocuments lost the bullets: %d", len(full[i].Blocks))
		}
	}

	todos, err := store.ListNoteTodos(anna.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(todos) != 2 || todos[0].BlockID != "t1" || todos[1].BlockID != "t2" || !todos[1].Checked {
		t.Fatalf("to-dos = %+v", todos)
	}
	for _, td := range todos {
		if td.DocID == bensDoc.ID {
			t.Fatal("Ben's to-do in Anna's list")
		}
	}

	b, err := store.GetBlockForUser(anna.ID, "b1")
	if err != nil || b.DocumentID != doc.ID || b.Content != "Notiz #laden #idee" || b.Type != "bullet" {
		t.Fatalf("own bullet: %+v %v", b, err)
	}
	if _, err := store.GetBlockForUser(anna.ID, "z1"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("someone else's bullet: want ErrNoRows, got %v", err)
	}
	if _, err := store.GetBlockForUser(anna.ID, "missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing bullet: want ErrNoRows, got %v", err)
	}

	// Shared with Ben: he sees the note with its counts, its to-dos and its bullets
	if _, err := store.CreateDocShare(anna.ID, doc.ID, ben.ID, "read"); err != nil {
		t.Fatal(err)
	}
	benList, _ := store.GetDocumentList(ben.ID)
	found := false
	for i := range benList {
		if benList[i].ID == doc.ID {
			found = true
			if benList[i].OpenTodos != 1 || benList[i].TagCounts["laden"] != 3 {
				t.Errorf("shared note counts for Ben: %+v", benList[i])
			}
		}
	}
	if !found {
		t.Fatal("shared note missing from Ben's list")
	}
	if _, err := store.GetBlockForUser(ben.ID, "b1"); err != nil {
		t.Fatalf("shared bullet for Ben: %v", err)
	}
}
