package storage

import (
	"errors"
	"strconv"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// How long finished and deleted things are kept, chosen by everyone in the account settings
// ("Aufbewahrung"): completed tasks (then into the task trash), the task trash, the triage trash
// (discarded thoughts), the notes trash and ticked-off list items (deleted for good). In shared task
// lists, lists and notes the owner's choice counts. 0 keeps things for good; the admin can switch that
// off (RETENTION_ALLOW_NEVER or the system settings), then 0 counts as the area's default.
//
// Things that were already finished or deleted before this feature count from its update on
// (retention_since), so nothing disappeared at once.

// RetentionChoices are the delays offered in the app, in days; 0 = never.
var RetentionChoices = []int{0, 7, 14, 30, 90, 365, 730}

// Retention: the delays of one user, in days.
type Retention = domain.Retention

// DefaultRetention: what everyone starts with, and what "never" becomes when it is not allowed.
var DefaultRetention = Retention{DoneTasks: DefaultDoneRetentionDays, TaskTrash: 30, TriageTrash: 14, NoteTrash: 30, ListDone: 7}

var (
	ErrInvalidRetention = errors.New("Ungültige Frist (erlaubt: 7, 14, 30, 90, 365, 730 Tage oder nie)")
	ErrRetentionNever   = errors.New("Dauerhaftes Aufbewahren ist auf diesem Server abgeschaltet")
)

// retentionFields maps each area to its users column.
var retentionFields = []struct {
	column string
	field  func(r *Retention) *int
}{
	{"done_retention_days", func(r *Retention) *int { return &r.DoneTasks }},
	{"task_trash_days", func(r *Retention) *int { return &r.TaskTrash }},
	{"triage_trash_days", func(r *Retention) *int { return &r.TriageTrash }},
	{"note_trash_days", func(r *Retention) *int { return &r.NoteTrash }},
	{"list_done_days", func(r *Retention) *int { return &r.ListDone }},
}

func (s *Store) migrateRetention() error {
	d := DefaultRetention
	for _, c := range []struct {
		column string
		days   int
	}{{"task_trash_days", d.TaskTrash}, {"triage_trash_days", d.TriageTrash}, {"note_trash_days", d.NoteTrash}, {"list_done_days", d.ListDone}} {
		if err := s.addColumnIfMissing("users", c.column, "INTEGER NOT NULL DEFAULT "+strconv.Itoa(c.days)); err != nil {
			return err
		}
	}
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS trashed_tasks (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			task_list_id TEXT NOT NULL DEFAULT '',
			owner_id TEXT NOT NULL,
			content TEXT NOT NULL,
			is_completed INTEGER NOT NULL DEFAULT 0,
			data TEXT NOT NULL,
			assignees TEXT NOT NULL DEFAULT '[]',
			trashed_at TEXT NOT NULL,
			trashed_by TEXT NOT NULL DEFAULT ''
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_trashed_tasks_list ON trashed_tasks(task_list_id, trashed_at)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_trashed_tasks_owner ON trashed_tasks(owner_id, trashed_at)`),
		stmt(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('retention_since', ?)`, domain.NowISO()),
	)
}

func validRetention(days int) bool {
	for _, d := range RetentionChoices {
		if d == days {
			return true
		}
	}
	return false
}

// RetentionOf returns the user's delays; without allowNever a stored 0 counts as the default.
func (s *Store) RetentionOf(userID string, allowNever bool) Retention {
	r := DefaultRetention
	_ = s.db.QueryRow(`SELECT done_retention_days, task_trash_days, triage_trash_days, note_trash_days, list_done_days FROM users WHERE id = ?`, userID).
		Scan(&r.DoneTasks, &r.TaskTrash, &r.TriageTrash, &r.NoteTrash, &r.ListDone)
	if !allowNever {
		def := DefaultRetention
		for _, f := range retentionFields {
			if v := f.field(&r); *v == 0 {
				*v = *f.field(&def)
			}
		}
	}
	return r
}

// SetRetention stores all delays; each must be one of RetentionChoices, 0 only when allowed.
func (s *Store) SetRetention(userID string, r Retention, allowNever bool) error {
	stmts := []sqlStmt{}
	for _, f := range retentionFields {
		v := *f.field(&r)
		if !validRetention(v) {
			return ErrInvalidRetention
		}
		if v == 0 && !allowNever {
			return ErrRetentionNever
		}
		stmts = append(stmts, stmt(`UPDATE users SET `+f.column+` = ? WHERE id = ?`, v, userID))
	}
	return s.execInTx(stmts...)
}

// retentionSince: when retention started; older items count from then on.
func (s *Store) retentionSince() string {
	var v string
	_ = s.db.QueryRow(`SELECT value FROM system_settings WHERE key = 'retention_since'`).Scan(&v)
	return v
}

// daysSQL: the delay in days of an owner column, with "never" (0) replaced by def when it is not allowed.
func daysSQL(column string) string {
	return `COALESCE(NULLIF(` + column + `, 0), ?)`
}

// neverAs: what a stored 0 means in daysSQL: 0 (keep) when allowed, else the area's default.
func neverAs(allowNever bool, def int) int {
	if allowNever {
		return 0
	}
	return def
}

