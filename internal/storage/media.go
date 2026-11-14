package storage

import (
	"database/sql"
	"errors"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
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
	rows, err := s.db.Query(sqlDocsWithMedia, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var docs []string
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		docs = append(docs, d)
	}
	return docs, rows.Err()
}

// UnreferencedMedia returns files older than the grace time that no block mentions any more. The grace
// time covers uploads whose block has not reached the server yet (offline, slow sync). A file only a
// bullet beyond maxBlockRefs references mentions is not one of them (mediaBeyondRefCap).
func (s *Store) UnreferencedMedia(olderThan time.Time) ([]Media, error) {
	out, err := s.queryMedia(sqlUnreferencedMedia, olderThan.UTC().Format(time.RFC3339))
	if err != nil || len(out) == 0 {
		return out, err
	}
	beyond, err := s.mediaBeyondRefCap("")
	if err != nil {
		return nil, err
	}
	kept := out[:0]
	for _, m := range out {
		if len(beyond[m.ID]) == 0 {
			kept = append(kept, m)
		}
	}
	return kept, nil
}

// MediaOfUser lists the files shown in the user's own notes (for backups and exports), also those a
// bullet beyond maxBlockRefs references shows.
func (s *Store) MediaOfUser(userID string) ([]Media, error) {
	out, err := s.queryMedia(sqlMediaOfUser, userID)
	if err != nil {
		return nil, err
	}
	beyond, err := s.mediaBeyondRefCap(userID)
	if err != nil || len(beyond) == 0 {
		return out, err
	}
	have := map[string]bool{}
	for _, m := range out {
		have[m.ID] = true
	}
	for id := range beyond {
		if have[id] {
			continue
		}
		if m, err := s.GetMedia(id); err == nil {
			out = append(out, *m)
		} else if !errors.Is(err, ErrMediaNotFound) {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) queryMedia(q string, args ...any) ([]Media, error) {
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Media
	for rows.Next() {
		var m Media
		if err := rows.Scan(&m.ID, &m.DocID, &m.OwnerID, &m.Kind, &m.Mime, &m.Size, &m.SourceURL, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
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

// CanReadMedia: the user may read the note the file was uploaded to, or a note whose bullets show it
// (e.g. a bullet copied into another note).
func (s *Store) CanReadMedia(userID string, m *Media) bool {
	if s.DocRole(userID, m.DocID) != "" {
		return true
	}
	docs, _ := s.MediaReferencedIn(m.ID)
	for _, d := range docs {
		if s.DocRole(userID, d) != "" {
			return true
		}
	}
	return false
}

// A bullet that shows a file makes the file readable for everyone who may read its note (CanReadMedia).
// So a bullet may only point to a file its writer uploaded or may read already; otherwise knowing the id
// of someone else's file would be enough to read it, by writing ![…](media:<id>) into an own note or
// importing a note that does (FLAW-43). mediaGate drops the other references from content one person
// writes. It runs where content comes in: sync and MCP operations, new notes (imports included) and a
// task's title carried into its note. Moving bullets between notes on the server copies content the
// person can read already.
type mediaGate struct {
	s      *Store
	userID string
	keep   map[string]bool // ids fine without a check (files an import brings along, stored after the note)
	known  map[string]bool // ids checked so far
	lang   string          // for the placeholder, read once it is needed

	docID   string          // the note the content goes into ("" for a new note or a task title)
	present map[string]bool // files its bullets (deleted ones too) show now, read once it is needed
	extra   int             // lookups left for files beyond maxBlockRefs in a bullet (for the whole gate)
}

func (s *Store) newMediaGate(userID string, keep map[string]bool) *mediaGate {
	return &mediaGate{s: s, userID: userID, keep: keep, known: map[string]bool{}, extra: maxBlockRefs}
}

// newDocMediaGate is newMediaGate for content written into an existing note: files beyond maxBlockRefs
// in a bullet stay when the note shows them already (inNote).
func (s *Store) newDocMediaGate(userID, docID string) *mediaGate {
	g := s.newMediaGate(userID, nil)
	g.docID = docID
	return g
}

// inNote: a bullet of the gate's note (a deleted one too) shows the file now. The note's bullets with
// files are read once per gate and only for a bullet with more than maxBlockRefs files, so this costs
// one query per request at most. A file there entered the note through the gate before (or as content
// the person could read), and beyond maxBlockRefs it gets no block_refs row, so keeping it there grants
// no one a read right they did not have.
func (g *mediaGate) inNote(id string) bool {
	if g.docID == "" {
		return false
	}
	if g.present == nil {
		g.present = map[string]bool{}
		rows, err := g.s.db.Query(`SELECT content FROM blocks WHERE document_id = ? AND instr(content, 'media:') > 0`, g.docID)
		if err != nil {
			return false
		}
		defer rows.Close()
		for rows.Next() {
			var content string
			if rows.Scan(&content) != nil {
				return false
			}
			for _, m := range mediaIDRe.FindAllStringSubmatch(content, -1) {
				g.present[m[1]] = true
			}
		}
	}
	return g.present[id]
}

// allowed: the file exists and the person uploaded it or may read it.
func (g *mediaGate) allowed(id string) bool {
	if g.keep[id] {
		return true
	}
	if ok, seen := g.known[id]; seen {
		return ok
	}
	m, err := g.s.GetMedia(id)
	ok := err == nil && (m.OwnerID == g.userID || g.s.CanReadMedia(g.userID, m))
	g.known[id] = ok
	return ok
}

// mediaLinkRe: a reference with its caption anywhere in the content (image or audio)
var mediaLinkRe = regexp.MustCompile(`!?\[((?:[^\]\\]|\\.)*)\]\(media:(med_[0-9a-f]+)\)`)

// clean returns the content without references to files the person may not show: an image or a
// recording becomes its caption (a placeholder without one), a bare "media:<id>" the placeholder.
// changed is false when everything stays.
//
// Like block_refs, the first maxBlockRefs files of a bullet are each checked, so a bullet full of
// made-up ids costs at most that many lookups. A file beyond them must not get lost either: editing an
// old bullet with more pictures than the cap sends its whole text again. Such a file stays when the
// import brings it along (keep), was checked already (known), or the note shows it now (inNote, one
// query per gate); otherwise it is checked while the gate's extra lookups last (a new picture added to
// a big table) and dropped after that. Files beyond the cap get no block_refs row (blockRefsOf counts
// the same way), so keeping them grants no read right; an edit that moves one into the first
// maxBlockRefs comes through here again and has it checked.
func (g *mediaGate) clean(content string) (out string, changed bool) {
	if !strings.Contains(content, "media:") {
		return content, false
	}
	ok := map[string]bool{}
	denied := false
	for _, m := range mediaIDRe.FindAllStringSubmatch(content, -1) {
		id := m[1]
		if _, seen := ok[id]; !seen {
			if len(ok) < maxBlockRefs {
				ok[id] = g.allowed(id)
			} else {
				ok[id] = g.keep[id] || g.known[id] || g.inNote(id)
				if !ok[id] && g.extra > 0 {
					if _, seen := g.known[id]; !seen {
						g.extra--
						ok[id] = g.allowed(id)
					}
				}
			}
			denied = denied || !ok[id]
		}
	}
	if !denied {
		return content, false
	}
	out = mediaLinkRe.ReplaceAllStringFunc(content, func(link string) string {
		m := mediaLinkRe.FindStringSubmatch(link)
		if ok[m[2]] {
			return link
		}
		if caption := strings.TrimSpace(mediaRefEsc.ReplaceAllString(m[1], "$1")); caption != "" {
			return caption
		}
		return g.placeholderFor(link)
	})
	out = mediaIDRe.ReplaceAllStringFunc(out, func(ref string) string {
		if ok[strings.TrimPrefix(ref, "media:")] {
			return ref
		}
		return g.placeholderFor(ref)
	})
	return out, true
}

func (g *mediaGate) placeholder() string {
	if g.lang == "" {
		g.lang = g.s.MessageLanguage(g.userID)
	}
	return i18n.T(g.lang, "(Datei nicht übernommen)")
}

// placeholderFor replaces a reference without caption: the placeholder, or nothing where the placeholder
// is longer than the reference (a short made-up id; real ids are longer). Dropping files never makes
// content longer, so a bullet just under the length limit full of such references is not refused as
// too long (re-test 2026-11-14, side finding 2).
func (g *mediaGate) placeholderFor(ref string) string {
	if p := g.placeholder(); len(p) <= len(ref) {
		return p
	}
	return ""
}

// cleanBlock drops from a bullet what the person may not show; an image or audio bullet that loses its
// file becomes a plain bullet with the caption.
func (g *mediaGate) cleanBlock(typ, content string) (string, string, bool) {
	out, changed := g.clean(content)
	if !changed {
		return typ, content, false
	}
	if typ == "image" || typ == "audio" {
		if _, still := ParseMediaContent(out); !still {
			typ = "bullet"
		}
	}
	return typ, out, true
}

// cleanBlocks applies cleanBlock to bullets (copied on the first change, the caller's list stays).
func (g *mediaGate) cleanBlocks(blocks []domain.DocumentBlock) (_ []domain.DocumentBlock, dropped bool) {
	out := blocks
	for i, b := range blocks {
		typ, content, changed := g.cleanBlock(b.Type, b.Content)
		if !changed {
			continue
		}
		if !dropped {
			out = append([]domain.DocumentBlock(nil), blocks...)
			dropped = true
		}
		out[i].Type, out[i].Content = typ, content
	}
	return out, dropped
}

// cleanOps applies cleanBlock to inserted and changed bullets (copied on the first change).
func (g *mediaGate) cleanOps(ops []collab.Op) []collab.Op {
	out := ops
	copied := false
	for i, op := range ops {
		if op.Content == nil || (op.Kind != collab.OpInsert && op.Kind != collab.OpSetContent) {
			continue
		}
		typ, content, changed := g.cleanBlock(op.Type, *op.Content)
		if !changed {
			continue
		}
		if !copied {
			out = append([]collab.Op(nil), ops...)
			copied = true
		}
		out[i].Content = &content
		if op.Kind == collab.OpInsert {
			out[i].Type = typ
		}
	}
	return out
}
