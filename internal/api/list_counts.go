package api

import (
	"sync"
	"time"
)

// The list overview shows the number of open entries of every list, but the entries' events (ITEM_*) go
// to the open list's room only (sending every entry to everyone would multiply the traffic of a busy
// list). So a change of the open entries marks the list, and at most once per listCountsDelay its open
// count is worked out (one COUNT) and sent as LIST_COUNTS {listId, open} to everyone who sees the list,
// only when it differs from the count sent last: a burst of ticks makes one small event, not one each.
const (
	listCountsDelay = 3 * time.Second
	// listCountsKeep: lists whose last count is remembered; beyond that the memory starts over
	listCountsKeep = 10000
)

type listCountsState struct {
	mu   sync.Mutex
	due  map[string]time.Time // list → when its count is checked
	last map[string]int       // list → the open count sent last
}

// broadcastListItemEvent sends an entry event to the list's room (BroadcastListEvent) and, when it can
// change the open entries, marks the list for LIST_COUNTS. Every entry event goes through here.
func (s *Server) broadcastListItemEvent(listID, event string, payload any) {
	s.wsHub.BroadcastListEvent(listID, event, payload)
	switch event {
	case eventItemCreated, eventItemToggled, eventItemDeleted, eventListCleared:
		s.touchListCounts(listID, time.Now())
	}
}

// touchListCounts marks a list whose open entries may have changed; changes until the check are folded in.
func (s *Server) touchListCounts(listID string, now time.Time) {
	c := &s.listCounts
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.due == nil {
		c.due = map[string]time.Time{}
	}
	if _, ok := c.due[listID]; !ok {
		c.due[listID] = now.Add(listCountsDelay)
	}
}

// sendDueListCounts checks the lists due at now and sends the counts that changed (ticker of doc_counts.go).
func (s *Server) sendDueListCounts(now time.Time) {
	c := &s.listCounts
	var ids []string
	c.mu.Lock()
	for id, at := range c.due {
		if !at.After(now) {
			ids = append(ids, id)
			delete(c.due, id)
		}
	}
	c.mu.Unlock()

	ctx, cancel := s.stopContext()
	defer cancel()
	for _, id := range ids {
		open, err := s.store.CountOpenListItems(ctx, id)
		if err != nil {
			continue
		}
		c.mu.Lock()
		if c.last == nil || len(c.last) >= listCountsKeep {
			c.last = map[string]int{}
		}
		prev, known := c.last[id]
		c.last[id] = open
		c.mu.Unlock()
		if known && prev == open {
			continue
		}
		users := s.store.GetListUserIDs(id)
		if len(users) == 0 {
			continue // deleted meanwhile
		}
		s.wsHub.BroadcastListToUsers(users, id, eventListCounts, map[string]any{"listId": id, "open": open})
	}
}