// cutoffSQL: true when the timestamp column (counted from retention_since at the earliest) lies more
// than the delay before now. Arguments: since, since, now (in this order).
func cutoffSQL(tsColumn, days string) string {
	return `(CASE WHEN ` + tsColumn + ` = '' OR ` + tsColumn + ` < ? THEN ? ELSE ` + tsColumn + ` END)
		< strftime('%Y-%m-%dT%H:%M:%SZ', ?, '-' || ` + days + ` || ' days')`
}

func sqlNow(now time.Time) string { return now.UTC().Format("2006-01-02 15:04:05") }

// PurgeResult: what PurgeExpired removed, for the realtime messages.
type PurgeResult struct {
	TasksToTrash []DeletedTask
	TrashedTasks []string // purged from the task trash for good
	Discarded    int
	Notes        []string
	ListItems    []PurgedListItem
}

// PurgedListItem: a ticked-off list item deleted after its delay.
type PurgedListItem struct {
	ID, ListID string
}

// PurgeExpired runs every delay at now: completed tasks go to the task trash, the trashes and ticked-off
// list items are emptied for good.
func (s *Store) PurgeExpired(now time.Time, allowNever bool) (PurgeResult, error) {
	var res PurgeResult
	var err error
	if res.TasksToTrash, err = s.PurgeExpiredDoneTasks(now, allowNever); err != nil {
		return res, err
	}
	if res.TrashedTasks, err = s.purgeExpiredTaskTrash(now, allowNever); err != nil {
		return res, err
	}
	since := s.retentionSince()
	if since == "" {
		since = domain.NowISO()
	}
	d := DefaultRetention

	// Triage trash: discarded thoughts, from the moment they were discarded (triaged_at)
	r, err := s.db.Exec(`DELETE FROM thoughts WHERE status = 'discarded' AND id IN (
		SELECT t.id FROM thoughts t JOIN users u ON u.id = t.user_id
		WHERE t.status = 'discarded' AND `+daysSQL("u.triage_trash_days")+` > 0
		  AND `+cutoffSQL("t.triaged_at", daysSQL("u.triage_trash_days"))+`)`,
		neverAs(allowNever, d.TriageTrash), since, since, sqlNow(now), neverAs(allowNever, d.TriageTrash))
	if err != nil {
		return res, err
	}
	n, _ := r.RowsAffected()
	res.Discarded = int(n)

	// Notes trash: the note owner's delay, from the deletion
	rows, err := s.db.Query(`SELECT d.id FROM documents d JOIN users u ON u.id = d.user_id
		WHERE d.is_archived = 1 AND `+daysSQL("u.note_trash_days")+` > 0
		  AND `+cutoffSQL("d.archived_at", daysSQL("u.note_trash_days")),
		neverAs(allowNever, d.NoteTrash), since, since, sqlNow(now), neverAs(allowNever, d.NoteTrash))
	if err != nil {
		return res, err
	}
	var docIDs []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			docIDs = append(docIDs, id)
		}
	}
	_ = rows.Close()
	for _, id := range docIDs {
		if err := s.hardDeleteDocument(id); err != nil {
			return res, err
		}
		res.Notes = append(res.Notes, id)
	}
	// Folders in the notes trash: same delay; their notes went above (they were trashed at the same time)
	if _, err := s.db.Exec(`DELETE FROM trashed_folders WHERE id IN (
		SELECT tf.id FROM trashed_folders tf JOIN users u ON u.id = tf.user_id
		WHERE `+daysSQL("u.note_trash_days")+` > 0 AND `+cutoffSQL("tf.trashed_at", daysSQL("u.note_trash_days"))+`)`,
		neverAs(allowNever, d.NoteTrash), since, since, sqlNow(now), neverAs(allowNever, d.NoteTrash)); err != nil {
		return res, err
	}

	// Ticked-off list items: the list owner's delay, from ticking them off
	rows, err = s.db.Query(`SELECT li.id, li.list_id FROM list_items li JOIN lists l ON l.id = li.list_id JOIN users u ON u.id = l.user_id
		WHERE li.is_completed = 1 AND `+daysSQL("u.list_done_days")+` > 0
		  AND `+cutoffSQL("li.completed_at", daysSQL("u.list_done_days")),
		neverAs(allowNever, d.ListDone), since, since, sqlNow(now), neverAs(allowNever, d.ListDone))
	if err != nil {
		return res, err
	}
	for rows.Next() {
		var it PurgedListItem
		if rows.Scan(&it.ID, &it.ListID) == nil {
			res.ListItems = append(res.ListItems, it)
		}
	}
	_ = rows.Close()
	for _, it := range res.ListItems {
		if _, err := s.db.Exec(`DELETE FROM list_items WHERE id = ?`, it.ID); err != nil {
			return res, err
		}
	}
	return res, nil
}

// RetentionAllowNeverSetting: the admin's switch in the system settings (default: allowed).
func (s *Store) RetentionAllowNeverSetting() bool {
	var v string
	_ = s.db.QueryRow(`SELECT value FROM system_settings WHERE key = 'retention_allow_never'`).Scan(&v)
	return v != "false"
}
