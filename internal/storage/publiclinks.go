package storage

import (
	"database/sql"
	"errors"
	"regexp"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// Public links (api/publiclinks.go): one note shared read only with anyone who has the link, at most
// one link per note, always expiring. Only the token's hash finds the link; the token itself is kept
// encrypted (sealed by the API with SECRETS_KEY) so the owner can copy the link again.

// PublicLink is one note's public link.
type PublicLink struct {
	ID           string
	DocID        string
	CreatedBy    string
	TokenHash    string
	TokenSealed  string
	PasswordHash string // "" = no password
	ThemeFamily  string // unused (v0.87.0 kept the owner's theme; visitors now pick their own)
	ExpiresAt    string // RFC3339, UTC
	CreatedAt    string
}

// ErrPublicLinkNotFound covers unknown, expired and switched-off links alike.
var ErrPublicLinkNotFound = errors.New("Link nicht gefunden oder abgelaufen")

func (s *Store) migratePublicLinks() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS public_links (
			id TEXT PRIMARY KEY,
			doc_id TEXT NOT NULL UNIQUE,
			created_by TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			token_sealed TEXT NOT NULL,
			password_hash TEXT NOT NULL DEFAULT '',
			theme_family TEXT NOT NULL DEFAULT '',
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`),
	)
}

const publicLinkCols = `id, doc_id, created_by, token_hash, token_sealed, password_hash, theme_family, expires_at, created_at`

func scanPublicLink(row interface{ Scan(...any) error }) (*PublicLink, error) {
	var l PublicLink
	if err := row.Scan(&l.ID, &l.DocID, &l.CreatedBy, &l.TokenHash, &l.TokenSealed, &l.PasswordHash, &l.ThemeFamily, &l.ExpiresAt, &l.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPublicLinkNotFound
		}
		return nil, err
	}
	return &l, nil
}

// SavePublicLink stores the note's link, replacing an older one (its address stops working).
func (s *Store) SavePublicLink(l *PublicLink) error {
	return s.execInTx(
		stmt(`DELETE FROM public_links WHERE doc_id = ?`, l.DocID),
		stmt(`INSERT INTO public_links (`+publicLinkCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			l.ID, l.DocID, l.CreatedBy, l.TokenHash, l.TokenSealed, l.PasswordHash, l.ThemeFamily, l.ExpiresAt, l.CreatedAt),
	)
}

// PublicLinkOfDoc returns the note's link while it is valid.
func (s *Store) PublicLinkOfDoc(docID string, now time.Time) (*PublicLink, error) {
	return scanPublicLink(s.db.QueryRow(`SELECT `+publicLinkCols+` FROM public_links WHERE doc_id = ? AND expires_at > ?`,
		docID, now.UTC().Format(time.RFC3339)))
}

// PublicLinkByTokenHash finds a valid link of a note that is not in the trash.
func (s *Store) PublicLinkByTokenHash(hash string, now time.Time) (*PublicLink, error) {
	return scanPublicLink(s.db.QueryRow(`SELECT `+publicLinkCols+` FROM public_links l
		WHERE token_hash = ? AND expires_at > ? AND EXISTS (SELECT 1 FROM documents d WHERE d.id = l.doc_id AND d.is_archived = 0)`,
		hash, now.UTC().Format(time.RFC3339)))
}

// DeletePublicLink ends the note's link at once.
func (s *Store) DeletePublicLink(docID string) error {
	_, err := s.db.Exec(`DELETE FROM public_links WHERE doc_id = ?`, docID)
	return err
}

// PurgePublicLinks removes expired links and those of notes that no longer exist.
func (s *Store) PurgePublicLinks(now time.Time) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM public_links WHERE expires_at <= ? OR doc_id NOT IN (SELECT id FROM documents)`,
		now.UTC().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DocOwner returns the owner of a note ("" when unknown).
func (s *Store) DocOwner(docID string) string {
	var owner string
	_ = s.db.QueryRow(`SELECT user_id FROM documents WHERE id = ?`, docID).Scan(&owner)
	return owner
}

// DocIcon returns a note's icon.
func (s *Store) DocIcon(docID string) string {
	var icon string
	_ = s.db.QueryRow(`SELECT icon FROM documents WHERE id = ?`, docID).Scan(&icon)
	return icon
}

// DocShowsMedia reports whether a living bullet of the note shows the file.
func (s *Store) DocShowsMedia(docID, mediaID string) bool {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM blocks WHERE document_id = ? AND deleted = 0 AND instr(content, ?) > 0`,
		docID, "media:"+mediaID).Scan(&n)
	return n > 0
}

var secretRefRE = regexp.MustCompile(`\{\{secret:[A-Za-z0-9_]+\}\}`)

// PublicSecretRef stands in for every hidden value on a public page: no id, nothing to reveal.
const PublicSecretRef = "{{secret:hidden}}"

// PublicBlocks prepares a note's blocks for strangers: deleted bullets lose their text (they stay as
// empty tombstones so the tree holds together), conflict copies go, hidden values lose their id and
// nothing tells who wrote what.
func PublicBlocks(blocks []collab.Block) []collab.Block {
	out := make([]collab.Block, 0, len(blocks))
	for _, b := range blocks {
		if b.Props.ConflictOf != "" {
			continue
		}
		b.UpdatedBy = ""
		b.Props.ConflictAuthor = ""
		if b.Deleted {
			b.Content = ""
		} else {
			// Links without the ids of other notes: visitors see the title stored in the link or its text
			b.Content = ReadableWikiLinks(secretRefRE.ReplaceAllString(b.Content, PublicSecretRef), nil)
		}
		out = append(out, b)
	}
	return out
}

// NewPublicLinkID returns a fresh id for a public link.
func NewPublicLinkID() string { return domain.NewID("pln") }
