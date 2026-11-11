package storage

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Notifications: per-user settings (JSON on the user), a queue that is sent bundled every few minutes,
// task watchers and the bookkeeping for the daily summary.

func (s *Store) migrateNotifications() error {
	if err := s.addColumnIfMissing("users", "notification_settings", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("users", "last_daily_summary", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS notification_queue (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			payload TEXT NOT NULL,
			created_at TEXT NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_notification_queue_user ON notification_queue(user_id, created_at)`),
		stmt(`CREATE TABLE IF NOT EXISTS task_watchers (
			task_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (task_id, user_id)
		)`),
	)
}

// NotificationSettingsOf returns the user's settings, defaults filled in for users who never saved any.
func (s *Store) NotificationSettingsOf(userID string) domain.NotificationSettings {
	var raw, channels string
	logDBErr(s.db.QueryRow(`SELECT notification_settings, alarm_channels FROM users WHERE id = ?`, userID).Scan(&raw, &channels))
	out := domain.DefaultNotificationSettings(parseAlarmChannels(channels))
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	if !validClock(out.DailySummary.Time) {
		out.DailySummary.Time = "07:00"
	}
	return out
}

func validClock(v string) bool {
	t, err := time.Parse("15:04", v)
	return err == nil && t.Format("15:04") == v
}

func (s *Store) SetNotificationSettings(userID string, n domain.NotificationSettings) error {
	if !validClock(n.DailySummary.Time) {
		n.DailySummary.Time = "07:00"
	}
	raw, _ := json.Marshal(n)
	_, err := s.db.Exec(`UPDATE users SET notification_settings = ? WHERE id = ?`, string(raw), userID)
	return err
}

// QueuedNotification is one event waiting to be sent bundled.
type QueuedNotification struct {
	ID        int64
	UserID    string
	Kind      string
	Payload   map[string]string
	CreatedAt string
	Attempts  int
}

func (s *Store) QueueNotification(userID, kind string, payload map[string]string) error {
	raw, _ := json.Marshal(payload)
	_, err := s.db.Exec(`INSERT INTO notification_queue (user_id, kind, payload, created_at) VALUES (?, ?, ?, ?)`,
		userID, kind, string(raw), time.Now().UTC().Format(time.RFC3339))
	return err
}

// DueNotificationUsers lists users whose oldest waiting event is older than the bundling window.
func (s *Store) DueNotificationUsers(olderThan time.Time) ([]string, error) {
	rows, err := s.db.Query(`SELECT user_id FROM notification_queue GROUP BY user_id HAVING MIN(created_at) <= ?`,
		olderThan.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) QueuedNotifications(userID string) ([]QueuedNotification, error) {
	rows, err := s.db.Query(`SELECT id, user_id, kind, payload, created_at, attempts FROM notification_queue WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []QueuedNotification
	for rows.Next() {
		var q QueuedNotification
		var raw string
		if err := rows.Scan(&q.ID, &q.UserID, &q.Kind, &raw, &q.CreatedAt, &q.Attempts); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &q.Payload)
		out = append(out, q)
	}
	return out, rows.Err()
}

func (s *Store) DeleteQueuedNotifications(ids []int64) error {
	for _, id := range ids {
		if _, err := s.db.Exec(`DELETE FROM notification_queue WHERE id = ?`, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) BumpQueuedNotifications(ids []int64) error {
	for _, id := range ids {
		if _, err := s.db.Exec(`UPDATE notification_queue SET attempts = attempts + 1 WHERE id = ?`, id); err != nil {
			return err
		}
	}
	return nil
}

// --- Task watchers ---

func (s *Store) WatchTask(taskID, userID string, on bool) error {
	if on {
		_, err := s.db.Exec(`INSERT OR IGNORE INTO task_watchers (task_id, user_id, created_at) VALUES (?, ?, ?)`, taskID, userID, nowUTC())
		return err
	}
	_, err := s.db.Exec(`DELETE FROM task_watchers WHERE task_id = ? AND user_id = ?`, taskID, userID)
	return err
}

func (s *Store) TaskWatchers(taskID string) []string {
	rows, err := s.db.Query(`SELECT user_id FROM task_watchers WHERE task_id = ?`, taskID)
	if dbFailed(err) {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if !dbFailed(rows.Scan(&id)) {
			out = append(out, id)
		}
	}
	logDBErr(rows.Err())
	return out
}

// WatchedTaskIDs is the set of tasks the user watches (to mark them in task lists).
func (s *Store) WatchedTaskIDs(userID string) map[string]bool {
	out := map[string]bool{}
	rows, err := s.db.Query(`SELECT task_id FROM task_watchers WHERE user_id = ?`, userID)
	if dbFailed(err) {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if !dbFailed(rows.Scan(&id)) {
			out[id] = true
		}
	}
	logDBErr(rows.Err())
	return out
}

func (s *Store) ForgetTaskWatchers(taskID string) {
	s.execLogged(`DELETE FROM task_watchers WHERE task_id = ?`, taskID)
}

// --- Daily summary ---

// SummaryTask is an open task with a due date, for the daily summary.
type SummaryTask struct {
	Title, DueDate, ListTitle string
}

// ActiveUserIDs lists all active accounts (the summary job checks their settings).
func (s *Store) ActiveUserIDs() []string {
	rows, err := s.db.Query(`SELECT id FROM users WHERE is_active = 1`)
	if dbFailed(err) {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if !dbFailed(rows.Scan(&id)) {
			out = append(out, id)
		}
	}
	logDBErr(rows.Err())
	return out
}

// OpenTasksDueBefore lists the user's open tasks (own ones, those of own lists and of lists shared with
// the user directly or through a group) due before
// the given day (YYYY-MM-DD, exclusive), oldest first.
func (s *Store) OpenTasksDueBefore(userID, beforeDay string) ([]SummaryTask, error) {
	rows, err := s.db.Query(`SELECT t.id, t.user_id, t.task_list_id, t.content, t.due_date, COALESCE(l.title, '')
		FROM thoughts t LEFT JOIN task_lists l ON l.id = t.task_list_id
		WHERE (t.status = 'kept' OR (t.status = 'converted' AND t.converted_type = 'task'))
		  AND t.is_completed = 0 AND t.due_date != '' AND substr(t.due_date, 1, 10) < ?
		  AND (t.user_id = ? OR (t.task_list_id != '' AND t.task_list_id IN (
		        SELECT id FROM task_lists WHERE user_id = ?
		        UNION SELECT task_list_id FROM task_list_shares WHERE target_type = 'user' AND target_id = ?
		        UNION SELECT task_list_id FROM task_list_shares WHERE target_type = 'team'
		              AND target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))))
		ORDER BY t.due_date`, beforeDay, userID, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	type candidate struct {
		task    domain.Thought
		summary SummaryTask
	}
	var found []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.task.ID, &c.task.UserID, &c.task.TaskListID, &c.summary.Title, &c.summary.DueDate, &c.summary.ListTitle); err != nil {
			_ = rows.Close()
			return nil, err
		}
		c.summary.Title = strings.TrimSpace(strings.SplitN(c.summary.Title, "\n", 2)[0])
		found = append(found, c)
	}
	err = rows.Err()
	rows.Close()
	// Same people as the due alarm: in a shared list the assignees, or every member when nobody is assigned
	var out []SummaryTask
	for _, c := range found {
		c.task.Assignees = s.getTaskAssignees(c.task.ID)
		for _, id := range s.TaskAlarmRecipients(&c.task) {
			if id == userID {
				out = append(out, c.summary)
				break
			}
		}
	}
	return out, err
}

// ClaimDailySummary marks today's summary as sent; false when it was already sent today.
func (s *Store) ClaimDailySummary(userID, day string) bool {
	res, err := s.db.Exec(`UPDATE users SET last_daily_summary = ? WHERE id = ? AND last_daily_summary != ?`, day, userID, day)
	if dbFailed(err) {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

// SharedFolderName is the display name of a shared workspace folder.
func (s *Store) SharedFolderName(folderID string) string {
	var name string
	logDBErr(s.db.QueryRow(`SELECT name FROM workspace_shared_folders WHERE id = ?`, folderID).Scan(&name))
	if name == "" {
		name = "Ordner"
	}
	return name
}
