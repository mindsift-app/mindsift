package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// seedReorderBoard: a list of owner shared with ed as editor, with n open tasks in column "todo"
func seedReorderBoard(t *testing.T, store *Store, n int) (owner, ed *domain.User, listID string, ids []string) {
	t.Helper()
	openSharing(t, store)
	owner, _ = store.CreateUser("owner@example.com", "hash", "Owner", "member")
	ed, _ = store.CreateUser("ed@example.com", "hash", "Ed", "member")
	tl, err := store.CreateTaskList(owner.ID, "", "", "Board", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddTaskListShare(tl.ID, "user", ed.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		th, err := store.CreateThoughtWithDetails(owner.ID, fmt.Sprintf("Aufgabe %d", i), "normal", "manual", "", tl.ID, "todo", "")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.UpdateThoughtTriage(owner.ID, th.ID, "keep", "task", "", "", tl.ID); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, th.ID)
	}
	return owner, ed, tl.ID, ids
}

func reorderItems(ids []string, status func(i int) string) []domain.ThoughtReorderItem {
	items := make([]domain.ThoughtReorderItem, len(ids))
	for i, id := range ids {
		st := status(i)
		items[i] = domain.ThoughtReorderItem{ID: id, SortOrder: len(ids) - i, KanbanStatus: &st}
	}
	return items
}

