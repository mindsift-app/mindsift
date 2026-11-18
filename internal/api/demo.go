package api

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// In demo mode the database is reset to the sample data every DEMO_RESET_MINUTES. Requests hold a read
// lock while they run and the reset takes the write lock, so no request sees half-dropped tables.
// Long-lived streams (WebSocket, SSE, long polling) are left out, otherwise the reset would wait for
// them forever; they reconnect or retry on their own. The demo accounts keep their IDs, so sessions
// stay valid; clients get DEMO_RESET and reload their data.

type demoState struct {
	gate sync.RWMutex // read: a running request, write: the reset

	mu        sync.Mutex
	nextReset time.Time
}

func isLongLivedRequest(r *http.Request) bool {
	p := r.URL.Path
	return strings.HasPrefix(p, "/api/v1/ws") || p == "/api/v1/events" ||
		(strings.HasPrefix(p, "/api/v1/docs/") && strings.HasSuffix(p, "/changes"))
}

func (s *Server) demoResetGate(next http.Handler) http.Handler {
	if !s.cfg.DemoMode {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isLongLivedRequest(r) || !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		s.demo.gate.RLock()
		defer s.demo.gate.RUnlock()
		next.ServeHTTP(w, r)
	})
}

// demoPass holds a demo reset off while a pass of a background job (alarms, compaction, live drawings)
// runs, and the pass off while a reset runs, the way the gate does for requests; call the returned func
// when the pass is done. Outside demo mode it does nothing. The pass must not wait for a request.
func (s *Server) demoPass() func() {
	if !s.cfg.DemoMode {
		return func() {}
	}
	s.demo.gate.RLock()
	return s.demo.gate.RUnlock
}

// demoNextReset is zero when no periodic reset runs.
func (s *Server) demoNextReset() time.Time {
	s.demo.mu.Lock()
	defer s.demo.mu.Unlock()
	return s.demo.nextReset
}

func (s *Server) setDemoNextReset(t time.Time) {
	s.demo.mu.Lock()
	s.demo.nextReset = t
	s.demo.mu.Unlock()
}

func (s *Server) resetDemo() {
	s.demo.gate.Lock()
	err := s.store.ResetAndSeedDemo()
	// Uploaded images and recordings belong to the old state; their rows are gone with the tables
	_ = os.RemoveAll(s.mediaRoot())
	// The next deadline is set before the gate opens and before DEMO_RESET goes out: a client that asks
	// for the status right after the event (or was held by the gate) must not get the deadline just passed,
	// or its countdown would stay at "resetting"
	if interval := s.demoResetInterval(); interval > 0 {
		s.setDemoNextReset(time.Now().Add(interval))
	}
	s.demo.gate.Unlock()
	if err != nil {
		slog.Error("Demo reset failed", "error", err)
		return
	}
	s.stats.clear()
	s.wsHub.BroadcastSystem("DEMO_RESET")
}

func (s *Server) demoResetInterval() time.Duration {
	return time.Duration(s.cfg.DemoResetMinutes) * time.Minute
}

// startDemoResetTicker waits for the deadline NewServer set first; resetDemo sets the following one itself.
func (s *Server) startDemoResetTicker() {
	for {
		if !s.wait(time.Until(s.demoNextReset())) {
			return
		}
		s.resetDemo()
	}
}

// A public demo must not send anything to the outside (FLAW-33): no alarm mails, Discord or webhook
// calls, no test messages. The senders refuse, and the routes that only exist to send or to change
// server settings answer with 403 right away. All visitors share the demo accounts, so whatever
// would lock the others out (passwords, ending sessions, deleting accounts) is refused as well.
var errDemoOutgoing = errors.New("In der Demo deaktiviert")

func (s *Server) notInDemo(h http.HandlerFunc) http.HandlerFunc {
	if !s.cfg.DemoMode {
		return h
	}
	return func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusForbidden, "In der Demo deaktiviert")
	}
}
