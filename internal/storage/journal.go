package storage

import (
	"database/sql"
	"errors"
)

// Journal: one note per person and day. The notes are ordinary documents (sharing, search, sync work as
// usual); this table only remembers which note belongs to which day.

type JournalDay struct {
	Date  string `json:"date"` // YYYY-MM-DD
	DocID string `json:"docId"`
	Empty bool   `json:"empty"` // no text yet (the journal still shows today and days jumped to)
}

func (s *Store) migrateJournal() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS journal_days (
			user_id TEXT NOT NULL,
			day TEXT NOT NULL,
			doc_id TEXT NOT NULL,
			PRIMARY KEY (user_id, day)
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_journal_days_doc ON journal_days(doc_id)`),
	)
}

// JournalDays lists the user's days whose note still exists (not in the trash), newest first.
func (s *Store) JournalDays(userID string) ([]JournalDay, error) {
	rows, err := s.db.Query(`SELECT j.day, j.doc_id, TRIM(d.content) = ''
		FROM journal_days j JOIN documents d ON d.id = j.doc_id
		WHERE j.user_id = ? AND d.is_archived = 0
		ORDER BY j.day DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := []JournalDay{}
	for rows.Next() {
		var d JournalDay
		if err := rows.Scan(&d.Date, &d.DocID, &d.Empty); err != nil {
			return nil, err
		}
		days = append(days, d)
	}
	return days, rows.Err()
}

// JournalDocID returns the note of a day; "" when there is none or it was moved to the trash.
func (s *Store) JournalDocID(userID, day string) (string, error) {
	var docID string
	err := s.db.QueryRow(`SELECT j.doc_id FROM journal_days j JOIN documents d ON d.id = j.doc_id
		WHERE j.user_id = ? AND j.day = ? AND d.is_archived = 0`, userID, day).Scan(&docID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return docID, err
}

func (s *Store) SetJournalDay(userID, day, docID string) error {
	_, err := s.db.Exec(`INSERT INTO journal_days (user_id, day, doc_id) VALUES (?, ?, ?)
		ON CONFLICT(user_id, day) DO UPDATE SET doc_id = excluded.doc_id`, userID, day, docID)
	return err
}
