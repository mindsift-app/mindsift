package storage

import (
	"errors"
	"strconv"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Who hears about tasks: task lists a person muted, and the due alarm per person. A task in a shared list
// alarms the people assigned to it, or every member when nobody is; a personal task (or one in a list
// nobody else sees) alarms its owner. "Sent" is kept per person; thoughts.alarm_sent says that someone got
// it, and setting it back to 0 (new due date, reopened) clears the per-person rows through a trigger.

func (s *Store) migrateTaskAlerts() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS task_list_mutes (
			user_id TEXT NOT NULL,
			task_list_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (user_id, task_list_id)
		)`),
		stmt(`CREATE TABLE IF NOT EXISTS task_alarms_sent (
			task_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			sent INTEGER NOT NULL DEFAULT 0,
			failures INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (task_id, user_id)
		)`),
		stmt(`CREATE TRIGGER IF NOT EXISTS task_alarm_rearm AFTER UPDATE OF alarm_sent ON thoughts
			WHEN OLD.alarm_sent = 1 AND NEW.alarm_sent = 0
			BEGIN DELETE FROM task_alarms_sent WHERE task_id = NEW.id; END`),
		// Alarms sent before count as sent to everyone, so an update does not alarm the other members again
		stmt(`INSERT OR IGNORE INTO task_alarms_sent (task_id, user_id, sent) SELECT id, ?, 1 FROM thoughts WHERE alarm_sent = 1`, alarmSentToAll),
	)
}

// alarmSentToAll marks a task whose alarm went out before alarms were kept per person
const alarmSentToAll = "*"

// IsTaskListMuted: the person muted the shared task list (no list-wide notifications from it).
func (s *Store) IsTaskListMuted(userID, listID string) bool {
	var n int
	logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM task_list_mutes WHERE user_id = ? AND task_list_id = ?`, userID, listID).Scan(&n))
	return n > 0
}

// MutedTaskListIDs: the task lists the person muted.
func (s *Store) MutedTaskListIDs(userID string) map[string]bool {
	out := map[string]bool{}
	for _, id := range s.queryUserIDs(`SELECT task_list_id FROM task_list_mutes WHERE user_id = ?`, userID) {
		out[id] = true
	}
	return out
}

// SetTaskListMuted mutes or unmutes a task list the person can see.
func (s *Store) SetTaskListMuted(userID, listID string, muted bool) error {
	if s.GetTaskListPermission(userID, listID) == "" {
		return ErrTaskListNotFound
	}
	if !muted {
		_, err := s.db.Exec(`DELETE FROM task_list_mutes WHERE user_id = ? AND task_list_id = ?`, userID, listID)
		return err
	}
	_, err := s.db.Exec(`INSERT OR IGNORE INTO task_list_mutes (user_id, task_list_id, created_at) VALUES (?, ?, ?)`,
		userID, listID, time.Now().UTC().Format(time.RFC3339))
	return err
}

// ErrTaskListNotFound: the task list does not exist or the person has no access.
var ErrTaskListNotFound = errors.New("Aufgabenliste nicht gefunden oder kein Zugriff")

// TaskAlarmRecipients: who gets the due alarm of a task (assignees must be loaded).
func (s *Store) TaskAlarmRecipients(t *domain.Thought) []string {
	if t.TaskListID == "" {
		return []string{t.UserID}
	}
	members := s.GetTaskListUserIDs(t.TaskListID)
	if len(members) <= 1 {
		return members
	}
	if len(t.Assignees) > 0 {
		member := map[string]bool{}
		for _, id := range members {
			member[id] = true
		}
		var out []string
		for _, id := range t.Assignees {
			if member[id] {
				out = append(out, id)
			}
		}
		return out
	}
	var out []string
	for _, id := range members {
		if !s.IsTaskListMuted(id, t.TaskListID) {
			out = append(out, id)
		}
	}
	return out
}

