package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// MCP (Model Context Protocol) endpoint for AI agents: Streamable HTTP, stateless, JSON-RPC 2.0 over
// POST. Authentication runs through authMiddleware (API key with agent scopes or a session); every
// tool checks the scope it needs (mcpToolAllowed). There is no server-to-client stream (GET answers
// 405), so each request is one JSON response.

const mcpPath = "/api/v1/mcp"

// Version of the tool set, not of MindSift (the binary does not know its release)
const mcpServerVersion = "1"

// Protocol versions this server speaks; the newest is the default
var mcpProtocolVersions = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

type jsonrpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type jsonrpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  interface{}     `json:"result,omitempty"`
	Error   *jsonrpcError   `json:"error,omitempty"`
}

const (
	rpcParseError     = -32700
	rpcInvalidRequest = -32600
	rpcMethodNotFound = -32601
	rpcInvalidParams  = -32602
)

// mcpTool is one callable tool: the scope an API key needs for it and the function doing the work.
// run returns the structured result; an error becomes a tool error (isError) the agent can read.
type mcpTool struct {
	Name        string
	Description string
	Scope       string
	// AltScope: a narrower right that allows this tool too (e.g. "create tasks" for create_task)
	AltScope string
	Schema   map[string]interface{}
	run      func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error)
}

// mcpToolAllowed: sessions may use every tool, API keys only those of their scopes. search needs any
// read scope (its results are filtered to those scopes).
func mcpToolAllowed(scopes []string, isKey bool, tool mcpTool) bool {
	if !isKey {
		return true
	}
	if tool.Scope == "" {
		return true
	}
	has := func(sc string) bool {
		for _, have := range scopes {
			if have == sc {
				return true
			}
		}
		return false
	}
	if tool.Name == "search" {
		return has(storage.ScopeTasksRead) || has(storage.ScopeListsRead) || has(storage.ScopeNotesRead)
	}
	return has(tool.Scope) || (tool.AltScope != "" && has(tool.AltScope))
}

func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	scopes, isKey := keyScopes(r.Context())
	// Changes are recorded as made via MCP, with the key if there is one (a login session has none)
	actor := actorFrom(r.Context())
	if actor == nil {
		actor = &apiActor{Via: storage.OriginMCP}
	}

	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeRPC(w, nil, nil, &jsonrpcError{rpcParseError, "Ungültiges JSON"})
		return
	}
	trimmed := strings.TrimSpace(string(raw))
	if strings.HasPrefix(trimmed, "[") {
		writeRPC(w, nil, nil, &jsonrpcError{rpcInvalidRequest, "Batch-Anfragen werden nicht unterstützt"})
		return
	}
	var req jsonrpcRequest
	if err := json.Unmarshal(raw, &req); err != nil || req.Method == "" {
		writeRPC(w, nil, nil, &jsonrpcError{rpcInvalidRequest, "Ungültige JSON-RPC-Anfrage"})
		return
	}
	// Notifications (no id) are acknowledged without a body
	if len(req.ID) == 0 || string(req.ID) == "null" {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &p)
		version := mcpProtocolVersions[0]
		for _, v := range mcpProtocolVersions {
			if v == p.ProtocolVersion {
				version = v
			}
		}
		writeRPC(w, req.ID, map[string]interface{}{
			"protocolVersion": version,
			"capabilities":    map[string]interface{}{"tools": map[string]interface{}{}},
			"serverInfo":      map[string]string{"name": "MindSift", "version": mcpServerVersion},
			"instructions": "MindSift is a personal notes, tasks and lists app. Use list_task_lists and list_tasks " +
				"to see open tasks, complete_task to check one off, add_subtask/update_subtask for a task's " +
				"checklist, list_lists/get_list for shopping and other lists and check_list_item to tick items, " +
				"list_notes/get_note to read notes and create_note for a " +
				"new one. IDs come from the list tools; never guess them. Tasks and list items you create or " +
				"change show the user a badge with the name of your API key. Notes, tasks and lists come with a url " +
				"that opens them in the app: when you tell the user about one, summarize it and add its url so " +
				"they can look for themselves.",
		}, nil)
	case "ping":
		writeRPC(w, req.ID, map[string]interface{}{}, nil)
	case "tools/list":
		tools := []map[string]interface{}{}
		for _, t := range mcpTools {
			if !mcpToolAllowed(scopes, isKey, t) {
				continue
			}
			tools = append(tools, map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"inputSchema": t.Schema,
			})
		}
		writeRPC(w, req.ID, map[string]interface{}{"tools": tools}, nil)
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Name == "" {
			writeRPC(w, req.ID, nil, &jsonrpcError{rpcInvalidParams, "Parameter 'name' fehlt"})
			return
		}
		tool, ok := mcpToolByName(p.Name)
		if !ok {
			writeRPC(w, req.ID, nil, &jsonrpcError{rpcInvalidParams, "Unbekanntes Tool: " + p.Name})
			return
		}
		if !mcpToolAllowed(scopes, isKey, tool) {
			writeRPC(w, req.ID, toolError(i18n.T("en", "Der API-Key hat keine Berechtigung für {tool} (Scope {scope} fehlt)", "tool", tool.Name, "scope", tool.Scope)), nil)
			return
		}
		if len(p.Arguments) == 0 {
			p.Arguments = json.RawMessage("{}")
		}
		result, err := tool.run(s, userID, actor, p.Arguments)
		if err != nil {
			writeRPC(w, req.ID, toolError(i18n.Text("en", err)), nil)
			return
		}
		if tool.Name == "search" && isKey {
			result = filterSearchForScopes(result, scopes)
		}
		writeRPC(w, req.ID, toolResult(result), nil)
	default:
		writeRPC(w, req.ID, nil, &jsonrpcError{rpcMethodNotFound, "Methode nicht unterstützt: " + req.Method})
	}
}

