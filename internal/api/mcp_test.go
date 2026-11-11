package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// rpc posts one JSON-RPC request to the MCP endpoint and returns status and decoded body.
func rpc(t *testing.T, router http.Handler, token, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, mcpPath, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if strings.HasPrefix(token, "mindsift_sec_") {
		req.Header.Set("X-API-Key", token)
	} else {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var out map[string]any
	if rec.Body.Len() > 0 {
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
	}
	return rec.Code, out
}

func toolNames(res map[string]any) []string {
	names := []string{}
	result, _ := res["result"].(map[string]any)
	tools, _ := result["tools"].([]any)
	for _, tl := range tools {
		names = append(names, tl.(map[string]any)["name"].(string))
	}
	return names
}

func callResult(t *testing.T, res map[string]any) (map[string]any, bool) {
	t.Helper()
	result, ok := res["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result in %v", res)
	}
	isErr, _ := result["isError"].(bool)
	return result, isErr
}

// Agent scopes decide which tools a key sees and may call; webhook-only keys get nothing to read.
func TestMCPToolsFollowScopes(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)

	code, res := rpc(t, router, token, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`)
	if code != http.StatusOK {
		t.Fatalf("initialize: %d %v", code, res)
	}
	if v := res["result"].(map[string]any)["protocolVersion"]; v != "2025-03-26" {
		t.Fatalf("requested protocol version should be echoed, got %v", v)
	}
	// Notifications are acknowledged with 202 and no body
	code, _ = rpc(t, router, token, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if code != http.StatusAccepted {
		t.Fatalf("notification should answer 202, got %d", code)
	}

	// A session sees every tool
	_, res = rpc(t, router, token, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	if n := len(toolNames(res)); n != len(mcpTools) {
		t.Fatalf("session should see all %d tools, got %d", len(mcpTools), n)
	}

	// Webhook-only key: only capture_to_inbox
	webhookKey, _ := store.CreateAPIKey(claims.UserID, "HA", nil)
	_, res = rpc(t, router, webhookKey.RawKey, `{"jsonrpc":"2.0","id":3,"method":"tools/list"}`)
	if names := toolNames(res); len(names) != 1 || names[0] != "capture_to_inbox" {
		t.Fatalf("triage key should only see capture_to_inbox, got %v", names)
	}
	_, res = rpc(t, router, webhookKey.RawKey, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_tasks","arguments":{}}}`)
	if _, isErr := callResult(t, res); !isErr {
		t.Fatalf("triage key must not list tasks: %v", res)
	}

	// Read-only task key: lists tasks, cannot complete them
	readKey, _ := store.CreateAPIKey(claims.UserID, "Reader", []string{"tasks:read"})
	names := strings.Join(toolNames(func() map[string]any {
		_, r := rpc(t, router, readKey.RawKey, `{"jsonrpc":"2.0","id":5,"method":"tools/list"}`)
		return r
	}()), ",")
	if !strings.Contains(names, "list_tasks") || strings.Contains(names, "complete_task") || strings.Contains(names, "list_lists") {
		t.Fatalf("tasks:read key sees the wrong tools: %s", names)
	}
	// search is offered with any read scope
	if !strings.Contains(names, "search") {
		t.Fatalf("search should be available with tasks:read: %s", names)
	}
}

