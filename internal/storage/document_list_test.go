package storage

import (
	"context"
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

	list, err := store.GetDocumentList(context.Background(), anna.ID)
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
	benList, _ := store.GetDocumentList(context.Background(), ben.ID)
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

// One note as the list has it, for the realtime events: no bullets, the counts, the person's own view.
func TestDocumentListItem(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "item.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	carla, _ := store.CreateUser("carla@example.com", "hash", "Carla", "member")
	doc, err := store.CreateDocument(anna.ID, "", "Einkauf", "", "Privat", []domain.DocumentBlock{
		{ID: "t1", Type: "todo", Content: "Milch #laden"},
		{ID: "b1", Type: "bullet", Content: "Notiz #idee"},
	}, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDocShare(anna.ID, doc.ID, ben.ID, "write"); err != nil {
		t.Fatal(err)
	}

	item, err := store.GetDocumentListItem(anna.ID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(item.Blocks) != 0 || item.Content != "" || item.MarkdownCache != "" {
		t.Fatalf("list item carries bullets: %+v", item)
	}
	if item.OpenTodos != 1 || item.TagCounts["laden"] != 1 || item.TagCounts["idee"] != 1 || item.TagOpenTodos["laden"] != 1 {
		t.Errorf("counts = %d %v %v", item.OpenTodos, item.TagCounts, item.TagOpenTodos)
	}
	if !item.IsOwner || !item.IsPinned || item.FolderPath != "Privat" || len(item.SharedWith) != 1 {
		t.Errorf("owner's view: %+v", item)
	}

	forBen, err := store.GetDocumentListItem(ben.ID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if forBen.IsOwner || forBen.Permission != "write" || forBen.FolderPath != "" || forBen.OpenTodos != 1 {
		t.Errorf("Ben's view: %+v", forBen)
	}
	if _, err := store.GetDocumentListItem(carla.ID, doc.ID); err == nil {
		t.Error("Carla got a note not shared with her")
	}
}

// A client that gave up gets nothing built: the list stops with the context's error, not a partial list.
func TestDocumentListStopsWithContext(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "list.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	if _, err := store.CreateDocument(anna.ID, "", "Einkauf", "", "", nil, nil, false); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if list, err := store.GetDocumentList(ctx, anna.ID); !errors.Is(err, context.Canceled) || list != nil {
		t.Fatalf("cancelled list: %v, %d notes", err, len(list))
	}
	if list, err := store.GetDocumentList(context.Background(), anna.ID); err != nil || len(list) != 1 {
		t.Fatalf("list: %v, %d notes", err, len(list))
	}
}
