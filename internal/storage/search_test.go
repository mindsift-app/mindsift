package storage

import (
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func setupTestStore(t *testing.T) (*Store, *domain.User, *domain.User) {
	t.Helper()
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_search.db")

	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	openSharing(t, store)

	userA, err := store.CreateUserWithUsername("alice@test.local", "alice", "hash123", "Alice", "member")
	if err != nil {
		t.Fatalf("CreateUser Alice failed: %v", err)
	}

	userB, err := store.CreateUserWithUsername("bob@test.local", "bob", "hash123", "Bob", "member")
	if err != nil {
		t.Fatalf("CreateUser Bob failed: %v", err)
	}

	return store, userA, userB
}

func TestSearchBlockContent(t *testing.T) {
	store, userA, _ := setupTestStore(t)
	defer store.Close()

	// Create document with block content
	doc, err := store.CreateDocument(userA.ID, "", "Rezeptbuch", "📖", "", nil, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}

	blockID := domain.NewID("blk")
	pos := 1.0
	_, err = store.db.Exec(`
		INSERT INTO blocks (id, document_id, content, level, position, type, deleted, deleted_at)
		VALUES (?, ?, ?, 0, ?, 'bullet', 0, '')
	`, blockID, doc.ID, "Zutaten: 500g Mehl und Hefe für Pizza", pos)
	if err != nil {
		t.Fatalf("Insert block failed: %v", err)
	}

	// Search for block content
	res, err := store.SearchGlobal(userA.ID, "Hefe")
	if err != nil {
		t.Fatalf("SearchGlobal failed: %v", err)
	}

	found := false
	for _, hit := range res.Hits {
		if hit.DocID == doc.ID && hit.BlockID == blockID {
			found = true
			if hit.Snippet == "" {
				t.Errorf("expected snippet with marked match, got empty string")
			}
			break
		}
	}
	if !found {
		t.Errorf("expected to find hit for block content 'Hefe', hits: %+v", res.Hits)
	}
}

func TestSearchTitleRanking(t *testing.T) {
	store, userA, _ := setupTestStore(t)
	defer store.Close()

	// Doc 1 has "Architektur" in block content
	docContent, err := store.CreateDocument(userA.ID, "", "Notizen zu Systemen", "📝", "", nil, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}
	_, err = store.db.Exec(`
		INSERT INTO blocks (id, document_id, content, level, position, type, deleted, deleted_at)
		VALUES (?, ?, 'Hier wird die Architektur im Detail besprochen', 0, 1.0, 'bullet', 0, '')
	`, domain.NewID("blk"), docContent.ID)
	if err != nil {
		t.Fatalf("Insert block failed: %v", err)
	}

	// Doc 2 has "Architektur" in title
	docTitle, err := store.CreateDocument(userA.ID, "", "Architektur Leitfaden", "🏛️", "", nil, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}

	res, err := store.SearchGlobal(userA.ID, "Architektur")
	if err != nil {
		t.Fatalf("SearchGlobal failed: %v", err)
	}

	if len(res.Hits) < 2 {
		t.Fatalf("expected at least 2 hits, got %d", len(res.Hits))
	}

	// First hit must be the document with the title match
	if res.Hits[0].DocID != docTitle.ID {
		t.Errorf("expected title match (doc %s) to rank first, got doc %s", docTitle.ID, res.Hits[0].DocID)
	}
}

func TestSearchPermissionsAndUnshared(t *testing.T) {
	store, userA, userB := setupTestStore(t)
	defer store.Close()

	// Alice creates private doc, private thought, and private list
	privateDoc, err := store.CreateDocument(userA.ID, "", "Geheimes Projekt", "🔒", "", nil, nil, false)
	if err != nil {
		t.Fatalf("CreateDocument failed: %v", err)
	}

	privateThought, err := store.CreateThought(userA.ID, "Geheimer Gedanke für Alice", "high", "manual", "")
	if err != nil {
		t.Fatalf("CreateThought failed: %v", err)
	}

	privateList, err := store.CreateList(userA.ID, "Geheime Einkaufsliste", "🛒", "shopping")
	if err != nil {
		t.Fatalf("CreateList failed: %v", err)
	}
	_, err = store.CreateListItem(privateList.ID, "Geheimer Kuchen", "", "", 0, userA.ID)
	if err != nil {
		t.Fatalf("CreateListItem failed: %v", err)
	}

	// Bob searches for "Geheim"
	resBob, err := store.SearchGlobal(userB.ID, "Geheim")
	if err != nil {
		t.Fatalf("SearchGlobal for Bob failed: %v", err)
	}

	if len(resBob.Hits) != 0 || len(resBob.Thoughts) != 0 || len(resBob.Documents) != 0 || len(resBob.ListItems) != 0 {
		t.Fatalf("expected Bob to find 0 private hits of Alice, got hits=%+v thoughts=%+v docs=%+v",
			resBob.Hits, resBob.Thoughts, resBob.Documents)
	}

	// Now share privateDoc with Bob
	if _, err := store.CreateDocShare(userA.ID, privateDoc.ID, userB.Email, "read"); err != nil {
		t.Fatalf("CreateDocShare failed: %v", err)
	}

	// Bob searches again
	resBobShared, err := store.SearchGlobal(userB.ID, "Geheim")
	if err != nil {
		t.Fatalf("SearchGlobal for Bob after share failed: %v", err)
	}

	if len(resBobShared.Documents) != 1 || resBobShared.Documents[0].ID != privateDoc.ID {
		t.Fatalf("expected Bob to find shared document %s, got %+v", privateDoc.ID, resBobShared.Documents)
	}

	// Alice searches and finds her own items
	resAlice, err := store.SearchGlobal(userA.ID, "Geheim")
	if err != nil {
		t.Fatalf("SearchGlobal for Alice failed: %v", err)
	}
	if len(resAlice.Documents) != 1 || len(resAlice.Thoughts) != 1 || len(resAlice.ListItems) != 1 {
		t.Fatalf("expected Alice to find her items, got docs=%d thoughts=%d lists=%d",
			len(resAlice.Documents), len(resAlice.Thoughts), len(resAlice.ListItems))
	}
	_ = privateThought
}

func TestSearchPrefixAndSpecialCharacters(t *testing.T) {
	store, userA, _ := setupTestStore(t)
	defer store.Close()

	_, err := store.CreateThought(userA.ID, "Großer Wocheneinkauf im Supermarkt", "normal", "manual", "")
	if err != nil {
		t.Fatalf("CreateThought failed: %v", err)
	}

	// Prefix search: "einkau" should find "Wocheneinkauf" or "Einkauf"
	// Note: FTS5 prefix matches word prefixes: "Wochen..." vs "einkauf"
	_, err = store.CreateThought(userA.ID, "Einkaufszettel schreiben", "normal", "manual", "")
	if err != nil {
		t.Fatalf("CreateThought failed: %v", err)
	}

	res, err := store.SearchGlobal(userA.ID, "einkau")
	if err != nil {
		t.Fatalf("SearchGlobal prefix failed: %v", err)
	}
	if len(res.Hits) == 0 {
		t.Errorf("expected prefix match for 'einkau', got 0 hits")
	}

	// Special characters should not cause syntax errors
	crazyQueries := []string{
		`"unclosed quote`,
		`test: foo AND OR NOT (bar)^`,
		`!@#$%^&*()_+=-[]{}\|;:'",.<>/?`,
		`* * *`,
		``,
		`   `,
	}
	for _, cq := range crazyQueries {
		_, err := store.SearchGlobal(userA.ID, cq)
		if err != nil {
			t.Errorf("query %q caused error: %v", cq, err)
		}
	}
}

// Open tasks come before completed ones, even when a completed one matches the words better.
func TestSearchListsOpenTasksFirst(t *testing.T) {
	store, userA, _ := setupTestStore(t)
	defer store.Close()

	done := doneTask(t, store, userA.ID, "", "Heizung Heizung Heizung entlüften", "")
	open, _ := store.CreateThoughtWithDetails(userA.ID, "Heizung warten lassen, Termin mit dem Installateur ausmachen", "normal", "manual", "", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(userA.ID, open.ID, "keep", "task", "", "", "")

	res, err := store.SearchGlobal(userA.ID, "Heizung")
	if err != nil {
		t.Fatal(err)
	}
	var order []string
	for _, h := range res.Hits {
		if h.Type == "thought" {
			order = append(order, h.ID)
		}
	}
	if len(order) != 2 || order[0] != open.ID || order[1] != done {
		t.Fatalf("open task should come first: %v (open %s, done %s)", order, open.ID, done)
	}
}

// Narrowing by kind and filters: tasks of one status, list items of one list, notes in a folder.
func TestSearchOptions(t *testing.T) {
	store, userA, _ := setupTestStore(t)
	defer store.Close()

	doc, _ := store.CreateDocument(userA.ID, "", "Garten", "", "Haus", nil, nil, false)
	_, _ = store.CreateDocument(userA.ID, "", "Garten Büro", "", "Arbeit", nil, nil, false)
	done := doneTask(t, store, userA.ID, "", "Garten winterfest machen", "")
	open, _ := store.CreateThoughtWithDetails(userA.ID, "Garten Hecke schneiden", "high", "manual", "", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(userA.ID, open.ID, "keep", "task", "", "", "")
	lst, _ := store.CreateList(userA.ID, "Baumarkt", "", "shopping")
	_, _ = store.CreateListItem(lst.ID, "Gartenschere", "", "", 0, userA.ID)

	only, err := store.Search(userA.ID, "Garten", SearchOptions{Type: "thought"})
	if err != nil || len(only.Hits) != 2 || only.Counts["document"] != 0 {
		t.Fatalf("type filter: %+v %v", only.Counts, err)
	}
	openOnly, _ := store.Search(userA.ID, "Garten", SearchOptions{Type: "thought", TaskStatus: "open"})
	if len(openOnly.Hits) != 1 || openOnly.Hits[0].ID != open.ID {
		t.Fatalf("open tasks only: %+v", openOnly.Hits)
	}
	doneOnly, _ := store.Search(userA.ID, "Garten", SearchOptions{Type: "thought", TaskStatus: "done", Priority: "normal"})
	if len(doneOnly.Hits) != 1 || doneOnly.Hits[0].ID != done {
		t.Fatalf("done + priority: %+v", doneOnly.Hits)
	}
	inFolder, _ := store.Search(userA.ID, "Garten", SearchOptions{Type: "document", Folder: "Haus"})
	if len(inFolder.Hits) != 1 || inFolder.Hits[0].DocID != doc.ID {
		t.Fatalf("folder filter: %+v", inFolder.Hits)
	}
	all, _ := store.Search(userA.ID, "Garten", SearchOptions{})
	if all.Counts["thought"] != 2 || all.Counts["document"] != 2 {
		t.Fatalf("counts: %+v", all.Counts)
	}
}

func TestSearchFindsDrawingsByTheirWords(t *testing.T) {
	store, userA, _ := setupTestStore(t)
	defer store.Close()
	blocks := []domain.DocumentBlock{{ID: "drw1", Type: "drawing", Content: `{"v":1,"els":[{"id":"a","ver":1,"t":"rect","x":0,"y":0,"w":10,"h":10,"s":"main","f":"none","sw":2,"txt":"Waschmaschine"}]}`}}
	if _, err := store.CreateDocument(userA.ID, "", "Skizze", "", "", blocks, nil, false); err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	res, err := store.SearchGlobal(userA.ID, "Waschmaschine")
	if err != nil || len(res.Hits) == 0 {
		t.Fatalf("drawing text not found: %v %+v", err, res)
	}
	if res.Hits[0].Content != "Waschmaschine" {
		t.Fatalf("hit shows %q instead of the words", res.Hits[0].Content)
	}
	// The JSON itself is not searchable
	if res, _ := store.SearchGlobal(userA.ID, "ellipse rect"); len(res.Hits) != 0 {
		t.Fatalf("JSON keys must not match: %+v", res.Hits)
	}
}
