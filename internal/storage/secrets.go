package storage

import (
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Hidden values in notes (an IP address, a token in a technical note). The text of a bullet only holds
// the reference {{secret:<id>}}; the value lives encrypted in note_secrets (the server layer encrypts,
// see api/secrets.go). So everything that hands out note text (API keys, MCP, search, sync, export)
// never sees the value, and only a login can reveal it.
//
// A secret belongs to the note it was created in: who can see that note can reveal it. A bullet that
// moves to another note takes its secret along the next time it is revealed there or at the nightly
// sweep, as long as the person who created it may edit the new note.

// SecretRefRe matches a reference in block text; group 1 is the id.
var SecretRefRe = regexp.MustCompile(`\{\{secret:([A-Za-z0-9_]+)\}\}`)

// SecretOrphanDays: how long a secret without any reference is kept (undo, trash, pasting it back).
const SecretOrphanDays = 30

// MaxSecretLength: longest value in bytes.
const MaxSecretLength = 4096

var ErrSecretNotFound = errors.New("Geheimnis nicht gefunden")

// NoteSecret is one stored value; Ciphertext is what the server layer produced.
type NoteSecret struct {
	ID         string
	DocumentID string
	CreatedBy  string
	Ciphertext string
}

func (s *Store) migrateNoteSecrets() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS note_secrets (
			id TEXT PRIMARY KEY,
			document_id TEXT NOT NULL,
			created_by TEXT NOT NULL DEFAULT '',
			ciphertext TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			orphaned_at TEXT NOT NULL DEFAULT ''
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_note_secrets_doc ON note_secrets(document_id)`),
	)
}

func secretRef(id string) string { return "{{secret:" + id + "}}" }

// MaskSecretRefs replaces every reference with a neutral mask (Markdown export).
func MaskSecretRefs(text string) string {
	if !strings.Contains(text, "{{secret:") {
		return text
	}
	return SecretRefRe.ReplaceAllString(text, "••••")
}

// NewSecretID: the id is known before encrypting, so the ciphertext can be bound to it. Without "_",
// so "_" in the text around a reference cannot be read as Markdown italics reaching into it.
func NewSecretID() string { return strings.Replace(domain.NewID("sec"), "_", "", 1) }

func (s *Store) CreateSecret(id, docID, userID, ciphertext string) error {
	now := domain.NowISO()
	_, err := s.db.Exec(`INSERT INTO note_secrets (id, document_id, created_by, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, docID, userID, ciphertext, now, now)
	return err
}

func (s *Store) GetSecret(id string) (*NoteSecret, error) {
	var n NoteSecret
	err := s.db.QueryRow(`SELECT id, document_id, created_by, ciphertext FROM note_secrets WHERE id = ?`, id).
		Scan(&n.ID, &n.DocumentID, &n.CreatedBy, &n.Ciphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSecretNotFound
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func (s *Store) UpdateSecret(id, ciphertext string) error {
	_, err := s.db.Exec(`UPDATE note_secrets SET ciphertext = ?, updated_at = ? WHERE id = ?`, ciphertext, domain.NowISO(), id)
	return err
}

// MoveSecret binds a secret to another note and clears its orphan mark.
func (s *Store) MoveSecret(id, docID string) error {
	_, err := s.db.Exec(`UPDATE note_secrets SET document_id = ?, orphaned_at = '' WHERE id = ?`, docID, id)
	return err
}

// DocReferencesSecret reports whether a live bullet of the note holds the reference.
func (s *Store) DocReferencesSecret(docID, id string) bool {
	var n int
	logDBErr(s.db.QueryRow(sqlDocHoldsSecret, id, docID).Scan(&n))
	return n > 0
}

// docsReferencingSecret: the notes (trashed ones too) with a live bullet holding the reference.
func (s *Store) docsReferencingSecret(id string) ([]string, error) {
	rows, err := s.db.Query(sqlDocsHoldingSecret, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		ids = append(ids, d)
	}
	return ids, rows.Err()
}

// SecretSweep is what one pass of SweepSecrets did.
type SecretSweep struct {
	Orphaned, Restored, Moved, Deleted int
}

// SweepSecrets marks secrets whose note no longer references them, moves them to another note that
// does (when their creator may edit it), clears the mark when the reference is back and deletes
// secrets that have been orphaned for SecretOrphanDays.
func (s *Store) SweepSecrets(now time.Time) (SecretSweep, error) {
	var res SecretSweep
	type row struct{ id, docID, createdBy, orphanedAt string }
	rows, err := s.db.Query(`SELECT id, document_id, created_by, orphaned_at FROM note_secrets`)
	if err != nil {
		return res, err
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.docID, &r.createdBy, &r.orphanedAt); err != nil {
			rows.Close()
			return res, err
		}
		all = append(all, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return res, err
	}

	nowISO := now.UTC().Format(time.RFC3339)
	cutoff := now.UTC().AddDate(0, 0, -SecretOrphanDays).Format(time.RFC3339)
	for _, r := range all {
		docs, err := s.docsReferencingSecret(r.id)
		if err != nil {
			return res, err
		}
		home := false
		other := ""
		for _, d := range docs {
			if d == r.docID {
				home = true
			} else if other == "" && CanEditDoc(s.DocRole(r.createdBy, d)) {
				other = d
			}
		}
		switch {
		case home:
			if r.orphanedAt != "" {
				_, err = s.db.Exec(`UPDATE note_secrets SET orphaned_at = '' WHERE id = ?`, r.id)
				res.Restored++
			}
		case other != "":
			err = s.MoveSecret(r.id, other)
			res.Moved++
		case r.orphanedAt == "":
			_, err = s.db.Exec(`UPDATE note_secrets SET orphaned_at = ? WHERE id = ?`, nowISO, r.id)
			res.Orphaned++
		case r.orphanedAt < cutoff:
			_, err = s.db.Exec(`DELETE FROM note_secrets WHERE id = ?`, r.id)
			res.Deleted++
		}
		if err != nil {
			return res, err
		}
	}
	return res, nil
}
