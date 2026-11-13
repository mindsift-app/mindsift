package storage

import (
	"errors"
	"log/slog"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// ErrInvalidRecurrence is returned for unknown repeat rules.
var ErrInvalidRecurrence = errors.New("Unbekannte Wiederholung (erlaubt: täglich, wöchentlich, monatlich, jährlich)")

func validRecurrence(r string) bool {
	switch r {
	case "", "daily", "weekly", "monthly", "yearly":
		return true
	}
	return false
}

// NextDueDate moves a due date (YYYY-MM-DD or YYYY-MM-DDTHH:MM, today when empty) one interval forward
// and keeps the time. Months and years keep the day where possible and fall back to the month's last
// day (31 Jan -> 28/29 Feb). today is an instant; its day counts in the server's time zone.
func NextDueDate(due, rule string, today time.Time) string {
	parsed, hasTime, ok := domain.ParseDue(due, clock.Location())
	today = clock.In(today)
	base := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	if ok {
		base = time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, time.UTC)
	}
	switch rule {
	case "daily":
		base = base.AddDate(0, 0, 1)
	case "weekly":
		base = base.AddDate(0, 0, 7)
	case "monthly":
		base = addMonthsClamped(base, 1)
	case "yearly":
		base = addMonthsClamped(base, 12)
	}
	if hasTime {
		return base.Format("2006-01-02") + parsed.Format("T15:04")
	}
	return base.Format("2006-01-02")
}

func addMonthsClamped(t time.Time, months int) time.Time {
	first := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, months, 0)
	last := first.AddDate(0, 1, -1).Day()
	day := t.Day()
	if day > last {
		day = last
	}
	return time.Date(first.Year(), first.Month(), day, 0, 0, 0, 0, time.UTC)
}

// SetTaskRecurrence changes the repeat rule of a task (editors of its list or its owner).
func (s *Store) SetTaskRecurrence(userID, taskID, rule string) error {
	if !validRecurrence(rule) {
		return ErrInvalidRecurrence
	}
	t, err := s.GetThoughtByID(userID, taskID)
	if err != nil {
		return err
	}
	if err := s.ensureTaskListWritable(userID, t.TaskListID); err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE thoughts SET recurrence = ? WHERE id = ?`, rule, taskID)
	return err
}

func (s *Store) getThoughtRaw(id string) (*domain.Thought, error) {
	t, err := scanThought(s.db.QueryRow(
		`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, reminders, `+originColumns("")+`
		 FROM thoughts WHERE id = ?`, id))
	if err != nil {
		return nil, err
	}
	t.Assignees = s.getTaskAssignees(t.ID)
	return t, nil
}

// spawnNextOccurrence creates the follow-up of a repeating task that was just completed: same title,
// tags, priority, notes, list, assignees and rule, subtasks unchecked, due date one interval later,
// in the list's first open column. Each task spawns at most once, so re-opening and completing it
// again creates no duplicate. The new task goes to OnTaskCreated (live update for all clients).
func (s *Store) spawnNextOccurrence(taskID string) {
	t, err := s.getThoughtRaw(taskID)
	if err != nil || t.Recurrence == "" || !t.IsCompleted {
		return
	}
	res, err := s.db.Exec(`UPDATE thoughts SET recurrence_spawned = 1 WHERE id = ? AND recurrence_spawned = 0`, taskID)
	if dbFailed(err) {
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return // already spawned its successor
	}

	column := "todo"
	if t.TaskListID != "" {
		if tl, err := s.GetTaskListByID(t.UserID, t.TaskListID); err == nil {
			for _, c := range tl.Columns {
				if !c.IsDone {
					column = c.ID
					break
				}
			}
		}
	}
	due := NextDueDate(t.DueDate, t.Recurrence, time.Now())
	next, err := s.CreateThoughtWithDetails(t.UserID, t.Content, t.Priority, t.Source, due, t.TaskListID, column, t.Notes)
	if err != nil {
		slog.Error("Creating the next occurrence failed", "task_id", taskID, "error", err)
		return
	}
	if _, err := s.UpdateThoughtTriage(t.UserID, next.ID, "keep", "task", "", due, t.TaskListID); err != nil {
		slog.Error("Filing the next occurrence as a task failed", "task_id", next.ID, "error", err)
		return
	}
	subs := make([]domain.SubTask, len(t.Subtasks))
	for i, st := range t.Subtasks {
		subs[i] = domain.SubTask{ID: domain.NewID("st"), Title: st.Title, CreatedAt: domain.NowISO()}
	}
	tags := t.Tags
	if _, err := s.UpdateThoughtDetails(t.UserID, next.ID, nil, nil, nil, nil, nil, &column, nil, &subs, &tags); err != nil {
		slog.Error("Next occurrence: subtasks and tags missing", "task_id", next.ID, "error", err)
	}
	carry := []sqlStmt{stmt(`UPDATE thoughts SET recurrence = ?, reminders = ?, sort_order = ? WHERE id = ?`, t.Recurrence, domain.FormatReminders(t.Reminders), t.SortOrder, next.ID)}
	for _, uid := range t.Assignees {
		carry = append(carry, stmt(`INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, ?)`, next.ID, uid, domain.NowISO()))
	}
	if err := s.execInTx(carry...); err != nil {
		slog.Error("Next occurrence: repeat, reminders and assignees not carried over", "task_id", next.ID, "error", err)
	}
	s.PruneTaskAssignees()

	if created, err := s.getThoughtRaw(next.ID); err == nil && s.OnTaskCreated != nil {
		s.OnTaskCreated(created)
	}
}