// Full round trip with a tasks:write / lists:write key: create, list, complete; add and tick list items.
func TestMCPTasksAndLists(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"tasks:read", "tasks:write", "lists:read", "lists:write"})

	_, res := rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_task","arguments":{"content":"Filter wechseln #haus","priority":"high","dueDate":"2026-11-15"}}}`)
	result, isErr := callResult(t, res)
	if isErr {
		t.Fatalf("create_task failed: %v", result)
	}
	created := result["structuredContent"].(map[string]any)
	taskID, _ := created["id"].(string)
	if taskID == "" || created["dueDate"] != "2026-11-15" {
		t.Fatalf("unexpected task: %v", created)
	}
	th, _ := store.GetThoughtByID(claims.UserID, taskID)
	if th == nil || th.Source != "agent" || th.Status != "converted" && th.Status != "kept" {
		t.Fatalf("task not stored as task: %+v", th)
	}

	_, res = rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_tasks","arguments":{"dueBefore":"2026-11-15"}}}`)
	result, _ = callResult(t, res)
	items := result["structuredContent"].(map[string]any)["items"].([]any)
	found := false
	for _, it := range items {
		if it.(map[string]any)["id"] == taskID {
			found = true
		}
	}
	if !found {
		t.Fatalf("created task missing from list_tasks: %v", items)
	}

	_, res = rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"complete_task","arguments":{"id":"`+taskID+`"}}}`)
	result, isErr = callResult(t, res)
	if isErr || result["structuredContent"].(map[string]any)["isCompleted"] != true {
		t.Fatalf("complete_task: %v", result)
	}
	// Done tasks drop out of the default listing
	_, res = rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_tasks","arguments":{}}}`)
	result, _ = callResult(t, res)
	for _, it := range result["structuredContent"].(map[string]any)["items"].([]any) {
		if it.(map[string]any)["id"] == taskID {
			t.Fatalf("completed task should not be listed as open")
		}
	}

	// Lists
	list, _ := store.CreateList(claims.UserID, "Einkauf", "🛒", "shopping")
	_, res = rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"add_list_item","arguments":{"listId":"`+list.ID+`","content":"Hafermilch","quantity":"2"}}}`)
	result, isErr = callResult(t, res)
	if isErr {
		t.Fatalf("add_list_item: %v", result)
	}
	itemID := result["structuredContent"].(map[string]any)["id"].(string)
	_, res = rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"check_list_item","arguments":{"listId":"`+list.ID+`","itemId":"`+itemID+`"}}}`)
	result, isErr = callResult(t, res)
	if isErr || result["structuredContent"].(map[string]any)["isCompleted"] != true {
		t.Fatalf("check_list_item: %v", result)
	}
	_, res = rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_list","arguments":{"listId":"`+list.ID+`"}}}`)
	result, _ = callResult(t, res)
	lv := result["structuredContent"].(map[string]any)["list"].(map[string]any)
	if lv["openItems"].(float64) != 0 || lv["items"].(float64) != 1 {
		t.Fatalf("get_list counts wrong: %v", lv)
	}

	// Lists of other people stay invisible
	other, _ := store.CreateUser("other@example.com", "hash", "Other", "member")
	foreign, _ := store.CreateList(other.ID, "Fremd", "", "shopping")
	_, res = rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"add_list_item","arguments":{"listId":"`+foreign.ID+`","content":"Spam"}}}`)
	if _, isErr = callResult(t, res); !isErr {
		t.Fatalf("key must not write into foreign lists")
	}

	// Unknown method and batch requests are JSON-RPC errors
	_, res = rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":9,"method":"resources/list"}`)
	if res["error"] == nil {
		t.Fatalf("unknown method should be a JSON-RPC error: %v", res)
	}
	_, res = rpc(t, router, key.RawKey, `[{"jsonrpc":"2.0","id":10,"method":"ping"}]`)
	if res["error"] == nil {
		t.Fatalf("batches should be refused: %v", res)
	}
	// Without a key there is no access at all
	req := httptest.NewRequest(http.MethodPost, mcpPath, strings.NewReader(`{"jsonrpc":"2.0","id":11,"method":"ping"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous MCP call should be 401, got %d", rec.Code)
	}
}

// Agents can create task lists and lists and delete tasks; what a key creates or changes keeps its
// origin for good, also after the user's own edits.
func TestMCPCreateDeleteAndOrigin(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	key, _ := store.CreateAPIKey(claims.UserID, "Claude Code", []string{"tasks:read", "tasks:write", "lists:read", "lists:write"})
	call := func(id int, name, args string) map[string]any {
		t.Helper()
		_, res := rpc(t, router, key.RawKey, fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, id, name, args))
		result, isErr := callResult(t, res)
		if isErr {
			t.Fatalf("%s failed: %v", name, result)
		}
		return result["structuredContent"].(map[string]any)
	}

	tl := call(1, "create_task_list", `{"title":"Agentenliste"}`)
	tlID, _ := tl["id"].(string)
	if tlID == "" || tl["permission"] != "owner" || len(tl["columns"].([]any)) == 0 {
		t.Fatalf("create_task_list: %v", tl)
	}
	task := call(2, "create_task", `{"content":"Von Claude","taskListId":"`+tlID+`"}`)
	taskID := task["id"].(string)
	th, _ := store.GetThoughtByID(claims.UserID, taskID)
	if th.Origin == nil || th.Origin.CreatedVia != "mcp" || th.Origin.CreatedKey != "Claude Code" || th.TaskListID != tlID {
		t.Fatalf("agent task should carry its origin: %+v", th.Origin)
	}
	// The user's own edit keeps the origin
	notes := "selbst ergänzt"
	if _, err := srv.updateTask(claims.UserID, taskID, taskPatch{Notes: &notes}); err != nil {
		t.Fatal(err)
	}
	if th, _ = store.GetThoughtByID(claims.UserID, taskID); th.Origin == nil || th.Origin.CreatedKey != "Claude Code" || th.Origin.ChangedVia != "" {
		t.Fatalf("user edit must keep the origin and not count as a key change: %+v", th.Origin)
	}

	// A task of the user changed by the agent: changed via MCP, with key and time
	own, _ := srv.createTask(claims.UserID, "Von mir", "", "manual", "", "", "", nil)
	if own.Origin != nil {
		t.Fatalf("own task must not have an origin: %+v", own.Origin)
	}
	call(3, "complete_task", `{"id":"`+own.ID+`"}`)
	if th, _ = store.GetThoughtByID(claims.UserID, own.ID); th.Origin == nil || th.Origin.CreatedVia != "" ||
		th.Origin.ChangedVia != "mcp" || th.Origin.ChangedKey != "Claude Code" || th.Origin.ChangedAt == "" {
		t.Fatalf("agent change of a user task: %+v", th.Origin)
	}
	// Renamed or deleted keys show up as such
	_ = store.DeleteAPIKey(claims.UserID, key.ID)
	if th, _ = store.GetThoughtByID(claims.UserID, own.ID); !th.Origin.ChangedKeyDeleted || th.Origin.ChangedKey != "" {
		t.Fatalf("deleted key name: %q", th.Origin.ChangedKey)
	}
	key, _ = store.CreateAPIKey(claims.UserID, "Claude Code", []string{"tasks:read", "tasks:write", "lists:read", "lists:write"})

	call(5, "delete_task", `{"id":"`+taskID+`"}`)
	if th, err := store.GetThoughtByID(claims.UserID, taskID); err == nil && th != nil {
		t.Fatalf("task should be gone")
	}

	l := call(6, "create_list", `{"title":"Packliste","listType":"vacation"}`)
	listID := l["id"].(string)
	if l["listType"] != "vacation" || l["role"] != "owner" {
		t.Fatalf("create_list: %v", l)
	}
	item := call(7, "add_list_item", `{"listId":"`+listID+`","content":"Zahnbürste"}`)
	if o, _ := item["origin"].(map[string]any); o == nil || o["createdVia"] != "mcp" {
		t.Fatalf("agent item should carry its origin: %v", item)
	}
	items, _ := store.GetListItems(listID)
	if _, err := srv.setListItemDone(claims.UserID, listID, items[0].ID, true, nil); err != nil {
		t.Fatal(err)
	}
	if items, _ = store.GetListItems(listID); items[0].Origin == nil || items[0].Origin.CreatedKey != "Claude Code" {
		t.Fatalf("ticking by the user keeps the origin: %+v", items[0].Origin)
	}

	// Other people's tasks cannot be deleted
	other, _ := store.CreateUser("other@example.com", "hash", "Other", "member")
	foreign, _ := store.CreateThoughtWithDetails(other.ID, "Fremd", "normal", "manual", "", "", "todo", "")
	_, res := rpc(t, router, key.RawKey, `{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"delete_task","arguments":{"id":"`+foreign.ID+`"}}}`)
	if _, isErr := callResult(t, res); !isErr {
		t.Fatalf("key must not delete foreign tasks")
	}

	// The narrow right "create tasks" also allows create_task over MCP, but not update_task
	creator, _ := store.CreateAPIKey(claims.UserID, "Nur anlegen", []string{"webhook:task"})
	_, res = rpc(t, router, creator.RawKey, `{"jsonrpc":"2.0","id":9,"method":"tools/list"}`)
	if names := strings.Join(toolNames(res), ","); !strings.Contains(names, "create_task") || strings.Contains(names, "update_task") {
		t.Fatalf("webhook:task key tools: %s", names)
	}
}

// Agents manage a task's subtasks one at a time; the rest of the checklist stays as it is.
func TestMCPSubtasks(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	key, _ := store.CreateAPIKey(claims.UserID, "Claude Code", []string{"tasks:read", "tasks:write"})
	call := func(id int, name, args string) (map[string]any, bool) {
		t.Helper()
		_, res := rpc(t, router, key.RawKey, fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, id, name, args))
		result, isErr := callResult(t, res)
		if isErr {
			return result, true
		}
		return result["structuredContent"].(map[string]any), false
	}

	task, _ := srv.createTask(claims.UserID, "Umzug", "", "manual", "", "", "", nil)
	call(1, "add_subtask", `{"taskId":"`+task.ID+`","title":"Kartons kaufen"}`)
	res, isErr := call(2, "add_subtask", `{"taskId":"`+task.ID+`","title":" Strom ummelden "}`)
	if isErr {
		t.Fatalf("add_subtask: %v", res)
	}
	subs := res["subtasks"].([]any)
	if len(subs) != 2 || subs[1].(map[string]any)["title"] != "Strom ummelden" {
		t.Fatalf("subtasks after adding: %v", subs)
	}
	first := subs[0].(map[string]any)["id"].(string)
	second := subs[1].(map[string]any)["id"].(string)

	call(3, "update_subtask", `{"taskId":"`+task.ID+`","subtaskId":"`+first+`","completed":true}`)
	call(4, "update_subtask", `{"taskId":"`+task.ID+`","subtaskId":"`+second+`","title":"Strom und Gas ummelden"}`)
	th, _ := store.GetThoughtByID(claims.UserID, task.ID)
	if len(th.Subtasks) != 2 || !th.Subtasks[0].IsCompleted || th.Subtasks[1].IsCompleted || th.Subtasks[1].Title != "Strom und Gas ummelden" {
		t.Fatalf("subtasks after updating: %+v", th.Subtasks)
	}
	if th.Origin == nil || th.Origin.ChangedVia != "mcp" {
		t.Fatalf("subtask change should count as agent change: %+v", th.Origin)
	}

	call(5, "update_subtask", `{"taskId":"`+task.ID+`","subtaskId":"`+first+`","delete":true}`)
	if th, _ = store.GetThoughtByID(claims.UserID, task.ID); len(th.Subtasks) != 1 || th.Subtasks[0].ID != second {
		t.Fatalf("subtasks after deleting: %+v", th.Subtasks)
	}

	if _, isErr = call(6, "update_subtask", `{"taskId":"`+task.ID+`","subtaskId":"st_unknown","completed":true}`); !isErr {
		t.Fatalf("unknown subtask must fail")
	}
	if _, isErr = call(7, "add_subtask", `{"taskId":"`+task.ID+`","title":"  "}`); !isErr {
		t.Fatalf("empty title must fail")
	}
	other, _ := store.CreateUser("other@example.com", "hash", "Other", "member")
	foreign, _ := store.CreateThoughtWithDetails(other.ID, "Fremd", "normal", "manual", "", "", "todo", "")
	if _, isErr = call(8, "add_subtask", `{"taskId":"`+foreign.ID+`","title":"Spam"}`); !isErr {
		t.Fatalf("key must not change foreign tasks")
	}
}

// Operators can switch MCP off: in the admin settings, or fixed by MCP_ENABLED. OAuth goes with it.
func TestMCPSwitchOff(t *testing.T) {
	srv, _, session := setupTestServer(t)
	srv.cfg.BaseURL = "https://ms.example/"
	srv.cfg.BaseURLSet = true
	router := srv.Router()
	const list = `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	status := func() map[string]any {
		_, _, st := oauthDo(t, router, http.MethodGet, "/api/v1/auth/status", "", "", "")
		return st
	}

	if code, _ := rpc(t, router, session, list); code != http.StatusOK {
		t.Fatalf("MCP should be on by default, got %d", code)
	}
	if st := status(); st["mcpEnabled"] != true || st["mcpConnectorUrl"] == "" {
		t.Fatalf("status with MCP on: %v", st)
	}

	if code, _, _ := oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", session, "application/json", `{"mcpEnabled":false}`); code != http.StatusOK {
		t.Fatalf("switch off: %d", code)
	}
	if code, _ := rpc(t, router, session, list); code != http.StatusNotFound {
		t.Fatalf("MCP switched off must answer 404, got %d", code)
	}
	code, h, _ := oauthDo(t, router, http.MethodPost, mcpPath, "", "application/json", list)
	if code != http.StatusNotFound || h.Get("WWW-Authenticate") != "" {
		t.Fatalf("no login hint while MCP is off: %d %q", code, h.Get("WWW-Authenticate"))
	}
	if code, _, _ := oauthDo(t, router, http.MethodGet, "/.well-known/oauth-authorization-server", "", "", ""); code != http.StatusNotFound {
		t.Fatalf("OAuth must be off with MCP, got %d", code)
	}
	if st := status(); st["mcpEnabled"] != false || st["mcpConnectorUrl"] != "" {
		t.Fatalf("status with MCP off: %v", st)
	}
	// Saving other settings (without the field) leaves the switch as it is
	if code, _, _ := oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", session, "application/json", `{"allowPrivateWebhooks":true}`); code != http.StatusOK {
		t.Fatalf("save other settings: %d", code)
	}
	if code, _ := rpc(t, router, session, list); code != http.StatusNotFound {
		t.Fatalf("MCP must stay off, got %d", code)
	}

	// MCP_ENABLED wins over the stored switch and locks it
	on := true
	srv.cfg.MCPEnabled = &on
	if code, _ := rpc(t, router, session, list); code != http.StatusOK {
		t.Fatalf("MCP_ENABLED=true must win, got %d", code)
	}
	_, _, adm := oauthDo(t, router, http.MethodGet, "/api/v1/admin/settings", session, "", "")
	if adm["mcpEnabled"] != true || adm["mcpConfiguredViaEnv"] != true {
		t.Fatalf("admin settings must show the environment's value: %v", adm)
	}
	off := false
	srv.cfg.MCPEnabled = &off
	if code, _, _ := oauthDo(t, router, http.MethodPut, "/api/v1/admin/settings", session, "application/json", `{"mcpEnabled":true}`); code != http.StatusOK {
		t.Fatalf("save: %d", code)
	}
	if code, _ := rpc(t, router, session, list); code != http.StatusNotFound {
		t.Fatalf("MCP_ENABLED=false must win, got %d", code)
	}
	srv.cfg.MCPEnabled = nil
	if code, _ := rpc(t, router, session, list); code != http.StatusNotFound {
		t.Fatalf("the locked switch must not have changed the stored value, got %d", code)
	}
}

