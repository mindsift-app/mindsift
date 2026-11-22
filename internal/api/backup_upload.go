package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Uploading a full backup to restore it (moving to a new server): in chunks, resumable, so a reverse proxy
// with a body limit and a dropped connection do not break a file of several GB.
//
//	POST   /admin/backups/uploads             {name, size}         → {id, size, offset, chunkSize}
//	GET    /admin/backups/uploads/{id}                             → {id, size, offset}  (resume)
//	PUT    /admin/backups/uploads/{id}?offset=N   raw bytes        → {offset}; X-Chunk-SHA256 checked when sent
//	POST   /admin/backups/uploads/{id}/restore {confirm, sha256}   → the restore (fullrestore.go)
//	DELETE /admin/backups/uploads/{id}
//
// The file grows in $DATA_DIR/backup-uploads/<id>/upload; a chunk that does not start at the end so far is
// refused with the real offset (409), one whose checksum does not match is cut off again. The checksum of
// the whole file (sha256 below) is checked before the restore. One upload at a time: a new one replaces
// the others; one untouched for uploadAbandonAfter is removed by the hourly cleanup.

const (
	// uploadChunkSize: what the app sends per request; small enough for the usual proxy limits once they
	// allow media uploads, the app halves it when a proxy answers 413
	uploadChunkSize = 32 << 20
	// maxUploadChunk: the largest chunk the server takes
	maxUploadChunk     = 64 << 20
	uploadAbandonAfter = 24 * time.Hour
	uploadsDir         = "backup-uploads"
	// uploadHashBlock: the checksum of an upload is SHA-256 over the SHA-256 of each 32 MiB block, which a
	// browser can compute piece by piece (WebCrypto has no streaming hash)
	uploadHashBlock = 32 << 20
)

