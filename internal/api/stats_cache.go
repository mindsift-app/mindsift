package api

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// statsCacheTTL: how long the counters of the navigation (GET /stats, /auth/me) are answered from memory.
// A burst of requests from one person (several tabs or devices, an action and its realtime echo) costs one
// computation of the nine counting queries (storage.GetDashboardStats).
const statsCacheTTL = 3 * time.Second

// statsCacheMaxUsers: above this many entries, entries that ran out are dropped when a new one is stored
const statsCacheMaxUsers = 1024

// statsCache keeps the counters per user for statsCacheTTL. An entry is dropped as soon as the user may
// see other numbers: on every change the user sends (invalidateStatsOnWrite) and on every realtime event
// delivered to the user (the hub's delivery listener), since events are what tell the app that counters
// changed. A computation that overlaps such a drop is not stored (generation check), so the acting user
// always gets numbers that include the own change.
type statsCache struct {
	mu      sync.Mutex
	entries map[string]*statsEntry
	nextGen uint64
	now     func() time.Time // tests set it
}

type statsEntry struct {
	gen    uint64 // changes on every invalidation
	stats  *domain.DashboardStats
	at     time.Time    // when the stored computation started
	flight *statsFlight // the computation of the current generation, while it runs
}

// statsFlight is one running computation; requests that join it get its result.
type statsFlight struct {
	gen  uint64
	done chan struct{} // closed when st and err are set
	st   *domain.DashboardStats
	err  error
}

func newStatsCache() *statsCache {
	return &statsCache{entries: make(map[string]*statsEntry), now: time.Now}
}

// get answers from the cache or computes the counters. A request joins a computation only when that one
// started after the last invalidation (so it includes every change made before the request) and then takes
// its result; otherwise it computes in parallel. Nobody waits for more than one computation, also while
// changes keep coming (each of them invalidates).
func (c *statsCache) get(userID string, compute func() (*domain.DashboardStats, error)) (*domain.DashboardStats, error) {
	c.mu.Lock()
	e := c.entries[userID]
	if e == nil {
		c.nextGen++
		e = &statsEntry{gen: c.nextGen}
		c.entries[userID] = e
	}
	if e.stats != nil && c.now().Sub(e.at) < statsCacheTTL {
		st := *e.stats
		c.mu.Unlock()
		return &st, nil
	}
	if f := e.flight; f != nil && f.gen == e.gen {
		c.mu.Unlock()
		<-f.done
		if f.err != nil || f.st == nil {
			return f.st, f.err
		}
		st := *f.st
		return &st, nil
	}
	f := &statsFlight{gen: e.gen, done: make(chan struct{})}
	e.flight = f
	started := c.now()
	c.mu.Unlock()

	st, err := compute()
	if st != nil {
		cp := *st
		f.st = &cp
	}
	f.err = err

	c.mu.Lock()
	if cur := c.entries[userID]; cur != nil {
		if cur.flight == f {
			cur.flight = nil
		}
		if err == nil && f.st != nil && cur.gen == f.gen {
			cp := *f.st
			cur.stats, cur.at = &cp, started
		}
	}
	c.pruneLocked()
	c.mu.Unlock()
	close(f.done)
	return st, err
}

// invalidate drops the user's counters; a computation running right now is not stored.
func (c *statsCache) invalidate(userID string) {
	if userID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.entries[userID]
	if e == nil {
		// Nothing stored and nothing running for the user: nothing to drop
		return
	}
	c.nextGen++
	e.gen = c.nextGen
	e.stats = nil
	// A computation that runs for the old generation ends without storing; new requests do not join it
}

// clear drops all counters (demo reset: the whole database changed).
func (c *statsCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range c.entries {
		c.nextGen++
		e.gen = c.nextGen
		e.stats = nil
	}
}

// pruneLocked keeps the map small: entries without counters in time and without a running computation go.
func (c *statsCache) pruneLocked() {
	if len(c.entries) <= statsCacheMaxUsers {
		return
	}
	now := c.now()
	for uid, e := range c.entries {
		if e.flight == nil && (e.stats == nil || now.Sub(e.at) >= statsCacheTTL) {
			delete(c.entries, uid)
		}
	}
}

// dashboardStats: the counters of the navigation, from the cache when they are fresh.
func (s *Server) dashboardStats(userID string) (*domain.DashboardStats, error) {
	return s.stats.get(userID, func() (*domain.DashboardStats, error) { return s.store.GetDashboardStats(userID) })
}

// statsEventDelivered: a realtime event reached the user (hub delivery listener). Events that can change
// a counter drop the user's cached counters, the same events the app reloads them for
// (frontend/src/app/realtimeCounters.ts): tasks, notes, lists, but not DOC_SEQ (edits inside a note),
// ITEM_REORDERED, live drawing or notifications.
func (s *Server) statsEventDelivered(userID, event string) {
	if eventChangesStats(event) {
		s.stats.invalidate(userID)
	}
}

// statsEventPrefixes: the families of events that can change a counter (TASK_LIST_* included)
var statsEventPrefixes = []string{"TASK_", "DOC_", "ITEM_", "LIST_"}

func eventChangesStats(event string) bool {
	if event == eventDocSeq || event == eventItemReordered {
		return false
	}
	for _, prefix := range statsEventPrefixes {
		if strings.HasPrefix(event, prefix) {
			return true
		}
	}
	return false
}

// invalidateStatsOnWrite: every change the user sends (any method but GET, HEAD and OPTIONS) drops the
// user's cached counters, before and after the handler, so the next GET /stats includes it.
func (s *Server) invalidateStatsOnWrite(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		userID := auth.GetUserID(r.Context())
		s.stats.invalidate(userID)
		defer s.stats.invalidate(userID)
		next.ServeHTTP(w, r)
	})
}
