package storage

import (
	"database/sql"
	"errors"
	"regexp"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Hidden values in notes (an IP address, a token in a technical note). The text of a bullet only holds
// the reference {{secret:<id>}}; the value lives encrypted in note_secrets (the server layer encrypts,
// see api/secrets.go). So everything that hands out note text (API keys, MCP, search, sync, export)
// never sees the value, and only a login can reveal it.
//
// A secret belongs to one note: who can see that note can reveal it, who may edit it can change it.
// A bullet copied or moved into another note gets a copy of the value there (secret_gate.go), so every
// reference points into its own note and no note reveals the value of another.

// SecretRefRe matches a reference in block text; group 1 is the id.
var SecretRefRe = regexp.MustCompile(`\{\{secret:([A-Za-z0-9_]+)\}\}`)

// SecretOrphanDays: how long a secret no bullet of its note holds any more is kept (undo, trash, pasting
// it back).
const SecretOrphanDays = 30

// MaxSecretLength: longest value in bytes.
const MaxSecretLength = 4096

var ErrSecretNotFound = errors.New("Geheimnis nicht gefunden")

// NoteSecret is one stored value; Ciphertext is what the server layer produced. SourceID is the value
// it was copied from (secretGate), empty for one created with /secret.
type NoteSecret struct {
	ID         string
	DocumentID string
	CreatedBy  string
	SourceID   string
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
	err := s.db.QueryRow(`SELECT id, document_id, created_by, source_id, ciphertext FROM note_secrets WHERE id = ?`, id).
		Scan(&n.ID, &n.DocumentID, &n.CreatedBy, &n.SourceID, &n.Ciphertext)
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