var (
	uploadIDRe          = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`) // randomToken(16)
	errUploadGone       = errors.New("Der Upload ist nicht mehr da. Bitte die Datei noch einmal wählen.")
	errUploadIncomplete = errors.New("Der Upload ist noch nicht vollständig")
	errUploadChecksum   = errors.New("Die Prüfsumme stimmt nicht: die Datei ist beim Hochladen beschädigt worden")
	errUploadChunk      = errors.New("Ein Teil der Datei kam beschädigt an. Bitte noch einmal versuchen.")
	errUploadSize       = errors.New("Ungültige Dateigröße")
	uploadMu            sync.Mutex
)

type uploadMeta struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	UserID  string `json:"userId"`
	Created string `json:"created"`
}

func (s *Server) uploadsRoot() string {
	return filepath.Join(filepath.Dir(s.cfg.DatabasePath), uploadsDir)
}

// maxRestoreUploadBytes: RESTORE_UPLOAD_MAX_GB (default 100 GB)
func (s *Server) maxRestoreUploadBytes() int64 {
	gb := s.cfg.RestoreUploadMaxGB
	if gb <= 0 {
		gb = 100
	}
	return int64(gb) << 30
}

func errUploadTooBig(limit int64) error {
	return i18n.NewError("Die Datei ist zu groß (max. {gb} GB)", "gb", strconv.FormatInt(limit>>30, 10))
}

func (s *Server) uploadDir(id string) (string, bool) {
	if !uploadIDRe.MatchString(id) {
		return "", false
	}
	dir := filepath.Join(s.uploadsRoot(), id)
	if info, err := os.Lstat(dir); err != nil || !info.IsDir() {
		return "", false
	}
	return dir, true
}

func readUploadMeta(dir string) (*uploadMeta, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "meta.json"))
	if err != nil {
		return nil, err
	}
	var m uploadMeta
	return &m, json.Unmarshal(raw, &m)
}

func uploadOffset(dir string) int64 {
	if info, err := os.Stat(filepath.Join(dir, "upload")); err == nil {
		return info.Size()
	}
	return 0
}

// handleUploadStart: POST /admin/backups/uploads {name, size}
func (s *Server) handleUploadStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil || req.Size <= 0 {
		writeErrorFrom(w, http.StatusBadRequest, errUploadSize)
		return
	}
	if limit := s.maxRestoreUploadBytes(); req.Size > limit {
		writeErrorFrom(w, http.StatusRequestEntityTooLarge, errUploadTooBig(limit))
		return
	}
	id, err := randomToken(16)
	if err != nil {
		writeInternal(w, err)
		return
	}
	uploadMu.Lock()
	defer uploadMu.Unlock()
	logFailed("Removing earlier backup uploads", os.RemoveAll(s.uploadsRoot()))
	dir := filepath.Join(s.uploadsRoot(), id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		writeInternal(w, err)
		return
	}
	name := filepath.Base(strings.ReplaceAll(req.Name, `\`, "/"))
	if len(name) > 200 {
		name = name[:200]
	}
	meta := uploadMeta{ID: id, Name: name, Size: req.Size, UserID: auth.GetUserID(r.Context()), Created: time.Now().UTC().Format(time.RFC3339)}
	raw, _ := json.Marshal(meta)
	if err := os.WriteFile(filepath.Join(dir, "meta.json"), raw, 0o600); err != nil {
		writeInternal(w, err)
		return
	}
	if err := os.WriteFile(filepath.Join(dir, "upload"), nil, 0o600); err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": name, "size": req.Size, "offset": 0, "chunkSize": uploadChunkSize, "maxChunkSize": maxUploadChunk})
}

// handleUploadStatus: GET /admin/backups/uploads/{id}
func (s *Server) handleUploadStatus(w http.ResponseWriter, r *http.Request) {
	dir, ok := s.uploadDir(chi.URLParam(r, "id"))
	if !ok {
		writeErrorFrom(w, http.StatusNotFound, errUploadGone)
		return
	}
	meta, err := readUploadMeta(dir)
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, errUploadGone)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": meta.ID, "name": meta.Name, "size": meta.Size, "offset": uploadOffset(dir), "chunkSize": uploadChunkSize, "maxChunkSize": maxUploadChunk})
}

// handleUploadChunk: PUT /admin/backups/uploads/{id}?offset=N
func (s *Server) handleUploadChunk(w http.ResponseWriter, r *http.Request) {
	allowLongTransfer(w) // a chunk on a slow line takes longer than the server's 15 s for a body
	dir, ok := s.uploadDir(chi.URLParam(r, "id"))
	if !ok {
		writeErrorFrom(w, http.StatusNotFound, errUploadGone)
		return
	}
	uploadMu.Lock()
	defer uploadMu.Unlock()
	meta, err := readUploadMeta(dir)
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, errUploadGone)
		return
	}
	offset, err := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	have := uploadOffset(dir)
	if err != nil || offset != have {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "offset", "offset": have})
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "upload"), os.O_WRONLY, 0o600)
	if err != nil {
		writeInternal(w, err)
		return
	}
	defer f.Close()
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		writeInternal(w, err)
		return
	}
	h := sha256.New()
	limit := min(int64(maxUploadChunk), meta.Size-offset)
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(r.Body, limit+1))
	cut := func() { _ = f.Truncate(offset) }
	if err != nil {
		cut()
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeErrorFrom(w, http.StatusRequestEntityTooLarge, errUploadTooBig(maxUploadChunk))
			return
		}
		writeErrorFrom(w, http.StatusBadRequest, errUploadChunk)
		return
	}
	if n > limit {
		cut()
		writeErrorFrom(w, http.StatusBadRequest, errUploadSize)
		return
	}
	if want := strings.ToLower(r.Header.Get("X-Chunk-SHA256")); want != "" && want != hex.EncodeToString(h.Sum(nil)) {
		cut()
		writeErrorFrom(w, http.StatusBadRequest, errUploadChunk)
		return
	}
	now := time.Now()
	_ = os.Chtimes(dir, now, now) // touched: not abandoned
	writeJSON(w, http.StatusOK, map[string]any{"offset": offset + n, "size": meta.Size})
}

// uploadChecksum: SHA-256 over the SHA-256 of each uploadHashBlock of the file, hex.
func uploadChecksum(file string) (string, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
	outer := sha256.New()
	buf := make([]byte, 1<<20)
	for {
		block := sha256.New()
		n, err := io.CopyBuffer(block, io.LimitReader(f, uploadHashBlock), buf)
		if err != nil {
			return "", err
		}
		if n == 0 {
			break
		}
		outer.Write(block.Sum(nil))
		if n < uploadHashBlock {
			break
		}
	}
	return hex.EncodeToString(outer.Sum(nil)), nil
}

// handleUploadRestore: POST /admin/backups/uploads/{id}/restore {confirm: name, sha256}
func (s *Server) handleUploadRestore(w http.ResponseWriter, r *http.Request) {
	allowLongTransfer(w)
	id := chi.URLParam(r, "id")
	dir, ok := s.uploadDir(id)
	if !ok {
		writeErrorFrom(w, http.StatusNotFound, errUploadGone)
		return
	}
	meta, err := readUploadMeta(dir)
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, errUploadGone)
		return
	}
	var req restoreRequest
	_ = json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req)
	if req.Confirm != meta.Name {
		writeErrorFrom(w, http.StatusBadRequest, errRestoreConfirm)
		return
	}
	if uploadOffset(dir) != meta.Size {
		writeErrorFrom(w, http.StatusConflict, errUploadIncomplete)
		return
	}
	file := filepath.Join(dir, "upload")
	sum, err := uploadChecksum(file)
	if err != nil {
		writeInternal(w, err)
		return
	}
	if !strings.EqualFold(sum, req.SHA256) {
		slog.Warn("Uploaded backup refused: checksum mismatch", "upload", id)
		writeErrorFrom(w, http.StatusBadRequest, errUploadChecksum)
		return
	}
	s.restoreFrom(w, r, meta.Name, true, req.AcceptKeyMismatch, stageUploadedBackup(file), func() {
		// Staged: the upload itself is no longer needed
		logFailed("Removing a restored backup upload", os.RemoveAll(dir))
	})
}

// handleUploadDiscard: DELETE /admin/backups/uploads/{id}
func (s *Server) handleUploadDiscard(w http.ResponseWriter, r *http.Request) {
	if dir, ok := s.uploadDir(chi.URLParam(r, "id")); ok {
		uploadMu.Lock()
		logFailed("Removing a backup upload", os.RemoveAll(dir))
		uploadMu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// runUploadCleanup removes uploads nobody touched for uploadAbandonAfter (hourly).
func (s *Server) runUploadCleanup(now time.Time) {
	entries, err := os.ReadDir(s.uploadsRoot())
	if err != nil {
		return
	}
	uploadMu.Lock()
	defer uploadMu.Unlock()
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || now.Sub(info.ModTime()) < uploadAbandonAfter {
			continue
		}
		logFailed("Removing an abandoned backup upload", os.RemoveAll(filepath.Join(s.uploadsRoot(), e.Name())))
	}
}
