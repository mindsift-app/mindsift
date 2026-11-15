package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// A to-do in a note linked to a task (and its children to subtasks) changes in both directions: these
// tests drive both sides through the API as the apps do (note sync, PATCH of the task, trash) in a note
// and a task list shared by two people with both assigned, and check the task, the note and what the
// realtime events tell the other person.

// wsEvents collects every event of one WebSocket connection (joined to a note's room).
type wsEvents struct {
	ch chan sseMsg
}

func listenWS(t *testing.T, ts *httptest.Server, token, docID string) *wsEvents {
	t.Helper()
	conn := dialWS(t, ts, token)
	if err := conn.WriteJSON(map[string]string{"event": "JOIN_ROOM", "room": "doc:" + docID}); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(map[string]string{"event": "PING"}); err != nil {
		t.Fatal(err)
	}
	if readWSEvent(conn, "PONG", 10*time.Second) == nil {
		t.Fatal("no PONG after the join")
	}
	w := &wsEvents{ch: make(chan sseMsg, 1024)}
	go func(c *websocket.Conn) {
		defer close(w.ch)
		for {
			_ = c.SetReadDeadline(time.Time{})
			var m sseMsg
			if err := c.ReadJSON(&m); err != nil {
				return
			}
			w.ch <- m
		}
	}(conn)
	return w
}

// waitTask waits for a TASK_UPDATED of the task that ok accepts and returns its payload.
func (w *wsEvents) waitTask(t *testing.T, event, taskID string, ok func(*domain.Thought) bool) *domain.Thought {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case m, open := <-w.ch:
			if !open {
				t.Fatalf("connection closed while waiting for %s", event)
			}
			if m.Event != event {
				continue
			}
			var th domain.Thought
			if json.Unmarshal(m.Payload, &th) != nil || (taskID != "" && th.ID != taskID) {
				continue
			}
			if ok == nil || ok(&th) {
				return &th
			}
		case <-deadline:
			t.Fatalf("no matching %s for %s", event, taskID)
			return nil
		}
	}
}

// waitEvent waits for an event of that name (any payload).
func (w *wsEvents) waitEvent(t *testing.T, event string) sseMsg {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case m := <-w.ch:
			if m.Event == event {
				return m
			}
		case <-deadline:
			t.Fatalf("no %s", event)
			return sseMsg{}
		}
	}
}

// quiet collects the events of the next d and counts them by name.
func (w *wsEvents) quiet(d time.Duration) map[string]int {
	out := map[string]int{}
	end := time.After(d)
	for {
		select {
		case m := <-w.ch:
			out[m.Event]++
		case <-end:
			return out
		}
	}
}

type linkedFixture struct {
	srv                 *Server
	store               *storage.Store
	ts                  *httptest.Server
	owner, member       *domain.User
	ownerTok, memberTok string
	docID, listID       string
	listB               string // a second list shared the same way
	taskID, main        string
	ownerWS, memberWS   *wsEvents
	assignees           []string
	opSeq               int
	mu                  sync.Mutex
}

