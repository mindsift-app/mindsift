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

// openSuccessors are the open next occurrences spawned from a task (recurrence_of). A deleted one is in
// the task trash, not in thoughts, and a completed one does not count.
func (s *Store) openSuccessors(taskID string) []string {
	return s.queryUserIDs(`SELECT id FROM thoughts WHERE recurrence_of = ? AND is_completed = 0 AND status != 'discarded'`, taskID)
}

// spawnNextOccurrence creates the follow-up of a repeating task that was just completed: same title,
// tags, priority, notes, list, assignees and rule, subtasks unchecked, due date one interval later,
// in the list's first open column, linked to the task (recurrence_of). It spawns whenever the task is
// completed and has no open successor: re-opening and completing it again creates no second one, while
// a successor deleted or completed meanwhile (or a rule set again after it was removed) lets the series
// go on. The new task goes to OnTaskCreated (live update for all clients).
func (s *Store) spawnNextOccurrence(taskID string) {
	s.recurrenceMu.Lock()
	defer s.recurrenceMu.Unlock()
	t, err := s.getThoughtRaw(taskID)
	if err != nil || t.Recurrence == "" || !t.IsCompleted {
		return
	}
	if len(s.openSuccessors(taskID)) > 0 {
		return
	}

	column := statusColumn(s.listColumns(t.TaskListID), false, "")
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
	carry := []sqlStmt{stmt(`UPDATE thoughts SET recurrence = ?, reminders = ?, sort_order = ?, recurrence_of = ? WHERE id = ?`,
		t.Recurrence, domain.FormatReminders(t.Reminders), t.SortOrder, taskID, next.ID)}
	for _, uid := range t.Assignees {
		carry = append(carry, stmt(`INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, ?)`, next.ID, uid, domain.NowISO()))
	}
	if err := s.execInTx(carry...); err != nil {
		slog.Error("Next occurrence: repeat, reminders and assignees not carried over", "task_id", next.ID, "error", err)
	}
	s.pruneTaskAssigneesOf(next.ID)

	if created, err := s.getThoughtRaw(next.ID); err == nil && s.OnTaskCreated != nil {
		s.OnTaskCreated(created)
	}
}

// dropUntouchedSuccessor undoes the next occurrence a repeating task spawned when it is reopened (a tick
// by mistake, undone): its open successor is deleted for good as long as nobody touched it, i.e. it still
// is what spawnNextOccurrence made of the task as it is now (title, notes, priority, list, rule,
// reminders, due date, first open column, subtasks unchecked). A successor edited, moved or with a
// subtask ticked stays. Ticking the task again spawns a fresh one, so tick, untick, tick leaves one.
// The removed task goes to OnTaskRemoved (live update for all clients).
func (s *Store) dropUntouchedSuccessor(taskID string) {
	s.recurrenceMu.Lock()
	defer s.recurrenceMu.Unlock()
	t, err := s.getThoughtRaw(taskID)
	if err != nil || t.IsCompleted || t.Recurrence == "" {
		return
	}
	for _, id := range s.openSuccessors(taskID) {
		next, err := s.getThoughtRaw(id)
		if err != nil || !s.untouchedSuccessor(t, next) {
			continue
		}
		if err := s.execInTx(
			stmt(`DELETE FROM task_assignees WHERE task_id = ?`, id),
			stmt(`DELETE FROM task_watchers WHERE task_id = ?`, id),
			stmt(`DELETE FROM thoughts WHERE id = ? AND is_completed = 0`, id),
		); err != nil {
			slog.Error("Removing the next occurrence of a reopened task failed", "task_id", id, "error", err)
			continue
		}
		if s.OnTaskRemoved != nil {
			s.OnTaskRemoved(next)
		}
	}
}

// untouchedSuccessor: next is still what spawnNextOccurrence made of t.
func (s *Store) untouchedSuccessor(t, next *domain.Thought) bool {
	if next.IsCompleted || next.Content != t.Content || next.Notes != t.Notes || next.Priority != t.Priority ||
		next.TaskListID != t.TaskListID || next.Recurrence != t.Recurrence ||
		domain.FormatReminders(next.Reminders) != domain.FormatReminders(t.Reminders) ||
		next.KanbanStatus != statusColumn(s.listColumns(t.TaskListID), false, "") {
		return false
	}
	created, err := time.Parse(time.RFC3339, next.CreatedAt)
	if err != nil || next.DueDate != NextDueDate(t.DueDate, t.Recurrence, created) {
		return false
	}
	if len(next.Subtasks) != len(t.Subtasks) {
		return false
	}
	for i, st := range next.Subtasks {
		if st.IsCompleted || st.Title != t.Subtasks[i].Title {
			return false
		}
	}
	return true
}