// handleMCPNoStream: the endpoint is stateless and has no server-initiated stream (GET) or session to
// end (DELETE).
// mcpEnabled: MCP_ENABLED if set, else the admin's switch in the system settings (default: on).
func (s *Server) mcpEnabled() bool {
	if s.cfg.MCPEnabled != nil {
		return *s.cfg.MCPEnabled
	}
	return s.store.MCPEnabledSetting()
}

func handleMCPNoStream(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Allow", "POST")
	writeError(w, http.StatusMethodNotAllowed, "Der MCP-Endpunkt nimmt nur POST an (kein Server-Stream)")
}

// MCP speaks English to agents whatever the user's language
func writeRPC(w http.ResponseWriter, id json.RawMessage, result interface{}, rpcErr *jsonrpcError) {
	if rpcErr != nil {
		rpcErr.Message = i18n.T("en", rpcErr.Message)
	}
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	writeJSON(w, http.StatusOK, jsonrpcResponse{JSONRPC: "2.0", ID: id, Result: result, Error: rpcErr})
}

// toolResult: the data as structuredContent plus the same JSON as text for clients without
// structured output.
func toolResult(data interface{}) map[string]interface{} {
	text, _ := json.MarshalIndent(data, "", "  ")
	return map[string]interface{}{
		"content":           []map[string]string{{"type": "text", "text": string(text)}},
		"structuredContent": wrapStructured(data),
	}
}

// structuredContent must be an object; arrays are wrapped
func wrapStructured(data interface{}) interface{} {
	raw, _ := json.Marshal(data)
	if strings.HasPrefix(strings.TrimSpace(string(raw)), "[") {
		return map[string]interface{}{"items": data}
	}
	return data
}

func toolError(msg string) map[string]interface{} {
	return map[string]interface{}{
		"content": []map[string]string{{"type": "text", "text": i18n.T("en", msg)}},
		"isError": true,
	}
}

// --- tools ---

func mcpToolByName(name string) (mcpTool, bool) {
	for _, t := range mcpTools {
		if t.Name == name {
			return t, true
		}
	}
	return mcpTool{}, false
}

func schema(required []string, props map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{"type": "object", "properties": props}
	if len(required) > 0 {
		out["required"] = required
	}
	return out
}

func prop(typ, desc string) map[string]interface{} {
	return map[string]interface{}{"type": typ, "description": desc}
}

func decodeArgs(args json.RawMessage, into interface{}) error {
	if err := json.Unmarshal(args, into); err != nil {
		return errors.New("Ungültige Argumente: " + err.Error())
	}
	return nil
}

// taskView is what an agent gets per task: the fields it can reason about, no internal bookkeeping.
type taskView struct {
	ID           string           `json:"id"`
	Content      string           `json:"content"`
	IsCompleted  bool             `json:"isCompleted"`
	Priority     string           `json:"priority"`
	DueDate      string           `json:"dueDate,omitempty"`
	TaskListID   string           `json:"taskListId,omitempty"`
	KanbanStatus string           `json:"kanbanStatus,omitempty"`
	Notes        string           `json:"notes,omitempty"`
	Tags         []string         `json:"tags,omitempty"`
	Subtasks     []domain.SubTask `json:"subtasks,omitempty"`
	Recurrence   string           `json:"recurrence,omitempty"`
	Reminders    []int            `json:"reminders,omitempty"`
	CreatedAt    string           `json:"createdAt"`
	Origin       *domain.Origin   `json:"origin,omitempty"`
	URL          string           `json:"url,omitempty"`
}

// mcpLink: the address that opens a note, task or list in the app (?note=…, ?task=…, ?list=…), so an
// agent can hand the user a link; empty without BASE_URL.
func (s *Server) mcpLink(kind, id string) string {
	if !s.cfg.BaseURLSet || id == "" {
		return ""
	}
	return strings.TrimRight(s.cfg.BaseURL, "/") + "/?" + kind + "=" + url.QueryEscape(id)
}

func (s *Server) toTaskView(t *domain.Thought) taskView {
	// Mentions as "@Name" (an agent reads them out; it cannot mention anyone itself)
	subs := make([]domain.SubTask, len(t.Subtasks))
	for i, st := range t.Subtasks {
		st.Title = s.store.ReadableMentions(st.Title)
		subs[i] = st
	}
	return taskView{
		ID: t.ID, Content: t.Content, IsCompleted: t.IsCompleted, Priority: t.Priority, DueDate: t.DueDate,
		TaskListID: t.TaskListID, KanbanStatus: t.KanbanStatus, Notes: s.store.ReadableMentions(t.Notes), Tags: t.Tags, Subtasks: subs,
		Recurrence: t.Recurrence, Reminders: t.Reminders, CreatedAt: t.CreatedAt, Origin: t.Origin, URL: s.mcpLink("task", t.ID),
	}
}

type taskListView struct {
	ID         string       `json:"id"`
	Title      string       `json:"title"`
	Icon       string       `json:"icon,omitempty"`
	Permission string       `json:"permission"`
	OpenTasks  int          `json:"openTasks"`
	Columns    []columnView `json:"columns,omitempty"`
}

// columnView: a board column, so an agent knows the valid kanbanStatus values of a task list
type columnView struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	IsDone bool   `json:"isDone,omitempty"`
}

func (s *Server) toTaskListView(l domain.TaskList) taskListView {
	cols := make([]columnView, 0, len(l.Columns))
	for _, c := range l.Columns {
		cols = append(cols, columnView{ID: c.ID, Name: c.Name, IsDone: c.IsDone})
	}
	permission := l.Permission
	if permission == "" && l.IsOwner {
		permission = "owner"
	}
	return taskListView{ID: l.ID, Title: l.Title, Icon: l.Icon, Permission: permission, OpenTasks: l.TasksCount, Columns: cols}
}

