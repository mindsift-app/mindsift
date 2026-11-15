package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A task list shared by two people, one phone offline for a while: the app's outbox sends the ticks and
// column changes made offline later, as the wanted state with when it was made (changedAt) and when it
// was sent (sentAt), both on the phone's clock. Two people ticking the same task leave it ticked, an older
// change does not undo a newer one, a change that writes nothing tells nobody, and changes without
// changedAt (online, MCP) count as made now.
func TestTaskTickSentLate(t *testing.T) {
	srv, store, ts, owner, ownerToken := startRealtimeServer(t)
	friend, friendToken := newTestUser(t, store, "partnerin@example.com")
	tl, err := store.CreateTaskList(owner.ID, "", "", "Haushalt", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddTaskListShare(tl.ID, "user", friend.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	ownerStream := openSSE(t, ts, ownerToken)
	newTask := func(content string) string {
		t.Helper()
		th, err := store.CreateThoughtWithDetails(owner.ID, content, "", "manual", "", tl.ID, "todo", "")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.UpdateThoughtTriage(owner.ID, th.ID, "keep", "task", "", "", tl.ID); err != nil {
			t.Fatal(err)
		}
		return th.ID
	}
	patch := func(token, id string, body map[string]any) domain.Thought {
		t.Helper()
		resp := doJSON(t, ts, http.MethodPatch, "/api/v1/thoughts/"+id, token, body)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("patch %v: %d", body, resp.StatusCode)
		}
		var th domain.Thought
		_ = json.NewDecoder(resp.Body).Decode(&th)
		return th
	}
	// The phone's clock is a day behind: only the time between change and sending counts
	phone := time.Now().Add(-24 * time.Hour).UnixMilli()
	late := func(body map[string]any, agoMs int64) map[string]any {
		body["changedAt"] = phone - agoMs
		body["sentAt"] = phone
		return body
	}
	drain := func() {
		for ownerStream.waitFor(t, "TASK_UPDATED", 300*time.Millisecond) != nil {
		}
	}

	// The owner ticked it offline a minute ago, the friend ticks it now, the owner's phone sends: ticked,
	// and nobody hears of the owner's tick
	dishes := newTask("Abwasch")
	if th := patch(friendToken, dishes, map[string]any{"isCompleted": true, "kanbanStatus": "done"}); !th.IsCompleted {
		t.Fatal("friend's tick not stored")
	}
	if ownerStream.waitFor(t, "TASK_UPDATED", 10*time.Second) == nil {
		t.Fatal("no TASK_UPDATED for the friend's tick")
	}
	drain()
	if th := patch(ownerToken, dishes, late(map[string]any{"isCompleted": true, "kanbanStatus": "done"}, 60_000)); !th.IsCompleted || th.KanbanStatus != "done" {
		t.Errorf("after the late tick: %v %q, want ticked", th.IsCompleted, th.KanbanStatus)
	}
	if ownerStream.waitFor(t, "TASK_UPDATED", 500*time.Millisecond) != nil {
		t.Error("a tick that changed nothing was broadcast")
	}

	// The owner ticked it offline two minutes ago; the friend ticked and opened it again since: open
	laundry := newTask("Wäsche")
	patch(friendToken, laundry, map[string]any{"isCompleted": true})
	patch(friendToken, laundry, map[string]any{"isCompleted": false})
	if th := patch(ownerToken, laundry, late(map[string]any{"isCompleted": true, "kanbanStatus": "done"}, 120_000)); th.IsCompleted {
		t.Error("an older tick sent late undid the friend's newer un-tick")
	}

	// The friend moved it to "In Bearbeitung"; the owner's un-tick from a minute ago leaves it there
	windows := newTask("Fenster")
	patch(friendToken, windows, map[string]any{"kanbanStatus": "in_progress", "isCompleted": false})
	if th := patch(ownerToken, windows, late(map[string]any{"isCompleted": false, "kanbanStatus": "todo"}, 60_000)); th.KanbanStatus != "in_progress" {
		t.Errorf("an older column change moved the task to %q", th.KanbanStatus)
	}

	// The owner opened a ticked task offline, nobody touched it since: open
	plants := newTask("Blumen gießen")
	patch(friendToken, plants, map[string]any{"isCompleted": true})
	time.Sleep(20 * time.Millisecond)
	if th := patch(ownerToken, plants, late(map[string]any{"isCompleted": false, "kanbanStatus": "todo"}, 5)); th.IsCompleted {
		t.Error("the owner's un-tick sent late was not stored")
	}

	// Without changedAt (online): the wanted state, made now
	if th := patch(ownerToken, plants, map[string]any{"isCompleted": true}); !th.IsCompleted {
		t.Error("online tick not stored")
	}
	if th := patch(ownerToken, plants, map[string]any{"isCompleted": true}); !th.IsCompleted {
		t.Error("the same tick twice opened the task")
	}

	// MCP (complete_task, update_task): no time of its own, made now; it wins over the friend's earlier tick
	open := false
	if th, err := srv.updateTask(owner.ID, dishes, taskPatch{IsCompleted: &open}); err != nil || th.IsCompleted {
		t.Errorf("MCP un-tick: %v, err %v", th, err)
	}
	done := true
	if th, err := srv.updateTask(friend.ID, dishes, taskPatch{IsCompleted: &done}); err != nil || !th.IsCompleted {
		t.Errorf("MCP tick: %v, err %v", th, err)
	}

	// A repeating task ticked by both: one successor
	trash := newTask("Altpapier")
	if err := store.SetTaskRecurrence(owner.ID, trash, "weekly"); err != nil {
		t.Fatal(err)
	}
	patch(friendToken, trash, map[string]any{"isCompleted": true})
	patch(ownerToken, trash, late(map[string]any{"isCompleted": true, "kanbanStatus": "done"}, 30_000))
	tasks, err := store.GetTasks(owner.ID, tl.ID)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, th := range tasks {
		if th.Content == "Altpapier" {
			n++
		}
	}
	if n != 2 {
		t.Errorf("repeating task ticked twice: %d tasks, want it and one successor", n)
	}

	// Deleted by the friend meanwhile: 404, which the outbox drops
	gone := newTask("Weg")
	if resp := doJSON(t, ts, http.MethodDelete, "/api/v1/thoughts/"+gone, friendToken, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	if resp := doJSON(t, ts, http.MethodPatch, "/api/v1/thoughts/"+gone, ownerToken, late(map[string]any{"isCompleted": true}, 60_000)); resp.StatusCode != http.StatusNotFound {
		t.Errorf("late tick of a deleted task: %d, want 404", resp.StatusCode)
	}
}

// A to-do in a note linked to a task: a tick in the note counts as made when the server applied it (note
// operations carry no time of their own). A tick from the task view sent late does not undo a newer one
// from the note, and a note tick arriving after a task-view tick is newer and wins.
func TestLinkedTodoTickSentLate(t *testing.T) {
	f := newLinkedFixture(t)
	phone := time.Now().Add(-24 * time.Hour).UnixMilli()

	// The owner ticked the task offline a minute ago; the member ticked and un-ticked the to-do since
	f.edit(t, checkOp(f.main, true))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
	f.edit(t, checkOp(f.main, false))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return !th.IsCompleted })
	got := f.patch(t, f.ownerTok, map[string]any{"isCompleted": true, "kanbanStatus": "done", "changedAt": phone - 60_000, "sentAt": phone})
	if got.IsCompleted {
		t.Error("an older tick from the task view undid the newer un-tick in the note")
	}
	if f.block(t, f.main).Props.Checked {
		t.Error("the skipped tick reached the note")
	}

	// The owner ticks the task now (the note follows); the member's un-tick reaches the server afterwards
	// and wins: it is the newer change on the server
	f.patch(t, f.ownerTok, map[string]any{"isCompleted": true, "kanbanStatus": "done"})
	if !f.block(t, f.main).Props.Checked {
		t.Fatal("the task's tick did not reach the note")
	}
	f.edit(t, checkOp(f.main, false))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return !th.IsCompleted })
	if got := f.task(t); got.IsCompleted {
		t.Error("the note's un-tick did not reach the task")
	}

	// A late tick from the task view made after the note's change (sent a moment ago) still wins
	time.Sleep(20 * time.Millisecond)
	got = f.patch(t, f.ownerTok, map[string]any{"isCompleted": true, "kanbanStatus": "done", "changedAt": phone - 5, "sentAt": phone})
	if !got.IsCompleted || !f.block(t, f.main).Props.Checked {
		t.Errorf("a newer late tick: task %v, note %v, want both ticked", got.IsCompleted, f.block(t, f.main).Props.Checked)
	}
}
