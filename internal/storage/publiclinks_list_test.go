package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The note list marks the owner's notes that have a valid public link; people the note is shared with
// do not see the mark, and an expired link counts as none.
func TestDocumentListMarksPublicLinks(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "publiclinks-list.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	block := []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "Text", Level: 0}}
	linked, _ := store.CreateDocument(anna.ID, "", "Öffentlich", "", "Projekte", block, nil, false)
	expired, _ := store.CreateDocument(anna.ID, "", "Abgelaufen", "", "", []domain.DocumentBlock{{ID: "b2", Type: "bullet", Content: "Text", Level: 0}}, nil, false)
	plain, _ := store.CreateDocument(anna.ID, "", "Privat", "", "", []domain.DocumentBlock{{ID: "b3", Type: "bullet", Content: "Text", Level: 0}}, nil, false)
	if _, err := store.CreateDocShare(anna.ID, linked.ID, ben.ID, "read"); err != nil {
		t.Fatalf("share: %v", err)
	}

	now := time.Now().UTC()
	save := func(docID, token string, expires time.Time) {
		if err := store.SavePublicLink(&PublicLink{
			ID: NewPublicLinkID(), DocID: docID, CreatedBy: anna.ID, TokenHash: token, TokenSealed: "x",
			ExpiresAt: expires.Format(time.RFC3339), CreatedAt: now.Format(time.RFC3339),
		}); err != nil {
			t.Fatalf("save link: %v", err)
		}
	}
	save(linked.ID, "h1", now.Add(24*time.Hour))
	save(expired.ID, "h2", now.Add(-time.Hour))

	list, err := store.GetDocumentList(context.Background(), anna.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	want := map[string]bool{linked.ID: true, expired.ID: false, plain.ID: false}
	for _, d := range list {
		if w, ok := want[d.ID]; ok && d.HasPublicLink != w {
			t.Errorf("%s: hasPublicLink %v, want %v", d.Title, d.HasPublicLink, w)
		}
	}
	if item, err := store.GetDocumentListItem(anna.ID, linked.ID); err != nil || !item.HasPublicLink {
		t.Errorf("list item of the owner should carry the mark: %+v, %v", item, err)
	}

	bens, err := store.GetDocumentList(context.Background(), ben.ID)
	if err != nil {
		t.Fatalf("Ben's list: %v", err)
	}
	for _, d := range bens {
		if d.HasPublicLink {
			t.Errorf("Ben is no owner and must not see the mark on %s", d.Title)
		}
	}
	if item, err := store.GetDocumentListItem(ben.ID, linked.ID); err != nil || item.HasPublicLink {
		t.Errorf("Ben's list item must not carry the mark: %+v, %v", item, err)
	}
}
