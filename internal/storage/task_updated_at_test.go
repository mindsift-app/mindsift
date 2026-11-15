package storage

import (
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// thoughts.updated_at and thoughts.revision (migration 67) move with every change of a task, whichever
// way it is written, and stay put on reads and on changes that do not count (order in the column, alarm
// mark).
func TestTaskUpdatedAtAndRevision(t *testing.T) {
	store, alice, bob := setupTestStore(t)
	defer store.Close()

	tl, err := store.CreateTaskList(alice.ID, "", "", "Haushalt", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddTaskListShare(tl.ID, "user", bob.ID, "editor", alice.ID); err != nil {
		t.Fatal(err)
	}
	th, err := store.CreateThoughtWithDetails(alice.ID, "Fenster putzen", "", "manual", "", tl.ID, "todo", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateThoughtTriage(alice.ID, th.ID, "keep", "task", "", "", tl.ID); err != nil {
		t.Fatal(err)
	}
	const old = "2020-01-01T00:00:00Z"
	// reset sets updated_at to a time long past (the triggers stamp seconds, a test runs within one) and
	// returns the revision
	reset := func() int {
		t.Helper()
		if _, err := store.db.Exec(`UPDATE thoughts SET updated_at = ? WHERE id = ?`, old, th.ID); err != nil {
			t.Fatal(err)
		}
		var rev int
		if err := store.db.QueryRow(`SELECT revision FROM thoughts WHERE id = ?`, th.ID).Scan(&rev); err != nil {
			t.Fatal(err)
		}
		return rev
	}
	check := func(what string, changes bool, do func()) {
		t.Helper()
		rev := reset()
		do()
		var at string
		var now int
		if err := store.db.QueryRow(`SELECT updated_at, revision FROM thoughts WHERE id = ?`, th.ID).Scan(&at, &now); err != nil {
			t.Fatal(err)
		}
		if changes && (at == old || now <= rev) {
			t.Errorf("%s: updated_at %s, revision %d -> %d; want both moved", what, at, rev, now)
		}
		if !changes && (at != old || now != rev) {
			t.Errorf("%s: updated_at %s, revision %d -> %d; want both unchanged", what, at, rev, now)
		}
	}
	update := func(p ThoughtPatch) func() {
		return func() {
			before, err := store.GetThoughtByID(alice.ID, th.ID)
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := store.UpdateTask(alice.ID, before, p, nil); err != nil {
				t.Fatal(err)
			}
		}
	}
	str := func(v string) *string { return &v }
	yes := true
	no := false

	check("read", false, func() {
		_, _ = store.GetThoughtByID(alice.ID, th.ID)
		_, _ = store.GetTasks(alice.ID, tl.ID)
	})
	check("content", true, update(ThoughtPatch{Content: str("Fenster putzen innen")}))
	check("same content again", false, update(ThoughtPatch{Content: str("Fenster putzen innen")}))
	check("notes", true, update(ThoughtPatch{Notes: str("Leiter aus dem Keller")}))
	check("due date", true, update(ThoughtPatch{DueDate: str("2030-05-01")}))
	check("priority", true, update(ThoughtPatch{Priority: str("high")}))
	check("completed", true, update(ThoughtPatch{IsCompleted: &yes}))
	check("opened again", true, update(ThoughtPatch{IsCompleted: &no}))
	check("column", true, update(ThoughtPatch{KanbanStatus: str("in_progress")}))
	check("subtasks", true, update(ThoughtPatch{Subtasks: &[]domain.SubTask{{ID: "s1", Title: "Eimer"}}}))
	check("recurrence", true, func() {
		if err := store.SetTaskRecurrence(alice.ID, th.ID, "weekly"); err != nil {
			t.Fatal(err)
		}
	})
	check("reminders", true, func() {
		if _, err := store.SetTaskReminders(alice.ID, th.ID, []int{30}); err != nil {
			t.Fatal(err)
		}
	})
	check("assignee added", true, func() {
		if _, err := store.SetTaskAssignees(alice.ID, th.ID, []string{alice.ID, bob.ID}); err != nil {
			t.Fatal(err)
		}
	})
	check("same assignees again", false, func() {
		if _, err := store.SetTaskAssignees(alice.ID, th.ID, []string{alice.ID, bob.ID}); err != nil {
			t.Fatal(err)
		}
	})
	check("assignee removed", true, func() {
		if _, err := store.SetTaskAssignees(alice.ID, th.ID, []string{alice.ID}); err != nil {
			t.Fatal(err)
		}
	})
	check("alarm mark and order", false, func() {
		if _, err := store.db.Exec(`UPDATE thoughts SET alarm_sent = 1, sort_order = sort_order + 5 WHERE id = ?`, th.ID); err != nil {
			t.Fatal(err)
		}
	})
	other, err := store.CreateTaskList(alice.ID, "", "", "Garten", "", "")
	if err != nil {
		t.Fatal(err)
	}
	check("moved to another list", true, update(ThoughtPatch{TaskListID: &other.ID}))
}

// A task inserted after migration 67 reads its creation time until its first change.
func TestTaskUpdatedAtFallsBackToCreatedAt(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	defer store.Close()
	th, err := store.CreateThought(alice.ID, "Neu", "", "manual", "")
	if err != nil {
		t.Fatal(err)
	}
	var created, updated string
	if err := store.db.QueryRow(`SELECT t.created_at, `+sqlTaskUpdatedAt+` FROM thoughts t WHERE t.id = ?`, th.ID).Scan(&created, &updated); err != nil {
		t.Fatal(err)
	}
	if updated != created {
		t.Errorf("updated_at of a new task %q, want created_at %q", updated, created)
	}
}
