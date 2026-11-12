package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

const drawBase = `{"v":1,"els":[{"id":"e1","ver":1,"t":"rect","x":0,"y":0,"w":100,"h":50,"s":"main","f":"none","sw":2}]}`

func sendDraw(t *testing.T, conn *websocket.Conn, event string, payload map[string]any) {
	t.Helper()
	if err := conn.WriteJSON(map[string]any{"event": event, "payload": payload}); err != nil {
		t.Fatalf("%s: %v", event, err)
	}
}

type drawPayload struct {
	Code         string            `json:"code"`
	Host         string            `json:"host"`
	You          string            `json:"you"`
	Active       bool              `json:"active"`
	Reason       string            `json:"reason"`
	Els          []json.RawMessage `json:"els"`
	Participants []struct {
		ID     string `json:"id"`
		UserID string `json:"userId"`
	} `json:"participants"`
	Watchers []struct {
		ID string `json:"id"`
	} `json:"watchers"`
}

func readDraw(t *testing.T, conn *websocket.Conn, event string) drawPayload {
	t.Helper()
	m := readWSEvent(conn, event, 2*time.Second)
	if m == nil {
		t.Fatalf("no %s", event)
	}
	var p drawPayload
	_ = json.Unmarshal(m.Payload, &p)
	return p
}

func drawEl(id string, ver, nonce int, x int) json.RawMessage {
	b, _ := json.Marshal(map[string]any{"id": id, "ver": ver, "nonce": nonce, "t": "rect", "x": x, "y": 0, "w": 100, "h": 50, "s": "main", "f": "none", "sw": 2})
	return b
}

