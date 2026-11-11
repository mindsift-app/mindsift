package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

const testJWTSecret = "test-jwt-secret-key"

type sseMsg struct {
	Event   string          `json:"event"`
	Payload json.RawMessage `json:"payload"`
}

type sseStream struct {
	id     string
	events chan sseMsg
}

// startRealtimeServer serves the router over real HTTP with a short WriteTimeout, like production but faster.
func startRealtimeServer(t *testing.T) (*Server, *storage.Store, *httptest.Server, *domain.User, string) {
	t.Helper()
	srv, store, token := setupTestServer(t)
	claims, err := auth.ValidateToken(testJWTSecret, token)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	owner, _ := store.GetUserByID(claims.UserID)
	ts := httptest.NewUnstartedServer(srv.Router())
	ts.Config.WriteTimeout = time.Second
	ts.Start()
	t.Cleanup(ts.Close)
	return srv, store, ts, owner, token
}

func newTestUser(t *testing.T, store *storage.Store, email string) (*domain.User, string) {
	t.Helper()
	u, err := store.CreateUser(email, "hash", strings.Split(email, "@")[0], "member")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	tok, err := auth.GenerateToken(testJWTSecret, u.ID, u.Email, u.DisplayName, u.TokenVersion, testSession(t, store, u.ID))
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	return u, tok
}

func openSSE(t *testing.T, ts *httptest.Server, token string) *sseStream {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/events", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		cancel()
		t.Fatalf("open sse: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		cancel()
		t.Fatalf("open sse: status %d", resp.StatusCode)
	}
	st := &sseStream{events: make(chan sseMsg, 64)}
	go func() {
		defer close(st.events)
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			if line, ok := strings.CutPrefix(sc.Text(), "data: "); ok {
				var m sseMsg
				if json.Unmarshal([]byte(line), &m) == nil {
					st.events <- m
				}
			}
		}
	}()
	t.Cleanup(func() {
		cancel()
		_ = resp.Body.Close()
	})
	connected := st.waitFor(t, "SSE_CONNECTED", 2*time.Second)
	if connected == nil {
		t.Fatal("no SSE_CONNECTED event")
	}
	var p struct {
		SSEID string `json:"sseId"`
	}
	_ = json.Unmarshal(connected.Payload, &p)
	st.id = p.SSEID
	return st
}

func (st *sseStream) waitFor(t *testing.T, event string, timeout time.Duration) *sseMsg {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case m, ok := <-st.events:
			if !ok {
				return nil
			}
			if m.Event == event {
				return &m
			}
		case <-deadline:
			return nil
		}
	}
}

func doJSON(t *testing.T, ts *httptest.Server, method, path, token string, body any) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, ts.URL+path, &buf)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func TestRealtimeEndpointsRequireAuth(t *testing.T) {
	_, _, ts, _, _ := startRealtimeServer(t)
	for _, path := range []string{"/api/v1/events", "/api/v1/ws", "/api/v1/events/rooms"} {
		method := http.MethodGet
		if strings.HasSuffix(path, "/rooms") {
			method = http.MethodPost
		}
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(`{}`))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s without token: want 401, got %d", path, resp.StatusCode)
		}
	}
}

func TestSSEStreamOutlivesWriteTimeout(t *testing.T) {
	srv, _, ts, owner, token := startRealtimeServer(t)
	st := openSSE(t, ts, token)

	time.Sleep(1500 * time.Millisecond) // longer than the server's WriteTimeout of 1s
	srv.wsHub.BroadcastToUser(owner.ID, "LATE_EVENT", map[string]string{"ok": "1"})

	if st.waitFor(t, "LATE_EVENT", 2*time.Second) == nil {
		t.Fatal("SSE stream was cut by the WriteTimeout")
	}
}

