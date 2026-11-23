package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// Entries added to a shared list reach someone who does not have it open (not in its room) as one
// LIST_COUNTS with the open count, only when the count differs from the one sent last.
func TestListCountsReachTheListOverview(t *testing.T) {
	srv, store, ts, owner, token := startRealtimeServer(t)
	anna, annaToken := newTestUser(t, store, "anna-lists@example.com")
	list, err := store.CreateList(owner.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddListShare(owner.ID, list.ID, "user", anna.ID, "viewer"); err != nil {
		t.Fatal(err)
	}
	stream := openSSE(t, ts, annaToken)

	for _, content := range []string{"Milch", "Brot"} {
		if r := doJSON(t, ts, http.MethodPost, "/api/v1/lists/"+list.ID+"/items", token, map[string]string{"content": content}); r.StatusCode != http.StatusCreated && r.StatusCode != http.StatusOK {
			t.Fatalf("add %s: %d", content, r.StatusCode)
		}
	}
	srv.listCounts.mu.Lock()
	pending := len(srv.listCounts.due)
	srv.listCounts.mu.Unlock()
	if pending > 1 {
		t.Fatalf("%d lists pending, want the two entries folded into one", pending)
	}
	srv.sendDueListCounts(time.Now().Add(listCountsDelay))
	m := stream.waitFor(t, "LIST_COUNTS", 3*time.Second)
	if m == nil {
		t.Fatal("no LIST_COUNTS outside the list's room")
	}
	var c struct {
		ListID string `json:"listId"`
		Open   int    `json:"open"`
	}
	_ = json.Unmarshal(m.Payload, &c)
	if c.ListID != list.ID || c.Open != 2 {
		t.Fatalf("LIST_COUNTS %s", m.Payload)
	}

	// The same count again: nothing is sent
	srv.touchListCounts(list.ID, time.Now())
	srv.sendDueListCounts(time.Now().Add(listCountsDelay))
	if m := stream.waitFor(t, "LIST_COUNTS", 400*time.Millisecond); m != nil {
		t.Fatalf("unchanged count sent again: %s", m.Payload)
	}
}
