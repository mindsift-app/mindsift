package storage

import (
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestBacklinks(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "backlinks.db"))
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

	target, _ := store.CreateDocument(anna.ID, "", "Homelab", "🖥️", "", block("t1", "Server [[Homelab]] selbst"), nil, false)
	_, _ = store.CreateDocument(anna.ID, "", "Einkauf", "🛒", "Privat", block("a1", "Kabel für [[ homelab |das Labor]] kaufen"), nil, false)
	_, _ = store.CreateDocument(anna.ID, "", "Ohne", "", "", block("a2", "Homelab ohne Klammern, [[Homelabor]]"), nil, false)
	trashed, _ := store.CreateDocument(anna.ID, "", "Alt", "", "", block("a3", "[[Homelab#Netz]]"), nil, false)
	_ = store.DeleteDocument(anna.ID, trashed.ID)
	bens, _ := store.CreateDocument(ben.ID, "", "Bens Plan", "", "", block("b1", "siehe [[Homelab]]"), nil, false)

	links, err := store.GetBacklinks(anna.ID, target.ID)
	if err != nil {
		t.Fatalf("GetBacklinks: %v", err)
	}
	if len(links) != 1 || links[0].Title != "Einkauf" || links[0].FolderPath != "Privat" || len(links[0].Blocks) != 1 || links[0].Blocks[0].ID != "a1" {
		t.Fatalf("expected only Einkauf (alias link), not itself, plain text, other titles, trash or Ben's private note: %+v", links)
	}

	// Ben's note counts once Anna can see it
	if _, err := store.CreateDocShare(ben.ID, bens.ID, anna.ID, "read"); err != nil {
		t.Fatalf("share: %v", err)
	}
	if links, _ := store.GetBacklinks(anna.ID, target.ID); len(links) != 2 {
		t.Errorf("shared note should appear: %+v", links)
	}
	if _, err := store.GetBacklinks(ben.ID, target.ID); err == nil {
		t.Errorf("Ben cannot open Homelab, so no backlinks for him")
	}
}