func TestTaskEventsOnlyReachAuthorizedUsers(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	member, memberToken := newTestUser(t, store, "member@example.com")
	_, outsiderToken := newTestUser(t, store, "outsider@example.com")

	list, err := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	if err != nil {
		t.Fatalf("create list: %v", err)
	}
	if _, err := store.AddTaskListShare(list.ID, "user", member.ID, "viewer", owner.ID); err != nil {
		t.Fatalf("share: %v", err)
	}
	task, err := store.CreateThoughtWithDetails(owner.ID, "Fenster putzen", "normal", "manual", "", list.ID, "todo", "")
	if err != nil {
		t.Fatalf("create task: %v", err)
	}

	memberStream := openSSE(t, ts, memberToken)
	outsiderStream := openSSE(t, ts, outsiderToken)

	resp := doJSON(t, ts, http.MethodPatch, "/api/v1/thoughts/"+task.ID, ownerToken, map[string]string{"content": "Fenster putzen (geheim)"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update task: status %d", resp.StatusCode)
	}
	if memberStream.waitFor(t, "TASK_UPDATED", 2*time.Second) == nil {
		t.Error("list member did not receive TASK_UPDATED")
	}
	if outsiderStream.waitFor(t, "TASK_UPDATED", 500*time.Millisecond) != nil {
		t.Error("outsider received TASK_UPDATED of a foreign list")
	}

	resp = doJSON(t, ts, http.MethodPut, "/api/v1/task-lists/"+list.ID, ownerToken, map[string]string{"title": "Haushalt 2"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update list: status %d", resp.StatusCode)
	}
	msg := memberStream.waitFor(t, "TASK_LIST_UPDATED", 2*time.Second)
	if msg == nil {
		t.Fatal("list member did not receive TASK_LIST_UPDATED")
	}
	if strings.Contains(string(msg.Payload), "permission") || !strings.Contains(string(msg.Payload), list.ID) {
		t.Errorf("TASK_LIST_UPDATED must only carry the list ID, got %s", msg.Payload)
	}
	if outsiderStream.waitFor(t, "TASK_LIST_UPDATED", 500*time.Millisecond) != nil {
		t.Error("outsider received TASK_LIST_UPDATED of a foreign list")
	}
}

func TestSSERoomJoinRequiresAccess(t *testing.T) {
	_, store, ts, owner, _ := startRealtimeServer(t)
	friend, friendToken := newTestUser(t, store, "friend@example.com")
	_, strangerToken := newTestUser(t, store, "stranger@example.com")

	list, err := store.CreateList(owner.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatalf("create list: %v", err)
	}
	friendStream := openSSE(t, ts, friendToken)
	strangerStream := openSSE(t, ts, strangerToken)

	join := func(token, sseID string) int {
		resp := doJSON(t, ts, http.MethodPost, "/api/v1/events/rooms", token, map[string]string{"sseId": sseID, "room": list.ID})
		return resp.StatusCode
	}

	if code := join(strangerToken, strangerStream.id); code != http.StatusForbidden {
		t.Errorf("stranger joining a foreign list room: want 403, got %d", code)
	}
	if code := join(friendToken, friendStream.id); code != http.StatusForbidden {
		t.Errorf("friend joining before being shared: want 403, got %d", code)
	}
	if _, err := store.AddListShare(owner.ID, list.ID, "user", friend.ID, "viewer"); err != nil {
		t.Fatalf("share list: %v", err)
	}
	if code := join(strangerToken, friendStream.id); code != http.StatusForbidden {
		t.Errorf("joining with someone else's sseId: want 403, got %d", code)
	}
	if code := join(friendToken, friendStream.id); code != http.StatusOK {
		t.Errorf("friend joining shared list room: want 200, got %d", code)
	}
}

func TestReorderRejectsForeignTasks(t *testing.T) {
	_, store, ts, owner, _ := startRealtimeServer(t)
	_, attackerToken := newTestUser(t, store, "attacker@example.com")

	task, err := store.CreateThoughtWithDetails(owner.ID, "Privat", "normal", "manual", "", "", "todo", "")
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	done := "done"
	resp := doJSON(t, ts, http.MethodPost, "/api/v1/tasks/reorder", attackerToken, map[string]any{
		"items": []domain.ThoughtReorderItem{{ID: task.ID, SortOrder: 99, KanbanStatus: &done}},
	})
	if resp.StatusCode == http.StatusOK {
		t.Fatal("reordering a foreign task must be rejected")
	}
	after, _ := store.GetThoughtByID(owner.ID, task.ID)
	if after.SortOrder == 99 || after.IsCompleted {
		t.Fatalf("foreign task was modified: sortOrder=%d completed=%v", after.SortOrder, after.IsCompleted)
	}
}

func dialWS(t *testing.T, ts *httptest.Server, token string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/ws"
	conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Authorization": {"Bearer " + token}})
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func readWSEvent(conn *websocket.Conn, event string, timeout time.Duration) *sseMsg {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(deadline)
		var m sseMsg
		if err := conn.ReadJSON(&m); err != nil {
			return nil
		}
		if m.Event == event {
			return &m
		}
	}
	return nil
}

func TestWebSocketHeartbeat(t *testing.T) {
	_, _, ts, _, token := startRealtimeServer(t)
	conn := dialWS(t, ts, token)
	if err := conn.WriteJSON(map[string]string{"event": "PING"}); err != nil {
		t.Fatal(err)
	}
	if readWSEvent(conn, "PONG", 2*time.Second) == nil {
		t.Fatal("no PONG for an app-level PING")
	}
}

func TestDocChangesArePushedToTheNoteRoom(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	editor, editorToken := newTestUser(t, store, "push-editor@example.com")
	doc, err := store.CreateDocument(owner.ID, "", "Push", "🗒️", "", []domain.DocumentBlock{{ID: "push_b1", Type: "bullet", Content: "Start"}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDocShare(owner.ID, doc.ID, editor.ID, "write"); err != nil {
		t.Fatal(err)
	}

	conn := dialWS(t, ts, editorToken)
	if err := conn.WriteJSON(map[string]string{"event": "JOIN_ROOM", "room": "doc:" + doc.ID}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond) // the join is processed asynchronously

	text := "Geändert"
	resp := doJSON(t, ts, http.MethodPost, "/api/v1/docs/"+doc.ID+"/sync", ownerToken, map[string]any{
		"clientId": "owner-tab",
		"ops":      []collab.Op{{OpID: "push-1", Kind: collab.OpSetContent, BlockID: "push_b1", BaseVersion: 1, Content: &text}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("sync: %d", resp.StatusCode)
	}
	msg := readWSEvent(conn, "DOC_SEQ", 2*time.Second)
	if msg == nil || !strings.Contains(string(msg.Payload), doc.ID) {
		t.Fatalf("no DOC_SEQ push for the note: %+v", msg)
	}
}

func TestLogoutEndsLiveStreams(t *testing.T) {
	srv, _, ts, owner, token := startRealtimeServer(t)
	st := openSSE(t, ts, token)
	srv.wsHub.DisconnectUser(owner.ID)
	deadline := time.After(2 * time.Second)
	for {
		select {
		case _, ok := <-st.events:
			if !ok {
				return // stream closed by the server
			}
		case <-deadline:
			t.Fatal("stream still open after DisconnectUser")
		}
	}
}

// Long polling as the third transport: events of the user and of joined rooms arrive with the next
// poll, a poll waits until something happens, and nobody else can read the connection.
func TestLongPollDeliversEvents(t *testing.T) {
	srv, store, ts, owner, token := startRealtimeServer(t)
	_, strangerToken := newTestUser(t, store, "stranger@example.com")

	resp := doJSON(t, ts, http.MethodPost, "/api/v1/events/poll", token, map[string]any{})
	var opened struct {
		PollID string `json:"pollId"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&opened)
	if resp.StatusCode != http.StatusOK || opened.PollID == "" {
		t.Fatalf("open poll: %d %+v", resp.StatusCode, opened)
	}
	poll := func(tok string, wait int) (int, []sseMsg) {
		resp := doJSON(t, ts, http.MethodGet, "/api/v1/events/poll/"+opened.PollID+"?wait="+strconv.Itoa(wait), tok, nil)
		var out struct {
			Events []sseMsg `json:"events"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out.Events
	}

	// Nothing happens: the poll answers empty after the wait
	if code, events := poll(token, 0); code != http.StatusOK || len(events) != 0 {
		t.Fatalf("empty poll: %d %v", code, events)
	}

	// A poll that is waiting returns as soon as an event comes
	go func() {
		time.Sleep(200 * time.Millisecond)
		srv.wsHub.BroadcastToUser(owner.ID, "TASK_UPDATED", map[string]string{"id": "t1"})
	}()
	start := time.Now()
	code, events := poll(token, 5)
	if code != http.StatusOK || len(events) != 1 || events[0].Event != "TASK_UPDATED" || time.Since(start) > 3*time.Second {
		t.Fatalf("waiting poll: %d %v after %s", code, events, time.Since(start))
	}

	// List rooms are joined like with SSE; events between polls wait in the buffer
	list, _ := store.CreateList(owner.ID, "Einkauf", "🛒", "shopping")
	if r := doJSON(t, ts, http.MethodPost, "/api/v1/events/rooms", token, map[string]string{"sseId": opened.PollID, "room": list.ID}); r.StatusCode != http.StatusOK {
		t.Fatalf("join list room: %d", r.StatusCode)
	}
	srv.wsHub.BroadcastListEvent(list.ID, "ITEM_ADDED", map[string]string{"id": "i1"})
	srv.wsHub.BroadcastListEvent(list.ID, "ITEM_UPDATED", map[string]string{"id": "i1"})
	if code, events = poll(token, 5); code != http.StatusOK || len(events) != 2 || events[1].Event != "ITEM_UPDATED" {
		t.Fatalf("list events: %d %v", code, events)
	}

	if code, _ = poll(strangerToken, 0); code != http.StatusNotFound {
		t.Errorf("someone else's poll connection: want 404, got %d", code)
	}
	resp = doJSON(t, ts, http.MethodGet, "/api/v1/events/poll/poll_unknown?wait=0", token, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown poll connection: want 404, got %d", resp.StatusCode)
	}
}
