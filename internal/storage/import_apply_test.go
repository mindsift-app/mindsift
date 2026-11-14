package storage

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// countOf counts the rows of a table that belong to the user (column user_id).
func countOf(t *testing.T, s *Store, table, userID string) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE user_id = ?`, userID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// An import that fails half way takes out what it created (notes, folders, task lists, tasks), instead
// of leaving half of the archive behind (re-test 2026-11-14, A2).
func TestFailedImportIsTakenOut(t *testing.T) {
	store, anna, ben := newImportStore(t)
	seedAnna(t, store, anna)
	exp, _ := store.ExportUserData(anna.ID)
	raw, _ := json.Marshal(exp)
	plan, err := PlanMindSiftJSONImport(raw)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	// Ben has a folder of his own already: it stays
	if _, err := store.CreateFolder(ben.ID, "Eigenes"); err != nil {
		t.Fatal(err)
	}
	// The lists come last: creating one fails after notes, folders, task lists and tasks exist
	if _, err := store.db.Exec(`CREATE TRIGGER test_fail_lists BEFORE INSERT ON lists BEGIN SELECT RAISE(ABORT, 'Testfehler'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err == nil {
		t.Fatal("the import should fail")
	}
	for table, want := range map[string]int{"documents": 0, "task_lists": 0, "thoughts": 0, "lists": 0, "workspace_folders": 1} {
		if n := countOf(t, store, table, ben.ID); n != want {
			t.Errorf("%s of Ben after the failed import: %d, want %d", table, n, want)
		}
	}
	var blocks int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM blocks WHERE document_id NOT IN (SELECT id FROM documents)`).Scan(&blocks); err != nil || blocks != 0 {
		t.Errorf("bullets of taken out notes left: %d (%v)", blocks, err)
	}

	// Once the cause is gone the same import goes through completely
	if _, err := store.db.Exec(`DROP TRIGGER test_fail_lists`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatalf("apply: %v", err)
	}
	checkRestored(t, store, ben)
}

// Imports of several people at once are applied one after the other and all of them complete.
func TestConcurrentImportsAllComplete(t *testing.T) {
	store, anna, ben := newImportStore(t)
	seedAnna(t, store, anna)
	exp, _ := store.ExportUserData(anna.ID)
	raw, _ := json.Marshal(exp)
	users := []string{ben.ID}
	for i := 0; i < 3; i++ {
		u, err := store.CreateUser(fmt.Sprintf("import%d@example.com", i), "hash", "Import", "member")
		if err != nil {
			t.Fatal(err)
		}
		users = append(users, u.ID)
	}
	var wg sync.WaitGroup
	errs := make([]error, len(users))
	for i, id := range users {
		wg.Add(1)
		go func() {
			defer wg.Done()
			plan, err := PlanMindSiftJSONImport(raw)
			if err == nil {
				_, err = store.ApplyImport(id, plan)
			}
			errs[i] = err
		}()
	}
	wg.Wait()
	for i, id := range users {
		if errs[i] != nil {
			t.Errorf("import %d failed: %v", i, errs[i])
		}
		if n := countOf(t, store, "documents", id); n != 1 {
			t.Errorf("import %d: %d notes, want 1", i, n)
		}
	}
}

// A failed import leaves the person's existing notes as they were: their [[Titel]] links are not turned
// into links to an imported note that is taken out again.
func TestFailedImportLeavesWikiLinksAlone(t *testing.T) {
	store, anna, ben := newImportStore(t)
	seedAnna(t, store, anna)
	exp, _ := store.ExportUserData(anna.ID)
	raw, _ := json.Marshal(exp)
	plan, err := PlanMindSiftJSONImport(raw)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	const text = "Siehe [[Umzug]]"
	own, err := store.CreateDocument(ben.ID, "", "Eigene Notiz", "", "", []domain.DocumentBlock{
		{ID: "own1", Type: "bullet", Content: text},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`CREATE TRIGGER test_fail_lists BEFORE INSERT ON lists BEGIN SELECT RAISE(ABORT, 'Testfehler'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err == nil {
		t.Fatal("the import should fail")
	}
	if got := blocksOf(t, store, own.ID)["own1"].Content; got != text {
		t.Errorf("the failed import rewrote a link in an existing note: %q", got)
	}

	// A complete import links it
	if _, err := store.db.Exec(`DROP TRIGGER test_fail_lists`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyImport(ben.ID, plan); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if got := blocksOf(t, store, own.ID)["own1"].Content; !strings.Contains(got, "#doc_") {
		t.Errorf("the link does not point at the imported note: %q", got)
	}
}
