package storage

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Pulling a note back in counts the links by id from notes of other people who can open the note:
// those would point to nothing afterwards. Title links, trashed notes and people without access do not
// count; the confirmed call pulls the note back anyway.
func TestInlineNoteCountsForeignIDLinks(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "inline.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	carl, _ := store.CreateUser("carl@example.com", "hash", "Carl", "member")
	block := func(id, content string) []domain.DocumentBlock {
		return []domain.DocumentBlock{{ID: id, Type: "bullet", Content: content, Level: 0}}
	}

	note, _ := store.CreateDocument(anna.ID, "", "Garten", "", "", block("n1", "Beete"), nil, false)
	src, _ := store.CreateDocument(anna.ID, "", "Projekt", "", "", block("s1", "[[Garten#"+note.ID+"]]"), nil, false)
	if _, err := store.CreateDocShare(anna.ID, note.ID, ben.ID, "read"); err != nil {
		t.Fatalf("share: %v", err)
	}
	// Ben: one bullet links the note, one a bullet of it (2), a title link (0), a trashed note (0)
	_, _ = store.CreateDocument(ben.ID, "", "Bens Plan", "", "", []domain.DocumentBlock{
		{ID: "b1", Type: "bullet", Content: "siehe [[Garten#" + note.ID + "]]"},
		{ID: "b2", Type: "bullet", Content: "[[Garten#" + note.ID + "^n1|Beete]]"},
		{ID: "b3", Type: "bullet", Content: "[[Garten]]"},
	}, nil, false)
	old, _ := store.CreateDocument(ben.ID, "", "Alt", "", "", block("b4", "[[Garten#"+note.ID+"]]"), nil, false)
	if err := store.DeleteDocument(ben.ID, old.ID); err != nil {
		t.Fatalf("trash: %v", err)
	}
	// Carl cannot open the note: his link points nowhere already
	_, _ = store.CreateDocument(carl.ID, "", "Carls Notiz", "", "", block("c1", "[[Garten#"+note.ID+"]]"), nil, false)

	_, err = store.InlineNote(anna.ID, src.ID, "s1")
	var foreign *ForeignLinksError
	if !errors.As(err, &foreign) || foreign.Count != 2 {
		t.Fatalf("want ForeignLinksError with 2 links, got %v", err)
	}
	if d, _ := store.GetDocumentByID(anna.ID, note.ID); d == nil || d.IsArchived {
		t.Fatal("refused pull-back must not trash the note")
	}

	res, err := store.InlineNoteConfirmed(anna.ID, src.ID, "s1")
	if err != nil || res.SourceID != note.ID {
		t.Fatalf("confirmed pull-back: %+v %v", res, err)
	}
	if d, _ := store.GetDocumentByID(anna.ID, note.ID); d == nil || !d.IsArchived {
		t.Fatal("confirmed pull-back must trash the note")
	}
}

// Only title links of other people: the pull-back goes through without a question.
func TestInlineNoteIgnoresForeignTitleLinks(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "inline-title.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	block := func(id, content string) []domain.DocumentBlock {
		return []domain.DocumentBlock{{ID: id, Type: "bullet", Content: content, Level: 0}}
	}
	note, _ := store.CreateDocument(anna.ID, "", "Garten", "", "", block("n1", "Beete"), nil, false)
	src, _ := store.CreateDocument(anna.ID, "", "Projekt", "", "", block("s1", "[[Garten#"+note.ID+"]]"), nil, false)
	if _, err := store.CreateDocShare(anna.ID, note.ID, ben.ID, "write"); err != nil {
		t.Fatalf("share: %v", err)
	}
	_, _ = store.CreateDocument(ben.ID, "", "Bens Plan", "", "", block("b1", "siehe [[garten]]"), nil, false)
	if _, err := store.InlineNote(anna.ID, src.ID, "s1"); err != nil {
		t.Fatalf("title links of others must not stop the pull-back: %v", err)
	}
}