// noteView: a note without its bullets (list_notes); get_note adds them as Markdown.
type noteView struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Icon       string   `json:"icon,omitempty"`
	FolderPath string   `json:"folderPath,omitempty"`
	Permission string   `json:"permission"`
	Tags       []string `json:"tags,omitempty"`
	UpdatedAt  string   `json:"updatedAt"`
	URL        string   `json:"url,omitempty"`
	Content    string   `json:"content,omitempty"`
	// Bullets with their ids (get_note), for changing single bullets (notes:write)
	Bullets []noteBullet `json:"bullets,omitempty"`
	// Warnings (create_note): something in the call did not end up in the note
	Warnings []string `json:"warnings,omitempty"`
}

func (s *Server) toNoteView(d *domain.Document) noteView {
	permission := d.Permission
	if d.IsOwner || permission == "" {
		permission = "owner"
	}
	return noteView{ID: d.ID, Title: d.Title, Icon: d.Icon, FolderPath: d.FolderPath, Permission: permission, Tags: d.Tags, UpdatedAt: d.UpdatedAt, URL: s.mcpLink("note", d.ID)}
}

// noteMarkdown renders the bullets as an indented Markdown list; images and recordings become a
// placeholder with their caption (the agent cannot open the files), drawings a description in words,
// links to notes [[current title]] without ids (titles: storage.DocTitles of the user).
func (s *Server) noteMarkdown(blocks []domain.DocumentBlock, titles map[string]string) string {
	out := make([]domain.DocumentBlock, len(blocks))
	for i, b := range blocks {
		b.Content = s.store.ReadableMentions(storage.ReadableWikiLinks(b.Content, titles))
		if b.Type == "image" || b.Type == "audio" {
			label := map[string]string{"image": "Bild", "audio": "Aufnahme"}[b.Type]
			if ref, ok := storage.ParseMediaContent(b.Content); ok && ref.Caption != "" {
				label += ": " + ref.Caption
			}
			b.Type, b.Content = "paragraph", "["+label+"]"
		}
		if b.Type == drawing.BlockType {
			b.Type, b.Content = "paragraph", drawing.Describe(b.Content)
		}
		out[i] = b
	}
	return storage.BlocksToVaultMarkdown(out)
}

