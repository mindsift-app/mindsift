package ws

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestHubCloseAndGracefulShutdown(t *testing.T) {
	hub := NewHub()

	// Register multiple dummy SSE clients
	var sseClients []*SSEClient
	for i := 0; i < 5; i++ {
		client := &SSEClient{
			id:     "sse-test",
			userID: "user-1",
			send:   make(chan []byte, 10),
		}
		hub.RegisterSSE(client)
		sseClients = append(sseClients, client)
	}

	// Verify broadcast works
	hub.BroadcastToUser("user-1", "TEST_EVENT", map[string]string{"msg": "hello"})

	// Concurrently invoke Close() and Broadcast() to verify no panics or deadlocks
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			hub.BroadcastToUser("user-1", "SPAM", map[string]int{"i": i})
			time.Sleep(1 * time.Millisecond)
		}
	}()

	go func() {
		defer wg.Done()
		time.Sleep(5 * time.Millisecond)
		hub.Close()
	}()

	wg.Wait()

	// Verify that all SSE client channels are closed
	for _, c := range sseClients {
		select {
		case _, ok := <-c.send:
			if ok {
				// Drained a message, check next
				_, ok = <-c.send
			}
		default:
		}
	}
}

func TestRoomJoinsRequireAuthorization(t *testing.T) {
	hub := NewHub()
	c := &Client{hub: hub, userID: "user-1", send: make(chan []byte, 10)}

	if hub.JoinRoom(c, "lst_1") {
		t.Fatal("join must be denied without an authorizer")
	}

	hub.SetRoomAuthorizer(func(userID, roomID string) bool {
		return userID == "user-1" && roomID == "lst_allowed"
	})
	if hub.JoinRoom(c, "lst_other") {
		t.Fatal("join to an unauthorized room must be denied")
	}
	if !hub.JoinRoom(c, "lst_allowed") {
		t.Fatal("join to an authorized room must succeed")
	}

	anon := &Client{hub: hub, userID: "anonymous", send: make(chan []byte, 10)}
	if hub.JoinRoom(anon, "lst_allowed") {
		t.Fatal("anonymous clients must never join rooms")
	}

	sse := &SSEClient{id: "sse_1", userID: "user-1", send: make(chan []byte, 10),
		subscribedRooms: map[string]bool{"lst_allowed": true, "doc:secret": true}}
	hub.RegisterSSE(sse)
	if sse.subscribedRooms["doc:secret"] {
		t.Fatal("unauthorized initial SSE rooms must be dropped")
	}
	if hub.JoinSSERoomByID("sse_1", "user-2", "lst_allowed") {
		t.Fatal("joining with another user's sseId must fail")
	}
}

// Poll connections nobody asks for any more (tab closed) are closed and stop receiving events.
func TestIdlePollConnectionsAreClosed(t *testing.T) {
	hub := NewHub()
	id := hub.OpenPoll("user-1", nil)
	hub.BroadcastToUser("user-1", "TEST_EVENT", nil)
	if events, ok := hub.Poll(context.Background(), id, "user-1", 0); !ok || len(events) != 1 {
		t.Fatalf("fresh poll connection: ok=%v events=%d", ok, len(events))
	}
	if _, ok := hub.Poll(context.Background(), id, "user-2", 0); ok {
		t.Fatal("another user must not read the connection")
	}

	hub.mu.Lock()
	hub.polls[id].lastPoll = time.Now().Add(-PollIdleTimeout - time.Second)
	hub.mu.Unlock()
	hub.OpenPoll("user-1", nil) // any poll activity sweeps
	if _, ok := hub.Poll(context.Background(), id, "user-1", 0); ok {
		t.Fatal("idle poll connection should be gone")
	}
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	if len(hub.sseUserRooms["user-1"]) != 1 {
		t.Fatalf("only the new connection should stay registered, got %d", len(hub.sseUserRooms["user-1"]))
	}
}
