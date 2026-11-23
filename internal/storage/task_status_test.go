package storage

import (
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// A task list shared by two people, one phone offline for a while: its ticks and column changes arrive
// late, with when they were made (ThoughtPatch.StatusAt). Ticking means "completed", never "toggle": two
// people ticking the same task leave it ticked, an older change sent late does not undo a newer one, and
// a repeating task repeats once.
func TestUpdateTaskStatusSentLate(t *testing.T) {
	store, alice, bob := setupTestStore(t)
	defer store.Close()

	tl, err := store.CreateTaskList(alice.ID, "", "", "Haushalt", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddTaskListShare(tl.ID, "user", bob.ID, "editor", alice.ID); err != nil {
		t.Fatal(err)
	}
	newTask := func(content string) string {
		t.Helper()
		th, err := store.CreateThoughtWithDetails(alice.ID, content, "", "manual", "", tl.ID, "todo", "")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.UpdateThoughtTriage(alice.ID, th.ID, "keep", "task", "", "", tl.ID); err != nil {
			t.Fatal(err)
		}
		return th.ID
	}
	update := func(id string, who *domain.User, p ThoughtPatch) *domain.Thought {
		t.Helper()
		before, err := store.GetThoughtByID(who.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		th, _, err := store.UpdateTask(who.ID, before, p, nil)
		if err != nil {
			t.Fatal(err)
		}
		return th
	}
	tick := func(done bool, at time.Time) ThoughtPatch { return ThoughtPatch{IsCompleted: &done, StatusAt: at} }
	column := func(col string, done bool, at time.Time) ThoughtPatch {
		return ThoughtPatch{KanbanStatus: &col, IsCompleted: &done, StatusAt: at}
	}
	stamp := func(id string) string {
		t.Helper()
		st, err := store.taskStatus(id)
		if err != nil {
			t.Fatal(err)
		}
		return st.changedAt
	}
	now := time.Now()

	// Alice ticked it offline a minute ago, Bob ticks it now, Alice's tick arrives: stays ticked, nothing
	// is written (the time of Bob's tick stays)
	dishes := newTask("Abwasch")
	if th := update(dishes, bob, tick(true, time.Time{})); !th.IsCompleted || th.KanbanStatus != "done" {
		t.Fatalf("Bob's tick: %v %q", th.IsCompleted, th.KanbanStatus)
	}
	bobsTick := stamp(dishes)
	if bobsTick == "" {
		t.Fatal("Bob's tick stored no time")
	}
	if th := update(dishes, alice, tick(true, now.Add(-time.Minute))); !th.IsCompleted {
		t.Error("Alice's late tick opened the task")
	}
	if got := stamp(dishes); got != bobsTick {
		t.Errorf("the same tick twice wrote again: %q, was %q", got, bobsTick)
	}

	// Alice ticked it offline two minutes ago; Bob ticked and opened it again since: open (Bob last)
	laundry := newTask("Wäsche")
	update(laundry, bob, tick(true, now.Add(-90*time.Second)))
	update(laundry, bob, tick(false, now.Add(-time.Minute)))
	if th := update(laundry, alice, tick(true, now.Add(-2*time.Minute))); th.IsCompleted || th.KanbanStatus != "todo" {
		t.Errorf("Alice's older tick: %v %q, want open", th.IsCompleted, th.KanbanStatus)
	}
	// Alice's newer change wins
	if th := update(laundry, alice, tick(true, now.Add(-30*time.Second))); !th.IsCompleted {
		t.Error("Alice's newer tick was not stored")
	}

	// Bob moved it to "In Bearbeitung" just now; Alice's un-tick from a minute ago (to the first column)
	// leaves it there
	windows := newTask("Fenster")
	update(windows, alice, tick(true, now.Add(-time.Hour)))
	update(windows, bob, column("in_progress", false, time.Time{}))
	if th := update(windows, alice, column("todo", false, now.Add(-time.Minute))); th.KanbanStatus != "in_progress" || th.IsCompleted {
		t.Errorf("Alice's older column change: %v %q, want open in in_progress", th.IsCompleted, th.KanbanStatus)
	}
	// Un-ticking an open task changes nothing, not even the column
	if th := update(windows, alice, tick(false, time.Time{})); th.KanbanStatus != "in_progress" {
		t.Errorf("un-ticking an open task moved it to %q", th.KanbanStatus)
	}

	// Changes that do not go through UpdateTask (a to-do ticked in the note, a Kanban drag) are stamped by
	// the trigger: an older change sent late does not undo them
	doc, err := store.CreateDocument(alice.ID, "", "Garten", "", "", []domain.DocumentBlock{{ID: "plants", Type: "todo", Content: "Blumen gießen"}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	linked, err := store.CreateTaskFromDocBlock(alice.ID, doc.ID, "plants", "Blumen gießen", false)
	if err != nil {
		t.Fatal(err)
	}
	plants := linked.ID
	if _, err := store.UpdateThoughtDetails(alice.ID, plants, nil, nil, nil, nil, &tl.ID, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	on := true
	edit(t, store, alice.ID, doc.ID, func(*collab.Doc) []collab.Op {
		return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpSetProps, BlockID: "plants", Patch: &collab.PropsPatch{Checked: &on}}}
	})
	store.ReconcileDocTaskLinks(doc.ID)
	if th, _ := store.GetThoughtByID(alice.ID, plants); !th.IsCompleted {
		t.Fatal("ticking in the note did not complete the task")
	}
	if stamp(plants) == "" {
		t.Fatal("ticking in the note stored no time")
	}
	if th := update(plants, bob, tick(false, now.Add(-time.Minute))); !th.IsCompleted {
		t.Error("an older un-tick undid the tick from the note")
	}
	waiting := "waiting"
	if _, err := store.ReorderTasksForUser(alice.ID, tl.ID, []domain.ThoughtReorderItem{{ID: plants, SortOrder: 0, KanbanStatus: &waiting}}); err != nil {
		t.Fatal(err)
	}
	if th := update(plants, bob, column("done", true, now.Add(-time.Minute))); th.KanbanStatus != "waiting" || th.IsCompleted {
		t.Errorf("an older tick undid the Kanban drag: %v %q", th.IsCompleted, th.KanbanStatus)
	}

	// The other fields of the patch are written even when the status stays
	title := "Blumen gießen (Balkon)"
	done := true
	if th := update(plants, bob, ThoughtPatch{Content: &title, IsCompleted: &done, StatusAt: now.Add(-time.Minute)}); th.Content != title || th.IsCompleted {
		t.Errorf("patch with a late tick: %q %v, want the new title and still open", th.Content, th.IsCompleted)
	}

	// A time in the future (a phone's clock ahead) counts as now
	bins := newTask("Mülltonnen")
	update(bins, alice, tick(true, now.Add(time.Hour)))
	if th := update(bins, bob, tick(false, time.Time{})); th.IsCompleted {
		t.Error("Bob's un-tick after a tick dated in the future was not stored")
	}

	// A repeating task: Bob ticks it, Alice's late tick and a second tick change nothing, one successor
	var spawned []*domain.Thought
	store.OnTaskCreated = func(th *domain.Thought) { spawned = append(spawned, th) }
	defer func() { store.OnTaskCreated = nil }()
	trash := newTask("Altpapier")
	if err := store.SetTaskRecurrence(alice.ID, trash, "weekly"); err != nil {
		t.Fatal(err)
	}
	update(trash, bob, tick(true, time.Time{}))
	update(trash, alice, tick(true, now.Add(-time.Minute)))
	update(trash, bob, tick(true, time.Time{}))
	if len(spawned) != 1 {
		t.Errorf("repeating task ticked three times: %d successors, want 1", len(spawned))
	}
	// An older un-tick sent late leaves it done (and spawns nothing)
	if th := update(trash, alice, tick(false, now.Add(-time.Minute))); !th.IsCompleted {
		t.Error("an older un-tick opened the repeating task")
	}
	if len(spawned) != 1 {
		t.Errorf("%d successors after the late un-tick, want 1", len(spawned))
	}

	// Deleted meanwhile: not found
	gone := newTask("Weg")
	before, _ := store.GetThoughtByID(alice.ID, gone)
	if err := store.DeleteThought(alice.ID, gone); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.UpdateTask(alice.ID, before, tick(true, now.Add(-time.Minute)), nil); err == nil {
		t.Error("late tick of a deleted task: no error")
	}
}
