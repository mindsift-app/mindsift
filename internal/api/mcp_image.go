package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// MCP add_note_image: an agent adds an image to a note. The file takes the same way into the note as an
// upload in the app (saveMedia: format from the content, size limit, quota, media row) or, for an
// address, as the editor's copy of an external image (fetchExternalImage: https only, nothing in the
// server's own network); the bullet then goes in through the editor's operations, so the media gate and
// write rights apply as for every other bullet.

// mcpImageLimitText stands for the server's image limit (MEDIA_MAX_IMAGE_MB) in tool descriptions;
// tools/list puts the real number in (mcpDescription)
const mcpImageLimitText = "{imageLimit}"

// mcpDescription: a tool's description with the server's own limits
func (s *Server) mcpDescription(t mcpTool) string {
	if !strings.Contains(t.Description, mcpImageLimitText) {
		return t.Description
	}
	return strings.ReplaceAll(t.Description, mcpImageLimitText, strconv.FormatInt(s.mediaLimit("image")>>20, 10)+" MB")
}

// mcpLargeBody: MCP requests above this size (in practice add_note_image with data) take a place in
// mcpLargeGate. Reading and decoding such a request holds several copies of the image at once (the body,
// the JSON string, the decoded file), up to some 100 MB at the largest limit; a few of them in parallel
// would take a server far beyond its usual 200 MB.
const mcpLargeBody = 2 << 20

// maxMCPLargeRunning: large MCP requests handled at a time; others get a busy answer and try again
const maxMCPLargeRunning = 2

// mcpLargeGate counts the large MCP requests being handled (usable as zero value)
type mcpLargeGate struct {
	mu      sync.Mutex
	running int
}

func (g *mcpLargeGate) enter() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.running >= maxMCPLargeRunning {
		return false
	}
	g.running++
	return true
}

func (g *mcpLargeGate) leave() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.running--
}

// mcpLargeRequest: a body above mcpLargeBody, or one of unknown length (sent in chunks), which may be as large
func mcpLargeRequest(r *http.Request) bool {
	return r.ContentLength > mcpLargeBody || r.ContentLength < 0
}

func (s *Server) mcpAddNoteImage(ctx context.Context, userID string, actor *apiActor, args json.RawMessage) (any, error) {
	var a struct{ NoteID, Data, URL, Caption, AfterID, ParentID string }
	if err := decodeArgs(args, &a); err != nil {
		return nil, err
	}
	if err := s.editableNote(userID, a.NoteID); err != nil {
		return nil, err
	}
	a.Data, a.URL = strings.TrimSpace(a.Data), strings.TrimSpace(a.URL)
	if (a.Data == "") == (a.URL == "") {
		return nil, errors.New("Genau eins angeben: 'data' (Bild als base64) oder 'url' (https-Adresse eines Bildes)")
	}
	d, err := s.noteDoc(a.NoteID)
	if err != nil {
		return nil, err
	}
	// The place is checked before the file is stored, so a wrong id leaves no file behind
	parent, key, err := bulletPlace(d, a.AfterID, a.ParentID)
	if err != nil {
		return nil, err
	}
	var data []byte
	if a.Data != "" {
		if data, err = s.mcpImageData(a.Data); err != nil {
			return nil, err
		}
	} else {
		// Like the editor's copy (notInDemo): the demo server fetches nothing for visitors
		if s.cfg.DemoMode {
			return nil, errors.New("In der Demo deaktiviert")
		}
		if !s.imageSettings().External {
			return nil, errExternalImagesOff
		}
		// Stops when the client goes away; the guarded client gives up after 10 s on its own
		if data, _, err = s.fetchExternalImage(ctx, a.URL); err != nil {
			return nil, err
		}
	}
	m, _, err := s.saveMedia(userID, a.NoteID, data, "", a.URL)
	if err != nil {
		return nil, err
	}
	id := domain.NewID("blk")
	content := storage.MediaContent("image", m.ID, a.Caption)
	op := collab.Op{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: id, ParentID: &parent, OrderKey: key, Type: "image", Content: &content, Props: &collab.Props{}}
	// Should this fail, the stored file is removed with the other unused ones after mediaGrace
	if err := s.applyNoteOpsCtx(ctx, userID, actor, a.NoteID, []collab.Op{op}); err != nil {
		return nil, err
	}
	res, err := noteResult(s, userID, a.NoteID)
	if out, ok := res.(map[string]any); ok {
		out["addedId"], out["mediaId"] = id, m.ID
	}
	return res, err
}

// mcpImageData decodes the base64 of an image (optionally as a data: URL) and makes sure it is an image
// the app shows, within the image size limit, before anything is stored.
func (s *Server) mcpImageData(raw string) ([]byte, error) {
	if rest, ok := strings.CutPrefix(raw, "data:"); ok {
		header, payload, found := strings.Cut(rest, ",")
		if !found || !strings.HasSuffix(strings.ToLower(header), ";base64") {
			return nil, errors.New("'data' ist kein gültiges base64 (eine data:-URL braucht ;base64,)")
		}
		raw = payload
	}
	// Line breaks and spaces some encoders insert
	raw = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == ' ' || r == '\t' {
			return -1
		}
		return r
	}, raw)
	limit := s.mediaLimit("image")
	tooBig := i18n.NewError("Bild zu groß (höchstens {mb} MB)", "mb", strconv.FormatInt(limit>>20, 10))
	if int64(base64.RawStdEncoding.DecodedLen(len(strings.TrimRight(raw, "=")))) > limit {
		return nil, tooBig
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		if data, err = base64.RawStdEncoding.DecodeString(raw); err != nil {
			return nil, errors.New("'data' ist kein gültiges base64 (eine data:-URL braucht ;base64,)")
		}
	}
	if len(data) == 0 {
		return nil, errors.New("'data' ist kein gültiges base64 (eine data:-URL braucht ;base64,)")
	}
	if _, kind, ok := detectMedia(data, ""); !ok || kind != "image" {
		return nil, errors.New("Kein unterstütztes Bild (JPEG, PNG, GIF, WebP; kein SVG)")
	}
	return data, nil
}
