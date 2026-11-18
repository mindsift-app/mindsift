package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Images and audio in notes. Uploads need write access to the note, reading needs read access to a note
// that shows the file. Files are served through the API with the normal login (the browser loads them
// with fetch and shows a blob: URL), never under a public link.

const mediaGrace = 24 * time.Hour // uploads not yet placed in a block are kept this long

func (s *Server) mediaRoot() string { return s.store.MediaRoot() }

func (s *Server) mediaPath(m *storage.Media) string { return s.store.MediaFilePath(m) }

// mediaLimit is the largest allowed file of a kind in bytes.
func (s *Server) mediaLimit(kind string) int64 {
	mb := s.cfg.Media.MaxImageMB
	if kind == "audio" {
		mb = s.cfg.Media.MaxAudioMB
	}
	if s.cfg.DemoMode && s.cfg.Media.DemoMaxMB < mb {
		mb = s.cfg.Media.DemoMaxMB
	}
	return int64(mb) << 20
}

// imageQuality: how strongly the app compresses pictures before uploading them: MEDIA_IMAGE_QUALITY if
// set, else the admin's choice (default high). Uploads through MCP or the API are stored as sent.
func (s *Server) imageQuality() string {
	if s.cfg.Media.ImageQuality != "" {
		return s.cfg.Media.ImageQuality
	}
	if sys, _ := s.store.GetSystemSettings(); sys != nil && storage.ValidImageQuality(sys.ImageQuality) {
		return sys.ImageQuality
	}
	return storage.ImageQualityHigh
}

// audioSettings: how the app records audio and how large an uploaded audio file may be. Each value
// comes from its MEDIA_AUDIO_* variable if set, else from the admin's choice.
type audioSettings struct {
	Compression string `json:"compression"` // recordings | off
	Bitrate     int    `json:"bitrate"`     // kbit/s for recordings
	UploadMaxMB int    `json:"uploadMaxMB"` // uploaded files (recordings: MEDIA_MAX_AUDIO_MB)
}

func (s *Server) audioSettings() audioSettings {
	out := audioSettings{storage.AudioCompressionRecordings, storage.DefaultAudioBitrate, storage.DefaultAudioUploadMaxMB}
	if sys, _ := s.store.GetSystemSettings(); sys != nil {
		if storage.ValidAudioCompression(sys.AudioCompression) {
			out.Compression = sys.AudioCompression
		}
		if storage.ValidAudioBitrate(sys.AudioBitrate) {
			out.Bitrate = sys.AudioBitrate
		}
		if sys.AudioUploadMaxMB > 0 {
			out.UploadMaxMB = sys.AudioUploadMaxMB
		}
	}
	m := s.cfg.Media
	if m.AudioCompression != "" {
		out.Compression = m.AudioCompression
	}
	if m.AudioBitrate > 0 {
		out.Bitrate = m.AudioBitrate
	}
	if m.AudioUploadMaxMB > 0 {
		out.UploadMaxMB = m.AudioUploadMaxMB
	}
	// Never above the limit for every audio file (and the demo's)
	if limit := int(s.mediaLimit("audio") >> 20); out.UploadMaxMB > limit {
		out.UploadMaxMB = limit
	}
	return out
}

var detectMedia = storage.DetectMedia

func (s *Server) canEditDoc(userID, docID string) bool {
	role := s.store.DocRole(userID, docID)
	return role == "owner" || role == "editor"
}

// storeMedia checks limits and writes the file; size limits must have been applied while reading.
func (s *Server) storeMedia(w http.ResponseWriter, userID, docID string, data []byte, declared, sourceURL string) (*storage.Media, bool) {
	m, status, err := s.saveMedia(userID, docID, data, declared, sourceURL)
	if err != nil {
		writeErrorFrom(w, status, err)
		return nil, false
	}
	return m, true
}