// noteHit: a matching bullet (or title) of a note in the search
type noteHit struct {
	NoteID  string `json:"noteId"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
	URL     string `json:"url,omitempty"`
}

// markTags strips the highlighting of search snippets
var markTags = strings.NewReplacer("<mark>", "", "</mark>", "")

type listView struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Icon      string `json:"icon,omitempty"`
	ListType  string `json:"listType"`
	Role      string `json:"role"`
	OpenItems int    `json:"openItems"`
	Items     int    `json:"items"`
	URL       string `json:"url,omitempty"`
}

func (s *Server) toListView(l domain.SharedList) listView {
	open := 0
	for _, it := range l.Items {
		if !it.IsCompleted {
			open++
		}
	}
	role := l.Role
	if l.IsOwner {
		role = "owner"
	}
	return listView{ID: l.ID, Title: l.Title, Icon: l.Icon, ListType: l.ListType, Role: role, OpenItems: open, Items: len(l.Items), URL: s.mcpLink("list", l.ID)}
}

var mcpTools = []mcpTool{
	{
		Name:        "list_task_lists",
		Description: "All task lists the user can see, with permission (owner/editor/viewer), the number of open tasks and the board columns (valid kanbanStatus values). Tasks without a list live in the personal inbox list (taskListId empty).",
		Scope:       storage.ScopeTasksRead,
		Schema:      schema(nil, map[string]interface{}{}),
		run: func(s *Server, userID string, _ *apiActor, _ json.RawMessage) (interface{}, error) {
			lists, err := s.store.GetTaskLists(userID)
			if err != nil {
				return nil, err
			}
			out := make([]taskListView, 0, len(lists))
			for _, l := range lists {
				out = append(out, s.toTaskListView(l))
			}
			return out, nil
		},
	},
	{
		Name:        "create_task_list",
		Description: "Create a personal task list (board with the default columns). Returns it with its id and columns.",
		Scope:       storage.ScopeTasksWrite,
		Schema: schema([]string{"title"}, map[string]interface{}{
			"title": prop("string", "Name of the task list"),
			"icon":  prop("string", "One emoji, optional (default 📋)"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				Title string `json:"title"`
				Icon  string `json:"icon"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if strings.TrimSpace(a.Title) == "" {
				return nil, errors.New("'title' darf nicht leer sein")
			}
			if err := checkMCPIcon(a.Icon); err != nil {
				return nil, err
			}
			tl, err := s.store.CreateTaskList(userID, "", "", a.Title, a.Icon, "")
			if err != nil {
				return nil, err
			}
			s.broadcastTaskListChange(tl.ID, nil, "TASK_LIST_CREATED")
			tl.IsOwner = true
			return s.toTaskListView(*tl), nil
		},
	},
	{
		Name:        "list_tasks",
		Description: "Tasks the user can see. Defaults to open tasks across all lists; filter by taskListId, status (open|done|all) or dueBefore (YYYY-MM-DD, inclusive). Sorted: overdue and due first.",
		Scope:       storage.ScopeTasksRead,
		Schema: schema(nil, map[string]interface{}{
			"taskListId": prop("string", "Only tasks of this task list"),
			"status":     map[string]interface{}{"type": "string", "enum": []string{"open", "done", "all"}, "description": "Default open"},
			"dueBefore":  prop("string", "Only tasks due on or before this date (YYYY-MM-DD); tasks without due date are left out"),
			"limit":      prop("integer", "Maximum number of tasks (default 100)"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				TaskListID string `json:"taskListId"`
				Status     string `json:"status"`
				DueBefore  string `json:"dueBefore"`
				Limit      int    `json:"limit"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			tasks, err := s.store.GetTasks(userID, a.TaskListID)
			if err != nil {
				return nil, err
			}
			if a.Limit <= 0 {
				a.Limit = 100
			}
			out := make([]taskView, 0)
			for i := range tasks {
				t := &tasks[i]
				switch a.Status {
				case "done":
					if !t.IsCompleted {
						continue
					}
				case "all":
				default:
					if t.IsCompleted {
						continue
					}
				}
				if a.DueBefore != "" && (t.DueDate == "" || t.DueDate[:min(10, len(t.DueDate))] > a.DueBefore) {
					continue
				}
				out = append(out, s.toTaskView(t))
			}
			// Due dates first (earliest on top), then the rest in list order
			sort.SliceStable(out, func(i, j int) bool {
				if (out[i].DueDate == "") != (out[j].DueDate == "") {
					return out[i].DueDate != ""
				}
				return out[i].DueDate != "" && out[i].DueDate < out[j].DueDate
			})
			if len(out) > a.Limit {
				out = out[:a.Limit]
			}
			return out, nil
		},
	},
	{
		Name:        "get_task",
		Description: "One task with all details.",
		Scope:       storage.ScopeTasksRead,
		Schema:      schema([]string{"id"}, map[string]interface{}{"id": prop("string", "Task id")}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ID string `json:"id"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			t, err := s.store.GetThoughtByID(userID, a.ID)
			if err != nil || t == nil {
				return nil, errors.New("Aufgabe nicht gefunden")
			}
			return s.toTaskView(t), nil
		},
	},
	{
		Name:        "create_task",
		Description: "Create a task, optionally in a task list the user may edit. dueDate as YYYY-MM-DD or YYYY-MM-DDTHH:MM.",
		Scope:       storage.ScopeTasksWrite,
		AltScope:    storage.ScopeTask,
		Schema: schema([]string{"content"}, map[string]interface{}{
			"content":    prop("string", "Task text; #hashtags become tags"),
			"taskListId": prop("string", "Task list id (from list_task_lists); empty = personal tasks"),
			"priority":   map[string]interface{}{"type": "string", "enum": []string{"low", "normal", "high", "urgent"}},
			"dueDate":    prop("string", "YYYY-MM-DD or YYYY-MM-DDTHH:MM"),
			"notes":      prop("string", "Longer description"),
			"reminders": map[string]interface{}{"type": "array", "items": map[string]string{"type": "integer"},
				"description": "Reminders in minutes before the due date, replacing the user's lead time: 0, 15, 30, 60, 120, 1440 (1 day), 2880, 4320, 10080 (1 week), 20160 (2 weeks), 43200 (1 month); [] = the lead time again"},
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				Content    string `json:"content"`
				TaskListID string `json:"taskListId"`
				Priority   string `json:"priority"`
				DueDate    string `json:"dueDate"`
				Notes      string `json:"notes"`
				Reminders  []int  `json:"reminders"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if strings.TrimSpace(a.Content) == "" {
				return nil, errors.New("'content' darf nicht leer sein")
			}
			if _, ok := domain.NormalizeReminders(a.Reminders); !ok {
				return nil, storage.ErrInvalidReminders
			}
			t, err := s.createTask(userID, a.Content, a.Priority, "agent", a.DueDate, a.TaskListID, a.Notes, actor)
			if err != nil {
				return nil, err
			}
			if len(a.Reminders) > 0 {
				if t.Reminders, err = s.store.SetTaskReminders(userID, t.ID, a.Reminders); err != nil {
					return nil, err
				}
			}
			return s.toTaskView(t), nil
		},
	},
	{
		Name:        "update_task",
		Description: "Change fields of a task; only the given fields change. Empty dueDate removes the due date.",
		Scope:       storage.ScopeTasksWrite,
		Schema: schema([]string{"id"}, map[string]interface{}{
			"id":           prop("string", "Task id"),
			"content":      prop("string", "New text"),
			"isCompleted":  prop("boolean", "true = done"),
			"dueDate":      prop("string", "YYYY-MM-DD, YYYY-MM-DDTHH:MM or empty"),
			"priority":     map[string]interface{}{"type": "string", "enum": []string{"low", "normal", "high", "urgent"}},
			"notes":        prop("string", "Description"),
			"kanbanStatus": prop("string", "Column id of the task list's board (e.g. todo, in_progress, done)"),
			"taskListId":   prop("string", "Move into another task list"),
			"tags":         map[string]interface{}{"type": "array", "items": map[string]string{"type": "string"}},
			"reminders": map[string]interface{}{"type": "array", "items": map[string]string{"type": "integer"},
				"description": "Reminders in minutes before the due date, replacing the user's lead time: 0, 15, 30, 60, 120, 1440 (1 day), 2880, 4320, 10080 (1 week), 20160 (2 weeks), 43200 (1 month); [] = the lead time again"},
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ID string `json:"id"`
				taskPatch
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			a.taskPatch.Assignees, a.taskPatch.Recurrence, a.taskPatch.Subtasks = nil, nil, nil
			a.taskPatch.actor = actor
			t, err := s.updateTask(userID, a.ID, a.taskPatch)
			if err != nil {
				return nil, err
			}
			return s.toTaskView(t), nil
		},
	},
	{
		Name:        "complete_task",
		Description: "Check a task off (or reopen it with completed=false). Recurring tasks move to their next date.",
		Scope:       storage.ScopeTasksWrite,
		Schema: schema([]string{"id"}, map[string]interface{}{
			"id":        prop("string", "Task id"),
			"completed": prop("boolean", "Default true"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ID        string `json:"id"`
				Completed *bool  `json:"completed"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			done := a.Completed == nil || *a.Completed
			t, err := s.updateTask(userID, a.ID, taskPatch{IsCompleted: &done, actor: actor})
			if err != nil {
				return nil, err
			}
			return s.toTaskView(t), nil
		},
	},
	{
		Name:        "add_subtask",
		Description: "Add a subtask (checklist item) to a task. Returns the task with all its subtasks.",
		Scope:       storage.ScopeTasksWrite,
		Schema: schema([]string{"taskId", "title"}, map[string]interface{}{
			"taskId": prop("string", "Task id"),
			"title":  prop("string", "Subtask text"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				TaskID string `json:"taskId"`
				Title  string `json:"title"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			title := strings.TrimSpace(a.Title)
			if title == "" {
				return nil, errors.New("'title' darf nicht leer sein")
			}
			t, err := s.store.GetThoughtByID(userID, a.TaskID)
			if err != nil || t == nil {
				return nil, errors.New("Aufgabe nicht gefunden")
			}
			subs := append(append([]domain.SubTask{}, t.Subtasks...), domain.SubTask{
				ID: domain.NewID("st"), Title: title, CreatedAt: time.Now().UTC().Format(time.RFC3339),
			})
			updated, err := s.updateTask(userID, a.TaskID, taskPatch{Subtasks: &subs, actor: actor})
			if err != nil {
				return nil, err
			}
			return s.toTaskView(updated), nil
		},
	},
	{
		Name:        "update_subtask",
		Description: "Tick a subtask off (completed), reopen it (completed=false), rename it (title) or remove it (delete=true).",
		Scope:       storage.ScopeTasksWrite,
		Schema: schema([]string{"taskId", "subtaskId"}, map[string]interface{}{
			"taskId":    prop("string", "Task id"),
			"subtaskId": prop("string", "Subtask id from get_task"),
			"completed": prop("boolean", "true = done"),
			"title":     prop("string", "New text"),
			"delete":    prop("boolean", "true = remove the subtask"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				TaskID    string  `json:"taskId"`
				SubtaskID string  `json:"subtaskId"`
				Completed *bool   `json:"completed"`
				Title     *string `json:"title"`
				Delete    bool    `json:"delete"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if a.Title != nil && strings.TrimSpace(*a.Title) == "" {
				return nil, errors.New("'title' darf nicht leer sein")
			}
			t, err := s.store.GetThoughtByID(userID, a.TaskID)
			if err != nil || t == nil {
				return nil, errors.New("Aufgabe nicht gefunden")
			}
			subs := make([]domain.SubTask, 0, len(t.Subtasks))
			found := false
			for _, st := range t.Subtasks {
				if st.ID != a.SubtaskID {
					subs = append(subs, st)
					continue
				}
				found = true
				if a.Delete {
					continue
				}
				if a.Completed != nil {
					st.IsCompleted = *a.Completed
				}
				if a.Title != nil {
					st.Title = strings.TrimSpace(*a.Title)
				}
				subs = append(subs, st)
			}
			if !found {
				return nil, errors.New("Unteraufgabe nicht gefunden")
			}
			updated, err := s.updateTask(userID, a.TaskID, taskPatch{Subtasks: &subs, actor: actor})
			if err != nil {
				return nil, err
			}
			return s.toTaskView(updated), nil
		},
	},
	{
		Name:        "delete_task",
		Description: "Delete a task, e.g. one created by mistake: it goes to the task trash, where the user can restore it. Prefer complete_task for work that is done.",
		Scope:       storage.ScopeTasksWrite,
		Schema:      schema([]string{"id"}, map[string]interface{}{"id": prop("string", "Task id")}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ID string `json:"id"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if _, err := s.store.GetThoughtByID(userID, a.ID); err != nil {
				return nil, errors.New("Aufgabe nicht gefunden")
			}
			if err := s.deleteTask(userID, a.ID); err != nil {
				return nil, err
			}
			return map[string]interface{}{"id": a.ID, "deleted": true}, nil
		},
	},
	{
		Name:        "list_lists",
		Description: "Shopping lists, checklists and other shared lists the user can see, with open/total item counts.",
		Scope:       storage.ScopeListsRead,
		Schema:      schema(nil, map[string]interface{}{}),
		run: func(s *Server, userID string, _ *apiActor, _ json.RawMessage) (interface{}, error) {
			lists, err := s.store.GetAllListsForUser(userID)
			if err != nil {
				return nil, err
			}
			out := make([]listView, 0, len(lists))
			for _, l := range lists {
				out = append(out, s.toListView(l))
			}
			return out, nil
		},
	},
	{
		Name:        "create_list",
		Description: "Create a list for the user: shopping (items grouped by category), checklist or vacation (packing list).",
		Scope:       storage.ScopeListsWrite,
		Schema: schema([]string{"title"}, map[string]interface{}{
			"title":    prop("string", "Name of the list"),
			"icon":     prop("string", "One emoji, optional"),
			"listType": map[string]interface{}{"type": "string", "enum": []string{"shopping", "checklist", "vacation"}, "description": "Default shopping"},
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				Title    string `json:"title"`
				Icon     string `json:"icon"`
				ListType string `json:"listType"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if strings.TrimSpace(a.Title) == "" {
				return nil, errors.New("'title' darf nicht leer sein")
			}
			if err := checkMCPIcon(a.Icon); err != nil {
				return nil, err
			}
			l, err := s.store.CreateList(userID, a.Title, a.Icon, a.ListType)
			if err != nil {
				return nil, err
			}
			s.wsHub.BroadcastListEvent(l.ID, "LIST_CREATED", l)
			return s.toListView(*l), nil
		},
	},
	{
		Name:        "get_list",
		Description: "One list with all its items (id, content, category, quantity, isCompleted).",
		Scope:       storage.ScopeListsRead,
		Schema:      schema([]string{"listId"}, map[string]interface{}{"listId": prop("string", "List id from list_lists")}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ListID string `json:"listId"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			l, err := s.store.GetListByID(userID, a.ListID)
			if err != nil || l == nil {
				return nil, errors.New("Liste nicht gefunden")
			}
			return map[string]interface{}{"list": s.toListView(*l), "items": l.Items}, nil
		},
	},
	{
		Name:        "add_list_item",
		Description: "Add an item to a list the user may edit.",
		Scope:       storage.ScopeListsWrite,
		AltScope:    storage.ScopeList,
		Schema: schema([]string{"listId", "content"}, map[string]interface{}{
			"listId":   prop("string", "List id"),
			"content":  prop("string", "Item text"),
			"category": prop("string", "Category/aisle, e.g. Obst"),
			"quantity": prop("string", "Amount, e.g. 2 or 500 g"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ListID, Content, Category, Quantity string
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if strings.TrimSpace(a.Content) == "" {
				return nil, errors.New("'content' darf nicht leer sein")
			}
			return s.addListItem(userID, a.ListID, a.Content, a.Category, a.Quantity, actor)
		},
	},
	{
		Name:        "check_list_item",
		Description: "Tick an item off a list (or untick it with completed=false).",
		Scope:       storage.ScopeListsWrite,
		Schema: schema([]string{"listId", "itemId"}, map[string]interface{}{
			"listId":    prop("string", "List id"),
			"itemId":    prop("string", "Item id from get_list"),
			"completed": prop("boolean", "Default true"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ListID    string `json:"listId"`
				ItemID    string `json:"itemId"`
				Completed *bool  `json:"completed"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			return s.setListItemDone(userID, a.ListID, a.ItemID, a.Completed == nil || *a.Completed, actor)
		},
	},
	{
		Name:        "update_list_item",
		Description: "Change text, category or quantity of a list item; only the given fields change.",
		Scope:       storage.ScopeListsWrite,
		Schema: schema([]string{"listId", "itemId"}, map[string]interface{}{
			"listId":   prop("string", "List id"),
			"itemId":   prop("string", "Item id"),
			"content":  prop("string", "New text"),
			"category": prop("string", "New category"),
			"quantity": prop("string", "New amount"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				ListID   string  `json:"listId"`
				ItemID   string  `json:"itemId"`
				Content  *string `json:"content"`
				Category *string `json:"category"`
				Quantity *string `json:"quantity"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if err := s.store.EnsureListItemsWritable(userID, a.ListID, a.ItemID); err != nil {
				return nil, err
			}
			item, err := s.store.UpdateListItem(a.ItemID, a.Content, a.Category, a.Quantity)
			if err != nil {
				return nil, err
			}
			s.recordListItemOrigin(item, actor, false)
			s.wsHub.BroadcastListEvent(a.ListID, "ITEM_UPDATED", item)
			return item, nil
		},
	},
	{
		Name:        "list_notes",
		Description: "Notes the user can see (own and shared), newest change first, without their content. Filter by folder (includes subfolders) or words in the title. Use get_note for the bullets.",
		Scope:       storage.ScopeNotesRead,
		Schema: schema(nil, map[string]interface{}{
			"folder": prop("string", "Only notes in this folder or below (e.g. Projekte/MindSift)"),
			"query":  prop("string", "Only notes whose title contains this text"),
			"limit":  prop("integer", "Maximum number of notes (default 100)"),
		}),
		run: func(s *Server, userID string, _ *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				Folder, Query string
				Limit         int
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			docs, err := s.store.GetDocuments(userID)
			if err != nil {
				return nil, err
			}
			folder := strings.Trim(strings.TrimSpace(a.Folder), "/")
			query := strings.ToLower(strings.TrimSpace(a.Query))
			out := []noteView{}
			for i := range docs {
				d := &docs[i]
				if d.IsArchived {
					continue
				}
				if folder != "" && d.FolderPath != folder && !strings.HasPrefix(d.FolderPath, folder+"/") {
					continue
				}
				if query != "" && !strings.Contains(strings.ToLower(d.Title), query) {
					continue
				}
				out = append(out, s.toNoteView(d))
			}
			sort.SliceStable(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
			if a.Limit <= 0 {
				a.Limit = 100
			}
			if len(out) > a.Limit {
				out = out[:a.Limit]
			}
			return out, nil
		},
	},
	{
		Name:        "get_note",
		Description: "One note: content is its bullets as an indented Markdown list (one tab per level; - [ ] / - [x] are to-dos); bullets lists them with their ids, level and type, for add_note_bullet / update_note_bullet / delete_note_bullet. {{secret:…}} is a value the user hid; it cannot be read here, keep it unchanged when editing the bullet. {{mention:<user id>}} in bullets is an @-mention of a person (content shows it as @Name); keep it unchanged as well. Drawings (type drawing) are described in words: shapes with their text, arrows as „A“ → „B“ (label).",
		Scope:       storage.ScopeNotesRead,
		Schema:      schema([]string{"id"}, map[string]interface{}{"id": prop("string", "Note id")}),
		run: func(s *Server, userID string, _ *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct{ ID string }
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			d, err := s.store.GetDocumentByID(userID, a.ID)
			if err != nil || d == nil || d.IsArchived {
				return nil, errors.New("Notiz nicht gefunden")
			}
			v := s.toNoteView(d)
			titles := s.store.DocTitles(userID)
			v.Content = s.noteMarkdown(d.Blocks, titles)
			if doc, err := s.noteDoc(a.ID); err == nil {
				v.Bullets = noteBullets(doc, titles)
			}
			return v, nil
		},
	},
	{
		Name: "create_note",
		Description: "Create a new note. content is Markdown: a nested list (tab or 2+ spaces per level) becomes nested bullets, - [ ] a to-do, # a heading with the following bullets below it, plain lines and paragraphs become bullets. " +
			"Example content: \"# Plan\\n- First step\\n\\t- Detail\\n- [ ] Call Anna\". A fenced ```mermaid block (flowchart/graph or mindmap) becomes a drawing, laid out automatically. Changing existing notes needs notes:write (update_note, add_note_bullet, …).",
		Scope: storage.ScopeNotesCreate,
		Schema: schema([]string{"title"}, map[string]interface{}{
			"title":      prop("string", "Title of the note"),
			"content":    prop("string", "Bullets as Markdown, optional"),
			"folderPath": prop("string", "Folder, e.g. Projekte/MindSift; empty = top level. Missing folders are created."),
			"icon":       prop("string", "One emoji, optional (default 🗒️)"),
		}),
		run: func(s *Server, userID string, _ *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				Title, FolderPath, Icon string
				Content                 json.RawMessage
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if strings.TrimSpace(a.Title) == "" {
				return nil, errors.New("'title' darf nicht leer sein")
			}
			if err := checkMCPIcon(a.Icon); err != nil {
				return nil, err
			}
			content, err := mcpNoteContent(a.Content)
			if err != nil {
				return nil, err
			}
			folder := strings.Trim(strings.TrimSpace(a.FolderPath), "/")
			if err := s.store.CheckCreateInFolder(userID, folder); err != nil {
				return nil, err
			}
			blocks := mcpContentBlocks(content)
			// [[Titel]] written by the agent points at its note by id where the title is unambiguous
			link := s.store.WikiLinker(userID)
			for i := range blocks {
				if blocks[i].Type != drawing.BlockType {
					blocks[i].Content = link(blocks[i].Content)
				}
			}
			var warnings []string
			if strings.TrimSpace(content) != "" && len(blocks) == 0 {
				slog.Warn("MCP create_note: content gave no bullets", "user_id", userID, "content", content)
				warnings = append(warnings, i18n.T("en", "Aus 'content' ist kein Punkt entstanden, die Notiz ist leer. Schicke den Inhalt als Markdown-Liste, eine Zeile pro Punkt."))
			}
			if ignored := unknownArgs(args, "title", "content", "folderPath", "icon"); len(ignored) > 0 {
				warnings = append(warnings, i18n.T("en", "Unbekannte Argumente ignoriert:")+" "+strings.Join(ignored, ", "))
			}
			d, err := s.store.CreateDocument(userID, "", a.Title, a.Icon, folder, blocks, nil, false)
			if err != nil {
				return nil, err
			}
			s.broadcastDocToAuthorizedUsers(d.ID, "DOC_CREATED")
			v := s.toNoteView(d)
			v.Content = s.noteMarkdown(d.Blocks, s.store.DocTitles(userID))
			v.Warnings = warnings
			return v, nil
		},
	},
	{
		Name:        "search",
		Description: "Full-text search over tasks, list items and notes the user can see (each only with the matching read right). Notes come as matching bullets with the note id for get_note.",
		Scope:       storage.ScopeTasksRead,
		Schema:      schema([]string{"query"}, map[string]interface{}{"query": prop("string", "Words to search for")}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				Query string `json:"query"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			res, err := s.store.SearchGlobal(userID, a.Query)
			if err != nil {
				return nil, err
			}
			tasks := make([]taskView, 0, len(res.Thoughts))
			for i := range res.Thoughts {
				tasks = append(tasks, s.toTaskView(&res.Thoughts[i]))
			}
			notes := []noteHit{}
			for _, h := range res.Hits {
				if h.Type == "document" {
					notes = append(notes, noteHit{NoteID: h.DocID, Title: h.Title, Snippet: storage.ReadableWikiLinks(markTags.Replace(h.Snippet), nil), URL: s.mcpLink("note", h.DocID)})
				}
			}
			return map[string]interface{}{"tasks": tasks, "listItems": res.ListItems, "notes": notes}, nil
		},
	},
	{
		Name:        "capture_to_inbox",
		Description: "Drop a thought into the user's inbox for later triage (not a task yet).",
		Scope:       storage.ScopeTriage,
		Schema: schema([]string{"content"}, map[string]interface{}{
			"content":  prop("string", "The thought"),
			"priority": map[string]interface{}{"type": "string", "enum": []string{"low", "normal", "high", "urgent"}},
			"dueDate":  prop("string", "YYYY-MM-DD, optional"),
		}),
		run: func(s *Server, userID string, actor *apiActor, args json.RawMessage) (interface{}, error) {
			var a struct {
				Content, Priority, DueDate string
			}
			if err := decodeArgs(args, &a); err != nil {
				return nil, err
			}
			if strings.TrimSpace(a.Content) == "" {
				return nil, errors.New("'content' darf nicht leer sein")
			}
			if a.Priority == "" {
				a.Priority = "normal"
			}
			t, err := s.store.CreateThought(userID, a.Content, a.Priority, "agent", a.DueDate)
			if err != nil {
				return nil, err
			}
			s.recordThoughtOrigin(t, actor, true)
			s.wsHub.BroadcastToUsers(s.taskAudience(t), "TASK_CREATED", t)
			return map[string]interface{}{"id": t.ID, "content": t.Content, "status": fmt.Sprint(t.Status)}, nil
		},
	},
}

// mcpNoteContent reads create_note's content: Markdown as a string, or a list of strings (one bullet
// each), as some models send it. A string without line breaks but with literal "\n" was escaped twice.
func mcpNoteContent(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		var lines []string
		if err := json.Unmarshal(raw, &lines); err != nil {
			return "", errors.New("'content' muss Text sein (Markdown)")
		}
		text = strings.Join(lines, "\n\n")
	}
	if !strings.Contains(text, "\n") && strings.Contains(text, `\n`) {
		text = strings.NewReplacer(`\r\n`, "\n", `\n`, "\n", `\t`, "\t").Replace(text)
	}
	return text, nil
}

// mcpPlainLine: a line of plain text, not a list item, heading, quote or code fence
var mcpPlainLine = regexp.MustCompile("^[ \t]*[^-*+#>`~ \t\\d]|^[ \t]*\\d+[^.)\\d]|^[ \t]*[-*+][^ \t]")

// mcpContentBlocks turns content into bullets. Each line of plain text becomes a bullet of its own
// (Markdown would join consecutive lines into one paragraph); whatever text the Markdown parser leaves
// out still becomes bullets, so a note never ends up empty while text was sent.
func mcpContentBlocks(content string) []domain.DocumentBlock {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	var lines []string
	inFence, prevPlain := false, false
	for _, line := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			inFence = !inFence
		}
		plain := !inFence && trimmed != "" && mcpPlainLine.MatchString(line)
		if plain && prevPlain {
			lines = append(lines, "")
		}
		lines = append(lines, line)
		prevPlain = plain
	}
	blocks := storage.MarkdownToBlocks(strings.Join(lines, "\n"))
	// Mermaid diagrams become drawings, laid out here
	for i, b := range blocks {
		if b.Type == "code" && strings.EqualFold(b.Lang, "mermaid") {
			if content, err := drawing.FromMermaid(b.Content); err == nil {
				blocks[i].Type, blocks[i].Content, blocks[i].Lang = drawing.BlockType, content, ""
			}
		}
	}
	for _, b := range blocks {
		if strings.TrimSpace(b.Content) != "" {
			return blocks
		}
	}
	blocks = nil
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "-*+"))
		if line != "" {
			blocks = append(blocks, storage.MarkdownToBlocks(line)...)
		}
	}
	return blocks
}

// unknownArgs: the argument names a call sent that the tool does not know (compared like
// encoding/json does, ignoring case), so an agent learns a misspelled field was dropped
func unknownArgs(args json.RawMessage, known ...string) []string {
	var m map[string]json.RawMessage
	if json.Unmarshal(args, &m) != nil {
		return nil
	}
	var out []string
	for k := range m {
		found := false
		for _, n := range known {
			if strings.EqualFold(k, n) {
				found = true
			}
		}
		if !found {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

// checkMCPIcon: an icon from an agent is empty (default icon) or exactly one emoji, so a model cannot
// store a word like "optional" as the icon
func checkMCPIcon(icon string) error {
	if icon == "" || isSingleEmoji(icon) {
		return nil
	}
	return errors.New("'icon' muss ein einzelnes Emoji sein oder leer bleiben")
}

// isSingleEmoji reports whether s is one emoji, including skin tones, ZWJ sequences (👩‍💻), flags
// and keycaps (1️⃣)
func isSingleEmoji(s string) bool {
	runes := []rune(s)
	if len(runes) == 0 || len(runes) > 16 {
		return false
	}
	bases := 0
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch {
		case r == 0x200D || r == 0xFE0F || r == 0xFE0E || r == 0x20E3 || (r >= 0x1F3FB && r <= 0x1F3FF) || (r >= 0xE0020 && r <= 0xE007F):
			// joiner, variation selector, keycap, skin tone, tag: part of the emoji before
			if i == 0 {
				return false
			}
		case i > 0 && runes[i-1] == 0x200D && isEmojiRune(r):
			// joined to the emoji before
		case r >= 0x1F1E6 && r <= 0x1F1FF:
			// flag: two regional indicators
			if i+1 >= len(runes) || runes[i+1] < 0x1F1E6 || runes[i+1] > 0x1F1FF {
				return false
			}
			i++
			bases++
		case (r >= '0' && r <= '9') || r == '#' || r == '*':
			// keycap: digit, optional variation selector, U+20E3
			j := i + 1
			if j < len(runes) && runes[j] == 0xFE0F {
				j++
			}
			if j >= len(runes) || runes[j] != 0x20E3 {
				return false
			}
			bases++
		case isEmojiRune(r):
			bases++
		default:
			return false
		}
	}
	return bases == 1
}

func isEmojiRune(r rune) bool {
	return r >= 0x1F000 && r <= 0x1FAFF || r >= 0x2190 && r <= 0x2BFF || r == 0x00A9 || r == 0x00AE ||
		r == 0x203C || r == 0x2049 || r == 0x2122 || r == 0x2139 || r == 0x3030 || r == 0x303D || r == 0x3297 || r == 0x3299
}

// filterSearchForScopes drops the parts of a search result the key may not read.
func filterSearchForScopes(result interface{}, scopes []string) interface{} {
	m, ok := result.(map[string]interface{})
	if !ok {
		return result
	}
	has := map[string]bool{}
	for _, sc := range scopes {
		has[sc] = true
	}
	if !has[storage.ScopeTasksRead] {
		m["tasks"] = []taskView{}
	}
	if !has[storage.ScopeListsRead] {
		m["listItems"] = []domain.ListItem{}
	}
	if !has[storage.ScopeNotesRead] {
		m["notes"] = []noteHit{}
	}
	return m
}
