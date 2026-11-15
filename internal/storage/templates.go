package storage

import (
	"database/sql"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Note templates (Doku/modules/workspace.md, "Templates"). A template is an ordinary note that a person
// marked as one of theirs: the mark is personal like the pin (doc_templates, one row per person and
// note), so everyone picks their own templates from the notes they can read. Marking a note shared
// with you changes nothing for its owner or the others it is shared with, and needs no edit right:
// using a template only reads it (its bullets are copied into another note by the editor, or into a
// new note through POST /documents, where mediaGate and secretGate check the copy like any paste).

// migrateNoteTemplates is migration 61: the templates of each person.
func (s *Store) migrateNoteTemplates() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS doc_templates (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			created_at TEXT NOT NULL,
			PRIMARY KEY(user_id, doc_id)
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_doc_templates_doc ON doc_templates(doc_id)`),
	)
}

// SetDocTemplate marks a note the person can read as one of their templates (on) or removes the mark.
// A note in the trash cannot become one (sql.ErrNoRows for a note the person cannot see, ErrDocInTrash
// for one in the trash); removing the mark always works.
func (s *Store) SetDocTemplate(userID, docID string, on bool) error {
	if !on {
		_, err := s.db.Exec(`DELETE FROM doc_templates WHERE user_id = ? AND doc_id = ?`, userID, docID)
		return err
	}
	role := s.DocRole(userID, docID)
	if role == "" {
		return sql.ErrNoRows
	}
	var archived bool
	if err := s.db.QueryRow(`SELECT is_archived FROM documents WHERE id = ?`, docID).Scan(&archived); err != nil {
		return err
	}
	if archived {
		return ErrDocInTrash
	}
	_, err := s.db.Exec(`INSERT OR IGNORE INTO doc_templates (user_id, doc_id, created_at) VALUES (?, ?, ?)`,
		userID, docID, domain.NowISO())
	return err
}