func TestLiveDrawingRightsAndRelay(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	reader, readerToken := newTestUser(t, store, "draw-reader@example.com")
	_, strangerToken := newTestUser(t, store, "draw-stranger@example.com")
	doc, err := store.CreateDocument(owner.ID, "", "Skizze", "", "", []domain.DocumentBlock{
		{ID: "d_b1", Type: "drawing", Content: drawBase}, {ID: "d_b2", Type: "bullet", Content: "Text"}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDocShare(owner.ID, doc.ID, reader.ID, "read"); err != nil {
		t.Fatal(err)
	}
	at := func(block string) map[string]any { return map[string]any{"docId": doc.ID, "blockId": block} }

	// Readers may not draw along
	rd := dialWS(t, ts, readerToken)
	sendDraw(t, rd, "DRAW_JOIN", at("d_b1"))
	if p := readDraw(t, rd, "DRAW_ERROR"); p.Code != "forbidden" {
		t.Fatalf("reader joining: %+v", p)
	}
	// No session in a plain bullet
	own := dialWS(t, ts, ownerToken)
	sendDraw(t, own, "DRAW_JOIN", at("d_b2"))
	if p := readDraw(t, own, "DRAW_ERROR"); p.Code != "no_session" {
		t.Fatalf("session in a text bullet: %+v", p)
	}
	join := at("d_b1")
	join["base"], join["els"] = drawBase, []json.RawMessage{drawEl("e1", 1, 0, 0)}
	sendDraw(t, own, "DRAW_JOIN", join)
	st := readDraw(t, own, "DRAW_STATE")
	if !st.Active || st.Host == "" || st.Host != st.You || len(st.Els) != 1 {
		t.Fatalf("owner starts the session: %+v", st)
	}
	// Strangers cannot even watch
	sg := dialWS(t, ts, strangerToken)
	sendDraw(t, sg, "DRAW_WATCH", at("d_b1"))
	if p := readDraw(t, sg, "DRAW_ERROR"); p.Code != "forbidden" {
		t.Fatalf("stranger watching: %+v", p)
	}
	// The reader watches and gets the changes, but cannot make any
	sendDraw(t, rd, "DRAW_WATCH", at("d_b1"))
	if p := readDraw(t, rd, "DRAW_STATE"); !p.Active || len(p.Els) != 1 {
		t.Fatalf("reader watching: %+v", p)
	}
	if p := readDraw(t, own, "DRAW_PEOPLE"); len(p.Watchers) != 1 {
		t.Fatalf("the host sees the watcher: %+v", p)
	}
	ops := at("d_b1")
	ops["els"] = []json.RawMessage{drawEl("e1", 2, 5, 40)}
	sendDraw(t, own, "DRAW_OPS", ops)
	if p := readDraw(t, rd, "DRAW_OPS"); len(p.Els) != 1 || !strings.Contains(string(p.Els[0]), `"x":40`) {
		t.Fatalf("watcher gets the change: %+v", p)
	}
	readDraw(t, own, "DRAW_ACK")
	ops["els"] = []json.RawMessage{drawEl("e1", 9, 0, 80)}
	sendDraw(t, rd, "DRAW_OPS", ops)
	if p := readDraw(t, rd, "DRAW_ERROR"); p.Code != "no_session" {
		t.Fatalf("watcher changing the drawing: %+v", p)
	}
	// Only the host ends it
	sendDraw(t, rd, "DRAW_DISCARD", at("d_b1"))
	if p := readDraw(t, rd, "DRAW_ERROR"); p.Code != "no_session" && p.Code != "not_host" {
		t.Fatalf("watcher discarding: %+v", p)
	}
}

func TestLiveDrawingHoldsTheLeaseAndHandsItOver(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	editor, editorToken := newTestUser(t, store, "draw-editor@example.com")
	doc, err := store.CreateDocument(owner.ID, "", "Skizze", "", "", []domain.DocumentBlock{{ID: "d_b1", Type: "drawing", Content: drawBase}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDocShare(owner.ID, doc.ID, editor.ID, "write"); err != nil {
		t.Fatal(err)
	}
	at := map[string]any{"docId": doc.ID, "blockId": "d_b1", "base": drawBase, "els": []json.RawMessage{drawEl("e1", 1, 0, 0)}}
	sync := func(token, client string, ops []collab.Op) syncResponse {
		t.Helper()
		resp := doJSON(t, ts, http.MethodPost, "/api/v1/docs/"+doc.ID+"/sync", token, map[string]any{"clientId": client, "ops": ops})
		var out syncResponse
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return out
	}

	// The owner's note held the bullet (cursor in it); the session takes it over
	held := doJSON(t, ts, http.MethodPost, "/api/v1/docs/"+doc.ID+"/sync", ownerToken, map[string]any{"clientId": "owner-note", "leases": map[string]any{"hold": []string{"d_b1"}}})
	held.Body.Close()
	own := dialWS(t, ts, ownerToken)
	sendDraw(t, own, "DRAW_JOIN", at)
	readDraw(t, own, "DRAW_STATE")
	ed := dialWS(t, ts, editorToken)
	sendDraw(t, ed, "DRAW_JOIN", at)
	if p := readDraw(t, ed, "DRAW_STATE"); len(p.Participants) != 2 || p.Host == p.You {
		t.Fatalf("editor joins as second: %+v", p)
	}

	res := sync(editorToken, "editor-note", nil)
	if len(res.Leases.Others) != 1 || len(res.Leases.Others[0].Live) != 2 || res.Leases.Others[0].Live[0].UserID != owner.ID {
		t.Fatalf("the note shows the live drawing with both people: %+v", res.Leases.Others)
	}
	// Nobody writes into the bullet meanwhile, not even someone drawing in it (only "Fertig" saves)
	text := `{"v":1,"els":[]}`
	res = sync(ownerToken, "owner-note", []collab.Op{{OpID: "w1", Kind: collab.OpSetContent, BlockID: "d_b1", BaseVersion: 1, Content: &text}})
	if res.Results[0].Status != collab.StatusConflict {
		t.Fatalf("write during the session: %+v", res.Results)
	}

	// The host's tab closes: the editor takes over and saves; the lease goes to the editor's note
	own.Close()
	if p := readDraw(t, ed, "DRAW_PEOPLE"); p.Host != p.Participants[0].ID || p.Participants[0].UserID != editor.ID || len(p.Participants) != 1 {
		t.Fatalf("handover: %+v", p)
	}
	sendDraw(t, ed, "DRAW_DONE", map[string]any{"docId": doc.ID, "blockId": "d_b1", "clientId": "editor-note"})
	end := readDraw(t, ed, "DRAW_END")
	if end.Reason != "done" || len(end.Els) != 1 {
		t.Fatalf("the host gets the final state: %+v", end)
	}
	saved := `{"v":1,"els":[{"id":"e1","ver":2,"t":"rect","x":10,"y":0,"w":100,"h":50,"s":"main","f":"none","sw":2}]}`
	res = sync(editorToken, "editor-note", []collab.Op{{OpID: "save1", Kind: collab.OpSetContent, BlockID: "d_b1", BaseVersion: 1, Content: &saved}})
	if res.Results[0].Status != collab.StatusApplied {
		t.Fatalf("saving after Fertig: %+v", res.Results)
	}
	if others := sync(ownerToken, "owner-note", nil).Leases.Others; len(others) != 1 || len(others[0].Live) != 0 || others[0].UserID != editor.ID {
		t.Fatalf("after Fertig the bullet belongs to the editor's note: %+v", others)
	}
}

func TestLiveDrawingWatchOverSSE(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	reader, readerToken := newTestUser(t, store, "draw-reader@example.com")
	doc, err := store.CreateDocument(owner.ID, "", "Skizze", "", "", []domain.DocumentBlock{{ID: "d_b1", Type: "drawing", Content: drawBase}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDocShare(owner.ID, doc.ID, reader.ID, "read"); err != nil {
		t.Fatal(err)
	}
	own := dialWS(t, ts, ownerToken)
	sendDraw(t, own, "DRAW_JOIN", map[string]any{"docId": doc.ID, "blockId": "d_b1", "base": drawBase})
	readDraw(t, own, "DRAW_STATE")

	sse := openSSE(t, ts, readerToken)
	resp := doJSON(t, ts, http.MethodPost, "/api/v1/docs/"+doc.ID+"/drawings/d_b1/watch", readerToken, map[string]any{"sseId": sse.id})
	var st drawPayload
	_ = json.NewDecoder(resp.Body).Decode(&st)
	if resp.StatusCode != http.StatusOK || !st.Active || st.You != sse.id {
		t.Fatalf("watch over SSE: %d %+v", resp.StatusCode, st)
	}
	if p := readDraw(t, own, "DRAW_PEOPLE"); len(p.Watchers) != 1 || p.Watchers[0].ID != sse.id {
		t.Fatalf("the host sees the SSE watcher: %+v", p)
	}
	sendDraw(t, own, "DRAW_OPS", map[string]any{"docId": doc.ID, "blockId": "d_b1", "els": []json.RawMessage{drawEl("e2", 1, 3, 200)}})
	if m := sse.waitFor(t, "DRAW_OPS", 2*time.Second); m == nil || !strings.Contains(string(m.Payload), `"e2"`) {
		t.Fatalf("SSE watcher gets the change: %+v", m)
	}
	// Someone else's connection id does not get in
	_, strangerToken := newTestUser(t, store, "draw-stranger@example.com")
	if r := doJSON(t, ts, http.MethodPost, "/api/v1/docs/"+doc.ID+"/drawings/d_b1/watch", strangerToken, map[string]any{"sseId": sse.id}); r.StatusCode != http.StatusNotFound {
		t.Fatalf("stranger watching: %d", r.StatusCode)
	}
	live := doJSON(t, ts, http.MethodGet, "/api/v1/docs/"+doc.ID+"/drawings/d_b1/live", readerToken, nil)
	var now drawPayload
	_ = json.NewDecoder(live.Body).Decode(&now)
	if !now.Active || len(now.Participants) != 1 {
		t.Fatalf("live state: %+v", now)
	}
}