// saveMedia is the one way a file gets into a note (upload, copy of an external image, MCP add_note_image):
// format detected from the content, size limit, quota, media row and file. On failure it returns the
// HTTP status and a message meant for people.
func (s *Server) saveMedia(userID, docID string, data []byte, declared, sourceURL string) (*storage.Media, int, error) {
	mime, kind, ok := detectMedia(data, declared)
	if !ok {
		return nil, http.StatusUnsupportedMediaType, errors.New("Nicht unterstütztes Format (Bilder: JPEG, PNG, GIF, WebP; Audio: WebM, Ogg, MP3, WAV, M4A)")
	}
	if limit := s.mediaLimit(kind); int64(len(data)) > limit {
		return nil, http.StatusRequestEntityTooLarge, i18n.NewError("Datei zu groß (höchstens {mb} MB)", "mb", strconv.FormatInt(limit>>20, 10))
	}
	if quota := int64(s.cfg.Media.QuotaMB) << 20; quota > 0 {
		used, _ := s.store.MediaUsage(userID)
		if used+int64(len(data)) > quota {
			return nil, http.StatusRequestEntityTooLarge, i18n.NewError("Speicherplatz für Medien aufgebraucht ({mb} MB)", "mb", strconv.Itoa(s.cfg.Media.QuotaMB))
		}
	}
	errSave := errors.New("Datei konnte nicht gespeichert werden")
	m, err := s.store.CreateMedia(docID, userID, kind, mime, int64(len(data)), sourceURL)
	if err != nil {
		slog.Error("Storing a media entry failed", "error", err)
		return nil, http.StatusInternalServerError, errSave
	}
	path := s.mediaPath(m)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
		err = os.WriteFile(path, data, 0o644)
		if err == nil {
			return m, 0, nil
		}
		slog.Error("Writing a media file failed", "path", path, "error", err)
	}
	logFailed("Removing the entry of a media file that was not written", s.store.DeleteMediaRow(m.ID), "id", m.ID)
	return nil, http.StatusInternalServerError, errSave
}

func mediaResponse(m *storage.Media) map[string]any {
	return map[string]any{"id": m.ID, "kind": m.Kind, "mime": m.Mime, "size": m.Size, "url": "/api/v1/media/" + m.ID}
}

// handleUploadMedia: POST /documents/{id}/media (multipart, field "file")
func (s *Server) handleUploadMedia(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	if !s.canEditDoc(userID, docID) {
		writeError(w, http.StatusForbidden, "Keine Schreibrechte für diese Notiz")
		return
	}
	allowLongTransfer(w)
	file, header, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "Datei zu groß")
			return
		}
		writeError(w, http.StatusBadRequest, "Keine Datei im Feld \"file\"")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil || len(data) == 0 {
		writeError(w, http.StatusBadRequest, "Datei konnte nicht gelesen werden")
		return
	}
	// An audio file chosen from the device has its own, smaller limit; a recording made in the app
	// (source=recording) only the limit of every audio file
	if r.FormValue("source") != "recording" {
		if _, kind, ok := detectMedia(data, header.Header.Get("Content-Type")); ok && kind == "audio" {
			if mb := s.audioSettings().UploadMaxMB; int64(len(data)) > int64(mb)<<20 {
				writeErrorFrom(w, http.StatusRequestEntityTooLarge, i18n.NewError("Audiodatei zu groß (höchstens {mb} MB)", "mb", strconv.Itoa(mb)))
				return
			}
		}
	}
	if m, ok := s.storeMedia(w, userID, docID, data, header.Header.Get("Content-Type"), ""); ok {
		writeJSON(w, http.StatusCreated, mediaResponse(m))
	}
}

// handleFetchMedia: POST /documents/{id}/media/fetch {url} copies an external image, so readers of the
// note do not contact the other server and the image stays when it disappears there.
func (s *Server) handleFetchMedia(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	if !s.canEditDoc(userID, docID) {
		writeError(w, http.StatusForbidden, "Keine Schreibrechte für diese Notiz")
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.URL) == "" {
		writeError(w, http.StatusBadRequest, "Bild-URL erforderlich")
		return
	}
	src := strings.TrimSpace(req.URL)
	data, status, err := s.fetchExternalImage(r.Context(), src)
	if err != nil {
		writeErrorFrom(w, status, err)
		return
	}
	if m, ok := s.storeMedia(w, userID, docID, data, "", src); ok {
		writeJSON(w, http.StatusCreated, mediaResponse(m))
	}
}

