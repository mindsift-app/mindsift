package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Deleted tasks go to a trash first: deleting a task, "Erledigte leeren" and the automatic clean-up of
// completed tasks. The task leaves the thoughts table with its whole row and its assignees kept as a
// copy (trashed_tasks), so no query on tasks has to know about the trash; restoring puts the row back
// as it was. Everyone who sees a task list sees its trashed tasks; restoring and deleting for good need
// edit rights, like changing the list. The delay of the list owner (or of the user for personal tasks)
// empties the trash.

var ErrNotInTaskTrash = errors.New("Aufgabe nicht im Papierkorb")

// TrashedTask is one entry of the task trash.
type TrashedTask struct {
	ID          string `json:"id"`
	Content     string `json:"content"`
	TaskListID  string `json:"taskListId"`
	IsCompleted bool   `json:"isCompleted"`
	TrashedAt   string `json:"trashedAt"`
	TrashedBy   string `json:"trashedBy"` // display name
	CanEdit     bool   `json:"canEdit"`
}

// trashTasks moves tasks into the trash, each with its row and assignees, in one transaction per task.
func (s *Store) trashTasks(ids []string, byUserID string) error {
	for _, id := range ids {
		if err := s.trashTask(id, byUserID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) trashTask(id, byUserID string) error {
	rows, err := s.db.Query(`SELECT * FROM thoughts WHERE id = ?`, id)
	if err != nil {
		return err
	}
	cols, _ := rows.Columns()
	data := map[string]any{}
	found := false
	if rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			_ = rows.Close()
			return err
		}
		for i, c := range cols {
			if b, ok := vals[i].([]byte); ok {
				data[c] = string(b)
			} else {
				data[c] = vals[i]
			}
		}
		found = true
	}
	_ = rows.Close()
	if !found {
		return nil
	}
	str := func(k string) string { v, _ := data[k].(string); return v }
	userID, listID := str("user_id"), str("task_list_id")
	owner := userID
	if listID != "" {
		_ = s.db.QueryRow(`SELECT user_id FROM task_lists WHERE id = ?`, listID).Scan(&owner)
	}
	done := false
	switch v := data["is_completed"].(type) {
	case int64:
		done = v == 1
	}
	assignees := s.queryUserIDs(`SELECT user_id FROM task_assignees WHERE task_id = ?`, id)
	dataJSON, _ := json.Marshal(data)
	assJSON, _ := json.Marshal(assignees)
	return s.execInTx(
		stmt(`INSERT OR REPLACE INTO trashed_tasks (id, user_id, task_list_id, owner_id, content, is_completed, data, assignees, trashed_at, trashed_by)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, userID, listID, owner, str("content"), boolInt(done), string(dataJSON), string(assJSON), domain.NowISO(), byUserID),
		stmt(`DELETE FROM thoughts WHERE id = ?`, id),
	)
}

// taskTrashScope: entries the user can see: own personal tasks and tasks of lists they can see.
const taskTrashScope = `((tt.user_id = ? AND tt.task_list_id = '') OR tt.task_list_id IN (` + accessibleTaskListsSQL + `))`

func taskTrashArgs(userID string) []any {
	return append([]any{userID}, accessibleTaskListArgs(userID)...)
}

// GetTaskTrash lists the trashed tasks of one task list ("" = all the user can see), newest first.
func (s *Store) GetTaskTrash(userID, taskListID string) ([]TrashedTask, error) {
	q := `SELECT tt.id, tt.content, tt.task_list_id, tt.is_completed, tt.trashed_at, COALESCE(u.display_name, '')
		FROM trashed_tasks tt LEFT JOIN users u ON u.id = tt.trashed_by
		WHERE ` + taskTrashScope
	args := taskTrashArgs(userID)
	if taskListID != "" {
		q += ` AND tt.task_list_id = ?`
		args = append(args, taskListID)
	}
	rows, err := s.db.Query(q+` ORDER BY tt.trashed_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrashedTask{}
	for rows.Next() {
		var t TrashedTask
		var done int
		if rows.Scan(&t.ID, &t.Content, &t.TaskListID, &done, &t.TrashedAt, &t.TrashedBy) == nil {
			t.IsCompleted = done == 1
			out = append(out, t)
		}
	}
	for i := range out {
		out[i].CanEdit = out[i].TaskListID == "" || s.CanEditTaskList(userID, out[i].TaskListID)
	}
	return out, nil
}

// trashedTaskFor loads an entry the user may restore or delete.
func (s *Store) trashedTaskFor(userID, id string) (data map[string]any, assignees []string, listID string, err error) {
	var raw, rawAss, owner string
	err = s.db.QueryRow(`SELECT tt.data, tt.assignees, tt.task_list_id, tt.user_id FROM trashed_tasks tt WHERE tt.id = ? AND `+taskTrashScope,
		append([]any{id}, taskTrashArgs(userID)...)...).Scan(&raw, &rawAss, &listID, &owner)
	if err == sql.ErrNoRows {
		return nil, nil, "", ErrNotInTaskTrash
	}
	if err != nil {
		return nil, nil, "", err
	}
	if listID != "" && !s.CanEditTaskList(userID, listID) {
		return nil, nil, "", ErrTaskListReadOnly
	}
	_ = json.Unmarshal([]byte(raw), &data)
	_ = json.Unmarshal([]byte(rawAss), &assignees)
	for k, v := range data {
		if f, ok := v.(float64); ok && f == float64(int64(f)) {
			data[k] = int64(f) // JSON numbers come back as floats; the columns hold integers
		}
	}
	data["task_list_id"] = listID // a deleted list made it a personal task
	return data, assignees, listID, nil
}

// RestoreTrashedTask puts a task back where it was (a list deleted meanwhile: into its creator's own
// tasks, see DeleteTaskList). A
// completed task starts its delay anew, so the automatic clean-up does not take it again at once.
func (s *Store) RestoreTrashedTask(userID, id string) (*domain.Thought, error) {
	data, assignees, _, err := s.trashedTaskFor(userID, id)
	if err != nil {
		return nil, err
	}
	cols := map[string]bool{}
	rows, err := s.db.Query(`SELECT name FROM pragma_table_info('thoughts')`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c string
		if rows.Scan(&c) == nil {
			cols[c] = true
		}
	}
	_ = rows.Close()
	if done, ok := data["is_completed"].(int64); ok && done == 1 {
		data["completed_at"] = domain.NowISO()
	}
	names, marks, args := "", "", []any{}
	for k, v := range data {
		if !cols[k] || v == nil {
			continue
		}
		if names != "" {
			names += ", "
			marks += ", "
		}
		names += k
		marks += "?"
		args = append(args, v)
	}
	stmts := []sqlStmt{
		stmt(`INSERT INTO thoughts (`+names+`) VALUES (`+marks+`)`, args...),
		stmt(`DELETE FROM trashed_tasks WHERE id = ?`, id),
	}
	for _, uid := range assignees {
		stmts = append(stmts, stmt(`INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at)
			SELECT ?, id, ? FROM users WHERE id = ?`, id, domain.NowISO(), uid))
	}
	if err := s.execInTx(stmts...); err != nil {
		return nil, err
	}
	s.PruneTaskAssignees()
	return s.GetThoughtByIDUnchecked(id)
}

// PurgeTrashedTask deletes one trashed task for good.
func (s *Store) PurgeTrashedTask(userID, id string) error {
	if _, _, _, err := s.trashedTaskFor(userID, id); err != nil {
		return err
	}
	return s.purgeTrashedTasks([]string{id})
}

// EmptyTaskTrash deletes the trashed tasks of one list ("" = all the user may edit) for good.
func (s *Store) EmptyTaskTrash(userID, taskListID string) ([]string, error) {
	if taskListID != "" {
		if err := s.ensureTaskListWritable(userID, taskListID); err != nil {
			return nil, err
		}
	}
	items, err := s.GetTaskTrash(userID, taskListID)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, it := range items {
		if it.CanEdit {
			ids = append(ids, it.ID)
		}
	}
	return ids, s.purgeTrashedTasks(ids)
}

func (s *Store) purgeTrashedTasks(ids []string) error {
	for _, id := range ids {
		if err := s.execInTx(
			stmt(`DELETE FROM trashed_tasks WHERE id = ?`, id),
			stmt(`DELETE FROM task_watchers WHERE task_id = ?`, id),
		); err != nil {
			return err
		}
	}
	return nil
}

// purgeExpiredTaskTrash empties the task trash after the owner's delay (list owner, else the creator).
func (s *Store) purgeExpiredTaskTrash(now time.Time, allowNever bool) ([]string, error) {
	def := neverAs(allowNever, DefaultRetention.TaskTrash)
	rows, err := s.db.Query(`SELECT tt.id FROM trashed_tasks tt JOIN users u ON u.id = tt.owner_id
		WHERE `+daysSQL("u.task_trash_days")+` > 0
		  AND tt.trashed_at < strftime('%Y-%m-%dT%H:%M:%SZ', ?, '-' || `+daysSQL("u.task_trash_days")+` || ' days')`,
		def, sqlNow(now), def)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	_ = rows.Close()
	return ids, s.purgeTrashedTasks(ids)
}
