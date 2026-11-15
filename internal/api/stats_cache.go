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
	gen   uint64 // changes on every invalidation
	stats *domain.DashboardStats
	at    time.Time     // when the stored computation started
	wait  chan struct{} // closed when the running computation for gen ends; nil while none runs
}

func newStatsCache() *statsCache {
	return &statsCache{entries: make(map[string]*statsEntry), now: time.Now}
}

// get answers from the cache or computes the counters; parallel requests of the same user wait for one
// computation.
func (c *statsCache) get(userID string, compute func() (*domain.DashboardStats, error)) (*domain.DashboardStats, error) {
	for {
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
		if e.wait != nil {
			// Someone computes this generation already: wait and look again
			wait := e.wait
			c.mu.Unlock()
			<-wait
			continue
		}
		gen, started := e.gen, c.now()
		wait := make(chan struct{})
		e.wait = wait
		c.mu.Unlock()

		st, err := compute()

		c.mu.Lock()
		if cur := c.entries[userID]; cur != nil && cur.wait == wait {
			cur.wait = nil
			if err == nil && st != nil && cur.gen == gen {
				cp := *st
				cur.stats, cur.at = &cp, started
			}
		}
		c.pruneLocked()
		c.mu.Unlock()
		close(wait)
		return st, err
	}
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
	// A computation that runs for the old generation ends without storing; waiting requests then compute
	// the new one (wait stays: it belongs to the running computation)
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
		if e.wait == nil && (e.stats == nil || now.Sub(e.at) >= statsCacheTTL) {
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

func eventChangesStats(event string) bool {
	if event == "DOC_SEQ" || event == "ITEM_REORDERED" {
		return false
	}
	for _, prefix := range []string{"TASK_", "DOC_", "SPACE_", "ITEM_", "LIST_"} {
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