// mediaFetchClient: the client external images are copied with; the guard refuses the server's own
// network at connect time (DNS tricks, redirects). Tests replace it to reach a local TLS server.
var mediaFetchClient = func() *http.Client { return guardedClient(false) }

// fetchExternalImage loads an image from an https address outside the server's own network (same
// protection as alarm webhooks) within the image size limit; on failure it returns the HTTP status and a
// message meant for people. Used by the copy in the editor and by MCP add_note_image.
func (s *Server) fetchExternalImage(ctx context.Context, src string) ([]byte, int, error) {
	if err := validateWebhookURL(src, false, false); err != nil {
		return nil, http.StatusBadRequest, err
	}
	limit := s.mediaLimit("image")
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
	if err != nil {
		return nil, http.StatusBadRequest, errors.New("Ungültige URL")
	}
	httpReq.Header.Set("Accept", "image/*")
	httpReq.Header.Set("User-Agent", "MindSift (image copy)")
	resp, err := mediaFetchClient().Do(httpReq)
	if err != nil {
		return nil, http.StatusBadGateway, errors.New("Bild konnte nicht geladen werden")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, http.StatusBadGateway, i18n.NewError("Bild konnte nicht geladen werden (HTTP {status})", "status", strconv.Itoa(resp.StatusCode))
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, http.StatusBadGateway, errors.New("Bild konnte nicht geladen werden")
	}
	if int64(len(data)) > limit {
		return nil, http.StatusRequestEntityTooLarge, i18n.NewError("Bild zu groß (höchstens {mb} MB)", "mb", strconv.FormatInt(limit>>20, 10))
	}
	if _, kind, ok := detectMedia(data, ""); !ok || kind != "image" {
		return nil, http.StatusUnsupportedMediaType, errors.New("Unter dieser Adresse liegt kein Bild (JPEG, PNG, GIF, WebP)")
	}
	return data, 0, nil
}

// handleGetMedia: GET /media/{id} with range requests (seeking in audio). Readable for whoever may read
// the note the file was uploaded to or a note that shows it (storage.CanReadMedia).
func (s *Server) handleGetMedia(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	m, err := s.store.GetMedia(chi.URLParam(r, "id"))
	if err != nil || !s.store.CanReadMedia(userID, m) {
		writeError(w, http.StatusNotFound, storage.ErrMediaNotFound.Error())
		return
	}
	f, err := os.Open(s.mediaPath(m))
	if err != nil {
		writeError(w, http.StatusNotFound, storage.ErrMediaNotFound.Error())
		return
	}
	defer f.Close()
	// The content of an ID never changes; the login is checked on every request anyway
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	s.serveMediaFile(w, r, m, f)
}

// serveMediaFile sends an opened file with range requests (seeking in audio) under a strict CSP.
func (s *Server) serveMediaFile(w http.ResponseWriter, r *http.Request, m *storage.Media, f *os.File) {
	allowLongTransfer(w)
	w.Header().Set("Content-Type", m.Mime)
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	created, _ := time.Parse(time.RFC3339, m.CreatedAt)
	http.ServeContent(w, r, "", created, f)
}

// compactMedia deletes files no block mentions any more (after the grace time) and their folders.
func (s *Server) compactMedia(now time.Time) {
	orphans, err := s.store.UnreferencedMedia(now.Add(-mediaGrace))
	if err != nil {
		slog.Error("Cleaning up media files failed", "error", err)
		return
	}
	for i := range orphans {
		m := &orphans[i]
		if err := os.Remove(s.mediaPath(m)); err != nil && !os.IsNotExist(err) {
			slog.Warn("Deleting a media file failed", "id", m.ID, "error", err)
			continue
		}
		logFailed("Removing the entry of a deleted media file", s.store.DeleteMediaRow(m.ID), "id", m.ID)
		_ = os.Remove(filepath.Dir(s.mediaPath(m))) // only succeeds when the folder is empty
	}
	if len(orphans) > 0 {
		slog.Info("Unused media files deleted", "count", len(orphans))
	}
}

// bodyLimit for uploads: the largest kind plus room for the multipart envelope
func (s *Server) mediaUploadLimit() int64 {
	img, audio := s.mediaLimit("image"), s.mediaLimit("audio")
	if audio > img {
		return audio + 1<<20
	}
	return img + 1<<20
}
