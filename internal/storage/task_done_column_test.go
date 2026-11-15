package storage

import (
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A list with two columns marked as done, neither called "done": a plain tick (REST, MCP, a to-do ticked
// in a linked note) puts the task in the last of them, unless it stands in one already; a plain untick
// from a done column goes to the first open column, and a column alone completes the task only if it is
// marked as done. Without columns "done"/"todo" stay.
func TestPlainTickUsesTheListsDoneColumn(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	defer store.Close()

	cols := []domain.KanbanColumn{{ID: "col_offen", Name: "Offen"}, {ID: "col_abgelegt", Name: "Abgelegt", IsDone: true}, {ID: "col_dran", Name: "Dran"}, {ID: "col_fertig", Name: "Fertig", IsDone: true}}
	tl, err := store.CreateTaskList(alice.ID, "", "", "Garten", "", "", cols)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := store.CreateTaskList(alice.ID, "", "", "Ohne Spalten", "", "")
	if err != nil {
		t.Fatal(err)
	}
	store.execLogged(`UPDATE task_lists SET columns = '' WHERE id = ?`, plain.ID)

	newTask := func(content, listID, column string) string {
		t.Helper()
		th, err := store.CreateThoughtWithDetails(alice.ID, content, "", "manual", "", listID, column, "")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.UpdateThoughtTriage(alice.ID, th.ID, "keep", "task", "", "", listID); err != nil {
			t.Fatal(err)
		}
		return th.ID
	}
	update := func(id string, p ThoughtPatch) *domain.Thought {
		t.Helper()
		before, err := store.GetThoughtByID(alice.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		th, _, err := store.UpdateTask(alice.ID, before, p, nil)
		if err != nil {
			t.Fatal(err)
		}
		return th
	}
	yes, no := true, false

	hedge := newTask("Hecke schneiden", tl.ID, "col_dran")
	if th := update(hedge, ThoughtPatch{IsCompleted: &yes}); !th.IsCompleted || th.KanbanStatus != "col_fertig" {
		t.Fatalf("ticked: done=%v status=%q, want the column marked as done", th.IsCompleted, th.KanbanStatus)
	}
	if th := update(hedge, ThoughtPatch{IsCompleted: &no}); th.IsCompleted || th.KanbanStatus != "col_offen" {
		t.Fatalf("reopened: done=%v status=%q, want the first open column", th.IsCompleted, th.KanbanStatus)
	}
	// Reopening an open task leaves its column alone
	dran := "col_dran"
	update(hedge, ThoughtPatch{KanbanStatus: &dran})
	if th := update(hedge, ThoughtPatch{IsCompleted: &no}); th.KanbanStatus != "col_dran" {
		t.Fatalf("un-ticking an open task moved it to %q", th.KanbanStatus)
	}
	// A column alone: one marked as done completes (not only the last), the others reopen
	filed := "col_abgelegt"
	if th := update(hedge, ThoughtPatch{KanbanStatus: &filed}); !th.IsCompleted || th.KanbanStatus != "col_abgelegt" {
		t.Fatalf("moving to a column marked as done: done=%v status=%q", th.IsCompleted, th.KanbanStatus)
	}
	// Ticked again (another device, MCP): it stays in the done column it stands in
	if th := update(hedge, ThoughtPatch{IsCompleted: &yes}); !th.IsCompleted || th.KanbanStatus != "col_abgelegt" {
		t.Fatalf("ticking a task in a done column moved it to %q", th.KanbanStatus)
	}
	if th := update(hedge, ThoughtPatch{IsCompleted: &no}); th.IsCompleted || th.KanbanStatus != "col_offen" {
		t.Fatalf("reopened from the first done column: done=%v status=%q", th.IsCompleted, th.KanbanStatus)
	}
	update(hedge, ThoughtPatch{KanbanStatus: &filed})
	if th := update(hedge, ThoughtPatch{KanbanStatus: &dran}); th.IsCompleted {
		t.Fatal("moving to an open column left the task completed")
	}

	// Ticked while moved to that list in the same patch: the new list's columns count
	mower := newTask("Rasenmäher ölen", plain.ID, "todo")
	if th := update(mower, ThoughtPatch{IsCompleted: &yes, TaskListID: &tl.ID}); th.KanbanStatus != "col_fertig" {
		t.Fatalf("ticked and moved: status %q", th.KanbanStatus)
	}

	// Without columns (and without a list): the default IDs
	for _, listID := range []string{plain.ID, ""} {
		id := newTask("Ohne Spalten", listID, "todo")
		if th := update(id, ThoughtPatch{IsCompleted: &yes}); th.KanbanStatus != "done" {
			t.Fatalf("list %q ticked: status %q", listID, th.KanbanStatus)
		}
		if th := update(id, ThoughtPatch{IsCompleted: &no}); th.KanbanStatus != "todo" {
			t.Fatalf("list %q reopened: status %q", listID, th.KanbanStatus)
		}
	}

	// Ticked in a linked note
	rake := newTask("Laub rechen", tl.ID, "col_offen")
	store.SyncTaskFromBlockCheck(alice.ID, rake, true)
	if th, _ := store.GetThoughtByID(alice.ID, rake); !th.IsCompleted || th.KanbanStatus != "col_fertig" {
		t.Fatalf("ticked in the note: done=%v status=%q", th.IsCompleted, th.KanbanStatus)
	}
	store.SyncTaskFromBlockCheck(alice.ID, rake, false)
	if th, _ := store.GetThoughtByID(alice.ID, rake); th.IsCompleted || th.KanbanStatus != "col_offen" {
		t.Fatalf("unticked in the note: done=%v status=%q", th.IsCompleted, th.KanbanStatus)
	}
}

// A to-do of a note linked to a task in a list with its own done columns: ticking it in the note moves
// the task to the last of them (ReconcileDocTaskLinks), unticking to the first open one.
func TestReconcileTickUsesTheListsDoneColumn(t *testing.T) {
	l := newLinkedTodo(t)
	listID := l.task(t).TaskListID
	cols := []domain.KanbanColumn{{ID: "col_fertig", Name: "Fertig", IsDone: true}, {ID: "col_offen", Name: "Offen"}, {ID: "col_archiv", Name: "Archiv", IsDone: true}}
	if _, err := l.s.UpdateTaskList(l.anna.ID, listID, nil, nil, nil, nil, &cols); err != nil {
		t.Fatal(err)
	}
	l.tick(t, true)
	l.s.ReconcileDocTaskLinks(l.docID)
	if got := l.task(t); !got.IsCompleted || got.KanbanStatus != "col_archiv" {
		t.Fatalf("ticked in the note: done=%v status=%q", got.IsCompleted, got.KanbanStatus)
	}
	l.tick(t, false)
	l.s.ReconcileDocTaskLinks(l.docID)
	if got := l.task(t); got.IsCompleted || got.KanbanStatus != "col_offen" {
		t.Fatalf("unticked in the note: done=%v status=%q", got.IsCompleted, got.KanbanStatus)
	}
}
