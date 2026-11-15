package storage

import (
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The series of a repeating task goes on: a task spawns its next occurrence whenever it is completed and
// has no open successor. A deleted or completed successor no longer blocks it, an open one does (no two
// open successors), and reopening the task (an undone tick) removes its successor while untouched.
func TestRepeatingTaskSeries(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	defer store.Close()
	tl, err := store.CreateTaskList(alice.ID, "", "", "Haushalt", "", "")
	if err != nil {
		t.Fatal(err)
	}
	var removed []string
	store.OnTaskRemoved = func(th *domain.Thought) { removed = append(removed, th.ID) }

	newRepeating := func(content, rule string) string {
		t.Helper()
		th, err := store.CreateThoughtWithDetails(alice.ID, content, "", "manual", "2026-11-02", tl.ID, "todo", "")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.UpdateThoughtTriage(alice.ID, th.ID, "keep", "task", "", "2026-11-02", tl.ID); err != nil {
			t.Fatal(err)
		}
		if err := store.SetTaskRecurrence(alice.ID, th.ID, rule); err != nil {
			t.Fatal(err)
		}
		return th.ID
	}
	set := func(id string, done bool) {
		t.Helper()
		before, err := store.GetThoughtByID(alice.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := store.UpdateTask(alice.ID, before, ThoughtPatch{IsCompleted: &done}, nil); err != nil {
			t.Fatal(err)
		}
	}
	successors := func(id string) []string {
		t.Helper()
		return store.openSuccessors(id)
	}
	only := func(id string) string {
		t.Helper()
		got := successors(id)
		if len(got) != 1 {
			t.Fatalf("want one open successor of %s, got %v", id, got)
		}
		return got[0]
	}

	// Successor deleted, then the task unticked and ticked again: the series goes on
	bins := newRepeating("Müll rausbringen", "weekly")
	set(bins, true)
	first := only(bins)
	if err := store.DeleteThought(alice.ID, first); err != nil {
		t.Fatal(err)
	}
	set(bins, false)
	set(bins, true)
	again := only(bins)
	if again == first {
		t.Fatal("no new successor after the old one was deleted")
	}
	if th, _ := store.GetThoughtByID(alice.ID, again); th.DueDate != "2026-11-09" {
		t.Errorf("new successor due %q", th.DueDate)
	}

	// Ticked again while its successor is open and edited: no second one, and reopening keeps the edited one
	title := "Müll rausbringen (gelb)"
	beforeEdit, _ := store.GetThoughtByID(alice.ID, again)
	if _, _, err := store.UpdateTask(alice.ID, beforeEdit, ThoughtPatch{Content: &title}, nil); err != nil {
		t.Fatal(err)
	}
	removed = nil
	set(bins, false)
	if len(removed) != 0 || only(bins) != again {
		t.Fatalf("reopening removed the edited successor: removed %v", removed)
	}
	set(bins, true)
	if only(bins) != again {
		t.Fatal("ticking again with an open successor spawned a second one")
	}

	// A completed successor does not block either
	set(again, true)
	set(bins, false)
	set(bins, true)
	if got := only(bins); got == again {
		t.Fatal("a completed successor blocked the series")
	}

	// Rule removed and set again after the successor was deleted: ticking spawns again
	plants := newRepeating("Blumen gießen", "daily")
	set(plants, true)
	if err := store.DeleteThought(alice.ID, only(plants)); err != nil {
		t.Fatal(err)
	}
	set(plants, false)
	for _, rule := range []string{"", "daily", "weekly"} {
		if err := store.SetTaskRecurrence(alice.ID, plants, rule); err != nil {
			t.Fatal(err)
		}
	}
	set(plants, true)
	if th, _ := store.GetThoughtByID(alice.ID, only(plants)); th.Recurrence != "weekly" || th.DueDate != "2026-11-09" {
		t.Errorf("successor after the rule changed: %q due %q", th.Recurrence, th.DueDate)
	}

	// Tick by mistake, undone: the untouched successor goes; tick, untick, tick leaves one open successor
	towels := newRepeating("Handtücher waschen", "weekly")
	set(towels, true)
	spawned := only(towels)
	removed = nil
	set(towels, false)
	if len(removed) != 1 || removed[0] != spawned || len(successors(towels)) != 0 {
		t.Fatalf("undone tick: removed %v, open %v", removed, successors(towels))
	}
	if _, err := store.GetThoughtByID(alice.ID, spawned); err == nil {
		t.Error("the removed successor is still there")
	}
	set(towels, true)
	set(towels, false)
	set(towels, true)
	only(towels)

	// A successor with a subtask ticked counts as touched
	shirts := newRepeating("Hemden bügeln", "weekly")
	subs := []domain.SubTask{{ID: "s1", Title: "Bügelbrett"}}
	if _, err := store.UpdateThoughtDetails(alice.ID, shirts, nil, nil, nil, nil, nil, nil, nil, &subs, nil); err != nil {
		t.Fatal(err)
	}
	set(shirts, true)
	set(shirts, false) // untouched (its subtask unchecked): removed
	set(shirts, true)
	towels = shirts
	next := only(towels)
	nt, _ := store.GetThoughtByID(alice.ID, next)
	if len(nt.Subtasks) != 1 {
		t.Fatalf("successor subtasks: %+v", nt.Subtasks)
	}
	nt.Subtasks[0].IsCompleted = true
	if _, err := store.UpdateThoughtDetails(alice.ID, next, nil, nil, nil, nil, nil, nil, nil, &nt.Subtasks, nil); err != nil {
		t.Fatal(err)
	}
	set(towels, false)
	if only(towels) != next {
		t.Fatal("a successor with a ticked subtask was removed")
	}
}

// The same through a linked note and the Kanban board: unticking the to-do (or dragging the task out of
// the done column) removes the untouched successor, ticking again spawns one.
func TestRepeatingTaskSeriesFromNoteAndBoard(t *testing.T) {
	l := newLinkedTodo(t)
	if err := l.s.SetTaskRecurrence(l.anna.ID, l.taskID, "weekly"); err != nil {
		t.Fatal(err)
	}
	l.tick(t, true)
	l.s.ReconcileDocTaskLinks(l.docID)
	first := l.s.openSuccessors(l.taskID)
	if len(first) != 1 {
		t.Fatalf("ticked in the note: open successors %v", first)
	}
	l.tick(t, false)
	l.s.ReconcileDocTaskLinks(l.docID)
	if got := l.s.openSuccessors(l.taskID); len(got) != 0 {
		t.Fatalf("unticked in the note: open successors %v", got)
	}
	l.tick(t, true)
	l.s.ReconcileDocTaskLinks(l.docID)
	if got := l.s.openSuccessors(l.taskID); len(got) != 1 {
		t.Fatalf("ticked again in the note: open successors %v", got)
	}

	listID := l.task(t).TaskListID
	todo := "todo"
	if err := l.s.ReorderTasks(listID, []domain.ThoughtReorderItem{{ID: l.taskID, SortOrder: 0, KanbanStatus: &todo}}); err != nil {
		t.Fatal(err)
	}
	if got := l.s.openSuccessors(l.taskID); len(got) != 0 {
		t.Fatalf("dragged out of done: open successors %v", got)
	}
}

// An untick sent late by a phone that was offline does not undo a newer tick (status_changed_at), and so
// does not remove the successor either.
func TestLateUntickKeepsTheSuccessor(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	defer store.Close()
	th, _ := store.CreateThoughtWithDetails(alice.ID, "Zähne putzen", "", "manual", "2026-11-02", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(alice.ID, th.ID, "keep", "task", "", "2026-11-02", "")
	_ = store.SetTaskRecurrence(alice.ID, th.ID, "daily")
	done, open := true, false
	before, _ := store.GetThoughtByID(alice.ID, th.ID)
	if _, _, err := store.UpdateTask(alice.ID, before, ThoughtPatch{IsCompleted: &done}, nil); err != nil {
		t.Fatal(err)
	}
	before, _ = store.GetThoughtByID(alice.ID, th.ID)
	if _, _, err := store.UpdateTask(alice.ID, before, ThoughtPatch{IsCompleted: &open, StatusAt: time.Now().Add(-time.Hour)}, nil); err != nil {
		t.Fatal(err)
	}
	if got := store.openSuccessors(th.ID); len(got) != 1 {
		t.Fatalf("late untick: open successors %v", got)
	}
}
