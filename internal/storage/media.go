package storage

import (
	"database/sql"
	"errors"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Media files of notes (images, audio). The file lies in $DATA_DIR/media/<docID>/<id><ext>; a block
// points to it through its content, e.g. "![Beschriftung](media:med_…)", so the reference travels with
// the normal note sync, undo and conflict handling. A file is kept as long as any block (also deleted
// ones still in the log or a note in the trash) mentions it; CompactMedia removes the rest.

type Media struct {
	ID        string `json:"id"`
	DocID     string `json:"docId"`
	OwnerID   string `json:"ownerId"`
	Kind      string `json:"kind"` // image | audio
	Mime      string `json:"mime"`
	Size      int64  `json:"size"`
	SourceURL string `json:"sourceUrl,omitempty"` // copied from this address (external image)
	CreatedAt string `json:"createdAt"`
}

var ErrMediaNotFound = errors.New("Datei nicht gefunden")

// Accepted formats (detected from the content, not from the name): file extension and kind
var mediaTypes = map[string]struct{ ext, kind string }{
	"image/jpeg":      {".jpg", "image"},
	"image/png":       {".png", "image"},
	"image/gif":       {".gif", "image"},
	"image/webp":      {".webp", "image"},
	"audio/webm":      {".webm", "audio"},
	"video/webm":      {".webm", "audio"}, // Chrome's audio-only recordings are detected as video/webm
	"audio/ogg":       {".ogg", "audio"},
	"application/ogg": {".ogg", "audio"},
	"audio/mpeg":      {".mp3", "audio"},
	"audio/wave":      {".wav", "audio"},
	"audio/wav":       {".wav", "audio"},
	"audio/mp4":       {".m4a", "audio"},
	"video/mp4":       {".m4a", "audio"}, // Safari records MP4/AAC
	"audio/aac":       {".aac", "audio"},
}

// DetectMedia recognises the format from the first bytes. Browsers send audio as e.g.
// "audio/webm;codecs=opus"; that name is kept when the content looks like a container we accept.
func DetectMedia(data []byte, declared string) (mime, kind string, ok bool) {
	sniffed := http.DetectContentType(data)
	if i := strings.IndexByte(sniffed, ';'); i >= 0 {
		sniffed = sniffed[:i]
	}
	// Go does not know WebP and M4A by name; check their signatures directly
	switch {
	case len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		sniffed = "image/webp"
	case len(data) >= 12 && string(data[4:8]) == "ftyp":
		sniffed = "video/mp4"
	}
	t, ok := mediaTypes[sniffed]
	if !ok {
		return "", "", false
	}
	if t.kind == "audio" {
		if d := strings.ToLower(strings.TrimSpace(strings.SplitN(declared, ";", 2)[0])); strings.HasPrefix(d, "audio/") {
			if dt, known := mediaTypes[d]; known && dt.kind == "audio" {
				sniffed = d
			}
		} else if sniffed == "video/webm" {
			sniffed = "audio/webm"
		} else if sniffed == "video/mp4" {
			sniffed = "audio/mp4"
		}
	}
	return sniffed, t.kind, true
}

// MediaExt is the file extension for a stored format.
func MediaExt(mime string) string {
	if t, ok := mediaTypes[mime]; ok {
		return t.ext
	}
	return ".bin"
}

// MediaRoot is the folder with all media files ("" for in-memory databases).
func (s *Store) MediaRoot() string { return s.mediaRoot }

// MediaFilePath is where the file of m lies.
func (s *Store) MediaFilePath(m *Media) string {
	return filepath.Join(s.mediaRoot, filepath.Base(m.DocID), filepath.Base(m.ID)+MediaExt(m.Mime))
}

func (s *Store) migrateMedia() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS media (
			id TEXT PRIMARY KEY,
			doc_id TEXT NOT NULL,
			owner_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			mime TEXT NOT NULL,
			size INTEGER NOT NULL DEFAULT 0,
			source_url TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_media_doc ON media(doc_id)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id)`),
	)
}

func (s *Store) CreateMedia(docID, ownerID, kind, mime string, size int64, sourceURL string) (*Media, error) {
	return s.createMediaWithID(domain.NewID("med"), docID, ownerID, kind, mime, size, sourceURL)
}

func (s *Store) createMediaWithID(id, docID, ownerID, kind, mime string, size int64, sourceURL string) (*Media, error) {
	m := &Media{ID: id, DocID: docID, OwnerID: ownerID, Kind: kind, Mime: mime, Size: size,
		SourceURL: sourceURL, CreatedAt: nowUTC()}
	_, err := s.db.Exec(`INSERT INTO media (id, doc_id, owner_id, kind, mime, size, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.DocID, m.OwnerID, m.Kind, m.Mime, m.Size, m.SourceURL, m.CreatedAt)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (s *Store) GetMedia(id string) (*Media, error) {
	var m Media
	err := s.db.QueryRow(`SELECT id, doc_id, owner_id, kind, mime, size, source_url, created_at FROM media WHERE id = ?`, id).
		Scan(&m.ID, &m.DocID, &m.OwnerID, &m.Kind, &m.Mime, &m.Size, &m.SourceURL, &m.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrMediaNotFound
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// DeleteMediaRow forgets a file (the caller removes it from disk).
func (s *Store) DeleteMediaRow(id string) error {
	_, err := s.db.Exec(`DELETE FROM media WHERE id = ?`, id)
	return err
}

// MediaUsage is the stored size of all files the user uploaded.
func (s *Store) MediaUsage(ownerID string) (int64, error) {
	var n sql.NullInt64
	err := s.db.QueryRow(`SELECT SUM(size) FROM media WHERE owner_id = ?`, ownerID).Scan(&n)
	return n.Int64, err
}

// MediaReferencedIn lists the notes whose blocks (deleted ones included) point to the file. A block
// copied into another note keeps working there.
func (s *Store) MediaReferencedIn(id string) ([]string, error) {
	rows, err := s.db.Query(`SELECT DISTINCT document_id FROM blocks WHERE instr(content, ?) > 0`, "media:"+id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var docs []string
	for rows.Next() {
		var d string
		if rows.Scan(&d) == nil {
			docs = append(docs, d)
		}
	}
	return docs, rows.Err()
}

// UnreferencedMedia returns files older than the grace time that no block mentions any more. The grace
// time covers uploads whose block has not reached the server yet (offline, slow sync).
func (s *Store) UnreferencedMedia(olderThan time.Time) ([]Media, error) {
	rows, err := s.db.Query(`SELECT id, doc_id, owner_id, kind, mime, size, source_url, created_at FROM media m
		WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM blocks b WHERE instr(b.content, 'media:' || m.id) > 0)`,
		olderThan.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Media
	for rows.Next() {
		var m Media
		if rows.Scan(&m.ID, &m.DocID, &m.OwnerID, &m.Kind, &m.Mime, &m.Size, &m.SourceURL, &m.CreatedAt) == nil {
			out = append(out, m)
		}
	}
	return out, rows.Err()
}

// MediaOfUser lists the files shown in the user's own notes (for backups and exports).
func (s *Store) MediaOfUser(userID string) ([]Media, error) {
	rows, err := s.db.Query(`SELECT DISTINCT m.id, m.doc_id, m.owner_id, m.kind, m.mime, m.size, m.source_url, m.created_at
		FROM media m JOIN blocks b ON instr(b.content, 'media:' || m.id) > 0
		JOIN documents d ON d.id = b.document_id WHERE d.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Media
	for rows.Next() {
		var m Media
		if rows.Scan(&m.ID, &m.DocID, &m.OwnerID, &m.Kind, &m.Mime, &m.Size, &m.SourceURL, &m.CreatedAt) == nil {
			out = append(out, m)
		}
	}
	return out, rows.Err()
}

// MediaRef is a block's pointer to a file: ![caption](media:id) for images, [caption](media:id) for audio.
type MediaRef struct{ ID, Caption string }

var mediaRefRe = regexp.MustCompile(`^!?\[((?:[^\]\\]|\\.)*)\]\(media:(med_[0-9a-f]+)\)$`)
var mediaRefEsc = regexp.MustCompile(`\\(.)`)

func ParseMediaContent(content string) (MediaRef, bool) {
	m := mediaRefRe.FindStringSubmatch(strings.TrimSpace(content))
	if m == nil {
		return MediaRef{}, false
	}
	return MediaRef{ID: m[2], Caption: mediaRefEsc.ReplaceAllString(m[1], "$1")}, true
}

// MediaContent builds a block's content for a file (same format as the browser, lib/media.ts).
func MediaContent(kind, id, caption string) string {
	caption = strings.Join(strings.Fields(strings.ReplaceAll(caption, "\n", " ")), " ")
	caption = strings.NewReplacer(`\`, `\\`, `]`, `\]`).Replace(caption)
	prefix := ""
	if kind == "image" {
		prefix = "!"
	}
	return prefix + "[" + caption + "](media:" + id + ")"
}
