package api

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// Subtasks changed from the note and the task view at the same time, someone typing in the to-do while the
// task is renamed, and a note edited offline while the task changes online: nothing is lost, task and note
// end up the same, and the events stop.

// withSubtasks gives the fixture's task two subtasks from the note (sub1, sub2) and returns them as the
// task view has them.
func (f *linkedFixture) withSubtasks(t *testing.T) []domain.SubTask {
	t.Helper()
	f.edit(t, insertTodo("sub1", f.main, "a0", "Rahmen abwischen"), insertTodo("sub2", f.main, "a1", "Glas polieren"))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 2 })
	f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 2 })
	return f.task(t).Subtasks
}

func subtaskByBlock(th *domain.Thought, block string) *domain.SubTask {
	for i := range th.Subtasks {
		if th.Subtasks[i].BlockID == block {
			return &th.Subtasks[i]
		}
	}
	return nil
}

// patchSubtasks sends a subtask change as the task view does: the new list and the one it was made on.
func (f *linkedFixture) patchSubtasks(t *testing.T, tok string, base []domain.SubTask, change func([]domain.SubTask) []domain.SubTask) int {
	t.Helper()
	next := change(append([]domain.SubTask(nil), base...))
	resp := doJSON(t, f.ts, http.MethodPatch, "/api/v1/thoughts/"+f.taskID, tok, map[string]any{"subtasks": next, "subtasksBase": base})
	return resp.StatusCode
}

// The member ticks one subtask in the note while the owner renames the other one in the task view (with
// the list as it was before the tick), and the other way round, and both change the same subtask (tick
// there, rename here). Every change stays, in the task and in the note.
func TestLinkedTodoConcurrentSubtasks(t *testing.T) {
	f := newLinkedFixture(t)
	f.withSubtasks(t)
	for round := 0; round < 12; round++ {
		on := round%2 == 0
		base := f.task(t).Subtasks // what the task view shows when the round starts
		tickBlock, renameBlock := "sub1", "sub2"
		if round%3 == 2 {
			renameBlock = "sub1" // the same subtask: ticked in the note, renamed in the task view
		}
		title := fmt.Sprintf("Unteraufgabe %d", round)
		tick := checkOp(tickBlock, on)
		tick.OpID = f.opID()
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			syncDoc(t, f.ts, f.memberTok, f.docID, map[string]any{"clientId": "member-tab", "ops": []collab.Op{tick}})
		}()
		go func() {
			defer wg.Done()
			f.patchSubtasks(t, f.ownerTok, base, func(subs []domain.SubTask) []domain.SubTask {
				for i := range subs {
					if subs[i].BlockID == renameBlock {
						subs[i].Title = title
					}
				}
				return subs
			})
		}()
		wg.Wait()
		task, blocks := f.task(t), f.blocks(t)
		if len(task.Subtasks) != 2 {
			t.Fatalf("round %d: subtasks %+v", round, task.Subtasks)
		}
		if st := subtaskByBlock(task, tickBlock); st == nil || st.IsCompleted != on || blocks[tickBlock].Props.Checked != on {
			t.Errorf("round %d: tick of %s lost: subtask %+v, checkbox %v, want %v", round, tickBlock, st, blocks[tickBlock].Props.Checked, on)
		}
		if st := subtaskByBlock(task, renameBlock); st == nil || st.Title != title || blocks[renameBlock].Content != title {
			t.Errorf("round %d: rename of %s lost: subtask %+v, checkbox %q, want %q", round, renameBlock, st, blocks[renameBlock].Content, title)
		}
	}
	f.ownerWS.quiet(300 * time.Millisecond)
	f.memberWS.quiet(300 * time.Millisecond)
	f.noLoop(t, "concurrent subtask changes")
}

