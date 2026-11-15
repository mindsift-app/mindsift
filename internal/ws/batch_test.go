package ws

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Events waiting for one connection go out in one write to the network, each still a WebSocket message
// of its own and in order.
func TestWritePumpBatchesWaitingMessages(t *testing.T) {
	hub := NewHub()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, "", "u1")
	}))
	defer ts.Close()
	defer hub.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	var c *Client
	for deadline := time.Now().Add(5 * time.Second); c == nil; {
		hub.mu.RLock()
		for cl := range hub.allClients {
			c = cl
		}
		hub.mu.RUnlock()
		if c == nil && time.Now().After(deadline) {
			t.Fatal("the connection did not register")
		}
		time.Sleep(time.Millisecond)
	}
	if c.out == nil {
		t.Fatal("the connection is not batched")
	}

	// Hold the network side while 20 events queue up, so writePump finds them all waiting
	const n = 20
	c.out.mu.Lock()
	before := c.out.writes
	for i := 0; i < n; i++ {
		c.trySend(fmt.Appendf(nil, `{"event":"E%d"}`, i))
	}
	c.out.mu.Unlock()

	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for i := 0; i < n; i++ {
		typ, msg, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("message %d: %v", i, err)
		}
		if want := fmt.Sprintf(`{"event":"E%d"}`, i); typ != websocket.TextMessage || string(msg) != want {
			t.Fatalf("message %d: %q, want %q", i, msg, want)
		}
	}
	c.out.mu.Lock()
	writes := c.out.writes - before
	holding := c.out.holding
	c.out.mu.Unlock()
	if writes != 1 || holding {
		t.Fatalf("%d events took %d writes (holding %v), want 1", n, writes, holding)
	}

	// A single event goes out right away, as before
	c.trySend([]byte(`{"event":"ONE"}`))
	if _, msg, err := conn.ReadMessage(); err != nil || string(msg) != `{"event":"ONE"}` {
		t.Fatalf("single event: %q %v", msg, err)
	}
}

// BroadcastRoomEach gives every connection of a room its own message, or none.
func TestBroadcastRoomEach(t *testing.T) {
	hub := NewHub()
	a := &SSEClient{id: "sse-a", userID: "u1", send: make(chan []byte, 4)}
	b := &SSEClient{id: "sse-b", userID: "u2", send: make(chan []byte, 4)}
	other := &SSEClient{id: "sse-o", userID: "u3", send: make(chan []byte, 4)}
	for _, c := range []*SSEClient{a, b, other} {
		hub.RegisterSSE(c)
	}
	hub.mu.Lock()
	hub.sseRooms["r"] = map[*SSEClient]bool{a: true, b: true}
	hub.mu.Unlock()
	hub.BroadcastRoomEach("r", "E", func(connID string) []byte {
		if connID == "sse-b" {
			return nil
		}
		return []byte("for " + connID)
	})
	if got := string(<-a.send); got != "for sse-a" {
		t.Fatalf("a got %q", got)
	}
	if len(b.send) != 0 || len(other.send) != 0 {
		t.Fatal("b and the connection outside the room get nothing")
	}
}