// Notes over MCP: notes:create only creates, notes:read lists, reads and finds them; REST stays closed.
func TestMCPNotes(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := func(key, name, args string) (map[string]any, bool) {
		t.Helper()
		_, res := rpc(t, router, key, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+name+`","arguments":`+args+`}}`)
		result, isErr := callResult(t, res)
		sc, _ := result["structuredContent"].(map[string]any)
		return sc, isErr
	}
	names := func(key string) string {
		_, res := rpc(t, router, key, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
		return "," + strings.Join(toolNames(res), ",") + ","
	}

	writer, _ := store.CreateAPIKey(claims.UserID, "Schreiber", []string{"notes:create"})
	if n := names(writer.RawKey); n != ",create_note," {
		t.Fatalf("notes:create should only offer create_note, got %s", n)
	}
	note, isErr := call(writer.RawKey, "create_note", `{"title":"Ideen","folderPath":"/Projekte/KI/","content":"- Erster Punkt\n\t- Unterpunkt\n- [ ] Offen"}`)
	if isErr || note["folderPath"] != "Projekte/KI" || note["permission"] != "owner" {
		t.Fatalf("create_note: %v", note)
	}
	doc, err := store.GetDocumentByID(claims.UserID, note["id"].(string))
	if err != nil || len(doc.Blocks) != 3 || doc.Blocks[1].Level != 1 || doc.Blocks[2].Type != "todo" {
		t.Fatalf("bullets not stored as outline: %+v", doc)
	}
	if _, isErr := call(writer.RawKey, "create_note", `{"title":" "}`); !isErr {
		t.Fatal("empty title must be refused")
	}
	if _, isErr := call(writer.RawKey, "list_notes", `{}`); !isErr {
		t.Fatal("notes:create must not read notes")
	}

	reader, _ := store.CreateAPIKey(claims.UserID, "Leser", []string{"notes:read"})
	if n := names(reader.RawKey); !strings.Contains(n, ",list_notes,") || !strings.Contains(n, ",get_note,") ||
		!strings.Contains(n, ",search,") || strings.Contains(n, ",create_note,") {
		t.Fatalf("notes:read sees the wrong tools: %s", n)
	}
	_, _ = store.CreateDocument(claims.UserID, "", "Einkauf", "", "", nil, nil, false)
	list, _ := call(reader.RawKey, "list_notes", `{"folder":"Projekte/KI"}`)
	if items := list["items"].([]any); len(items) != 1 || items[0].(map[string]any)["title"] != "Ideen" {
		t.Fatalf("folder filter: %v", list)
	}
	// The folder includes its subfolders; the title filter ignores case
	list, _ = call(reader.RawKey, "list_notes", `{"folder":"Projekte","query":"IDEE"}`)
	if items := list["items"].([]any); len(items) != 1 {
		t.Fatalf("subfolder and title filter: %v", list)
	}
	got, isErr := call(reader.RawKey, "get_note", `{"id":"`+doc.ID+`"}`)
	if isErr || got["content"] != "- Erster Punkt\n\t- Unterpunkt\n- [ ] Offen\n" {
		t.Fatalf("get_note: %q", got["content"])
	}
	found, _ := call(reader.RawKey, "search", `{"query":"Unterpunkt"}`)
	if hits := found["notes"].([]any); len(hits) == 0 || hits[0].(map[string]any)["noteId"] != doc.ID {
		t.Fatalf("search should find the note: %v", found)
	}
	// Without notes:read the search leaves notes out
	taskReader, _ := store.CreateAPIKey(claims.UserID, "Aufgaben", []string{"tasks:read"})
	if found, _ := call(taskReader.RawKey, "search", `{"query":"Unterpunkt"}`); len(found["notes"].([]any)) != 0 {
		t.Fatalf("tasks:read must not find notes: %v", found)
	}
	// Notes stay closed over REST
	if code, _, _ := oauthDo(t, router, http.MethodGet, "/api/v1/documents", reader.RawKey, "", ""); code != http.StatusForbidden {
		t.Fatalf("REST must stay closed for notes keys, got %d", code)
	}

	// A shared folder with read access only takes no new notes
	other, _ := store.CreateUser("owner@example.com", "hash", "Owner", "member")
	if _, err := store.CreateFolder(other.ID, "Team"); err != nil {
		t.Fatal(err)
	}
	sf, err := store.CreateSharedFolder(other.ID, "Team", "Team")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateFolderShare(other.ID, sf.ID, "user", claims.UserID, "read"); err != nil {
		t.Fatal(err)
	}
	_, res := rpc(t, router, writer.RawKey, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_note","arguments":{"title":"Rein","folderPath":"Team"}}}`)
	if result, isErr := callResult(t, res); !isErr || !strings.Contains(fmt.Sprint(result["content"]), "only read in the shared folder “Team”") {
		t.Fatalf("read-only shared folder must refuse new notes: %v", result)
	}
}