// newLinkedFixture: owner's note "Wohnung" with the to-do "Fenster putzen" (main) linked to a task in the
// shared list "Haushalt", assigned to both; the member edits the note and sees the list.
func newLinkedFixture(t *testing.T) *linkedFixture {
	t.Helper()
	srv, store, ts, owner, ownerTok := startRealtimeServer(t)
	member, memberTok := newTestUser(t, store, "mitbewohner@example.com")
	f := &linkedFixture{srv: srv, store: store, ts: ts, owner: owner, member: member, ownerTok: ownerTok, memberTok: memberTok, main: "todo_main"}

	doc, err := store.CreateDocument(owner.ID, "", "Wohnung", "🏠", "", []domain.DocumentBlock{
		{ID: "intro", Type: "bullet", Content: "Diese Woche"},
		{ID: f.main, Type: "todo", Content: "Fenster putzen"},
		{ID: "other", Type: "bullet", Content: "Sonstiges"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	f.docID = doc.ID
	if _, err := store.CreateDocShare(owner.ID, doc.ID, member.ID, "write"); err != nil {
		t.Fatal(err)
	}
	for i, title := range []string{"Haushalt", "Garten"} {
		list, err := store.CreateTaskList(owner.ID, "", "", title, "🏠", "#000000")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.AddTaskListShare(list.ID, "user", member.ID, "editor", owner.ID); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			f.listID = list.ID
		} else {
			f.listB = list.ID
		}
	}

	resp := doJSON(t, ts, http.MethodPost, "/api/v1/documents/"+doc.ID+"/blocks/"+f.main+"/enhanced-task", ownerTok, map[string]any{"content": "Fenster putzen", "checked": false})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("link to-do: %d", resp.StatusCode)
	}
	var task domain.Thought
	_ = json.NewDecoder(resp.Body).Decode(&task)
	f.taskID = task.ID
	f.assignees = []string{owner.ID, member.ID}
	got := f.patch(t, ownerTok, map[string]any{"taskListId": f.listID})
	if got.TaskListID != f.listID {
		t.Fatalf("move into the list: %+v", got)
	}
	got = f.patch(t, ownerTok, map[string]any{"assignees": f.assignees})
	if !sameSet(got.Assignees, f.assignees) {
		t.Fatalf("assign: %+v", got.Assignees)
	}
	f.ownerWS = listenWS(t, ts, ownerTok, doc.ID)
	f.memberWS = listenWS(t, ts, memberTok, doc.ID)
	return f
}

func (f *linkedFixture) patch(t *testing.T, tok string, body map[string]any) *domain.Thought {
	t.Helper()
	resp := doJSON(t, f.ts, http.MethodPatch, "/api/v1/thoughts/"+f.taskID, tok, body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH task %v: %d", body, resp.StatusCode)
	}
	var out domain.Thought
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return &out
}

// task as the owner's app loads it
func (f *linkedFixture) task(t *testing.T) *domain.Thought {
	t.Helper()
	return f.taskOf(t, f.taskID)
}

func (f *linkedFixture) taskOf(t *testing.T, id string) *domain.Thought {
	t.Helper()
	resp := doJSON(t, f.ts, http.MethodGet, "/api/v1/thoughts/"+id, f.ownerTok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET task: %d", resp.StatusCode)
	}
	var out domain.Thought
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return &out
}

// blocks of the note as a client's snapshot has them (deleted ones left out)
func (f *linkedFixture) blocks(t *testing.T) map[string]collab.Block {
	t.Helper()
	resp := doJSON(t, f.ts, http.MethodGet, "/api/v1/docs/"+f.docID+"/snapshot", f.memberTok, nil)
	var snap struct {
		Blocks []collab.Block `json:"blocks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		t.Fatal(err)
	}
	out := map[string]collab.Block{}
	for _, b := range snap.Blocks {
		if !b.Deleted {
			out[b.ID] = b
		}
	}
	return out
}

func (f *linkedFixture) block(t *testing.T, id string) collab.Block {
	t.Helper()
	b, ok := f.blocks(t)[id]
	if !ok {
		t.Fatalf("block %s not in the note", id)
	}
	return b
}

func (f *linkedFixture) opID() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.opSeq++
	return fmt.Sprintf("op-%d-%d", time.Now().UnixNano(), f.opSeq)
}

// edit sends operations as the member's editor does and returns the sync answer.
func (f *linkedFixture) edit(t *testing.T, ops ...collab.Op) syncResponse {
	t.Helper()
	for i := range ops {
		ops[i].OpID = f.opID()
	}
	code, resp := syncDoc(t, f.ts, f.memberTok, f.docID, map[string]any{"clientId": "member-tab", "ops": ops})
	if code != http.StatusOK {
		t.Fatalf("sync: %d", code)
	}
	for i, r := range resp.Results {
		if r.Status != collab.StatusApplied {
			t.Fatalf("op %d (%s) not applied: %+v", i, ops[i].Kind, r)
		}
	}
	return resp
}

func checkOp(id string, on bool) collab.Op {
	return collab.Op{Kind: collab.OpSetProps, BlockID: id, Patch: &collab.PropsPatch{Checked: &on}}
}

func (f *linkedFixture) textOp(t *testing.T, id, text string) collab.Op {
	return collab.Op{Kind: collab.OpSetContent, BlockID: id, BaseVersion: f.block(t, id).Version, Content: &text}
}

func insertTodo(id, parent, key, text string) collab.Op {
	return collab.Op{Kind: collab.OpInsert, BlockID: id, ParentID: &parent, OrderKey: key, Type: "todo", Content: &text}
}

// expectAssignees: the event a person's task view applies still names everyone assigned
func (f *linkedFixture) expectAssignees(t *testing.T, where string, th *domain.Thought) {
	t.Helper()
	if !sameSet(th.Assignees, f.assignees) {
		t.Errorf("%s: TASK_UPDATED lost the assignees: %v (want %v)", where, th.Assignees, f.assignees)
	}
}

// noLoop: after a change has settled, nothing keeps going back and forth
func (f *linkedFixture) noLoop(t *testing.T, what string) {
	t.Helper()
	for name, w := range map[string]*wsEvents{"owner": f.ownerWS, "member": f.memberWS} {
		// What the change itself sent and was not waited for: at most one TASK_UPDATED, a few pokes
		if got := w.quiet(400 * time.Millisecond); got["TASK_UPDATED"] > 1 || got["DOC_SEQ"] > 2 {
			t.Errorf("%s: %s got too many events for one change: %v", what, name, got)
		}
		if got := w.quiet(600 * time.Millisecond); got["TASK_UPDATED"] > 0 || got["DOC_SEQ"] > 0 {
			t.Errorf("%s: %s keeps getting events after the change: %v", what, name, got)
		}
	}
}

// Note → task: tick, untick, edit the text. The task follows, both people's task views get the change
// with the assignees, the note's room is told of the new state, and nothing echoes back.
func TestLinkedTodoNoteToTaskTickAndText(t *testing.T) {
	f := newLinkedFixture(t)

	f.edit(t, checkOp(f.main, true))
	for name, w := range map[string]*wsEvents{"owner": f.ownerWS, "member": f.memberWS} {
		ev := w.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
		f.expectAssignees(t, name+" after the tick", ev)
		if ev.KanbanStatus != "done" || ev.DocID != f.docID || ev.BlockID != f.main {
			t.Errorf("%s: event after the tick: status %q doc %q block %q", name, ev.KanbanStatus, ev.DocID, ev.BlockID)
		}
		w.waitEvent(t, "DOC_SEQ")
	}
	if got := f.task(t); !got.IsCompleted || got.KanbanStatus != "done" || !sameSet(got.Assignees, f.assignees) {
		t.Fatalf("task after the tick: %+v", got)
	}
	f.noLoop(t, "tick")

	f.edit(t, checkOp(f.main, false))
	ev := f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return !th.IsCompleted })
	f.expectAssignees(t, "after the untick", ev)
	if got := f.task(t); got.IsCompleted || got.KanbanStatus != "todo" {
		t.Fatalf("task after the untick: %+v", got)
	}
	f.noLoop(t, "untick")

	f.edit(t, f.textOp(t, f.main, "Fenster putzen #haushalt"))
	ev = f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.Content == "Fenster putzen #haushalt" })
	f.expectAssignees(t, "after editing the text", ev)
	if !slices.Contains(ev.Tags, "haushalt") {
		t.Errorf("hashtag of the new text should become a tag: %v", ev.Tags)
	}
	if got := f.task(t); got.Content != "Fenster putzen #haushalt" {
		t.Fatalf("task after editing: %+v", got)
	}
	f.noLoop(t, "edit")

	// A change in the note that does not touch the to-do changes no task
	f.edit(t, f.textOp(t, "other", "Sonstiges und mehr"))
	if got := f.memberWS.quiet(500 * time.Millisecond); got["TASK_UPDATED"] > 0 {
		t.Errorf("an unrelated bullet changed the task: %v", got)
	}
}

// Moving the to-do (another place, nested under a bullet and back) keeps the link; ticking afterwards still
// reaches the task.
func TestLinkedTodoNoteToTaskMoveAndNest(t *testing.T) {
	f := newLinkedFixture(t)
	top := ""
	f.edit(t, collab.Op{Kind: collab.OpMove, BlockID: f.main, ParentID: &top, OrderKey: "a0"}) // before "intro"
	intro := "intro"
	f.edit(t, collab.Op{Kind: collab.OpMove, BlockID: f.main, ParentID: &intro, OrderKey: "a0"})
	if got := f.memberWS.quiet(400 * time.Millisecond); got["TASK_UPDATED"] > 0 {
		t.Errorf("moving changed the task: %v", got)
	}
	f.edit(t, checkOp(f.main, true))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
	if got := f.task(t); !got.IsCompleted || got.DocID != f.docID || got.BlockID != f.main {
		t.Fatalf("moved to-do lost its task: %+v", got)
	}
	resp := f.edit(t, collab.Op{Kind: collab.OpMove, BlockID: f.main, ParentID: &top, OrderKey: "a9"})
	if resp.TaskLinks[f.main] != f.taskID {
		t.Fatalf("badge of the moved to-do: %v", resp.TaskLinks)
	}
}

// Subtasks from the note: a to-do nested under the linked one becomes a subtask (with tick and text),
// moved out of it (unnested) it stays the same subtask, and a to-do turned into a bullet loses its link
// while the subtask stays.
func TestLinkedTodoNoteToTaskSubtasks(t *testing.T) {
	f := newLinkedFixture(t)
	f.edit(t, insertTodo("sub1", f.main, "a0", "Rahmen abwischen"))
	ev := f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 })
	f.expectAssignees(t, "after a new subtask", ev)
	if st := ev.Subtasks[0]; st.Title != "Rahmen abwischen" || st.BlockID != "sub1" || st.IsCompleted {
		t.Fatalf("new subtask: %+v", st)
	}

	f.edit(t, checkOp("sub1", true), f.textOp(t, "sub1", "Rahmen gründlich abwischen"))
	ev = f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool {
		return len(th.Subtasks) == 1 && th.Subtasks[0].IsCompleted && th.Subtasks[0].Title == "Rahmen gründlich abwischen"
	})
	f.expectAssignees(t, "after ticking a subtask", ev)

	// Unnest: the checkbox moves to the top level and stays tied to its subtask
	top := ""
	f.edit(t, collab.Op{Kind: collab.OpMove, BlockID: "sub1", ParentID: &top, OrderKey: "a8"})
	f.edit(t, checkOp("sub1", false))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 && !th.Subtasks[0].IsCompleted })
	if got := f.task(t); len(got.Subtasks) != 1 || got.Subtasks[0].BlockID != "sub1" {
		t.Fatalf("unnested subtask: %+v", got.Subtasks)
	}

	// Turned into a bullet: no longer a checkbox, the subtask stays without its link
	bullet := "bullet"
	f.edit(t, collab.Op{Kind: collab.OpSetProps, BlockID: "sub1", Patch: &collab.PropsPatch{Type: &bullet}})
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 && th.Subtasks[0].BlockID == "" })
	resp := f.edit(t, f.textOp(t, "intro", "Diese Woche!"))
	if _, ok := resp.SubtaskLinks["sub1"]; ok {
		t.Errorf("a bullet keeps the subtask badge: %v", resp.SubtaskLinks)
	}
}

// Converting the linked to-do itself into a bullet unlinks the task, as for a subtask whose checkbox
// stops being one (the task stays, with its subtasks); turned back into a to-do (by hand or undo) it is
// linked again and takes the to-do's state, subtasks included.
func TestLinkedTodoConvertTypes(t *testing.T) {
	f := newLinkedFixture(t)
	f.edit(t, insertTodo("sub1", f.main, "a0", "Rahmen abwischen"))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 })
	f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 })
	bullet, todo := "bullet", "todo"
	resp := f.edit(t, collab.Op{Kind: collab.OpSetProps, BlockID: f.main, Patch: &collab.PropsPatch{Type: &bullet}})
	ev := f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.DocID == "" })
	f.expectAssignees(t, "after turning the to-do into a bullet", ev)
	if _, ok := resp.TaskLinks[f.main]; ok {
		t.Errorf("a bullet keeps the task badge: %v", resp.TaskLinks)
	}
	got := f.task(t)
	if got.DocID != "" || len(got.Subtasks) != 1 || got.Subtasks[0].BlockID != "" {
		t.Fatalf("task after its to-do became a bullet: %+v", got)
	}
	// Unlinked: a rename in the task view leaves the bullet alone, a new text of the bullet the task
	f.patch(t, f.ownerTok, map[string]any{"content": "Fenster putzen lassen"})
	f.edit(t, f.textOp(t, f.main, "Fenster putzen als Punkt"))
	if b := f.block(t, f.main); b.Content != "Fenster putzen als Punkt" {
		t.Errorf("unlinked bullet changed by the task: %q", b.Content)
	}
	if got := f.task(t); got.Content != "Fenster putzen lassen" {
		t.Errorf("unlinked task changed by the bullet: %q", got.Content)
	}
	f.ownerWS.quiet(300 * time.Millisecond)
	f.memberWS.quiet(300 * time.Millisecond)
	f.noLoop(t, "to bullet")

	// A to-do again: linked, with the to-do's text and tick, and its subtask tied again
	resp = f.edit(t, collab.Op{Kind: collab.OpSetProps, BlockID: f.main, Patch: &collab.PropsPatch{Type: &todo}})
	if resp.TaskLinks[f.main] != f.taskID {
		t.Fatalf("to-do again: the badge is not back: %v", resp.TaskLinks)
	}
	ev = f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool {
		return th.DocID == f.docID && th.Content == "Fenster putzen als Punkt"
	})
	f.expectAssignees(t, "after turning it back into a to-do", ev)
	if got := f.task(t); len(got.Subtasks) != 1 || got.Subtasks[0].BlockID != "sub1" {
		t.Errorf("to-do again: subtask not tied again: %+v", got.Subtasks)
	}
	f.edit(t, checkOp(f.main, true))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
	if got := f.task(t); !got.IsCompleted {
		t.Fatalf("tick after converting back: %+v", got)
	}

	// Made a heading, deleted and restored: restored as no to-do, nothing is linked again
	heading := "h2"
	f.edit(t, collab.Op{Kind: collab.OpSetProps, BlockID: f.main, Patch: &collab.PropsPatch{Type: &heading}})
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.DocID == "" })
	f.edit(t, collab.Op{Kind: collab.OpDelete, BlockID: f.main})
	f.edit(t, collab.Op{Kind: collab.OpRestore, IDs: []string{f.main}})
	if got := f.task(t); got.DocID != "" {
		t.Errorf("a heading restored linked the task again: %+v", got)
	}

	// A plain bullet made a to-do is no task (nothing links it)
	f.edit(t, collab.Op{Kind: collab.OpSetProps, BlockID: "other", Patch: &collab.PropsPatch{Type: &todo}}, checkOp("other", true))
	resp = f.edit(t, f.textOp(t, "other", "Sonstiges erledigt"))
	if _, ok := resp.TaskLinks["other"]; ok {
		t.Errorf("a new to-do got a task by itself: %v", resp.TaskLinks)
	}
}

// A subtask's checkbox turned into a bullet and back (still under the main to-do): the same subtask is
// tied again, no second one.
func TestLinkedTodoSubtaskTypeRoundTrip(t *testing.T) {
	f := newLinkedFixture(t)
	f.edit(t, insertTodo("sub1", f.main, "a0", "Rahmen abwischen"))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 })
	id := f.task(t).Subtasks[0].ID
	bullet, todo := "bullet", "todo"
	f.edit(t, collab.Op{Kind: collab.OpSetProps, BlockID: "sub1", Patch: &collab.PropsPatch{Type: &bullet}})
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 && th.Subtasks[0].BlockID == "" })
	f.edit(t, collab.Op{Kind: collab.OpSetProps, BlockID: "sub1", Patch: &collab.PropsPatch{Type: &todo}})
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 && th.Subtasks[0].BlockID == "sub1" })
	if got := f.task(t); len(got.Subtasks) != 1 || got.Subtasks[0].ID != id {
		t.Fatalf("subtask after the round trip: %+v (want the same subtask %s)", got.Subtasks, id)
	}
	f.memberWS.quiet(300 * time.Millisecond)
	f.noLoop(t, "subtask round trip")
}

// Deleting the linked to-do unlinks the task (it stays, with its assignees); undoing the delete
// (restore) brings the link back, subtasks included.
func TestLinkedTodoDeleteAndRestore(t *testing.T) {
	f := newLinkedFixture(t)
	f.edit(t, insertTodo("sub1", f.main, "a0", "Rahmen abwischen"))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 })
	f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return len(th.Subtasks) == 1 })

	f.edit(t, collab.Op{Kind: collab.OpDelete, BlockID: f.main})
	ev := f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.DocID == "" })
	f.expectAssignees(t, "after deleting the to-do", ev)
	got := f.task(t)
	if got.DocID != "" || got.IsCompleted || len(got.Subtasks) != 1 || got.Subtasks[0].BlockID != "" {
		t.Fatalf("task after deleting its to-do: %+v", got)
	}
	f.noLoop(t, "delete")

	// Undo (Ctrl+Z) restores the block and its child
	resp := f.edit(t, collab.Op{Kind: collab.OpRestore, IDs: []string{f.main, "sub1"}})
	ev = f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.DocID == f.docID })
	f.expectAssignees(t, "after restoring the to-do", ev)
	if resp.TaskLinks[f.main] != f.taskID {
		t.Errorf("restored to-do: link not back: %v", resp.TaskLinks)
	}
	got = f.task(t)
	if got.DocID != f.docID || got.BlockID != f.main {
		t.Errorf("restored to-do: task not linked again: doc %q block %q", got.DocID, got.BlockID)
	}
	if len(got.Subtasks) != 1 || got.Subtasks[0].BlockID != "sub1" {
		t.Errorf("restored to-do: subtask not tied again: %+v", got.Subtasks)
	}
	// and a tick works again in both directions
	f.edit(t, checkOp(f.main, true))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
	if !f.task(t).IsCompleted {
		t.Error("tick after restoring did not reach the task")
	}
}

// Task → note: complete, reopen, rename. The note follows (the member's editor in the room hears
// DOC_SEQ), both task views get the change with the assignees, and nothing echoes back.
func TestLinkedTodoTaskToNote(t *testing.T) {
	f := newLinkedFixture(t)

	f.patch(t, f.ownerTok, map[string]any{"isCompleted": true})
	f.memberWS.waitEvent(t, "DOC_SEQ")
	ev := f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
	f.expectAssignees(t, "after completing", ev)
	if b := f.block(t, f.main); !b.Props.Checked {
		t.Fatal("completed task: to-do not ticked")
	}
	f.noLoop(t, "complete")

	f.patch(t, f.memberTok, map[string]any{"isCompleted": false})
	f.ownerWS.waitEvent(t, "DOC_SEQ")
	ev = f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return !th.IsCompleted })
	f.expectAssignees(t, "after reopening", ev)
	if b := f.block(t, f.main); b.Props.Checked {
		t.Fatal("reopened task: to-do still ticked")
	}
	f.noLoop(t, "reopen")

	f.patch(t, f.ownerTok, map[string]any{"content": "Alle Fenster putzen"})
	f.memberWS.waitEvent(t, "DOC_SEQ")
	if b := f.block(t, f.main); b.Content != "Alle Fenster putzen" {
		t.Fatalf("renamed task: to-do says %q", b.Content)
	}
	f.noLoop(t, "rename")

	// Kanban column "done" ticks as well
	f.patch(t, f.ownerTok, map[string]any{"kanbanStatus": "done"})
	if b := f.block(t, f.main); !b.Props.Checked {
		t.Fatal("moved to done: to-do not ticked")
	}
}

// Task → note: subtasks added, completed and deleted in the task view.
func TestLinkedTodoTaskSubtasksToNote(t *testing.T) {
	f := newLinkedFixture(t)
	subs := []domain.SubTask{{ID: "st1", Title: "Rahmen abwischen"}, {ID: "st2", Title: "Glas polieren"}}
	got := f.patch(t, f.ownerTok, map[string]any{"subtasks": subs})
	f.memberWS.waitEvent(t, "DOC_SEQ")
	blocks := f.blocks(t)
	tied := map[string]string{}
	for _, b := range blocks {
		if b.ParentID == f.main && b.Type == "todo" {
			tied[b.Content] = b.ID
		}
	}
	if len(tied) != 2 {
		t.Fatalf("subtasks should appear under the to-do: %v", tied)
	}
	// the answer (and the event) may come before the links are stored; the task as loaded has them
	_ = got
	task := f.task(t)
	for _, st := range task.Subtasks {
		if st.BlockID == "" || tied[st.Title] != st.BlockID {
			t.Errorf("subtask %q not tied to its checkbox: %+v / %v", st.Title, st, tied)
		}
	}
	f.noLoop(t, "add subtasks")

	// Completed in the task view: the checkbox is ticked
	task.Subtasks[1].IsCompleted = true
	f.patch(t, f.memberTok, map[string]any{"subtasks": task.Subtasks})
	if b := f.block(t, tied["Glas polieren"]); !b.Props.Checked {
		t.Error("completed subtask: checkbox not ticked")
	}

	// Deleted in the task view: its checkbox stays in the note (deleting is not mirrored)
	f.patch(t, f.ownerTok, map[string]any{"subtasks": task.Subtasks[:1]})
	if _, ok := f.blocks(t)[tied["Glas polieren"]]; !ok {
		t.Error("deleted subtask: checkbox removed from the note")
	}
	// ...and it does not come back as a subtask on the next change in the note
	f.edit(t, f.textOp(t, "intro", "Diese Woche!"))
	time.Sleep(200 * time.Millisecond)
	if task := f.task(t); len(task.Subtasks) != 1 {
		t.Logf("BEHAVIOUR: a subtask deleted in the task view comes back from its checkbox: %+v", task.Subtasks)
	}
}

// Task → note: moved to another list keeps the link (and the assignees, who see both lists); deleted, the
// to-do loses its badge; restored from the task trash, the link is back.
func TestLinkedTodoTaskMoveDeleteRestore(t *testing.T) {
	f := newLinkedFixture(t)
	moved := f.patch(t, f.ownerTok, map[string]any{"taskListId": f.listB})
	if moved.DocID != f.docID || !sameSet(moved.Assignees, f.assignees) {
		t.Fatalf("moved task: %+v", moved)
	}
	ev := f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.TaskListID == f.listB })
	f.expectAssignees(t, "after moving", ev)
	f.edit(t, checkOp(f.main, true))
	ev = f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
	f.expectAssignees(t, "after a tick in the moved task", ev)

	resp := doJSON(t, f.ts, http.MethodDelete, "/api/v1/thoughts/"+f.taskID, f.ownerTok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	f.memberWS.waitEvent(t, "TASK_DELETED")
	if b := f.block(t, f.main); !b.Props.Checked || b.Content != "Fenster putzen" {
		t.Errorf("the to-do of a deleted task should stay as it is: %+v", b)
	}
	if got := f.memberWS.quiet(400 * time.Millisecond); got["DOC_SEQ"] == 0 {
		t.Errorf("deleting the task does not tell the open note (its badge stays until the next sync)")
	}
	sync := f.edit(t, f.textOp(t, "intro", "Diese Woche!"))
	if _, ok := sync.TaskLinks[f.main]; ok {
		t.Errorf("deleted task: badge still on the to-do: %v", sync.TaskLinks)
	}
	// Ticking the to-do of a deleted task changes nothing (and fails nothing)
	f.edit(t, checkOp(f.main, false))

	resp = doJSON(t, f.ts, http.MethodPost, "/api/v1/tasks/trash/"+f.taskID+"/restore", f.ownerTok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("restore: %d", resp.StatusCode)
	}
	var restored domain.Thought
	_ = json.NewDecoder(resp.Body).Decode(&restored)
	if !sameSet(restored.Assignees, f.assignees) {
		t.Errorf("restored task: answer without assignees: %v", restored.Assignees)
	}
	created := f.memberWS.waitTask(t, "TASK_CREATED", f.taskID, nil)
	f.expectAssignees(t, "TASK_CREATED after restoring", created)
	// The to-do was unticked while the task was in the trash: the restored task follows it
	ev = f.memberWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return !th.IsCompleted })
	f.expectAssignees(t, "after restoring", ev)
	f.memberWS.waitEvent(t, "DOC_SEQ")
	if restored.IsCompleted || f.task(t).IsCompleted {
		t.Errorf("restored task stays completed although its to-do was unticked meanwhile")
	}
	sync = f.edit(t, f.textOp(t, "intro", "Diese Woche!!"))
	if sync.TaskLinks[f.main] != f.taskID {
		t.Errorf("restored task: badge not back: %v", sync.TaskLinks)
	}
	// The next tick in the note reaches the restored task
	f.edit(t, checkOp(f.main, true))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
}

// A repeating task completed by ticking its to-do: like completing it in the task view, the next
// occurrence is created, with the assignees; unticked again, it goes while untouched.
func TestLinkedTodoRecurringTickedInNote(t *testing.T) {
	f := newLinkedFixture(t)
	f.patch(t, f.ownerTok, map[string]any{"recurrence": "weekly", "dueDate": "2026-11-20"})

	f.edit(t, checkOp(f.main, true))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
	next := f.memberWS.waitTask(t, "TASK_CREATED", "", func(th *domain.Thought) bool { return th.ID != f.taskID })
	if next.Content != "Fenster putzen" || next.IsCompleted || next.DueDate != "2026-11-27" || next.TaskListID != f.listID {
		t.Fatalf("next occurrence: %+v", next)
	}
	if !sameSet(f.taskOf(t, next.ID).Assignees, f.assignees) {
		t.Errorf("next occurrence lost the assignees")
	}
	// Unticked: the untouched occurrence goes (TASK_DELETED); ticked again: a fresh one, so one in the end
	f.edit(t, checkOp(f.main, false))
	f.edit(t, checkOp(f.main, true))
	f.ownerWS.waitTask(t, "TASK_UPDATED", f.taskID, func(th *domain.Thought) bool { return th.IsCompleted })
	if got := f.memberWS.quiet(500 * time.Millisecond); got["TASK_CREATED"] != 1 || got["TASK_DELETED"] != 1 {
		t.Errorf("untick and tick again: want one occurrence removed and one created, got %v", got)
	}
	if _, err := f.store.GetThoughtByID(f.owner.ID, next.ID); err == nil {
		t.Errorf("the untouched occurrence is still there after unticking")
	}
}

// Note and task changed at nearly the same time: the member ticks the to-do while the owner renames the
// task (and the other way round). Neither change is lost, task and note agree, and the events stop.
func TestLinkedTodoConcurrentNoteAndTask(t *testing.T) {
	f := newLinkedFixture(t)
	for round := 0; round < 20; round++ {
		on := round%2 == 0
		title := fmt.Sprintf("Fenster putzen %d", round)
		var wg sync.WaitGroup
		wg.Add(2)
		tick := checkOp(f.main, on)
		tick.OpID = f.opID()
		go func() {
			defer wg.Done()
			syncDoc(t, f.ts, f.memberTok, f.docID, map[string]any{"clientId": "member-tab", "ops": []collab.Op{tick}})
		}()
		go func() {
			defer wg.Done()
			doJSON(t, f.ts, http.MethodPatch, "/api/v1/thoughts/"+f.taskID, f.ownerTok, map[string]any{"content": title})
		}()
		wg.Wait()
		task, b := f.task(t), f.block(t, f.main)
		if task.IsCompleted != on || b.Props.Checked != on {
			t.Errorf("round %d: tick lost: task done=%v, to-do checked=%v, want %v", round, task.IsCompleted, b.Props.Checked, on)
		}
		if task.Content != title || b.Content != title {
			t.Errorf("round %d: rename lost: task %q, to-do %q, want %q", round, task.Content, b.Content, title)
		}
		if !sameSet(task.Assignees, f.assignees) {
			t.Errorf("round %d: assignees %v", round, task.Assignees)
		}
	}
	f.ownerWS.quiet(300 * time.Millisecond)
	f.memberWS.quiet(300 * time.Millisecond)
	f.noLoop(t, "concurrent changes")
}

// The same the other way round: the task completed in the task view while the to-do's text is edited.
func TestLinkedTodoConcurrentTaskTickNoteText(t *testing.T) {
	f := newLinkedFixture(t)
	for round := 0; round < 20; round++ {
		on := round%2 == 0
		title := fmt.Sprintf("Fenster putzen, Runde %d", round)
		text := f.textOp(t, f.main, title)
		text.OpID = f.opID()
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			syncDoc(t, f.ts, f.memberTok, f.docID, map[string]any{"clientId": "member-tab", "ops": []collab.Op{text}})
		}()
		go func() {
			defer wg.Done()
			doJSON(t, f.ts, http.MethodPatch, "/api/v1/thoughts/"+f.taskID, f.ownerTok, map[string]any{"isCompleted": on})
		}()
		wg.Wait()
		task, b := f.task(t), f.block(t, f.main)
		if task.IsCompleted != on || b.Props.Checked != on {
			t.Errorf("round %d: completion lost: task done=%v, to-do checked=%v, want %v", round, task.IsCompleted, b.Props.Checked, on)
		}
		if task.Content != title || b.Content != title {
			t.Errorf("round %d: text lost: task %q, to-do %q, want %q", round, task.Content, b.Content, title)
		}
	}
	f.ownerWS.quiet(300 * time.Millisecond)
	f.memberWS.quiet(300 * time.Millisecond)
	f.noLoop(t, "concurrent changes")
}

// Both sides change the same field at once (the member unticks the to-do while the owner completes the
// task, and the other way round): one of them wins, but task and note end up the same.
func TestLinkedTodoConcurrentSameField(t *testing.T) {
	f := newLinkedFixture(t)
	for round := 0; round < 20; round++ {
		inNote := round%2 == 0
		tick := checkOp(f.main, inNote)
		tick.OpID = f.opID()
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			syncDoc(t, f.ts, f.memberTok, f.docID, map[string]any{"clientId": "member-tab", "ops": []collab.Op{tick}})
		}()
		go func() {
			defer wg.Done()
			doJSON(t, f.ts, http.MethodPatch, "/api/v1/thoughts/"+f.taskID, f.ownerTok, map[string]any{"isCompleted": !inNote})
		}()
		wg.Wait()
		if task, b := f.task(t), f.block(t, f.main); task.IsCompleted != b.Props.Checked {
			t.Errorf("round %d: task done=%v, to-do checked=%v", round, task.IsCompleted, b.Props.Checked)
		}
	}
}