func newFileStore(t *testing.T) *Store {
	t.Helper()
	store, err := NewStore(t.TempDir() + "/reorder.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

// A task deleted while the card was dragged no longer fails the whole move (load test: 197 of 198 moves
// in a busy shared list answered 404)
func TestReorderSkipsDeletedTasks(t *testing.T) {
	store := newFileStore(t)
	owner, ed, listID, ids := seedReorderBoard(t, store, 4)
	if err := store.DeleteThought(owner.ID, ids[1]); err != nil {
		t.Fatal(err)
	}
	items := reorderItems(append(ids, "th_unknown"), func(i int) string {
		if i == 0 {
			return "done"
		}
		return "todo"
	})
	res, err := store.ReorderTasksForUser(ed.ID, listID, items)
	if err != nil {
		t.Fatalf("move with a deleted task: %v", err)
	}
	if !slices.Equal(res.Skipped, []string{ids[1], "th_unknown"}) {
		t.Errorf("skipped = %v, want the deleted and the unknown ID", res.Skipped)
	}
	if len(res.Applied) != 3 || res.Applied[0].ID != ids[0] || !res.Applied[0].IsCompleted || res.Applied[0].KanbanStatus != "done" {
		t.Errorf("applied = %+v", res.Applied)
	}
	for _, id := range []string{ids[0], ids[2], ids[3]} {
		th, err := store.GetThoughtByID(ed.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		want := len(items) - slices.Index(ids, id)
		if th.SortOrder != want {
			t.Errorf("%s: sortOrder %d, want %d", th.Content, th.SortOrder, want)
		}
	}
	if th, _ := store.GetThoughtByID(ed.ID, ids[0]); !th.IsCompleted || th.KanbanStatus != "done" {
		t.Errorf("task moved into done: completed=%v status=%q", th.IsCompleted, th.KanbanStatus)
	}
	if !slices.Contains(res.Audience, owner.ID) || !slices.Contains(res.Audience, ed.ID) {
		t.Errorf("audience %v misses owner or editor", res.Audience)
	}

	// The same move again changes nothing and writes nothing
	again, err := store.ReorderTasksForUser(ed.ID, listID, items)
	if err != nil || again.Written != 0 {
		t.Fatalf("repeated move: written=%d err=%v", again.Written, err)
	}
}

func TestReorderStillChecksPermissions(t *testing.T) {
	store := newFileStore(t)
	owner, ed, listID, ids := seedReorderBoard(t, store, 2)
	viewer, _ := store.CreateUser("viewer@example.com", "hash", "Viewer", "member")
	stranger, _ := store.CreateUser("stranger@example.com", "hash", "Stranger", "member")
	if _, err := store.AddTaskListShare(listID, "user", viewer.ID, "viewer", owner.ID); err != nil {
		t.Fatal(err)
	}
	private, _ := store.CreateThoughtWithDetails(owner.ID, "Privat", "normal", "manual", "", "", "todo", "")
	items := reorderItems(ids, func(int) string { return "done" })

	if _, err := store.ReorderTasksForUser(viewer.ID, "", items); !errors.Is(err, ErrTaskListReadOnly) {
		t.Errorf("viewer: want ErrTaskListReadOnly, got %v", err)
	}
	if _, err := store.ReorderTasksForUser(stranger.ID, "", items); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("stranger: want sql.ErrNoRows, got %v", err)
	}
	privItems := reorderItems([]string{ids[0], private.ID}, func(int) string { return "done" })
	if _, err := store.ReorderTasksForUser(ed.ID, "", privItems); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("someone else's personal task: want sql.ErrNoRows, got %v", err)
	}
	// With the list of the move given, a task outside it is left alone (and looks like a deleted one)
	res, err := store.ReorderTasksForUser(ed.ID, listID, privItems)
	if err != nil || !slices.Equal(res.Skipped, []string{private.ID}) {
		t.Fatalf("task outside the list: skipped=%v err=%v", res.Skipped, err)
	}
	for _, id := range append(ids, private.ID) {
		th, _ := store.GetThoughtByID(owner.ID, id)
		if id != ids[0] && th.IsCompleted {
			t.Errorf("%s was changed by a refused move", th.Content)
		}
	}
}

// A task moved to another list while the card was dragged keeps its place there
func TestReorderSkipsTasksMovedToAnotherList(t *testing.T) {
	store := newFileStore(t)
	owner, _, listID, ids := seedReorderBoard(t, store, 2)
	other, _ := store.CreateTaskList(owner.ID, "", "", "Andere", "", "")
	if _, err := store.db.Exec(`UPDATE thoughts SET task_list_id = ?, sort_order = 7 WHERE id = ?`, other.ID, ids[1]); err != nil {
		t.Fatal(err)
	}
	res, err := store.applyTaskOrder(reorderItems(ids, func(int) string { return "todo" }), map[string]string{ids[0]: listID, ids[1]: listID})
	if err != nil || !slices.Equal(res.Skipped, []string{ids[1]}) {
		t.Fatalf("skipped=%v err=%v", res.Skipped, err)
	}
	if th, _ := store.GetThoughtByID(owner.ID, ids[1]); th.SortOrder != 7 {
		t.Errorf("moved task got sortOrder %d", th.SortOrder)
	}
}

// Queries and time of one move on a board with 200 tasks, as the app sends it (every task of the list).
// Before the rework the same move cost about 1,400 statements and 275 ms (72 ms of it holding the write
// lock): four to seven queries per task for the checks and three per task in the transaction.
func TestReorderCostWith200Tasks(t *testing.T) {
	store := newCountingStore(t)
	_, ed, listID, ids := seedReorderBoard(t, store, 200)
	const runs = 20
	var queries int64
	var total time.Duration
	for r := 0; r < runs; r++ {
		items := make([]domain.ThoughtReorderItem, len(ids))
		for i, id := range ids {
			st := "todo"
			if i == r {
				st = "done"
			}
			items[i] = domain.ThoughtReorderItem{ID: id, SortOrder: (i + r) % len(ids), KanbanStatus: &st}
		}
		queryCount.Store(0)
		start := time.Now()
		res, err := store.ReorderTasksForUser(ed.ID, listID, items)
		total += time.Since(start)
		queries += queryCount.Load()
		if err != nil || len(res.Applied) != len(ids) {
			t.Fatalf("move %d: applied %d, err %v", r, len(res.Applied), err)
		}
	}
	perMove := queries / runs
	t.Logf("200 tasks: %d statements and %v per move", perMove, total/runs)
	if perMove > 15 {
		t.Errorf("a move costs %d statements, want at most 15 (it must not grow with the number of tasks)", perMove)
	}
}

func TestGoneAsNotFound(t *testing.T) {
	store := newFileStore(t)
	_, err := store.db.Exec(`INSERT INTO task_assignees (task_id, user_id, created_at) VALUES ('th_gone', 'u', '')`)
	if err == nil {
		t.Fatal("insert for a missing task should fail its FOREIGN KEY check")
	}
	if !errors.Is(GoneAsNotFound(err), sql.ErrNoRows) {
		t.Errorf("FOREIGN KEY failure: want sql.ErrNoRows, got %v", GoneAsNotFound(err))
	}
	other := errors.New("disk full")
	if GoneAsNotFound(other) != other || GoneAsNotFound(nil) != nil {
		t.Error("other errors must pass unchanged")
	}
}

func TestToggleDeletedListItemIsNotFound(t *testing.T) {
	store := newFileStore(t)
	u, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	list, _ := store.CreateList(u.ID, "Einkauf", "", "shopping")
	item, err := store.CreateListItem(list.ID, "Milch", "", "", 0, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.DeleteListItem(item.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ToggleListItem(item.ID, true, u.ID, "Anna"); !errors.Is(err, ErrListItemNotFound) {
		t.Errorf("want ErrListItemNotFound, got %v", err)
	}
}
