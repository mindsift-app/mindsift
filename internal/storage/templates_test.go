package storage

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Templates are personal like the pin: each person marks the notes they can read, a read right is
// enough, and the mark shows only in that person's list and note.
func TestNoteTemplatesPerPerson(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "templates.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	cleo, _ := store.CreateUser("cleo@example.com", "hash", "Cleo", "member")

	doc, err := store.CreateDocument(anna.ID, "", "Besprechung", "", "", []domain.DocumentBlock{
		{ID: "v1", Type: "h2", Content: "Besprechung {{datum}}"},
		{ID: "v2", Type: "todo", Content: "Protokoll schreiben", Checked: true},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDocShare(anna.ID, doc.ID, ben.Email, "read"); err != nil {
		t.Fatalf("share: %v", err)
	}

	isTemplate := func(userID string) bool {
		t.Helper()
		list, err := store.GetDocumentList(context.Background(), userID)
		if err != nil {
			t.Fatal(err)
		}
		inList := false
		for _, d := range list {
			if d.ID == doc.ID {
				inList = d.IsTemplate
			}
		}
		got, err := store.GetDocumentByID(userID, doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.IsTemplate != inList {
			t.Fatalf("list says %v, note says %v", inList, got.IsTemplate)
		}
		return inList
	}

	// Ben may read the note: he can use it as his template, Anna's note stays as it is for her
	if err := store.SetDocTemplate(ben.ID, doc.ID, true); err != nil {
		t.Fatalf("reader marks template: %v", err)
	}
	if !isTemplate(ben.ID) {
		t.Error("Ben's template not marked for him")
	}
	if isTemplate(anna.ID) {
		t.Error("Ben's mark shows for the owner")
	}

	// Anna marks it for herself; twice changes nothing
	for range 2 {
		if err := store.SetDocTemplate(anna.ID, doc.ID, true); err != nil {
			t.Fatalf("owner marks template: %v", err)
		}
	}
	if !isTemplate(anna.ID) || !isTemplate(ben.ID) {
		t.Error("both marks expected")
	}

	// Cleo cannot see the note: no mark, the note stays hidden (not found)
	if err := store.SetDocTemplate(cleo.ID, doc.ID, true); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("stranger marks template: %v, want sql.ErrNoRows", err)
	}
	var n int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM doc_templates WHERE user_id = ?`, cleo.ID).Scan(&n)
	if n != 0 {
		t.Errorf("stranger got %d template rows", n)
	}

	// Removing the mark is personal too
	if err := store.SetDocTemplate(ben.ID, doc.ID, false); err != nil {
		t.Fatal(err)
	}
	if isTemplate(ben.ID) || !isTemplate(anna.ID) {
		t.Error("removing Ben's mark changed the wrong one")
	}

	// A note in the trash does not become a template; emptying the trash removes the marks
	if err := store.DeleteDocument(anna.ID, doc.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.SetDocTemplate(anna.ID, doc.ID, true); !errors.Is(err, ErrDocInTrash) {
		t.Errorf("template in the trash: %v, want ErrDocInTrash", err)
	}
	if err := store.DeleteDocument(anna.ID, doc.ID); err != nil {
		t.Fatal(err)
	}
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM doc_templates WHERE doc_id = ?`, doc.ID).Scan(&n)
	if n != 0 {
		t.Errorf("%d template rows left after the note was deleted", n)
	}
}
