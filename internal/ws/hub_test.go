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

	// Verify that all SSE client channels are closed, once what was still in them is read
	for i, c := range sseClients {
		for open := true; open; {
			select {
			case _, open = <-c.send:
			case <-time.After(time.Second):
				t.Fatalf("client %d: channel still open after Close", i)
			}
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

// The delivery listener learns every user an event goes to: directly, through a list room (WebSocket and
// SSE) and through a note room
func TestDeliveryListenerLearnsTheRecipients(t *testing.T) {
	hub := NewHub()
	hub.SetRoomAuthorizer(func(userID, roomID string) bool { return true })
	var mu sync.Mutex
	got := map[string][]string{}
	hub.SetDeliveryListener(func(userID, event string) {
		mu.Lock()
		got[event] = append(got[event], userID)
		mu.Unlock()
	})
	wsc := &Client{hub: hub, userID: "user-ws", send: make(chan []byte, 10)}
	hub.JoinRoom(wsc, "lst_1")
	hub.JoinRoom(wsc, "doc:d1")
	sse := &SSEClient{id: "sse_1", userID: "user-sse", send: make(chan []byte, 10),
		subscribedRooms: map[string]bool{"lst_1": true}}
	hub.RegisterSSE(sse)

	hub.BroadcastToUser("user-offline", "TASK_UPDATED", nil)
	hub.BroadcastListEvent("lst_1", "ITEM_TOGGLED", nil)
	hub.BroadcastDocEvent("d1", "DOC_UPDATED", nil)

	mu.Lock()
	defer mu.Unlock()
	if len(got["TASK_UPDATED"]) != 1 || got["TASK_UPDATED"][0] != "user-offline" {
		t.Fatalf("direct event: %v", got["TASK_UPDATED"])
	}
	if len(got["ITEM_TOGGLED"]) != 2 {
		t.Fatalf("list room: want both connections, got %v", got["ITEM_TOGGLED"])
	}
	if len(got["DOC_UPDATED"]) != 1 || got["DOC_UPDATED"][0] != "user-ws" {
		t.Fatalf("note room: %v", got["DOC_UPDATED"])
	}
}