// Two task views change different subtasks from the same list (the second one does not see the first
// change yet): both stay. Without subtasksBase (an older app) the list replaces the stored one as before.
func TestLinkedTodoSubtasksFromTwoTaskViews(t *testing.T) {
	f := newLinkedFixture(t)
	base := f.withSubtasks(t)
	if code := f.patchSubtasks(t, f.ownerTok, base, func(s []domain.SubTask) []domain.SubTask { s[0].IsCompleted = true; return s }); code != http.StatusOK {
		t.Fatalf("owner: %d", code)
	}
	added := domain.SubTask{ID: "st_neu", Title: "Fensterbank wischen"}
	if code := f.patchSubtasks(t, f.memberTok, base, func(s []domain.SubTask) []domain.SubTask { s[1].Title = "Glas blank polieren"; return append(s, added) }); code != http.StatusOK {
		t.Fatalf("member: %d", code)
	}
	task := f.task(t)
	if len(task.Subtasks) != 3 || !task.Subtasks[0].IsCompleted || task.Subtasks[1].Title != "Glas blank polieren" || task.Subtasks[2].Title != "Fensterbank wischen" {
		t.Fatalf("both changes should stay: %+v", task.Subtasks)
	}
	blocks := f.blocks(t)
	if !blocks["sub1"].Props.Checked || blocks["sub2"].Content != "Glas blank polieren" || task.Subtasks[2].BlockID == "" || blocks[task.Subtasks[2].BlockID].Content != "Fensterbank wischen" {
		t.Errorf("note after both changes: %+v", blocks)
	}
}

// The task is renamed while the member types in its to-do and in a subtask's checkbox. The server writes
// the new titles in (its own writes pass leases); the member's editor, typing on over a text its field
// never showed, sends its text on the newest version and keeps the server's text as a conflict copy right
// below (DocSyncEngine.keepOtherVersion). The typed texts win in note and task, the copies stay in the
// note, and neither copy becomes a task or a subtask until it is kept.
func TestLinkedTodoRenameWhileSomeoneTypes(t *testing.T) {
	f := newLinkedFixture(t)
	f.withSubtasks(t)
	f.patch(t, f.ownerTok, map[string]any{"content": "Fenster putzen lassen"})
	base := f.task(t).Subtasks
	f.patchSubtasks(t, f.ownerTok, base, func(s []domain.SubTask) []domain.SubTask {
		for i := range s {
			if s[i].BlockID == "sub2" {
				s[i].Title = "Glas blank polieren"
			}
		}
		return s
	})
	blocks := f.blocks(t)
	if blocks[f.main].Content != "Fenster putzen lassen" || blocks["sub2"].Content != "Glas blank polieren" {
		t.Fatalf("new titles not in the note: %q / %q", blocks[f.main].Content, blocks["sub2"].Content)
	}
	// What the member's editor sends when typing on: its text on the newest version, the other as a copy
	typedMain, typedSub := "Fenster putzen und Rahmen", "Glas polieren, getippt"
	copyMain, copySub := "Fenster putzen lassen", "Glas blank polieren"
	f.edit(t,
		collab.Op{Kind: collab.OpInsert, BlockID: "cf_main", ParentID: strp(""), OrderKey: blocks[f.main].OrderKey + "8", Type: "todo", Content: &copyMain, Props: &collab.Props{ConflictOf: f.main}},
		collab.Op{Kind: collab.OpSetContent, BlockID: f.main, BaseVersion: blocks[f.main].Version, Content: &typedMain},
		collab.Op{Kind: collab.OpInsert, BlockID: "cf_sub2", ParentID: strp(f.main), OrderKey: blocks["sub2"].OrderKey + "8", Type: "todo", Content: &copySub, Props: &collab.Props{ConflictOf: "sub2"}},
		collab.Op{Kind: collab.OpSetContent, BlockID: "sub2", BaseVersion: blocks["sub2"].Version, Content: &typedSub},
	)
	ev := f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.Content == typedMain })
	f.expectAssignees(t, "after typing over the new title", ev)
	task := f.task(t)
	if task.Content != typedMain || len(task.Subtasks) != 2 || subtaskByBlock(task, "sub2") == nil || subtaskByBlock(task, "sub2").Title != typedSub {
		t.Errorf("task after typing over the new titles: %q %+v", task.Content, task.Subtasks)
	}
	// Another change in the note: the copies still are no task and no subtask
	resp := f.edit(t, f.textOp(t, "intro", "Diese Woche!"))
	if task := f.task(t); len(task.Subtasks) != 2 {
		t.Errorf("a conflict copy became a subtask: %+v", task.Subtasks)
	}
	if _, ok := resp.TaskLinks["cf_main"]; ok {
		t.Errorf("a conflict copy got a task: %v", resp.TaskLinks)
	}
	if _, ok := resp.SubtaskLinks["cf_sub2"]; ok {
		t.Errorf("a conflict copy got a subtask: %v", resp.SubtaskLinks)
	}
	// Kept ("Beide behalten"): the copy under the to-do is a normal checkbox now and becomes a subtask
	keep := true
	f.edit(t, collab.Op{Kind: collab.OpSetProps, BlockID: "cf_sub2", Patch: &collab.PropsPatch{ClearConflict: &keep}})
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 3 })
	f.ownerWS.quiet(300 * time.Millisecond)
	f.memberWS.quiet(300 * time.Millisecond)
	f.noLoop(t, "typing over a new title")
}

