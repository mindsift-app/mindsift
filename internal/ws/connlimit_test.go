package ws

import (
	"fmt"
	"testing"
	"time"
)

func sseClosed(c *SSEClient) bool {
	c.sendMu.RLock()
	defer c.sendMu.RUnlock()
	return c.closed
}

// Registering more than MaxConnectionsPerUser connections for one account closes the oldest ones, so the
// account never holds more than the cap at once (FLAW-42). Other accounts are untouched.
func TestPerUserConnectionLimitEvictsOldest(t *testing.T) {
	hub := NewHub()
	over := 5
	n := MaxConnectionsPerUser + over
	clients := make([]*SSEClient, 0, n)
	for i := 0; i < n; i++ {
		c := &SSEClient{
			id:        fmt.Sprintf("sse-%d", i),
			userID:    "user-limit",
			send:      make(chan []byte, 4),
			createdAt: time.Now().Add(time.Duration(i) * time.Millisecond), // oldest first
		}
		hub.RegisterSSE(c)
		clients = append(clients, c)
	}

	hub.mu.RLock()
	got := len(hub.sseUserRooms["user-limit"])
	hub.mu.RUnlock()
	if got != MaxConnectionsPerUser {
		t.Fatalf("expected %d live connections, got %d", MaxConnectionsPerUser, got)
	}

	for i, c := range clients {
		closed := sseClosed(c)
		if i < over && !closed {
			t.Errorf("client %d (among the oldest) should have been closed", i)
		}
		if i >= over && closed {
			t.Errorf("client %d (recent) should still be open", i)
		}
	}

	// A second account is unaffected
	other := &SSEClient{id: "other", userID: "user-other", send: make(chan []byte, 4), createdAt: time.Now()}
	hub.RegisterSSE(other)
	if sseClosed(other) {
		t.Errorf("a different user's connection must not be closed")
	}
}
