package api

import (
	"encoding/json"
	"sync"
	"time"
)

// The counts of a note in the note lists of others (open to-dos, hashtags) follow its bullets: a change of
// the content marks the note, and at most once per docCountsDelay its counts are worked out (two grouped
// queries, storage.GetDocCounts) and sent as DOC_COUNTS to everyone with access, only when they differ
// from the counts sent last. The first check of a note after a start has nothing to compare with and sends.
const (
	docCountsDelay = 3 * time.Second
	docCountsTick  = time.Second
	// docCountsKeep: notes whose last counts are remembered; beyond that the memory starts over (each note
	// then sends once more)
	docCountsKeep = 10000
)

type docCountsState struct {
	mu   sync.Mutex
	due  map[string]time.Time // note → when its counts are checked
	last map[string]string    // note → the counts sent last (JSON)
}

// touchDocCounts marks a note whose content changed; changes until the check are folded into it.
func (s *Server) touchDocCounts(docID string, now time.Time) {
	c := &s.docCounts
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.due == nil {
		c.due = map[string]time.Time{}
	}
	if _, ok := c.due[docID]; !ok {
		c.due[docID] = now.Add(docCountsDelay)
	}
}

func (s *Server) startDocCountsTicker() {
	for s.wait(docCountsTick) {
		done := s.demoPass()
		s.sendDueDocCounts(time.Now())
		done()
	}
}

// sendDueDocCounts checks the notes due at now and sends the counts that changed.
func (s *Server) sendDueDocCounts(now time.Time) {
	c := &s.docCounts
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
		counts, err := s.store.GetDocCounts(ctx, id)
		if err != nil {
			continue
		}
		data, _ := json.Marshal(counts) // map keys sorted: equal counts give equal JSON
		key := string(data)
		c.mu.Lock()
		if c.last == nil || len(c.last) >= docCountsKeep {
			c.last = map[string]string{}
		}
		same := c.last[id] == key
		c.last[id] = key
		c.mu.Unlock()
		if same {
			continue
		}
		users, err := s.store.GetAuthorizedDocUsers(id)
		if err != nil {
			continue
		}
		s.wsHub.BroadcastToUsers(users, eventDocCounts, counts)
	}
}
