package storage

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// reorderChunk: tasks per statement when a move is read or written in batches (four values per task stay
// far below SQLite's limit of bound parameters)
const reorderChunk = 250

// TaskReorderResult is what a drag & drop move changed.
type TaskReorderResult struct {
	// Applied: every task of the move that still exists, in the order of the request, with its place as
	// stored now (unchanged ones included)
	Applied []domain.TaskOrder
	// Skipped: IDs left out because the task no longer exists or is no longer in the list of the move
	Skipped []string
	// Written: rows whose place actually changed
	Written int
	// Audience: everyone who sees one of the moved tasks (owners and everyone with access to their lists)
	Audience []string
	// Spawned: a repeating task was completed and got its next occurrence (a new task the move does not
	// list). Reopened, its untouched occurrence goes with TASK_DELETED (OnTaskRemoved).
	Spawned bool
}

// ReorderTasks writes a move without checking permissions (callers check them first).
func (s *Store) ReorderTasks(taskListID string, items []domain.ThoughtReorderItem) error {
	_, err := s.applyTaskOrder(uniqueReorderItems(items), nil)
	return err
}

// ReorderTasksForUser applies a drag & drop move of userID. With a taskListID only tasks in that list are
// moved; the caller has checked that userID may edit it. Without one (the view of all tasks) each list
// that occurs is checked once: a task the user cannot see answers sql.ErrNoRows, one in a list they may
// only read ErrTaskListReadOnly, and then nothing is written. Tasks that no longer exist (deleted while the
// card was dragged) or that have left the list of the move are skipped instead of failing the move.
func (s *Store) ReorderTasksForUser(userID, taskListID string, items []domain.ThoughtReorderItem) (*TaskReorderResult, error) {
	items = uniqueReorderItems(items)
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	type owner struct{ userID, listID string }
	found := make(map[string]owner, len(ids))
	err := forChunks(ids, func(chunk []string) error {
		rows, err := s.db.Query(`SELECT id, user_id, task_list_id FROM thoughts WHERE id IN (`+marks(len(chunk))+`)`, anys(chunk)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var o owner
			if err := rows.Scan(&id, &o.userID, &o.listID); err != nil {
				return err
			}
			found[id] = o
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	perms := map[string]string{}
	expected := make(map[string]string, len(found)) // task -> the list it was checked in
	var keep []domain.ThoughtReorderItem
	var skipped []string
	for _, it := range items {
		o, ok := found[it.ID]
		if !ok || (taskListID != "" && o.listID != taskListID) {
			// Gone, or no longer (or never) in the list of the move: left alone either way, and a foreign
			// task looks the same as a deleted one
			skipped = append(skipped, it.ID)
			continue
		}
		if taskListID == "" {
			if o.listID == "" {
				if o.userID != userID {
					return nil, sql.ErrNoRows
				}
			} else {
				p, ok := perms[o.listID]
				if !ok {
					p = s.GetTaskListPermission(userID, o.listID)
					perms[o.listID] = p
				}
				if p == "" && o.userID != userID {
					return nil, sql.ErrNoRows
				}
				if p != "owner" && p != "editor" {
					return nil, ErrTaskListReadOnly
				}
			}
		}
		expected[it.ID] = o.listID
		keep = append(keep, it)
	}

	res, err := s.applyTaskOrder(keep, expected)
	if err != nil {
		return nil, err
	}
	res.Skipped = append(skipped, res.Skipped...)

	audience := []string{userID}
	seenList := map[string]bool{}
	seenOwner := map[string]bool{userID: true}
	for _, a := range res.Applied {
		o := found[a.ID]
		if !seenOwner[o.userID] {
			seenOwner[o.userID] = true
			audience = append(audience, o.userID)
		}
		if o.listID != "" && !seenList[o.listID] {
			seenList[o.listID] = true
			audience = append(audience, s.GetTaskListUserIDs(o.listID)...)
		}
	}
	res.Audience = audience
	return res, nil
}

// applyTaskOrder writes the places in one short transaction: one read of the tasks with the columns of
// their lists, then one UPDATE per batch for the rows that change. expected (task -> list) skips tasks that
// have moved to another list since they were checked; nil writes every task that exists.
func (s *Store) applyTaskOrder(items []domain.ThoughtReorderItem, expected map[string]string) (*TaskReorderResult, error) {
	res := &TaskReorderResult{Applied: []domain.TaskOrder{}}
	if len(items) == 0 {
		return res, nil
	}
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	type place struct {
		listID     string
		order      int
		status     string
		done       bool
		recurrence string
	}
	current := make(map[string]place, len(ids))
	columns := map[string][]domain.KanbanColumn{} // per list, parsed once
	err = forChunks(ids, func(chunk []string) error {
		rows, err := tx.Query(
			`SELECT t.id, t.task_list_id, t.sort_order, COALESCE(t.kanban_status, ''), t.is_completed, COALESCE(t.recurrence, ''),
			        COALESCE(tl.columns, '')
			 FROM thoughts t LEFT JOIN task_lists tl ON tl.id = t.task_list_id
			 WHERE t.id IN (`+marks(len(chunk))+`)`, anys(chunk)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id, raw string
			var p place
			if err := rows.Scan(&id, &p.listID, &p.order, &p.status, &p.done, &p.recurrence, &raw); err != nil {
				return err
			}
			current[id] = p
			if _, ok := columns[p.listID]; !ok {
				var cols []domain.KanbanColumn
				if raw != "" {
					_ = json.Unmarshal([]byte(raw), &cols)
				}
				columns[p.listID] = cols
			}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	type change struct {
		id     string
		order  int
		status string
		done   bool
	}
	var changes []change
	var completed []string // tasks that move into "done" now (repeating ones spawn their successor)
	var reopened []string  // repeating tasks that move out of "done" (their untouched successor goes)
	for _, it := range items {
		cur, ok := current[it.ID]
		if !ok {
			res.Skipped = append(res.Skipped, it.ID)
			continue
		}
		if expected != nil && cur.listID != expected[it.ID] {
			res.Skipped = append(res.Skipped, it.ID)
			continue
		}
		next := cur
		next.order = it.SortOrder
		if it.KanbanStatus != nil && *it.KanbanStatus != "" {
			next.status = *it.KanbanStatus
			next.done = doneColumn(columns[cur.listID], next.status)
		}
		res.Applied = append(res.Applied, domain.TaskOrder{ID: it.ID, SortOrder: next.order, KanbanStatus: next.status, IsCompleted: next.done})
		if next == cur {
			continue
		}
		changes = append(changes, change{it.ID, next.order, next.status, next.done})
		if next.done && !cur.done {
			completed = append(completed, it.ID)
			if cur.recurrence != "" {
				res.Spawned = true
			}
		} else if !next.done && cur.done && cur.recurrence != "" {
			reopened = append(reopened, it.ID)
		}
	}

	for start := 0; start < len(changes); start += reorderChunk {
		batch := changes[start:min(start+reorderChunk, len(changes))]
		args := make([]any, 0, 4*len(batch))
		for _, c := range batch {
			done := 0
			if c.done {
				done = 1
			}
			args = append(args, c.id, c.order, c.status, done)
		}
		// Only a reopened task (done -> open) gets its due alarm again; a move sends every task of the
		// touched columns, so resetting all open ones re-sent "due today" for each of them. thoughts.* on
		// the right-hand side are the values before this UPDATE.
		if _, err := tx.Exec(
			`WITH v(id, sort_order, kanban_status, is_completed) AS (VALUES `+strings.TrimSuffix(strings.Repeat("(?, ?, ?, ?), ", len(batch)), ", ")+`)
			 UPDATE thoughts SET sort_order = v.sort_order, kanban_status = v.kanban_status, is_completed = v.is_completed,
			   alarm_sent = CASE WHEN v.is_completed = 0 AND thoughts.is_completed = 1 THEN 0 ELSE thoughts.alarm_sent END,
			   alarm_failures = CASE WHEN v.is_completed = 0 AND thoughts.is_completed = 1 THEN 0 ELSE thoughts.alarm_failures END
			 FROM v WHERE thoughts.id = v.id`, args...); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	res.Written = len(changes)
	for _, id := range completed {
		s.spawnNextOccurrence(id, time.Time{})
	}
	for _, id := range reopened {
		s.dropUntouchedSuccessor(id)
	}
	return res, nil
}

// doneColumn: whether a Kanban column completes a task: the column of the task's list marked as done (its
// ID may be anything), else the default ID "done".
func doneColumn(cols []domain.KanbanColumn, column string) bool {
	for _, c := range cols {
		if c.ID == column {
			return c.IsDone
		}
	}
	return column == "done"
}

// statusColumn is the Kanban column a plain tick (done) or untick puts a task that now stands in column:
// ticked, it stays in a column marked as done, else goes to the last (right-most) one, else "done";
// reopened from a done column, it goes to the first open column, else "todo" (an open one stays).
func statusColumn(cols []domain.KanbanColumn, done bool, column string) string {
	if column != "" && doneColumn(cols, column) == done {
		return column
	}
	if done {
		for i := len(cols) - 1; i >= 0; i-- {
			if cols[i].IsDone {
				return cols[i].ID
			}
		}
		return "done"
	}
	for _, c := range cols {
		if !c.IsDone {
			return c.ID
		}
	}
	return "todo"
}

// listColumns are the board columns stored for a task list (nil: none, or no list), without an access
// check: for working out the status column of a task the caller may change.
func (s *Store) listColumns(listID string) []domain.KanbanColumn {
	if listID == "" {
		return nil
	}
	var raw string
	if err := s.db.QueryRow(`SELECT COALESCE(columns, '') FROM task_lists WHERE id = ?`, listID).Scan(&raw); err != nil {
		logDBErr(rowErr(err))
		return nil
	}
	var cols []domain.KanbanColumn
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &cols)
	}
	return cols
}

// uniqueReorderItems drops repeated IDs (the last place given wins, at the position it was first named).
func uniqueReorderItems(items []domain.ThoughtReorderItem) []domain.ThoughtReorderItem {
	at := make(map[string]int, len(items))
	out := make([]domain.ThoughtReorderItem, 0, len(items))
	for _, it := range items {
		if i, ok := at[it.ID]; ok {
			out[i] = it
			continue
		}
		at[it.ID] = len(out)
		out = append(out, it)
	}
	return out
}

func forChunks(ids []string, fn func([]string) error) error {
	for start := 0; start < len(ids); start += reorderChunk {
		if err := fn(ids[start:min(start+reorderChunk, len(ids))]); err != nil {
			return err
		}
	}
	return nil
}

// marks: n comma-separated placeholders for an IN list
func marks(n int) string {
	return strings.TrimSuffix(strings.Repeat("?, ", n), ", ")
}

func anys(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}
