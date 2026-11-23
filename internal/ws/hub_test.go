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

// Whoever loses access to a room is taken out of it on RecheckRooms (joined, URL and SSE rooms) and gets
// none of its events any more; the others in the room and the person's other rooms stay.
func TestRecheckRoomsDropsLostAccess(t *testing.T) {
	hub := NewHub()
	var mu sync.Mutex
	allowed := map[string]bool{"anna|lst_1": true, "anna|doc:d1": true, "ben|lst_1": true}
	hub.SetRoomAuthorizer(func(userID, roomID string) bool {
		mu.Lock()
		defer mu.Unlock()
		return allowed[userID+"|"+roomID]
	})
	anna := &Client{hub: hub, id: "ws_anna", userID: "anna", roomID: "lst_1", send: make(chan []byte, 10)}
	hub.Register(anna)
	hub.JoinRoom(anna, "doc:d1")
	ben := &Client{hub: hub, id: "ws_ben", userID: "ben", send: make(chan []byte, 10)}
	hub.Register(ben)
	hub.JoinRoom(ben, "lst_1")
	annaSSE := &SSEClient{id: "sse_anna", userID: "anna", send: make(chan []byte, 10), subscribedRooms: map[string]bool{"lst_1": true}}
	hub.RegisterSSE(annaSSE)
	drain := func(ch chan []byte) int {
		n := 0
		for {
			select {
			case <-ch:
				n++
			default:
				return n
			}
		}
	}
	drain(anna.send)
	drain(ben.send)
	drain(annaSSE.send)

	// Nothing lost: nobody leaves
	if left := hub.RecheckRooms([]string{"anna", "ben"}); len(left) != 0 {
		t.Fatalf("nothing changed, yet %v left", left)
	}

	mu.Lock()
	delete(allowed, "anna|lst_1")
	mu.Unlock()
	left := hub.RecheckRooms([]string{"anna"})
	if len(left) != 2 {
		t.Fatalf("want anna's WebSocket and SSE connection out of lst_1, got %v", left)
	}
	for _, l := range left {
		if l.UserID != "anna" || l.Room != "lst_1" {
			t.Errorf("unexpected %v", l)
		}
	}

	hub.BroadcastListEvent("lst_1", "ITEM_CREATED", map[string]string{"content": "geheim"})
	hub.BroadcastDocEvent("d1", "DOC_SEQ", nil)
	if n := drain(anna.send); n != 1 {
		t.Errorf("anna's WebSocket: want only the note's event, got %d", n)
	}
	if n := drain(annaSSE.send); n != 0 {
		t.Errorf("anna's SSE connection still gets the list's events (%d)", n)
	}
	if n := drain(ben.send); n != 1 {
		t.Errorf("ben keeps the list: want 1 event, got %d", n)
	}
	if hub.JoinRoom(anna, "lst_1") {
		t.Error("anna joined the list again without access")
	}

	// By room: everyone in it, nobody else
	mu.Lock()
	allowed = map[string]bool{"ben|lst_1": true}
	mu.Unlock()
	if left := hub.RecheckRoomsWhere(func(room string) bool { return room == "lst_1" }); len(left) != 0 {
		t.Fatalf("ben keeps lst_1 and anna's note is not asked for, yet %v left", left)
	}
	// Everyone at once, and closing a connection after it left a room still works
	mu.Lock()
	allowed = map[string]bool{}
	mu.Unlock()
	if left := hub.RecheckAllRooms(); len(left) != 2 {
		t.Fatalf("RecheckAllRooms: want anna's note and ben's list, got %v", left)
	}
	hub.Unregister(anna)
	hub.UnregisterSSE(annaSSE)
	hub.Unregister(ben)
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	if len(hub.rooms)+len(hub.sseRooms) != 0 {
		t.Errorf("rooms left behind: %v %v", hub.rooms, hub.sseRooms)
	}
}

// RecheckRooms runs while connections join, leave, broadcast and close: no deadlock and (under -race) no race.
func TestRecheckRoomsConcurrent(t *testing.T) {
	hub := NewHub()
	hub.SetRoomAuthorizer(func(userID, roomID string) bool { return roomID != "lst_gone" })
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				c := &Client{hub: hub, id: "ws", userID: "anna", roomID: "lst_gone", send: make(chan []byte, 10)}
				hub.Register(c)
				hub.JoinRoom(c, "lst_ok")
				hub.BroadcastListEvent("lst_ok", "ITEM_CREATED", nil)
				hub.Unregister(c)
			}
		}()
	}
	done := make(chan struct{})
	go func() {
		for i := 0; i < 100; i++ {
			hub.RecheckRooms([]string{"anna"})
			hub.RecheckAllRooms()
		}
		close(done)
	}()
	wg.Wait()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("RecheckRooms hangs")
	}
}
