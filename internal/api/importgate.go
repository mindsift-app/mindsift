package api

import (
	"net/http"
	"sync"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// importGate lets one import per person and maxImportsRunning per server run at a time, previews and
// restores of a server backup included. An import reads and converts a whole archive; a few at once
// would take the memory of a small server, and nobody needs two of their own in parallel.
type importGate struct {
	mu      sync.Mutex
	running map[string]bool
}

const maxImportsRunning = 2

func (g *importGate) enter(userID string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.running == nil {
		g.running = map[string]bool{}
	}
	if g.running[userID] || len(g.running) >= maxImportsRunning {
		return false
	}
	g.running[userID] = true
	return true
}

func (g *importGate) leave(userID string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.running, userID)
}

// startImport claims a place for the caller's import, or answers 429. The caller defers done. Uploads
// call it once the file is read (larger ones wait in a temporary file, not in memory): an answer sent
// while the browser is still uploading can get lost when the server closes the connection.
func (s *Server) startImport(w http.ResponseWriter, r *http.Request) (done func(), ok bool) {
	userID := auth.GetUserID(r.Context())
	if !s.imports.enter(userID) {
		w.Header().Set("Retry-After", "30")
		writeError(w, http.StatusTooManyRequests, "Gerade läuft schon ein Import. Bitte versuche es gleich noch einmal.")
		return nil, false
	}
	return func() { s.imports.leave(userID) }, true
}
