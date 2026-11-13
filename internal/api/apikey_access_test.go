package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func keyRequest(t *testing.T, router http.Handler, key, method, path, body string) (int, []byte) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("X-API-Key", key)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

// API keys reach tasks and lists over plain REST with the right scope, and nothing else.
func TestAPIKeyRESTAccess(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	reader, _ := store.CreateAPIKey(claims.UserID, "Home Assistant", []string{"tasks:read", "lists:read"})
	writer, _ := store.CreateAPIKey(claims.UserID, "Skript", []string{"tasks:write", "lists:write"})
	inbox, _ := store.CreateAPIKey(claims.UserID, "Nur Inbox", nil)

	task, _ := srv.createTask(claims.UserID, "Müll rausbringen", "", "manual", clock.Today(), "", "", nil)
	list, _ := store.CreateList(claims.UserID, "Einkauf", "", "shopping")

	if code, body := keyRequest(t, router, reader.RawKey, http.MethodGet, "/api/v1/tasks?due=today&status=open", ""); code != http.StatusOK || !strings.Contains(string(body), "Müll rausbringen") {
		t.Fatalf("reader GET /tasks: %d %s", code, body)
	}
	if code, _ := keyRequest(t, router, reader.RawKey, http.MethodGet, "/api/v1/lists/"+list.ID, ""); code != http.StatusOK {
		t.Fatalf("reader GET list: %d", code)
	}
	// Reading does not allow writing, and notes stay closed
	if code, _ := keyRequest(t, router, reader.RawKey, http.MethodPatch, "/api/v1/thoughts/"+task.ID, `{"isCompleted":true}`); code != http.StatusForbidden {
		t.Fatalf("reader must not change tasks: %d", code)
	}
	if code, _ := keyRequest(t, router, reader.RawKey, http.MethodGet, "/api/v1/documents", ""); code != http.StatusForbidden {
		t.Fatalf("keys must not reach notes: %d", code)
	}
	if code, _ := keyRequest(t, router, inbox.RawKey, http.MethodGet, "/api/v1/tasks", ""); code != http.StatusForbidden {
		t.Fatalf("inbox key must not read tasks: %d", code)
	}
	if code, _ := keyRequest(t, router, reader.RawKey, http.MethodGet, "/api/v1/tasks?due=morgen", ""); code != http.StatusBadRequest {
		t.Fatalf("bad due filter should be 400: %d", code)
	}

	// Writing over REST records the key as origin
	if code, body := keyRequest(t, router, writer.RawKey, http.MethodPatch, "/api/v1/thoughts/"+task.ID, `{"isCompleted":true}`); code != http.StatusOK {
		t.Fatalf("writer PATCH: %d %s", code, body)
	}
	th, _ := store.GetThoughtByID(claims.UserID, task.ID)
	if !th.IsCompleted || th.Origin == nil || th.Origin.ChangedVia != "api" || th.Origin.ChangedKey != "Skript" {
		t.Fatalf("REST change by key: %+v %+v", th.IsCompleted, th.Origin)
	}
	code, body := keyRequest(t, router, writer.RawKey, http.MethodPost, "/api/v1/lists/"+list.ID+"/items", `{"content":"Milch"}`)
	var item domain.ListItem
	_ = json.Unmarshal(body, &item)
	if code != http.StatusCreated || item.Origin == nil || item.Origin.CreatedKey != "Skript" {
		t.Fatalf("writer adds item: %d %s", code, body)
	}

	// Webhook-delivered thoughts keep their origin when the triage turns them into a list item
	code, body = keyRequest(t, router, inbox.RawKey, http.MethodPost, "/api/v1/webhooks/ingest", `{"title":"Kaffee kaufen"}`)
	var ingested struct {
		Thought domain.Thought `json:"thought"`
	}
	_ = json.Unmarshal(body, &ingested)
	if code != http.StatusCreated || ingested.Thought.Origin == nil || ingested.Thought.Origin.CreatedKey != "Nur Inbox" {
		t.Fatalf("ingest origin: %d %s", code, body)
	}
	if _, err := store.UpdateThoughtTriage(claims.UserID, ingested.Thought.ID, "keep", "list_item", list.ID, "", ""); err != nil {
		t.Fatal(err)
	}
	items, _ := store.GetListItems(list.ID)
	found := false
	for _, it := range items {
		if it.Content == "Kaffee kaufen" {
			found = it.Origin != nil && it.Origin.CreatedVia == "api" && it.Origin.CreatedKey == "Nur Inbox"
		}
	}
	if !found {
		t.Fatalf("triaged list item lost its origin: %+v", items)
	}
}

// The day filters count in the server's time zone, whatever the time of day.
func TestFilterTasks(t *testing.T) {
	now := time.Date(2026, 11, 1, 23, 30, 0, 0, clock.Location())
	tasks := []domain.Thought{
		{ID: "a", DueDate: "2026-11-01T09:00"},
		{ID: "b", DueDate: "2026-10-30"},
		{ID: "c", DueDate: "2026-10-29", IsCompleted: true},
		{ID: "d", DueDate: "2026-11-02"},
		{ID: "e"},
	}
	ids := func(ts []domain.Thought) string {
		out := []string{}
		for _, x := range ts {
			out = append(out, x.ID)
		}
		return strings.Join(out, ",")
	}
	for _, tc := range []struct{ status, due, want string }{
		{"", "", "a,b,c,d,e"},
		{"", "today", "a"},
		{"", "overdue", "b"},
		{"open", "2026-11-01", "a,b"},
		{"done", "", "c"},
	} {
		got, err := filterTasks(tasks, tc.status, tc.due, now)
		if err != nil || ids(got) != tc.want {
			t.Errorf("status=%q due=%q: got %s (%v), want %s", tc.status, tc.due, ids(got), err, tc.want)
		}
	}
	if _, err := filterTasks(tasks, "offen", "", now); err == nil {
		t.Error("unknown status should fail")
	}
}

// A key can be renamed and get other rights; the secret stays, other users' keys are out of reach.
func TestUpdateAPIKey(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	key, _ := store.CreateAPIKey(claims.UserID, "Home Assistant", []string{"webhook:triage"})

	rec := sessionCall(router, http.MethodPatch, "/api/v1/keys/"+key.ID, token, `{"name":"Claude Code","scopes":["tasks:read","tasks:write"]}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
	}
	if code, _ := keyRequest(t, router, key.RawKey, http.MethodGet, "/api/v1/tasks", ""); code != http.StatusOK {
		t.Fatalf("same secret should now read tasks: %d", code)
	}
	keys, _ := store.GetAPIKeys(claims.UserID)
	if keys[0].Name != "Claude Code" {
		t.Fatalf("name not changed: %+v", keys[0])
	}
	other, _ := store.CreateUser("other@example.com", "hash", "Other", "member")
	foreign, _ := store.CreateAPIKey(other.ID, "Fremd", nil)
	if rec := sessionCall(router, http.MethodPatch, "/api/v1/keys/"+foreign.ID, token, `{"name":"x"}`, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign key must not be changed: %d", rec.Code)
	}
}
