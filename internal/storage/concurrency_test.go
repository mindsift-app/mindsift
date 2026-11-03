package storage

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Many writers at once on one SQLite file (FLAW-23): transactions that read before they write must
// wait for the write lock instead of failing with SQLITE_BUSY.
func TestConcurrentWritersDoNotFail(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "load.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	u, _ := store.CreateUser("load@example.com", "hash", "Last", "member")
	tl, _ := store.CreateTaskList(u.ID, "", "", "Last", "", "")
	var ids []string
	for i := 0; i < 20; i++ {
		th, _ := store.CreateThoughtWithDetails(u.ID, fmt.Sprintf("Aufgabe %d", i), "normal", "manual", "", tl.ID, "todo", "")
		_, _ = store.UpdateThoughtTriage(u.ID, th.ID, "keep", "task", "", "", tl.ID)
		ids = append(ids, th.ID)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 400)
	for w := 0; w < 16; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < 15; i++ {
				status := "todo"
				if (w+i)%2 == 0 {
					status = "done"
				}
				items := []domain.ThoughtReorderItem{{ID: ids[(w+i)%len(ids)], SortOrder: i, KanbanStatus: &status}}
				if err := store.ReorderTasks(tl.ID, items); err != nil {
					errs <- fmt.Errorf("reorder: %w", err)
				}
				if _, err := store.CreateThought(u.ID, fmt.Sprintf("Gedanke %d-%d", w, i), "normal", "manual", ""); err != nil {
					errs <- fmt.Errorf("create: %w", err)
				}
			}
		}(w)
	}
	wg.Wait()
	close(errs)
	failed := 0
	for err := range errs {
		if failed < 3 {
			t.Error(err)
		}
		failed++
	}
	if failed > 0 {
		t.Fatalf("%d of %d writes failed", failed, 16*15*2)
	}
}

func TestMultiStepChangesAreAllOrNothing(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "atomic.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	eve, _ := store.CreateUser("eve@example.com", "hash", "Eve", "member")
	tl, _ := store.CreateTaskList(anna.ID, "", "", "Haushalt", "", "")
	task, _ := store.CreateThoughtWithDetails(anna.ID, "Fenster", "normal", "manual", "", tl.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "", tl.ID)

	// A stranger deleting the list must not empty it (it used to unlink all tasks before checking)
	if err := store.DeleteTaskList(eve.ID, tl.ID); err == nil {
		t.Fatal("foreign user must not delete the task list")
	}
	if got, _ := store.GetThoughtByID(anna.ID, task.ID); got.TaskListID != tl.ID {
		t.Fatalf("task was taken out of the list by a stranger")
	}

	// A failing step rolls back the earlier ones
	err = store.execInTx(
		stmt(`UPDATE thoughts SET content = 'geändert' WHERE id = ?`, task.ID),
		stmt(`UPDATE gibt_es_nicht SET x = 1`),
	)
	if err == nil {
		t.Fatal("expected an error from the second statement")
	}
	if got, _ := store.GetThoughtByID(anna.ID, task.ID); got.Content != "Fenster" {
		t.Fatalf("first step must be rolled back, content is %q", got.Content)
	}
}
