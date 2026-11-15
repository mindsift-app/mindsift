package storage

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// linkedTodo: Anna's note with the to-do "Fenster putzen" linked to a task in her list "Haushalt",
// shared with Ben, both assigned.
type linkedTodo struct {
	s              *Store
	anna, ben      *domain.User
	docID, blockID string
	taskID         string
}

func newLinkedTodo(t *testing.T) linkedTodo {
	t.Helper()
	s, err := NewStore(filepath.Join(t.TempDir(), "linked.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := s.CreateUser("ben@example.com", "hash", "Ben", "member")
	org, _ := s.CreateOrganization("WG")
	for _, u := range []string{anna.ID, ben.ID} {
		if err := s.AddOrganizationMember(org.ID, u); err != nil {
			t.Fatal(err)
		}
	}
	tl, err := s.CreateTaskList(anna.ID, "", "", "Haushalt", "🏠", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddTaskListShare(tl.ID, "user", ben.ID, "editor", anna.ID); err != nil {
		t.Fatal(err)
	}
	doc, err := s.CreateDocument(anna.ID, "", "Wohnung", "🏠", "", []domain.DocumentBlock{{ID: "main", Type: "todo", Content: "Fenster putzen"}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.CreateTaskFromDocBlock(anna.ID, doc.ID, "main", "Fenster putzen", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateThoughtDetails(anna.ID, task.ID, nil, nil, nil, nil, &tl.ID, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if got, err := s.SetTaskAssignees(anna.ID, task.ID, []string{anna.ID, ben.ID}); err != nil || len(got) != 2 {
		t.Fatalf("assign: %v %v", got, err)
	}
	return linkedTodo{s: s, anna: anna, ben: ben, docID: doc.ID, blockID: "main", taskID: task.ID}
}

func (l linkedTodo) tick(t *testing.T, on bool) {
	t.Helper()
	edit(t, l.s, l.ben.ID, l.docID, func(d *collab.Doc) []collab.Op {
		return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpSetProps, BlockID: l.blockID, Patch: &collab.PropsPatch{Checked: &on}}}
	})
}

func (l linkedTodo) setText(t *testing.T, text string) {
	t.Helper()
	edit(t, l.s, l.ben.ID, l.docID, func(d *collab.Doc) []collab.Op {
		return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: l.blockID, BaseVersion: d.Blocks[l.blockID].Version, Content: &text}}
	})
}

func (l linkedTodo) task(t *testing.T) *domain.Thought {
	t.Helper()
	got, err := l.s.GetThoughtByID(l.anna.ID, l.taskID)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func (l linkedTodo) block(t *testing.T) *collab.Block {
	t.Helper()
	d, _, err := loadCollabDoc(l.s.db, l.docID)
	if err != nil {
		t.Fatal(err)
	}
	return d.Blocks[l.blockID]
}

// Ticked in the note while the task is renamed (between the reconcile's read and its write): only the
// tick is written, the new title stays, and the task sent out has the new title and its assignees.
func TestReconcileWritesOnlyWhatTheNoteChanged(t *testing.T) {
	l := newLinkedTodo(t)
	l.tick(t, true)
	changed, _ := l.s.ReconcileDocTaskLinksNotify(l.docID, func(c []TaskReconciled) ([]CenterAdd, []QueuedAdd) {
		if len(c) != 1 || !c[0].After.IsCompleted || len(c[0].After.Assignees) != 2 {
			t.Errorf("planned change: %+v", c)
		}
		// Someone renames the task in the task view right now
		l.s.execLogged(`UPDATE thoughts SET content = 'Alle Fenster putzen' WHERE id = ?`, l.taskID)
		return nil, nil
	})
	got := l.task(t)
	if !got.IsCompleted || got.KanbanStatus != "done" || got.Content != "Alle Fenster putzen" {
		t.Fatalf("task after tick and rename: done=%v status=%q content=%q", got.IsCompleted, got.KanbanStatus, got.Content)
	}
	if len(changed) != 1 || changed[0].After.Content != "Alle Fenster putzen" || !changed[0].After.IsCompleted {
		t.Fatalf("the task sent out should be the stored one: %+v", changed)
	}
	if !slices.Contains(changed[0].After.Assignees, l.ben.ID) || len(changed[0].After.Assignees) != 2 {
		t.Fatalf("the task sent out should carry its assignees: %v", changed[0].After.Assignees)
	}
}

// Changed in the task view while the to-do's text is edited: UpdateTask writes only the patched fields
// and answers with the stored state, the text from the note included.
func TestUpdateTaskWritesOnlyThePatch(t *testing.T) {
	l := newLinkedTodo(t)
	before := l.task(t)
	l.setText(t, "Fenster und Rahmen putzen")
	l.s.ReconcileDocTaskLinks(l.docID) // the note's text reaches the task after before was read
	done := true
	updated, _, err := l.s.UpdateTask(l.anna.ID, before, ThoughtPatch{IsCompleted: &done}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Content != "Fenster und Rahmen putzen" || !updated.IsCompleted || len(updated.Assignees) != 2 {
		t.Fatalf("answer: %+v", updated)
	}
	if got := l.task(t); got.Content != "Fenster und Rahmen putzen" || !got.IsCompleted {
		t.Fatalf("stored: content %q done %v", got.Content, got.IsCompleted)
	}
	// Only the tick goes into the note; the text there stays as typed
	if l.s.SyncTaskToDocFrom(l.anna.ID, updated, before) == "" {
		t.Fatal("the tick should reach the note")
	}
	if b := l.block(t); !b.Props.Checked || b.Content != "Fenster und Rahmen putzen" {
		t.Fatalf("to-do after completing: checked %v content %q", b.Props.Checked, b.Content)
	}
	// A deleted task: 404 instead of a silent no-op
	if err := l.s.DeleteThought(l.anna.ID, l.taskID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := l.s.UpdateTask(l.anna.ID, before, ThoughtPatch{IsCompleted: &done}, nil); err == nil {
		t.Fatal("updating a deleted task should fail")
	}
}

// SyncTaskToDocFrom with the state before: only what changed is carried over; without it everything.
func TestSyncTaskToDocFromCarriesOnlyChanges(t *testing.T) {
	l := newLinkedTodo(t)
	before := l.task(t)
	l.setText(t, "Fenster putzen (Küche)") // typed in the note, not yet in the task
	renamed := before.Clone()
	renamed.Content = "Fenster putzen (Bad)"
	l.s.SyncTaskToDocFrom(l.anna.ID, renamed, before)
	if b := l.block(t); b.Content != "Fenster putzen (Bad)" || b.Props.Checked {
		t.Fatalf("a rename should replace the text and leave the tick: %+v", b)
	}
	// Nothing changed from before: the note stays as it is
	l.setText(t, "Fenster putzen (Flur)")
	if l.s.SyncTaskToDocFrom(l.anna.ID, renamed, renamed) != "" {
		t.Fatal("no change, no note change")
	}
	if b := l.block(t); b.Content != "Fenster putzen (Flur)" {
		t.Fatalf("text overwritten without a change: %q", b.Content)
	}
	// Without before (SyncTaskToDoc): the whole task
	l.s.SyncTaskToDocFrom(l.anna.ID, renamed, nil)
	if b := l.block(t); b.Content != "Fenster putzen (Bad)" {
		t.Fatalf("full sync: %q", b.Content)
	}
}

// A repeating task ticked in its note repeats; unticked, its due alarm is armed again and its untouched
// next occurrence goes.
func TestReconcileRepeatsAndRearms(t *testing.T) {
	l := newLinkedTodo(t)
	if err := l.s.SetTaskRecurrence(l.anna.ID, l.taskID, "weekly"); err != nil {
		t.Fatal(err)
	}
	due := "2026-11-20"
	if _, err := l.s.UpdateThoughtDetails(l.anna.ID, l.taskID, nil, nil, &due, nil, nil, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	var created []*domain.Thought
	l.s.OnTaskCreated = func(th *domain.Thought) { created = append(created, th) }
	l.s.execLogged(`UPDATE thoughts SET alarm_sent = 1 WHERE id = ?`, l.taskID)

	l.tick(t, true)
	l.s.ReconcileDocTaskLinks(l.docID)
	if len(created) != 1 || created[0].Content != "Fenster putzen" || created[0].DueDate != "2026-11-27" || len(created[0].Assignees) != 2 {
		t.Fatalf("next occurrence: %+v", created)
	}
	l.tick(t, false)
	l.s.ReconcileDocTaskLinks(l.docID)
	if got := l.task(t); got.IsCompleted || got.AlarmSent {
		t.Fatalf("reopened from the note: done %v alarm sent %v", got.IsCompleted, got.AlarmSent)
	}
	// Unticking removed the untouched occurrence, so ticking again spawns one: one open in the end
	l.tick(t, true)
	l.s.ReconcileDocTaskLinks(l.docID)
	if open := l.s.openSuccessors(l.taskID); len(created) != 2 || len(open) != 1 || open[0] != created[1].ID {
		t.Fatalf("ticked again: %d spawned, open %v", len(created), open)
	}
}

// Deleting the to-do unlinks the task; restoring it (undo) links it again. An explicitly unlinked task is
// not linked again.
func TestRelinkRestoredDocTasks(t *testing.T) {
	l := newLinkedTodo(t)
	del := func() {
		edit(t, l.s, l.ben.ID, l.docID, func(d *collab.Doc) []collab.Op {
			return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpDelete, BlockID: l.blockID}}
		})
	}
	restore := func() {
		edit(t, l.s, l.ben.ID, l.docID, func(d *collab.Doc) []collab.Op {
			return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpRestore, IDs: []string{l.blockID}}}
		})
	}
	del()
	if changed := l.s.ReconcileDocTaskLinks(l.docID); len(changed) != 1 || changed[0].After.DocID != "" {
		t.Fatalf("deleting the to-do should unlink: %+v", changed)
	}
	if links, _ := l.s.DocTaskLinks(l.docID); len(links) != 0 {
		t.Fatalf("no badge on a deleted to-do: %v", links)
	}
	restore()
	relinked := l.s.RelinkRestoredDocTasks(l.docID, []string{l.blockID})
	if len(relinked) != 1 || relinked[0].ID != l.taskID || relinked[0].DocID != l.docID || len(relinked[0].Assignees) != 2 {
		t.Fatalf("restored to-do: %+v", relinked)
	}
	if links, _ := l.s.DocTaskLinks(l.docID); links[l.blockID] != l.taskID {
		t.Fatalf("badge after restoring: %v", links)
	}

	// Unlinked on purpose, then deleted and restored: stays unlinked
	if err := l.s.UnlinkTaskFromDocBlock(l.anna.ID, l.taskID); err != nil {
		t.Fatal(err)
	}
	del()
	restore()
	if got := l.s.RelinkRestoredDocTasks(l.docID, []string{l.blockID}); len(got) != 0 {
		t.Fatalf("an unlinked task came back: %+v", got)
	}
}

// Tasks loaded without access check carry their assignees (restore from the trash sends them out).
func TestGetThoughtByIDUncheckedHasAssignees(t *testing.T) {
	l := newLinkedTodo(t)
	got, err := l.s.GetThoughtByIDUnchecked(l.taskID)
	if err != nil || len(got.Assignees) != 2 {
		t.Fatalf("assignees: %+v %v", got, err)
	}
	if err := l.s.DeleteThought(l.anna.ID, l.taskID); err != nil {
		t.Fatal(err)
	}
	restored, err := l.s.RestoreTrashedTask(l.anna.ID, l.taskID)
	if err != nil || len(restored.Assignees) != 2 || restored.DocID != l.docID {
		t.Fatalf("restored: %+v %v", restored, err)
	}
}
