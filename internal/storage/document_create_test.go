package storage

import (
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// TestCreateDocumentReturnsStoredIDs: bullets whose id belongs to another note, is missing or repeats
// get a new one when the note is created; the returned note names those ids, the ones the note has.
func TestCreateDocumentReturnsStoredIDs(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "create.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	me, _ := store.CreateUser("ich@example.com", "h", "Ich", "member")

	if _, err := store.CreateDocument(me.ID, "", "Vorlage", "", "", []domain.DocumentBlock{
		{ID: "blk_vorlage1", Type: "bullet", Content: "Original"},
		{ID: "blk_vorlage2", Type: "bullet", Content: "Original 2"},
	}, nil, false); err != nil {
		t.Fatal(err)
	}

	created, err := store.CreateDocument(me.ID, "", "Kopie", "", "", []domain.DocumentBlock{
		{ID: "blk_vorlage1", Type: "bullet", Content: "Kopiert #kopie"},
		{ID: "blk_vorlage2", Type: "todo", Content: "Kopiert darunter", Level: 1},
		{ID: "", Content: "Ohne Id"},
		{ID: "blk_eigen", Type: "bullet", Content: "Eigene Id"},
		{ID: "blk_eigen", Type: "bullet", Content: "Doppelte Id"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := store.GetDocumentByID(me.ID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(created.Blocks) != 5 || len(stored.Blocks) != 5 {
		t.Fatalf("bullets: created %d, stored %d", len(created.Blocks), len(stored.Blocks))
	}
	seen := map[string]bool{}
	for i, b := range created.Blocks {
		s := stored.Blocks[i]
		if b.ID != s.ID || b.Content != s.Content || b.Type != s.Type || b.Level != s.Level {
			t.Fatalf("bullet %d: created %+v, stored %+v", i, b, s)
		}
		if b.ID == "" || b.ID == "blk_vorlage1" || b.ID == "blk_vorlage2" || seen[b.ID] {
			t.Fatalf("bullet %d keeps an id the note cannot have: %q", i, b.ID)
		}
		seen[b.ID] = true
	}
	if created.Blocks[3].ID != "blk_eigen" {
		t.Fatalf("free id not kept: %q", created.Blocks[3].ID)
	}
	if created.Blocks[2].Type != "bullet" {
		t.Fatalf("missing type not filled in: %q", created.Blocks[2].Type)
	}
	if created.Content != stored.Content {
		t.Fatalf("content: created %q, stored %q", created.Content, stored.Content)
	}

	// The hashtag was indexed under the new id
	details, err := store.GetTagDetails(me.ID, "kopie")
	if err != nil {
		t.Fatal(err)
	}
	if details.TotalMatches != 1 || details.Documents[0].MatchedBlocks[0].RootBlock.ID != created.Blocks[0].ID {
		t.Fatalf("hashtag page: %+v", details)
	}
}