// offline is a note editor without network (the member's tab): its changes wait and go out in one sync
// when it is back, on the versions it saw when it made them.
type offlineEditor struct {
	f   *linkedFixture
	ops []collab.Op
}

func (o *offlineEditor) add(ops ...collab.Op) {
	for i := range ops {
		ops[i].OpID = o.f.opID()
	}
	o.ops = append(o.ops, ops...)
}

func (o *offlineEditor) reconnect(t *testing.T) syncResponse {
	t.Helper()
	code, resp := syncDoc(t, o.f.ts, o.f.memberTok, o.f.docID, map[string]any{"clientId": "member-tab", "ops": o.ops})
	if code != http.StatusOK {
		t.Fatalf("sync after reconnecting: %d", code)
	}
	o.ops = nil
	return resp
}

// The member edits the note offline (ticks, unticks and renames the to-do and a subtask, adds a subtask)
// while the owner changes the task online (renames it, ticks and renames subtasks, adds one). Back online,
// nothing is lost or flips back: changes to different things all stay; a text both changed keeps the
// online one in the to-do and the offline one as a conflict copy right below. Task and note agree, and
// the events stop.
func TestLinkedTodoOfflineNoteOnlineTask(t *testing.T) {
	f := newLinkedFixture(t)
	f.withSubtasks(t)
	off := &offlineEditor{f: f}
	// What the member's editor saw before going offline
	mainV, sub1V := f.block(t, f.main).Version, f.block(t, "sub1").Version

	// Offline: tick the to-do, untick-tick a subtask, rename sub1, add a subtask
	off.add(checkOp(f.main, true), checkOp("sub2", true), checkOp("sub2", false), checkOp("sub2", true))
	text := "Rahmen offline abwischen"
	off.add(collab.Op{Kind: collab.OpSetContent, BlockID: "sub1", BaseVersion: sub1V, Content: &text})
	off.add(insertTodo("sub3", f.main, "a5", "Offline ergänzt"))

	// Online meanwhile: the owner renames the task, ticks sub1, renames sub2 and adds a subtask
	f.patch(t, f.ownerTok, map[string]any{"content": "Fenster putzen online"})
	base := f.task(t).Subtasks
	f.patchSubtasks(t, f.ownerTok, base, func(s []domain.SubTask) []domain.SubTask {
		for i := range s {
			switch s[i].BlockID {
			case "sub1":
				s[i].IsCompleted = true
			case "sub2":
				s[i].Title = "Glas online polieren"
			}
		}
		return append(s, domain.SubTask{ID: "st_online", Title: "Online ergänzt"})
	})
	f.ownerWS.quiet(300 * time.Millisecond)
	f.memberWS.quiet(300 * time.Millisecond)

	resp := off.reconnect(t)
	for i, r := range resp.Results {
		if r.Status != collab.StatusApplied {
			t.Errorf("offline op %d not applied: %+v", i, r)
		}
	}
	task, blocks := f.task(t), f.blocks(t)
	// The to-do: online title, offline tick
	if task.Content != "Fenster putzen online" || blocks[f.main].Content != "Fenster putzen online" {
		t.Errorf("title: task %q, to-do %q", task.Content, blocks[f.main].Content)
	}
	if !task.IsCompleted || !blocks[f.main].Props.Checked {
		t.Errorf("offline tick lost: task %v, to-do %v", task.IsCompleted, blocks[f.main].Props.Checked)
	}
	_ = mainV
	// sub1: ticked online, renamed offline
	if st := subtaskByBlock(task, "sub1"); st == nil || !st.IsCompleted || st.Title != text || !blocks["sub1"].Props.Checked || blocks["sub1"].Content != text {
		t.Errorf("sub1: subtask %+v, checkbox %+v", st, blocks["sub1"])
	}
	// sub2: renamed online, ticked offline (the last of three ticks)
	if st := subtaskByBlock(task, "sub2"); st == nil || !st.IsCompleted || st.Title != "Glas online polieren" || !blocks["sub2"].Props.Checked {
		t.Errorf("sub2: subtask %+v, checkbox %+v", st, blocks["sub2"])
	}
	// Both new subtasks, each once
	if st := subtaskByBlock(task, "sub3"); st == nil || st.Title != "Offline ergänzt" {
		t.Errorf("subtask added offline: %+v", task.Subtasks)
	}
	online := 0
	for _, st := range task.Subtasks {
		if st.Title == "Online ergänzt" {
			online++
			if b, ok := blocks[st.BlockID]; !ok || b.ParentID != f.main {
				t.Errorf("subtask added online has no checkbox under the to-do: %+v", st)
			}
		}
	}
	if online != 1 || len(task.Subtasks) != 4 {
		t.Errorf("subtasks after reconnecting: %+v", task.Subtasks)
	}
	f.ownerWS.quiet(300 * time.Millisecond)
	f.memberWS.quiet(300 * time.Millisecond)
	f.noLoop(t, "offline changes")
}

