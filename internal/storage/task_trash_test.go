package storage

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func inTaskTrash(s *Store, id string) bool {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM trashed_tasks WHERE id = ?`, id).Scan(&n)
	return n == 1
}

// Deleting a task, clearing completed ones and the automatic clean-up all go through the trash;
// restoring brings the task back with its fields and assignees.
func TestTaskTrashRoundTrip(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "trash.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	openSharing(t, s)
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := s.CreateUser("ben@example.com", "hash", "Ben", "member")
	carla, _ := s.CreateUser("carla@example.com", "hash", "Carla", "member")
	list, _ := s.CreateTaskList(anna.ID, "", "", "Haushalt", "", "")
	_, _ = s.AddTaskListShare(list.ID, "user", ben.ID, "editor", anna.ID)
	_, _ = s.AddTaskListShare(list.ID, "user", carla.ID, "viewer", anna.ID)

	task, _ := s.CreateThoughtWithDetails(anna.ID, "Fenster putzen #haus", "high", "manual", "2026-11-20", list.ID, "in_progress", "Innen und außen")
	if _, err := s.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "2026-11-20", list.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetTaskAssignees(anna.ID, task.ID, []string{ben.ID}); err != nil {
		t.Fatal(err)
	}
	before, _ := s.GetThoughtByIDUnchecked(task.ID)
	if ass := s.getTaskAssignees(task.ID); len(ass) != 1 {
		t.Fatalf("setup: assignee missing: %v", ass)
	}

	if err := s.DeleteThought(ben.ID, task.ID); err != nil {
		t.Fatal(err)
	}
	if exists(s, task.ID) || !inTaskTrash(s, task.ID) {
		t.Fatal("a deleted task should leave the list and wait in the trash")
	}
	// Everyone who sees the list sees the entry, only editors may act on it
	if items, _ := s.GetTaskTrash(carla.ID, list.ID); len(items) != 1 || items[0].CanEdit || items[0].TrashedBy != "Ben" {
		t.Fatalf("viewer should see the entry read-only: %+v", items)
	}
	if _, err := s.RestoreTrashedTask(carla.ID, task.ID); err == nil {
		t.Fatal("a viewer must not restore")
	}
	outsider, _ := s.CreateUser("dora@example.com", "hash", "Dora", "member")
	if items, _ := s.GetTaskTrash(outsider.ID, ""); len(items) != 0 {
		t.Fatalf("outsiders see nothing: %+v", items)
	}

	restored, err := s.RestoreTrashedTask(anna.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if inTaskTrash(s, task.ID) || restored.Content != before.Content || restored.Notes != before.Notes || restored.Priority != before.Priority ||
		restored.DueDate != before.DueDate || restored.TaskListID != list.ID || restored.KanbanStatus != before.KanbanStatus {
		t.Fatalf("restored task differs:\nbefore %+v\nafter  %+v", before, restored)
	}

	if ass := s.getTaskAssignees(task.ID); len(ass) != 1 || ass[0] != ben.ID {
		t.Fatalf("assignees should come back: %v", ass)
	}

	// Deleting for good
	_ = s.DeleteThought(anna.ID, task.ID)
	if err := s.PurgeTrashedTask(carla.ID, task.ID); err == nil {
		t.Fatal("a viewer must not delete for good")
	}
	if err := s.PurgeTrashedTask(anna.ID, task.ID); err != nil || inTaskTrash(s, task.ID) {
		t.Fatalf("purge failed: %v", err)
	}
}

// A restored completed task starts its delay anew; the clean-up then waits again.
func TestRestoredDoneTaskIsNotTrashedAgainAtOnce(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "again.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	id := doneTask(t, s, anna.ID, "", "alt", "2020-01-01T08:00:00Z")
	if moved, _ := s.PurgeExpiredDoneTasks(time.Now(), true); len(moved) != 1 || !inTaskTrash(s, id) {
		t.Fatalf("old completed task should be in the trash: %+v", moved)
	}
	if _, err := s.RestoreTrashedTask(anna.ID, id); err != nil {
		t.Fatal(err)
	}
	if moved, _ := s.PurgeExpiredDoneTasks(time.Now(), true); len(moved) != 0 || !exists(s, id) {
		t.Fatal("restored task must not go straight back to the trash")
	}
}

// Deleting a task list turns its trashed tasks into their creators' own, like its tasks.
func TestTaskTrashAfterListDeletion(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "listgone.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	openSharing(t, s)
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := s.CreateUser("ben@example.com", "hash", "Ben", "member")
	list, _ := s.CreateTaskList(anna.ID, "", "", "Projekt", "", "")
	_, _ = s.AddTaskListShare(list.ID, "user", ben.ID, "editor", anna.ID)
	task, _ := s.CreateThoughtWithDetails(ben.ID, "Bens Aufgabe", "normal", "manual", "", list.ID, "todo", "")
	_, _ = s.UpdateThoughtTriage(ben.ID, task.ID, "keep", "task", "", "", list.ID)
	_ = s.DeleteThought(ben.ID, task.ID)
	if err := s.DeleteTaskList(anna.ID, list.ID); err != nil {
		t.Fatal(err)
	}
	if items, _ := s.GetTaskTrash(ben.ID, ""); len(items) != 1 || items[0].TaskListID != "" {
		t.Fatalf("Ben should find his task in his own trash: %+v", items)
	}
	restored, err := s.RestoreTrashedTask(ben.ID, task.ID)
	if err != nil || restored.TaskListID != "" || restored.UserID != ben.ID {
		t.Fatalf("should come back as Ben's own task: %+v %v", restored, err)
	}
}

// Every area keeps its delay; older items count from the update on; "never" can be switched off.
func TestPurgeExpiredAreas(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "areas.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := s.CreateUser("ben@example.com", "hash", "Ben", "member")
	if r := s.RetentionOf(anna.ID, true); r != DefaultRetention {
		t.Fatalf("defaults: %+v", r)
	}
	if err := s.SetRetention(ben.ID, Retention{}, false); err != ErrRetentionNever {
		t.Fatalf("never must be refused when switched off: %v", err)
	}
	if err := s.SetRetention(ben.ID, Retention{DoneTasks: 12}, true); err != ErrInvalidRetention {
		t.Fatalf("only offered delays: %v", err)
	}
	if err := s.SetRetention(ben.ID, Retention{}, true); err != nil { // Ben keeps everything
		t.Fatal(err)
	}
	if r := s.RetentionOf(ben.ID, false); r != DefaultRetention {
		t.Fatalf("with never switched off Ben gets the defaults: %+v", r)
	}

	_, _ = s.db.Exec(`UPDATE system_settings SET value = '2026-01-01T00:00:00Z' WHERE key = 'retention_since'`)
	now := time.Date(2026, 12, 15, 12, 0, 0, 0, time.UTC)

	// Triage trash (14 days), timestamps before the update count from the update
	discard := func(user string, at string) string {
		th, _ := s.CreateThought(user, "weg", "normal", "manual", "")
		_, _ = s.UpdateThoughtTriage(user, th.ID, "discard", "", "", "", "")
		_, _ = s.db.Exec(`UPDATE thoughts SET triaged_at = ? WHERE id = ?`, at, th.ID)
		return th.ID
	}
	oldDiscard := discard(anna.ID, "2026-11-01T00:00:00Z")
	newDiscard := discard(anna.ID, "2026-12-10T00:00:00Z")
	benDiscard := discard(ben.ID, "2026-01-02T00:00:00Z")

	// Notes trash (30 days)
	doc, _ := s.CreateDocument(anna.ID, "", "Alte Notiz", "", "", nil, nil, false)
	_ = s.DeleteDocument(anna.ID, doc.ID)
	_, _ = s.db.Exec(`UPDATE documents SET archived_at = '2026-10-01T00:00:00Z' WHERE id = ?`, doc.ID)

	// Ticked-off list items (7 days, list owner)
	lst, _ := s.CreateList(anna.ID, "Einkauf", "🛒", "shopping")
	oldItem, _ := s.CreateListItem(lst.ID, "Milch", "", "", 0, anna.ID)
	freshItem, _ := s.CreateListItem(lst.ID, "Brot", "", "", 0, anna.ID)
	openItem, _ := s.CreateListItem(lst.ID, "Käse", "", "", 0, anna.ID)
	_, _ = s.ToggleListItem(oldItem.ID, true, anna.ID, "Anna")
	_, _ = s.ToggleListItem(freshItem.ID, true, anna.ID, "Anna")
	_, _ = s.db.Exec(`UPDATE list_items SET completed_at = '2026-12-01T00:00:00Z' WHERE id = ?`, oldItem.ID)
	_, _ = s.db.Exec(`UPDATE list_items SET completed_at = '2026-12-14T00:00:00Z' WHERE id = ?`, freshItem.ID)

	res, err := s.PurgeExpired(now, true)
	if err != nil {
		t.Fatal(err)
	}
	if exists(s, oldDiscard) || !exists(s, newDiscard) || !exists(s, benDiscard) || res.Discarded != 1 {
		t.Fatalf("triage trash wrong: %+v", res)
	}
	var docs int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE id = ?`, doc.ID).Scan(&docs)
	if docs != 0 || len(res.Notes) != 1 {
		t.Fatalf("old note should be gone: %+v", res)
	}
	itemExists := func(id string) bool {
		var n int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM list_items WHERE id = ?`, id).Scan(&n)
		return n == 1
	}
	if itemExists(oldItem.ID) || !itemExists(freshItem.ID) || !itemExists(openItem.ID) || len(res.ListItems) != 1 {
		t.Fatalf("list items wrong: %+v", res.ListItems)
	}

	// With "never" switched off, Ben's discarded thought (older than 14 days after the update) goes too
	if res, _ := s.PurgeExpired(now, false); exists(s, benDiscard) || res.Discarded != 1 {
		t.Fatalf("Ben's never should count as 14 days: %+v", res)
	}

	// Items from before the update count from the update: with a fresh update nothing old goes
	_, _ = s.db.Exec(`UPDATE system_settings SET value = '2026-12-14T00:00:00Z' WHERE key = 'retention_since'`)
	veryOld := discard(anna.ID, "2025-01-01T00:00:00Z")
	if _, _ = s.PurgeExpired(now, true); !exists(s, veryOld) {
		t.Fatal("things from before the update count from the update on")
	}
}

// Moving a card into a list's own done column (any ID) completes the task, other columns reopen it.
func TestReorderIntoCustomDoneColumn(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "donecol.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	list, _ := s.CreateTaskList(anna.ID, "", "", "Projekt", "", "")
	cols := []domain.KanbanColumn{{ID: "todo", Name: "Offen"}, {ID: "col_fertig", Name: "Fertig", IsDone: true}}
	if _, err := s.UpdateTaskList(anna.ID, list.ID, nil, nil, nil, nil, &cols); err != nil {
		t.Fatal(err)
	}
	task, _ := s.CreateThoughtWithDetails(anna.ID, "Bericht", "normal", "manual", "", list.ID, "todo", "")
	_, _ = s.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "", list.ID)
	done, open := "col_fertig", "todo"
	if err := s.ReorderTasks(list.ID, []domain.ThoughtReorderItem{{ID: task.ID, SortOrder: 0, KanbanStatus: &done}}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.GetThoughtByIDUnchecked(task.ID); !got.IsCompleted {
		t.Fatal("the list's done column should complete the task")
	}
	_ = s.ReorderTasks(list.ID, []domain.ThoughtReorderItem{{ID: task.ID, SortOrder: 0, KanbanStatus: &open}})
	if got, _ := s.GetThoughtByIDUnchecked(task.ID); got.IsCompleted {
		t.Fatal("an open column reopens it")
	}
}
