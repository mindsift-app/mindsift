package storage

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func blockContent(t *testing.T, s *Store, userID, docID, blockID string) string {
	t.Helper()
	d, err := s.GetDocumentByID(userID, docID)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range d.Blocks {
		if b.ID == blockID {
			return b.Content
		}
	}
	t.Fatalf("block %s missing", blockID)
	return ""
}

// Two notes with the same title: a link by id finds exactly its own, also after a rename; older links
// by title still count.
func TestBacklinksByID(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "links.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	a, _ := s.CreateDocument(anna.ID, "", "Garten", "", "Privat", nil, nil, false)
	b, _ := s.CreateDocument(anna.ID, "", "Garten", "", "Arbeit", nil, nil, false)
	src, _ := s.CreateDocument(anna.ID, "", "Index", "", "", []domain.DocumentBlock{
		{ID: "blk_l1", Type: "bullet", Content: "Siehe " + noteLink("Garten", a.ID, ""), Level: 0},
		{ID: "blk_l2", Type: "bullet", Content: "Punkt " + blockLink("Garten", b.ID, "blk_x", "da"), Level: 0},
	}, nil, false)
	title := "Gemüsegarten"
	if _, err := s.UpdateDocument(anna.ID, a.ID, &title, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	for doc, want := range map[string]string{a.ID: "blk_l1", b.ID: "blk_l2"} {
		bl, err := s.GetBacklinks(anna.ID, doc)
		if err != nil || len(bl) != 1 || bl[0].DocID != src.ID || len(bl[0].Blocks) != 1 || bl[0].Blocks[0].ID != want {
			t.Fatalf("backlinks of %s: %+v %v", doc, bl, err)
		}
	}
}

// The update gives existing links the id of their note where the title is unique; ambiguous and dead
// links stay as they are, links to a bullet find the note through the bullet.
func TestMigrateWikiLinksToIDs(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "migrate.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	homelab, _ := s.CreateDocument(anna.ID, "", "Homelab", "", "", []domain.DocumentBlock{
		{ID: "blk_h1", Type: "bullet", Content: "Backups", Level: 0},
	}, nil, false)
	_, _ = s.CreateDocument(anna.ID, "", "Garten", "", "A", nil, nil, false)
	_, _ = s.CreateDocument(anna.ID, "", "Garten", "", "B", nil, nil, false)
	src, _ := s.CreateDocument(anna.ID, "", "Index", "", "", []domain.DocumentBlock{
		{ID: "blk_m1", Type: "bullet", Content: "Siehe [[homelab|hier]] und [[Garten]] und [[Gibt es nicht]]", Level: 0},
		{ID: "blk_m2", Type: "bullet", Content: "[[Alter Titel#^blk_h1|Homelab › Backups]]", Level: 0},
		{ID: "blk_m3", Type: "bullet", Content: "Ohne Links", Level: 0},
	}, nil, false)
	if err := s.migrateWikiLinksToIDs(); err != nil {
		t.Fatal(err)
	}
	if got, want := blockContent(t, s, anna.ID, src.ID, "blk_m1"), "Siehe [[Homelab#"+homelab.ID+"|hier]] und [[Garten]] und [[Gibt es nicht]]"; got != want {
		t.Fatalf("links: %q, want %q", got, want)
	}
	if got, want := blockContent(t, s, anna.ID, src.ID, "blk_m2"), "[[Homelab#"+homelab.ID+"^blk_h1|Homelab › Backups]]"; got != want {
		t.Fatalf("bullet link: %q, want %q", got, want)
	}
	// Running again changes nothing
	if err := s.migrateWikiLinksToIDs(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(blockContent(t, s, anna.ID, src.ID, "blk_m1"), "#"+homelab.ID+"|hier") {
		t.Fatal("second run broke the link")
	}
}

// Outside the app (export, agents, public pages) links carry the current title and no ids.
func TestReadableWikiLinks(t *testing.T) {
	titles := map[string]string{"doc_1": "Homelab 2.0"}
	in := "[[Homelab#doc_1]], [[Homelab#doc_1|hier]], [[Homelab#doc_1^blk_2]], [[Weg#doc_9]], [[Alt]]"
	if got, want := ReadableWikiLinks(in, titles), "[[Homelab 2.0]], [[Homelab 2.0|hier]], [[Homelab 2.0#^blk_2]], [[Weg]], [[Alt]]"; got != want {
		t.Fatalf("readable: %q, want %q", got, want)
	}
	// An agent edits around a link it read without id: the link keeps its id
	old := "Siehe [[Homelab#doc_1|hier]]"
	if got, want := KeepWikiLinkIDs(old, "Bitte siehe [[Homelab 2.0|hier]] und [[Neu]]", titles), "Bitte siehe [[Homelab 2.0#doc_1|hier]] und [[Neu]]"; got != want {
		t.Fatalf("keep ids: %q, want %q", got, want)
	}
}
