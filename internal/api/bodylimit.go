package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// Request bodies are capped for every endpoint (FLAW-36), so a session or API key cannot tie up memory
// with huge uploads. Note sync and imports need more; their handlers apply the same limits again.
const defaultMaxBody = 2 << 20

func (s *Server) bodyLimitFor(path string) int64 {
	switch {
	case strings.HasPrefix(path, "/api/v1/documents/") && strings.HasSuffix(path, "/media"):
		return s.mediaUploadLimit()
	case path == "/api/v1/voice/transcribe":
		return int64(s.cfg.Speech.MaxUploadMB)<<20 + 1<<20
	case strings.HasPrefix(path, "/api/v1/import/"):
		return storage.MaxImportUploadBytes + 1<<20
	case strings.HasPrefix(path, "/api/v1/docs/") && strings.HasSuffix(path, "/sync"):
		return syncMaxBody
	}
	return defaultMaxBody
}

func (s *Server) bodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil && r.Body != http.NoBody {
			r.Body = http.MaxBytesReader(w, r.Body, s.bodyLimitFor(r.URL.Path))
		}
		next.ServeHTTP(w, r)
	})
}

// The server gives every request 15 s to send its body and 30 s for the answer. Whole archives on a slow
// line need longer: downloads of backups and exports, uploads of imports (FLAW-38).
const longTransferTime = 30 * time.Minute

func allowLongTransfer(w http.ResponseWriter) {
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(longTransferTime))
	_ = rc.SetReadDeadline(time.Now().Add(longTransferTime))
}
