package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
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

// The MCP endpoint has no server stream: every method but POST answers 405 with Allow: POST, for an API
// key as for a session (not 403, which says the key lacks a right). POST keeps its checks.
func TestMCPOtherMethodsAnswer405(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"tasks:read"})

	for _, method := range []string{http.MethodGet, http.MethodDelete, http.MethodPut, http.MethodPatch} {
		for who, setAuth := range map[string]func(*http.Request){
			"key":     func(r *http.Request) { r.Header.Set("X-API-Key", key.RawKey) },
			"session": func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+token) },
		} {
			req := httptest.NewRequest(method, mcpPath, nil)
			setAuth(req)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			// GET and DELETE are the endpoint's own 405; the router answers any other method
			ownAnswer := method == http.MethodGet || method == http.MethodDelete
			if rec.Code != http.StatusMethodNotAllowed || (ownAnswer && rec.Header().Get("Allow") != "POST") {
				t.Errorf("%s %s with a %s: %d Allow=%q, want 405 (Allow=POST for GET and DELETE)", method, mcpPath, who, rec.Code, rec.Header().Get("Allow"))
			}
		}
	}
	// Without a login it stays 401, and POST still works with the key
	req := httptest.NewRequest(http.MethodGet, mcpPath, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("GET without a login: %d", rec.Code)
	}
	if code, body := keyRequest(t, router, key.RawKey, http.MethodPost, mcpPath, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`); code != http.StatusOK {
		t.Errorf("POST with the key: %d %s", code, body)
	}
}

// The filters of GET /tasks: the day filters count in the server's time zone, whatever the time of day,
// overdue takes open tasks only, and tasks without a due date drop out of every day filter.
func TestFilterTasks(t *testing.T) {
	_, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	now := time.Date(2026, 11, 1, 23, 30, 0, 0, clock.Location())
	ids := map[string]string{}
	for _, tc := range []struct {
		name, due string
		done      bool
	}{{"a", "2026-11-01T09:00", false}, {"b", "2026-10-30", false}, {"c", "2026-10-29", true}, {"d", "2026-11-02", false}, {"e", "", false}} {
		task, _, _, err := store.CreateTask(claims.UserID, tc.name, "", "", tc.due, "", "", nil)
		if err != nil {
			t.Fatal(err)
		}
		if tc.done {
			done := true
			if _, err := store.UpdateThoughtDetails(claims.UserID, task.ID, nil, &done, nil, nil, nil, nil, nil, nil, nil); err != nil {
				t.Fatal(err)
			}
		}
		ids[task.ID] = tc.name
	}
	names := func(ts []domain.Thought) string {
		out := []string{}
		for _, x := range ts {
			if name, ok := ids[x.ID]; ok { // the account's sample tasks aside
				out = append(out, name)
			}
		}
		sort.Strings(out)
		return strings.Join(out, ",")
	}
	for _, tc := range []struct{ status, due, want string }{
		{"", "", "a,b,c,d,e"},
		{"", "today", "a"},
		{"", "overdue", "b"},
		{"done", "overdue", ""},
		{"open", "2026-11-01", "a,b"},
		{"done", "", "c"},
	} {
		q, none, err := taskFilter(tc.status, tc.due, now)
		got := []domain.Thought{}
		if err == nil && !none {
			got, err = store.QueryTasks(claims.UserID, q)
		}
		if err != nil || names(got) != tc.want {
			t.Errorf("status=%q due=%q: got %s (%v), want %s", tc.status, tc.due, names(got), err, tc.want)
		}
	}
	if _, _, err := taskFilter("offen", "", now); err == nil {
		t.Error("unknown status should fail")
	}
	if _, _, err := taskFilter("", "morgen", now); err == nil {
		t.Error("unknown due should fail")
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
