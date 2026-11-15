package storage

import (
	"encoding/json"
	"strings"
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
	return addCenterEntry(s.db, userID, e, groupKey, mode, "")
}

// centerDB is *sql.DB or *sql.Tx
type centerDB interface {
	docQueryer
	execer
}

// addCenterEntry is AddCenterEntry on a connection or transaction. generic: the text the entry gets
// instead when it replaces an unread one with a different text ("" keeps its own).
func addCenterEntry(db centerDB, userID string, e CenterEntry, groupKey string, mode CenterGroup, generic string) (out CenterEntry, ok bool, replaced string, err error) {
	if groupKey != "" {
		var id int64
		var text string
		var read bool
		found := db.QueryRow(`SELECT id, text, read FROM center_entries WHERE user_id = ? AND group_key = ? ORDER BY id DESC LIMIT 1`,
			userID, groupKey).Scan(&id, &text, &read) == nil
		if found && mode == CenterOnce {
			return CenterEntry{}, false, "", nil
		}
		if found {
			if !read {
				replaced = text
			}
			if _, err := db.Exec(`DELETE FROM center_entries WHERE user_id = ? AND group_key = ?`, userID, groupKey); err != nil {
				return CenterEntry{}, false, "", err
			}
		}
	}
	if replaced != "" && replaced != e.Text && generic != "" {
		e.Text = generic
	}
	e.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	res, err := db.Exec(`INSERT INTO center_entries (user_id, kind, title, text, target_type, target_id, block_id, group_key, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, userID, e.Kind, e.Title, e.Text, e.TargetType, e.TargetID, e.BlockID, groupKey, e.CreatedAt)
	if err != nil {
		return CenterEntry{}, false, "", err
	}
	e.ID, _ = res.LastInsertId()
	return e, true, replaced, nil
}

// CenterAdd is one entry for StoreNotifications: as AddCenterEntry with CenterReplace, Generic as in
// addCenterEntry.
type CenterAdd struct {
	UserID   string
	Entry    CenterEntry
	GroupKey string
	Generic  string
}

// QueuedAdd is one event for StoreNotifications to queue (QueueNotification).
type QueuedAdd struct {
	UserID  string
	Kind    string
	Payload map[string]string
}

// StoreNotifications stores the center entries and queued events of one event for all its recipients in
// a single transaction and returns the entries as stored (in the order of center). It used to be a
// write per recipient: a task completed in a list shared with 50 people waited 50 times for the
// database's write lock.
func (s *Store) StoreNotifications(center []CenterAdd, queue []QueuedAdd) ([]CenterEntry, error) {
	if len(center) == 0 && len(queue) == 0 {
		return nil, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out, err := storeNotificationsTx(tx, center, queue)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

// centerInsertBatch: rows per INSERT of entries without a group key (9 values each)
const centerInsertBatch = 100

// storeNotificationsTx is StoreNotifications inside the caller's transaction (the change the events are
// about goes into the same one). Entries without a group key, the usual case for a list's members, go in
// with one INSERT per batch instead of one per person; the queue alike.
func storeNotificationsTx(tx centerDB, center []CenterAdd, queue []QueuedAdd) ([]CenterEntry, error) {
	out := make([]CenterEntry, len(center))
	// pending: indexes into center of entries without a group key waiting for their INSERT, each person
	// once (their ids come back by person)
	var pending []int
	inPending := map[string]bool{}
	flush := func() error {
		if len(pending) == 0 {
			return nil
		}
		now := time.Now().UTC().Format(time.RFC3339)
		var sb strings.Builder
		sb.WriteString(`INSERT INTO center_entries (user_id, kind, title, text, target_type, target_id, block_id, group_key, created_at) VALUES `)
		args := make([]any, 0, 9*len(pending))
		byUser := make(map[string]int, len(pending))
		for n, i := range pending {
			c := center[i]
			if n > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString("(?, ?, ?, ?, ?, ?, ?, '', ?)")
			e := c.Entry
			args = append(args, c.UserID, e.Kind, e.Title, e.Text, e.TargetType, e.TargetID, e.BlockID, now)
			e.CreatedAt = now
			out[i] = e
			byUser[c.UserID] = i
		}
		sb.WriteString(" RETURNING id, user_id")
		rows, err := tx.Query(sb.String(), args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id int64
			var uid string
			if err := rows.Scan(&id, &uid); err != nil {
				_ = rows.Close()
				return err
			}
			out[byUser[uid]].ID = id
		}
		err = rows.Err()
		_ = rows.Close()
		pending = pending[:0]
		clear(inPending)
		return err
	}
	for i, c := range center {
		if c.GroupKey == "" && !inPending[c.UserID] {
			pending = append(pending, i)
			inPending[c.UserID] = true
			if len(pending) == centerInsertBatch {
				if err := flush(); err != nil {
					return nil, err
				}
			}
			continue
		}
		// In order: what an entry with a group key replaces may have been added just before
		if err := flush(); err != nil {
			return nil, err
		}
		if c.GroupKey == "" {
			pending = append(pending, i)
			inPending[c.UserID] = true
			continue
		}
		e, _, _, err := addCenterEntry(tx, c.UserID, c.Entry, c.GroupKey, CenterReplace, c.Generic)
		if err != nil {
			return nil, err
		}
		out[i] = e
	}
	if err := flush(); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for start := 0; start < len(queue); start += centerInsertBatch {
		part := queue[start:min(start+centerInsertBatch, len(queue))]
		var sb strings.Builder
		sb.WriteString(`INSERT INTO notification_queue (user_id, kind, payload, created_at) VALUES `)
		args := make([]any, 0, 4*len(part))
		for n, q := range part {
			if n > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString("(?, ?, ?, ?)")
			raw, _ := json.Marshal(q.Payload)
			args = append(args, q.UserID, q.Kind, string(raw), now)
		}
		if _, err := tx.Exec(sb.String(), args...); err != nil {
			return nil, err
		}
	}
	return out, nil
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
		if err := rows.Scan(&e.ID, &e.Kind, &e.Title, &e.Text, &e.TargetType, &e.TargetID, &e.BlockID, &e.CreatedAt, &e.Read); err != nil {
			_ = rows.Close()
			return nil, 0, err
		}
		out = append(out, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, 0, err
	}
	var unread int
	err = s.db.QueryRow(`SELECT COUNT(*) FROM center_entries WHERE user_id = ? AND read = 0`, userID).Scan(&unread)
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
	s.execLogged(`DELETE FROM center_entries WHERE created_at < ?`, now.Add(-CenterRetention).UTC().Format(time.RFC3339))
}
