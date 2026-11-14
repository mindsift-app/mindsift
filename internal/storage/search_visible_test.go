package storage

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Hits in other people's notes and lists must not push one's own out of the results: the search looks
// only at what the person can see before it applies the limit.
func TestSearchOnlyLooksAtVisibleNotesAndLists(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "search.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")

	annaList, _ := store.CreateList(anna.ID, "Annas Liste", "", "")
	for i := 0; i < 60; i++ {
		// Title and bullet both match, and better than Ben's single word: they would win the ranking
		if _, err := store.CreateDocument(anna.ID, "", fmt.Sprintf("Apfelkuchen %d", i), "", "", []domain.DocumentBlock{
			{ID: fmt.Sprintf("a%d", i), Type: "bullet", Content: "Apfelkuchen Apfelkuchen Apfelkuchen"},
		}, nil, false); err != nil {
			t.Fatal(err)
		}
		if _, err := store.CreateListItem(annaList.ID, "Apfelkuchen", "", "", i, anna.ID); err != nil {
			t.Fatal(err)
		}
	}
	bensDoc, _ := store.CreateDocument(ben.ID, "", "Rezepte", "", "Küche", []domain.DocumentBlock{
		{ID: "b1", Type: "bullet", Content: "Omas Apfelkuchen mit Zimt"},
	}, nil, false)
	bensList, _ := store.CreateList(ben.ID, "Einkauf", "", "")
	bensItem, _ := store.CreateListItem(bensList.ID, "Apfelkuchen backen", "", "", 0, ben.ID)

	res, err := store.SearchCtx(context.Background(), ben.ID, "apfelkuchen", SearchOptions{Limit: 40})
	if err != nil {
		t.Fatal(err)
	}
	var docHit, itemHit bool
	for _, h := range res.Hits {
		switch h.Type {
		case "document":
			if h.DocID != bensDoc.ID {
				t.Fatalf("Ben sees a hit in someone else's note: %+v", h)
			}
			if h.BlockID == "b1" {
				docHit = true
				if h.Snippet == "" || h.Content != "Omas Apfelkuchen mit Zimt" || h.Title != "Rezepte" {
					t.Errorf("hit without snippet, text or title: %+v", h)
				}
			}
		case "list_item":
			if h.ListID != bensList.ID {
				t.Fatalf("Ben sees an item of someone else's list: %+v", h)
			}
			if h.ID == bensItem.ID {
				itemHit = true
			}
		}
	}
	if !docHit {
		t.Errorf("Ben's own bullet was pushed out by Anna's notes: %+v", res.Hits)
	}
	if !itemHit {
		t.Errorf("Ben's own list item was pushed out by Anna's list: %+v", res.Hits)
	}

	// The folder filter keeps to the person's folders
	res, _ = store.SearchCtx(context.Background(), ben.ID, "apfelkuchen", SearchOptions{Folder: "Garten", Type: "document"})
	if len(res.Hits) != 0 {
		t.Errorf("folder filter: want no hits outside the folder, got %+v", res.Hits)
	}
	res, _ = store.SearchCtx(context.Background(), ben.ID, "apfelkuchen", SearchOptions{Folder: "Küche", Type: "document"})
	if len(res.Hits) == 0 {
		t.Error("folder filter: Ben's note in Küche not found")
	}

	// Anna still finds her own, with the limit applied
	res, _ = store.SearchCtx(context.Background(), anna.ID, "apfelkuchen", SearchOptions{Limit: 10, Type: "document"})
	if len(res.Hits) != 10 {
		t.Errorf("Anna: want 10 hits (limit), got %d", len(res.Hits))
	}
}
