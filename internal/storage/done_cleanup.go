package storage

import (
	"database/sql"
	"strings"
	"time"
)

// Completed tasks move to the task trash (task_trash.go) a while after they were ticked off, so the
// "Erledigt" tab does not fill up for good. Every user chooses the delay (done_retention_days, see
// retention.go); for tasks in a task list the owner's choice counts, for personal tasks the user's own.
// thoughts.completed_at is kept by two triggers, so every way of completing a task (app, Kanban, note
// checkbox, API) sets it.

const DefaultDoneRetentionDays = 30

func (s *Store) migrateDoneCleanup() error {
	if err := s.addColumnIfMissing("users", "done_retention_days", "INTEGER NOT NULL DEFAULT 30"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("thoughts", "completed_at", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return s.execInTx(
		// Tasks completed before this update count from now on, so nothing disappears at once
		stmt(`UPDATE thoughts SET completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE is_completed = 1 AND completed_at = ''`),
		stmt(`CREATE TRIGGER IF NOT EXISTS trg_thoughts_completed AFTER UPDATE OF is_completed ON thoughts
			WHEN NEW.is_completed != OLD.is_completed BEGIN
				UPDATE thoughts SET completed_at = CASE WHEN NEW.is_completed = 1 THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE '' END
				WHERE id = NEW.id;
			END`),
		stmt(`CREATE TRIGGER IF NOT EXISTS trg_thoughts_completed_insert AFTER INSERT ON thoughts
			WHEN NEW.is_completed = 1 AND NEW.completed_at = '' BEGIN
				UPDATE thoughts SET completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
			END`),
	)
}

// DoneRetentionDays: after how many days the user's completed tasks are deleted (0 = never).
func (s *Store) DoneRetentionDays(userID string) int {
	days := DefaultDoneRetentionDays
	logDBErr(s.db.QueryRow(`SELECT done_retention_days FROM users WHERE id = ?`, userID).Scan(&days))
	return days
}

// SetDoneRetentionDays stores one of RetentionChoices; other values are refused.
func (s *Store) SetDoneRetentionDays(userID string, days int) error {
	if !validRetention(days) {
		return ErrInvalidRetention
	}
	_, err := s.db.Exec(`UPDATE users SET done_retention_days = ? WHERE id = ?`, days, userID)
	return err
}

// DeletedTask: what callers need to tell everyone who saw a task that went to the trash.
type DeletedTask struct {
	ID, UserID, TaskListID string
}

// Completed tasks: a kept task, a converted task or a task linked to a note checkbox
const completedTaskSQL = `t.is_completed = 1 AND (t.status = 'kept' OR (t.status = 'converted' AND t.converted_type = 'task'))`

// PurgeExpiredDoneTasks moves completed tasks whose delay has run out at now into the task trash: the
// task list owner's delay, or the user's own for personal tasks. A note checkbox linked to such a task
// stays as a plain checkbox (the link lives on the task). Without allowNever, "never" counts as the
// default delay.
func (s *Store) PurgeExpiredDoneTasks(now time.Time, allowNever bool) ([]DeletedTask, error) {
	def := neverAs(allowNever, DefaultDoneRetentionDays)
	rows, err := s.db.Query(`
		SELECT t.id, t.user_id, t.task_list_id
		FROM thoughts t
		LEFT JOIN task_lists tl ON tl.id = t.task_list_id AND t.task_list_id != ''
		JOIN users u ON u.id = COALESCE(tl.user_id, t.user_id)
		WHERE `+completedTaskSQL+`
		  AND t.completed_at != '' AND `+daysSQL("u.done_retention_days")+` > 0
		  AND t.completed_at < strftime('%Y-%m-%dT%H:%M:%SZ', ?, '-' || `+daysSQL("u.done_retention_days")+` || ' days')`,
		def, sqlNow(now), def)
	if err != nil {
		return nil, err
	}
	return s.trashTaskRows(rows, "")
}

// ClearDoneTasks moves the completed tasks of one task list ("" = all lists the user can see) into the
// task trash, as far as the user may delete them: own personal tasks and tasks in lists they own or edit.
func (s *Store) ClearDoneTasks(userID, taskListID string) ([]DeletedTask, error) {
	if taskListID != "" {
		if err := s.ensureTaskListWritable(userID, taskListID); err != nil {
			return nil, err
		}
		rows, err := s.db.Query(`SELECT t.id, t.user_id, t.task_list_id FROM thoughts t
			WHERE `+completedTaskSQL+` AND t.task_list_id = ?`, taskListID)
		if err != nil {
			return nil, err
		}
		return s.trashTaskRows(rows, userID)
	}
	lists, err := s.GetTaskLists(userID)
	if err != nil {
		return nil, err
	}
	writable := []any{userID}
	marks := []string{}
	for _, l := range lists {
		if l.Permission != "viewer" {
			writable = append(writable, l.ID)
			marks = append(marks, "?")
		}
	}
	inLists := ""
	if len(marks) > 0 {
		inLists = ` OR t.task_list_id IN (` + strings.Join(marks, ",") + `)`
	}
	rows, err := s.db.Query(`SELECT t.id, t.user_id, t.task_list_id FROM thoughts t
		WHERE `+completedTaskSQL+` AND ((t.user_id = ? AND t.task_list_id = '')`+inLists+`)`, writable...)
	if err != nil {
		return nil, err
	}
	return s.trashTaskRows(rows, userID)
}

// trashTaskRows moves the tasks the query rows name into the task trash and returns them.
func (s *Store) trashTaskRows(rows *sql.Rows, byUserID string) ([]DeletedTask, error) {
	var out []DeletedTask
	for rows.Next() {
		var d DeletedTask
		if err := rows.Scan(&d.ID, &d.UserID, &d.TaskListID); err != nil {
			_ = rows.Close()
			return nil, err
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	_ = rows.Close()
	for _, d := range out {
		if err := s.trashTask(d.ID, byUserID); err != nil {
			return nil, err
		}
	}
	return out, nil
}
