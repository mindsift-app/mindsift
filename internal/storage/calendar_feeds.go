package storage

import (
	"database/sql"
	"errors"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// Calendar subscription (api/calendar_feed.go): one read-only iCalendar feed per person behind a secret
// address. Like public links, only the token's hash finds the feed; the token itself is kept encrypted
// (sealed by the API with SECRETS_KEY, bound to the user id) so the person can copy the address again.

// CalendarFeed is a person's feed.
type CalendarFeed struct {
	UserID      string
	TokenHash   string
	TokenSealed string
	CreatedAt   string
}

// ErrCalendarFeedNotFound covers unknown tokens and people without a feed alike.
var ErrCalendarFeedNotFound = errors.New("Kalender-Abo nicht gefunden")

func (s *Store) migrateCalendarFeeds() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS calendar_feeds (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			token_hash TEXT NOT NULL UNIQUE,
			token_sealed TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`),
	)
}

// SaveCalendarFeed stores the person's feed; an earlier token stops working at once.
func (s *Store) SaveCalendarFeed(f *CalendarFeed) error {
	_, err := s.db.Exec(`INSERT INTO calendar_feeds (user_id, token_hash, token_sealed, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, token_sealed = excluded.token_sealed, created_at = excluded.created_at`,
		f.UserID, f.TokenHash, f.TokenSealed, f.CreatedAt)
	return err
}

func scanCalendarFeed(row *sql.Row) (*CalendarFeed, error) {
	var f CalendarFeed
	if err := row.Scan(&f.UserID, &f.TokenHash, &f.TokenSealed, &f.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrCalendarFeedNotFound
		}
		return nil, err
	}
	return &f, nil
}

// CalendarFeedOf returns the person's feed (ErrCalendarFeedNotFound without one).
func (s *Store) CalendarFeedOf(userID string) (*CalendarFeed, error) {
	return scanCalendarFeed(s.db.QueryRow(`SELECT user_id, token_hash, token_sealed, created_at FROM calendar_feeds WHERE user_id = ?`, userID))
}

// CalendarFeedByTokenHash finds a feed by the hash of its token; only active accounts count.
func (s *Store) CalendarFeedByTokenHash(hash string) (*CalendarFeed, error) {
	return scanCalendarFeed(s.db.QueryRow(`SELECT f.user_id, f.token_hash, f.token_sealed, f.created_at
		FROM calendar_feeds f JOIN users u ON u.id = f.user_id
		WHERE f.token_hash = ? AND u.is_active = 1`, hash))
}

// DeleteCalendarFeed switches the person's feed off; its address stops working at once.
func (s *Store) DeleteCalendarFeed(userID string) error {
	_, err := s.db.Exec(`DELETE FROM calendar_feeds WHERE user_id = ?`, userID)
	return err
}

// CalendarTask is one open task with a due date as the calendar feed shows it.
type CalendarTask struct {
	ID        string
	Content   string
	Notes     string
	DueDate   string // as stored: YYYY-MM-DD or YYYY-MM-DDTHH:MM in the server's time zone
	ListTitle string // "" for tasks outside a task list
	Reminders []int
	CreatedAt string // RFC 3339, UTC
	ChangedAt string // last change by an API key, RFC 3339 ("" if none)
	UpdatedAt string // last change of the task, RFC 3339 (created_at until its first change)
	Revision  int    // how often the task changed (thoughts.revision)
}

// Window of due dates the feed covers, counted in calendar days of the server's time zone: overdue tasks
// of the last month, and the coming year. Bounds the work for people with thousands of tasks.
const (
	CalendarFeedDaysBack    = 30
	CalendarFeedDaysAhead   = 366
	CalendarFeedMaxEntries  = 5000
	calendarFeedNotesPrefix = 2000 // characters of the notes read per task; the feed shows an excerpt
)

// CalendarTasks returns the open tasks with a due date that the person sees (own tasks and those of task
// lists shared with them, the same rule as GetTasks), due from CalendarFeedDaysBack days before now to
// CalendarFeedDaysAhead days after it, earliest first. Completed and deleted tasks are not included; a
// repeating task is one row with its next due date, as in the app. One query.
func (s *Store) CalendarTasks(userID string, now time.Time) ([]CalendarTask, error) {
	today := clock.In(now)
	from := today.AddDate(0, 0, -CalendarFeedDaysBack).Format("2006-01-02")
	to := today.AddDate(0, 0, CalendarFeedDaysAhead+1).Format("2006-01-02") // exclusive: "YYYY-MM-DDT…" sorts after the day
	rows, err := s.db.Query(
		`SELECT t.id, t.content, substr(t.notes, 1, ?), t.due_date, COALESCE(tl.title, ''), t.reminders, t.created_at, t.changed_at, `+sqlTaskUpdatedAt+`, t.revision
		 FROM thoughts t LEFT JOIN task_lists tl ON tl.id = t.task_list_id
		 WHERE (t.user_id = ? OR t.task_list_id IN (`+accessibleTaskListsSQL+`))
		   AND (t.status = 'kept' OR (t.status = 'converted' AND t.converted_type = 'task'))
		   AND t.is_completed = 0
		   AND t.due_date >= ? AND t.due_date < ?
		 ORDER BY t.due_date, t.created_at
		 LIMIT ?`,
		calendarFeedNotesPrefix, userID, userID, userID, userID, from, to, CalendarFeedMaxEntries,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CalendarTask{}
	for rows.Next() {
		var t CalendarTask
		var reminders string
		if err := rows.Scan(&t.ID, &t.Content, &t.Notes, &t.DueDate, &t.ListTitle, &reminders, &t.CreatedAt, &t.ChangedAt, &t.UpdatedAt, &t.Revision); dbFailed(err) {
			continue
		}
		t.Reminders = domain.ParseReminders(reminders)
		out = append(out, t)
	}
	return out, rows.Err()
}
