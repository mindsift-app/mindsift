package storage

import (
	"database/sql"
	"errors"
	"regexp"
	"strings"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Hidden values in notes (an IP address, a token in a technical note). The text of a bullet only holds
// the reference {{secret:<id>}}; the value lives encrypted in note_secrets (the server layer encrypts,
// see api/secrets.go). So everything that hands out note text (API keys, MCP, search, sync, export)
// never sees the value, and only a login can reveal it.
//
// A secret belongs to one note: who can see that note can reveal it, who may edit it can change it.
// A bullet copied or moved into another note gets a copy of the value there (secret_gate.go), so every
// reference points into its own note and no note reveals the value of another.

// secretValueRefRe matches a reference with the id format of a stored value (blockfmt.NewSecretID; ids of older
// versions have "_" after "sec"). Code blocks keep none (codeBlockText).
var secretValueRefRe = regexp.MustCompile(`\{\{secret:sec_?[0-9a-f]{24}\}\}`)

// SecretOrphanDays: how long a secret no bullet of its note holds any more is kept (undo, trash, pasting
// it back).
const SecretOrphanDays = 30

// MaxSecretLength: longest value in bytes.
const MaxSecretLength = 4096

var ErrSecretNotFound = errors.New("Versteckter Wert nicht gefunden")

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

// A code block shows its text as it is and cannot show a hidden value as a chip: a reference in it showed
// its raw id, and the gates made copies of values nobody saw. So a code block keeps no reference to a
// value. Whatever brings one in (a bullet turned into a code block, text written or pasted into one, a new
// note or an import with code blocks) gets the placeholder instead, the one secretGate writes for a value
// not taken over, in the writer's message language. The editor does the same on its side
// (frontend/src/lib/docSync/diff.ts) in the same step as the change, so undo brings the reference back;
// the server's rule (collab.Env.CodeText, set by applyDocChangeCtx) covers everything else: older
// clients, MCP, the API, a type change on its own. Only references with the id format of a value count:
// "{{secret:id}}" written into code to explain the syntax stays. block_refs leaves code blocks out
// (blockRefsOf), so the secret sweep neither copies a value for them nor keeps one because of them.

// codeBlockText returns the text of a code block with every reference to a value replaced by placeholder
// (by nothing where the placeholder is longer than the reference, as secretGate.placeholderFor).
func codeBlockText(content, placeholder string) string {
	if !strings.Contains(content, "{{secret:") {
		return content
	}
	return secretValueRefRe.ReplaceAllStringFunc(content, func(ref string) string {
		if len(placeholder) <= len(ref) {
			return placeholder
		}
		return ""
	})
}

// secretPlaceholderIn: the placeholder for a value not taken over, in the language lang.
func secretPlaceholderIn(lang string) string {
	return i18n.T(lang, "(versteckter Wert nicht übernommen)")
}

// MaskSecretRefs replaces every reference with a neutral mask (Markdown export).
func MaskSecretRefs(text string) string {
	if !strings.Contains(text, "{{secret:") {
		return text
	}
	return blockfmt.SecretRefRe.ReplaceAllString(text, "••••")
}

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
