package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// joinWSRoom joins a room over the WebSocket and waits until the hub has handled it (messages are
// handled in order: the PONG comes after the join).
func joinWSRoom(t *testing.T, conn *websocket.Conn, room string) {
	t.Helper()
	if err := conn.WriteJSON(map[string]string{"event": "JOIN_ROOM", "room": room}); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(map[string]string{"event": "PING"}); err != nil {
		t.Fatal(err)
	}
	if readWSEvent(conn, "PONG", 10*time.Second) == nil {
		t.Fatal("no PONG after joining")
	}
}

// Whoever loses a list or note keeps no open connection in its room: after the share is removed the
// entries (ITEM_*) and the note's events no longer reach them, the others in the room still get them.
func TestLostAccessLeavesTheRealtimeRooms(t *testing.T) {
	srv, store, ts, owner, ownerToken := startRealtimeServer(t)
	member, memberToken := newTestUser(t, store, "mitglied@example.com")
	list, err := store.CreateList(owner.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	share, err := store.AddListShare(owner.ID, list.ID, "user", member.ID, "editor")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := store.CreateDocument(owner.ID, "", "Geheim", "", "", []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "x"}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDocShare(owner.ID, doc.ID, member.ID, "write"); err != nil {
		t.Fatal(err)
	}

	memberConn := dialWS(t, ts, memberToken)
	joinWSRoom(t, memberConn, list.ID)
	joinWSRoom(t, memberConn, "doc:"+doc.ID)
	joinWSRoom(t, memberConn, drawRoom(doc.ID, "b1"))
	ownerConn := dialWS(t, ts, ownerToken)
	joinWSRoom(t, ownerConn, list.ID)

	// Still shared: the entry arrives
	if r := doJSON(t, ts, http.MethodPost, "/api/v1/lists/"+list.ID+"/items", ownerToken, map[string]string{"content": "Milch"}); r.StatusCode != http.StatusCreated && r.StatusCode != http.StatusOK {
		t.Fatalf("add item: status %d", r.StatusCode)
	}
	if readWSEvent(memberConn, eventItemCreated, 10*time.Second) == nil {
		t.Fatal("the member got no ITEM_CREATED while the list was shared")
	}

	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/lists/"+list.ID+"/shares/"+share.ID, ownerToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("unshare list: status %d", r.StatusCode)
	}
	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/documents/"+doc.ID+"/shares/"+member.ID, ownerToken, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("unshare note: status %d", r.StatusCode)
	}
	if r := doJSON(t, ts, http.MethodPost, "/api/v1/lists/"+list.ID+"/items", ownerToken, map[string]string{"content": "Geheimes Geschenk"}); r.StatusCode != http.StatusCreated && r.StatusCode != http.StatusOK {
		t.Fatalf("add item: status %d", r.StatusCode)
	}
	srv.wsHub.BroadcastDocEvent(doc.ID, eventDocSeq, map[string]any{"docId": doc.ID})
	srv.wsHub.BroadcastRoom(drawRoom(doc.ID, "b1"), eventDrawOps, map[string]any{"docId": doc.ID}, nil)

	if readWSEvent(ownerConn, eventItemCreated, 10*time.Second) == nil {
		t.Fatal("the owner, still in the room, got no ITEM_CREATED")
	}
	// Anything of the list's or the note's rooms still reaching the member is a leak
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		_ = memberConn.SetReadDeadline(deadline)
		var m sseMsg
		if err := memberConn.ReadJSON(&m); err != nil {
			break
		}
		switch m.Event {
		case eventItemCreated, eventDocSeq, eventDrawOps:
			t.Fatalf("%s still reached the person who lost access: %s", m.Event, m.Payload)
		}
	}
}