// GetDueTasksForAlarm returns one entry per task, recipient and reminder whose alarm is still pending: the
// task's own reminders, or the person's lead time when it has none. Whether its time has come (due date
// minus NotifyBeforeMinutes) is decided by the caller.
func (s *Store) GetDueTasksForAlarm() ([]DueTaskAlarm, error) {
	rows, err := s.db.Query(
		`SELECT id, user_id, content, notes, due_date, priority, task_list_id, reminders
		 FROM thoughts
		 WHERE (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))
		   AND is_completed = 0
		   AND due_date != ''
		   AND id NOT IN (SELECT task_id FROM task_alarms_sent WHERE user_id = ?)`, alarmSentToAll)
	if err != nil {
		return []DueTaskAlarm{}, err
	}
	var tasks []domain.Thought
	for rows.Next() {
		var t domain.Thought
		var reminders string
		if err := rows.Scan(&t.ID, &t.UserID, &t.Content, &t.Notes, &t.DueDate, &t.Priority, &t.TaskListID, &reminders); err != nil {
			_ = rows.Close()
			return []DueTaskAlarm{}, err
		}
		t.Reminders = domain.ParseReminders(reminders)
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		return []DueTaskAlarm{}, err
	}
	rows.Close()
	if len(tasks) == 0 {
		return []DueTaskAlarm{}, nil
	}

	done := map[string]bool{}
	sentRows, err := s.db.Query(`SELECT task_id, user_id, reminder FROM task_alarms_sent WHERE sent = 1`)
	if err != nil {
		return []DueTaskAlarm{}, err // not knowing what went out already must not send it all again
	}
	for sentRows.Next() {
		var taskID, userID string
		var reminder int
		if err := sentRows.Scan(&taskID, &userID, &reminder); err != nil {
			_ = sentRows.Close()
			return []DueTaskAlarm{}, err
		}
		done[sentKey(taskID, userID, reminder)] = true
	}
	if err := sentRows.Err(); err != nil {
		return []DueTaskAlarm{}, err
	}
	sentRows.Close()

	users := map[string]*DueTaskAlarm{}
	alarms := make([]DueTaskAlarm, 0)
	for i := range tasks {
		t := &tasks[i]
		t.Assignees = s.getTaskAssignees(t.ID)
		reminders := t.Reminders
		if len(reminders) == 0 {
			reminders = []int{ReminderLeadTime}
		}
		for _, uid := range s.TaskAlarmRecipients(t) {
			u, ok := users[uid]
			if !ok {
				u = s.alarmUser(uid)
				users[uid] = u
			}
			if u == nil {
				continue
			}
			for _, reminder := range reminders {
				if done[sentKey(t.ID, uid, reminder)] {
					continue
				}
				a := *u
				a.TaskID, a.Title, a.Notes, a.DueDate, a.Priority = t.ID, t.Content, t.Notes, t.DueDate, t.Priority
				a.Reminder = reminder
				if reminder != ReminderLeadTime {
					a.NotifyBeforeMinutes = reminder
				}
				alarms = append(alarms, a)
			}
		}
	}
	return alarms, nil
}

func sentKey(taskID, userID string, reminder int) string {
	return taskID + "|" + userID + "|" + strconv.Itoa(reminder)
}

// alarmUser: the channels and addresses of an active person, nil for a missing or deactivated account.
func (s *Store) alarmUser(userID string) *DueTaskAlarm {
	var a DueTaskAlarm
	var channelsRaw string
	var active bool
	err := s.db.QueryRow(
		`SELECT id, email, display_name, alarm_channels, alarm_email, discord_webhook_url, custom_webhook_url, notify_before_minutes, is_active
		 FROM users WHERE id = ?`, userID,
	).Scan(&a.UserID, &a.UserEmail, &a.UserName, &channelsRaw, &a.AlarmEmail, &a.DiscordWebhookURL, &a.CustomWebhookURL, &a.NotifyBeforeMinutes, &active)
	if err != nil || !active {
		return nil
	}
	a.AlarmChannels = parseAlarmChannels(channelsRaw)
	if a.AlarmEmail == "" {
		a.AlarmEmail = a.UserEmail
	}
	return &a
}

// MarkTaskAlarmSent records that the person got the alarm of one reminder (ReminderLeadTime: the
// alarm at their lead time).
func (s *Store) MarkTaskAlarmSent(taskID, userID string, reminder int) error {
	return s.execInTx(
		stmt(`INSERT INTO task_alarms_sent (task_id, user_id, reminder, sent, failures) VALUES (?, ?, ?, 1, 0)
			ON CONFLICT(task_id, user_id, reminder) DO UPDATE SET sent = 1, failures = 0`, taskID, userID, reminder),
		stmt(`UPDATE thoughts SET alarm_sent = 1 WHERE id = ?`, taskID),
	)
}

// MaxAlarmFailures: after this many runs in which no channel delivered, the alarm is given up instead of
// being retried every minute. A new due date or reopening the task starts over.
const MaxAlarmFailures = 3

// RecordTaskAlarmFailure counts a run in which no channel reached the person and reports whether their
// alarm was given up now.
func (s *Store) RecordTaskAlarmFailure(taskID, userID string, reminder int) (gaveUp bool, err error) {
	var failures int
	err = s.db.QueryRow(`INSERT INTO task_alarms_sent (task_id, user_id, reminder, sent, failures) VALUES (?, ?, ?, 0, 1)
		ON CONFLICT(task_id, user_id, reminder) DO UPDATE SET failures = failures + 1
		RETURNING failures`, taskID, userID, reminder).Scan(&failures)
	if err != nil {
		return false, err
	}
	gaveUp = failures >= MaxAlarmFailures
	if gaveUp {
		_, err = s.db.Exec(`UPDATE task_alarms_sent SET sent = 1 WHERE task_id = ? AND user_id = ? AND reminder = ?`, taskID, userID, reminder)
	}
	// Someone has an entry now: a new due date or reopening clears it again
	s.execLogged(`UPDATE thoughts SET alarm_sent = 1 WHERE id = ?`, taskID)
	return gaveUp, err
}

// taskAlarmFailures: failed runs for one person at their lead time (tests).
func (s *Store) taskAlarmFailures(taskID, userID string) int {
	var n int
	logDBErr(s.db.QueryRow(`SELECT failures FROM task_alarms_sent WHERE task_id = ? AND user_id = ? AND reminder = -1`, taskID, userID).Scan(&n))
	return n
}
