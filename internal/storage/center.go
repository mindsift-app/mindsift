package storage

import (
	"time"
)

// Notification center: every event a person is told about, kept for the bell in the app regardless of
// their channels or a pause (those only decide about mail, Discord, webhook and push). Entries are gone
// after CenterRetention. A group key bundles entries: a watched task keeps only its latest change, a due
// alarm is kept once per due date.

// CenterRetention: how long entries stay, read or not
const CenterRetention = 14 * 24 * time.Hour

func (s *Store) migrateCenter() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS center_entries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			title TEXT NOT NULL,
			text TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT '',
			target_id TEXT NOT NULL DEFAULT '',
			block_id TEXT NOT NULL DEFAULT '',
			group_key TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			read INTEGER NOT NULL DEFAULT 0
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_center_user ON center_entries(user_id, id)`),
	)
}

// CenterEntry is one line in the notification center.
type CenterEntry struct {
	ID         int64  `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Text       string `json:"text"`
	TargetType string `json:"targetType,omitempty"` // task | note | list | tasklist
	TargetID   string `json:"targetId,omitempty"`
	BlockID    string `json:"blockId,omitempty"`
	CreatedAt  string `json:"createdAt"`
	Read       bool   `json:"read"`
}

// CenterGroup decides how an entry with a group key is added
type CenterGroup int

const (
	// CenterReplace: an earlier entry with the key goes, the new one is unread at the top
	CenterReplace CenterGroup = iota
	// CenterOnce: nothing is added while an entry with the key exists
	CenterOnce
)

// AddCenterEntry stores an entry; ok is false when CenterOnce found one already. replaced holds the text
// of the entry it replaced while that was still unread (to merge two changes into one line).
func (s *Store) AddCenterEntry(userID string, e CenterEntry, groupKey string, mode CenterGroup) (out CenterEntry, ok bool, replaced string, err error) {
	if groupKey != "" {
		var id int64
		var text string
		var read bool
		found := s.db.QueryRow(`SELECT id, text, read FROM center_entries WHERE user_id = ? AND group_key = ? ORDER BY id DESC LIMIT 1`,
			userID, groupKey).Scan(&id, &text, &read) == nil
		if found && mode == CenterOnce {
			return CenterEntry{}, false, "", nil
		}
		if found {
			if !read {
				replaced = text
			}
			if _, err := s.db.Exec(`DELETE FROM center_entries WHERE user_id = ? AND group_key = ?`, userID, groupKey); err != nil {
				return CenterEntry{}, false, "", err
			}
		}
	}
	e.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	res, err := s.db.Exec(`INSERT INTO center_entries (user_id, kind, title, text, target_type, target_id, block_id, group_key, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, userID, e.Kind, e.Title, e.Text, e.TargetType, e.TargetID, e.BlockID, groupKey, e.CreatedAt)
	if err != nil {
		return CenterEntry{}, false, "", err
	}
	e.ID, _ = res.LastInsertId()
	return e, true, replaced, nil
}

// SetCenterEntryText changes an entry's text (two changes of a watched task merged into one line).
func (s *Store) SetCenterEntryText(userID string, id int64, text string) error {
	_, err := s.db.Exec(`UPDATE center_entries SET text = ? WHERE id = ? AND user_id = ?`, text, id, userID)
	return err
}

// CenterEntries: the newest entries of a person and how many of all are unread.
func (s *Store) CenterEntries(userID string, limit int) ([]CenterEntry, int, error) {
	rows, err := s.db.Query(`SELECT id, kind, title, text, target_type, target_id, block_id, created_at, read
		FROM center_entries WHERE user_id = ? ORDER BY id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, 0, err
	}
	out := make([]CenterEntry, 0)
	for rows.Next() {
		var e CenterEntry
		if rows.Scan(&e.ID, &e.Kind, &e.Title, &e.Text, &e.TargetType, &e.TargetID, &e.BlockID, &e.CreatedAt, &e.Read) == nil {
			out = append(out, e)
		}
	}
	err = rows.Err()
	rows.Close()
	var unread int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM center_entries WHERE user_id = ? AND read = 0`, userID).Scan(&unread)
	return out, unread, err
}

// MarkCenterRead marks entries as read (all of the person's when ids is empty).
func (s *Store) MarkCenterRead(userID string, ids []int64) error {
	if len(ids) == 0 {
		_, err := s.db.Exec(`UPDATE center_entries SET read = 1 WHERE user_id = ? AND read = 0`, userID)
		return err
	}
	stmts := make([]sqlStmt, 0, len(ids))
	for _, id := range ids {
		stmts = append(stmts, stmt(`UPDATE center_entries SET read = 1 WHERE id = ? AND user_id = ?`, id, userID))
	}
	return s.execInTx(stmts...)
}

// ClearCenter removes all entries of a person.
func (s *Store) ClearCenter(userID string) error {
	_, err := s.db.Exec(`DELETE FROM center_entries WHERE user_id = ?`, userID)
	return err
}

// PruneCenter drops entries older than CenterRetention.
func (s *Store) PruneCenter(now time.Time) {
	_, _ = s.db.Exec(`DELETE FROM center_entries WHERE created_at < ?`, now.Add(-CenterRetention).UTC().Format(time.RFC3339))
}