// Both sides renamed the to-do: the online title stays in the to-do and the task, the offline text is a
// conflict copy right below it (not a task, not a subtask). A subtask renamed on both sides the same.
func TestLinkedTodoOfflineRenameBothSides(t *testing.T) {
	f := newLinkedFixture(t)
	f.withSubtasks(t)
	off := &offlineEditor{f: f}
	mainV, sub2V := f.block(t, f.main).Version, f.block(t, "sub2").Version
	mine, sub := "Fenster putzen offline", "Glas offline polieren"
	off.add(collab.Op{Kind: collab.OpSetContent, BlockID: f.main, BaseVersion: mainV, Content: &mine},
		collab.Op{Kind: collab.OpSetContent, BlockID: "sub2", BaseVersion: sub2V, Content: &sub})

	f.patch(t, f.ownerTok, map[string]any{"content": "Fenster putzen online"})
	base := f.task(t).Subtasks
	f.patchSubtasks(t, f.ownerTok, base, func(s []domain.SubTask) []domain.SubTask {
		for i := range s {
			if s[i].BlockID == "sub2" {
				s[i].Title = "Glas online polieren"
			}
		}
		return s
	})
	resp := off.reconnect(t)
	conflicts := 0
	for _, r := range resp.Results {
		if r.Status == collab.StatusConflict {
			conflicts++
		}
	}
	if conflicts != 2 {
		t.Errorf("both offline texts should become conflict copies: %+v", resp.Results)
	}
	task, blocks := f.task(t), f.blocks(t)
	if task.Content != "Fenster putzen online" || blocks[f.main].Content != "Fenster putzen online" {
		t.Errorf("title: task %q, to-do %q", task.Content, blocks[f.main].Content)
	}
	if st := subtaskByBlock(task, "sub2"); st == nil || st.Title != "Glas online polieren" || blocks["sub2"].Content != "Glas online polieren" {
		t.Errorf("sub2: %+v / %q", st, blocks["sub2"].Content)
	}
	kept := map[string]string{}
	for _, b := range blocks {
		if b.Props.ConflictOf != "" {
			kept[b.Props.ConflictOf] = b.Content
		}
	}
	if kept[f.main] != mine || kept["sub2"] != sub {
		t.Errorf("offline texts not kept as conflict copies: %v", kept)
	}
	if len(task.Subtasks) != 2 {
		t.Errorf("a conflict copy became a subtask: %+v", task.Subtasks)
	}
	f.ownerWS.quiet(300 * time.Millisecond)
	f.memberWS.quiet(300 * time.Millisecond)
	f.noLoop(t, "offline rename on both sides")
}

// The task view was offline: its tick (queued by the app, only status changes are) arrives after the
// to-do was renamed in the note. Both stay.
func TestLinkedTodoOfflineTaskTick(t *testing.T) {
	f := newLinkedFixture(t)
	f.edit(t, f.textOp(t, f.main, "Fenster putzen, in der Notiz geändert"))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.Content == "Fenster putzen, in der Notiz geändert" })
	// The queued request of the offline task view, sent when it is back
	f.patch(t, f.memberTok, map[string]any{"isCompleted": true, "kanbanStatus": "done"})
	task, b := f.task(t), f.block(t, f.main)
	if !task.IsCompleted || !b.Props.Checked || task.Content != "Fenster putzen, in der Notiz geändert" || b.Content != task.Content {
		t.Errorf("after the queued tick: task %+v, to-do %+v", task, b)
	}
	f.ownerWS.quiet(300 * time.Millisecond)
	f.memberWS.quiet(300 * time.Millisecond)
	f.noLoop(t, "queued tick")
}
