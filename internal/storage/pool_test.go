package storage

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// With a single connection, code that asks for a second one while it holds the first (a query per row
// while the rows are open, a lookup between Query and the loop) hangs at once. Under load the same code
// used up the 8 connections of the pool and stopped the whole server for good (load test 2026-11-05).
// The whole suite can be run like this too: DB_MAX_CONNS=1 go test ./internal/...
func TestQueriesNeedOnlyOneConnection(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "pool.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	blocks := []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "Gewürzregal aufräumen"}}
	doc, _ := store.CreateDocument(anna.ID, "", "Küche", "", "", blocks, nil, false)
	_, _ = store.CreateDocument(anna.ID, "", "Gewürzregal", "", "", blocks, nil, false)
	list, _ := store.CreateList(anna.ID, "Einkauf", "", "shopping")
	if _, err := store.AddListShare(anna.ID, list.ID, "user", ben.ID, "editor"); err != nil {
		t.Fatalf("AddListShare: %v", err)
	}
	folder, _ := store.CreateSharedFolder(anna.ID, "Familie", "Familie")
	if _, err := store.CreateFolderShare(anna.ID, folder.ID, "user", ben.Email, "write"); err != nil {
		t.Fatalf("CreateFolderShare: %v", err)
	}
	_, _ = store.CreateTaskList(anna.ID, "", "", "Haushalt", "", "")

	store.db.SetMaxOpenConns(1)

	within := func(name string, fn func()) {
		t.Helper()
		done := make(chan struct{})
		go func() {
			fn()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatalf("%s needs a second database connection while holding one (hangs with a single connection)", name)
		}
	}

	within("Search", func() {
		res, err := store.SearchGlobal(anna.ID, "Gewürzregal")
		if err != nil || len(res.Documents) != 2 {
			t.Errorf("Search: want both notes, got %v, %+v", err, res)
		}
		for _, h := range res.Hits {
			if h.DocID == doc.ID && h.BlockID == "b1" && h.Before != "" {
				t.Errorf("Search: unexpected context before the first bullet: %q", h.Before)
			}
		}
	})
	within("GetListShares", func() {
		shares, err := store.GetListShares(list.ID)
		if err != nil || len(shares) != 1 || shares[0].TargetName != "Ben" || shares[0].Email != "ben@example.com" {
			t.Errorf("GetListShares: want Ben with name and email, got %v, %+v", err, shares)
		}
	})
	within("GetSharedFolders", func() {
		folders, err := store.GetSharedFolders(anna.ID)
		if err != nil || len(folders) != 1 || len(folders[0].Shares) != 1 {
			t.Errorf("GetSharedFolders: want the folder with its share, got %v, %+v", err, folders)
		}
	})
	within("GetTaskLists", func() {
		if tls, err := store.GetTaskLists(anna.ID); err != nil || len(tls) != 1 || len(tls[0].Columns) == 0 {
			t.Errorf("GetTaskLists: want the list with its columns, got %v, %+v", err, tls)
		}
	})
}

// The search only returns what the results show: bullet text in the hit, light note entries, and the
// neighbouring bullets only when asked for (loading every hit note in full was most of its work).
func TestSearchContextOnlyOnRequest(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "search.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	blocks := []domain.DocumentBlock{
		{ID: "b1", Type: "bullet", Content: "Davor"},
		{ID: "b2", Type: "bullet", Content: "Das **Gewürzregal** aufräumen"},
		{ID: "b3", Type: "bullet", Content: "Danach"},
	}
	_, _ = store.CreateDocument(anna.ID, "", "Küche", "🍳", "", blocks, nil, false)

	res, err := store.Search(anna.ID, "Gewürzregal", SearchOptions{})
	if err != nil || len(res.Hits) == 0 {
		t.Fatalf("search: %v, %+v", err, res)
	}
	h := res.Hits[0]
	if h.Content != "Das **Gewürzregal** aufräumen" || h.Before != "" || h.After != "" {
		t.Errorf("without context: want the raw bullet text and no neighbours, got %+v", h)
	}
	if len(res.Documents) != 1 || res.Documents[0].Title != "Küche" || res.Documents[0].Icon != "🍳" || len(res.Documents[0].Blocks) != 0 {
		t.Errorf("documents: want a light entry, got %+v", res.Documents)
	}
	res, _ = store.Search(anna.ID, "Gewürzregal", SearchOptions{Context: true})
	if h := res.Hits[0]; h.Before != "Davor" || h.After != "Danach" {
		t.Errorf("with context: want the neighbours, got %+v", h)
	}
}

// Ticking an item someone else deleted meanwhile: "not found" (404), not the raw SQL error.
func TestListItemGoneIsNotFound(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "items.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	list, _ := store.CreateList(anna.ID, "Einkauf", "", "shopping")
	item, _ := store.CreateListItem(list.ID, "Milch", "", "", 0, anna.ID)
	_, _ = store.DeleteListItem(item.ID)
	if _, err := store.ToggleListItem(item.ID, true, anna.ID, "Anna"); !errors.Is(err, ErrListItemNotFound) {
		t.Errorf("toggle: want ErrListItemNotFound, got %v", err)
	}
	text := "Hafermilch"
	if _, err := store.UpdateListItem(item.ID, &text, nil, nil); !errors.Is(err, ErrListItemNotFound) {
		t.Errorf("update: want ErrListItemNotFound, got %v", err)
	}
}
