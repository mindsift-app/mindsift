package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- API KEYS & WEBHOOK INGESTION ---

func (s *Server) handleGetAPIKeys(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	keys, err := s.store.GetAPIKeys(userID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, keys)
}

// apiKeysUsable: a key works somewhere, on the REST API (API_KEYS_ENABLED) or the MCP endpoint.
func (s *Server) apiKeysUsable() bool {
	return !s.cfg.RESTAPIKeysOff || s.mcpEnabled()
}

func (s *Server) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Name   string   `json:"name"`
		Scopes []string `json:"scopes"`
		// A key never asks for the second factor: with one on, creating it does (code or passkey)
		secondFactor
	}
	// An empty body gives a key with the default name and rights; a broken one is refused, so a typo
	// does not quietly create a key with rights nobody asked for
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	// A session from the OIDC provider of an account without a second factor in MindSift confirms there
	if s.sessionViaOIDC(r) && !s.store.MFAActive(user.ID) && !s.oidcConfirmed(r, user) {
		s.writeOIDCConfirmRequired(w)
		return
	}
	// REST refuses keys and MCP is off: a new key could not be used anywhere
	if !s.apiKeysUsable() {
		writeError(w, http.StatusForbidden, "API-Schlüssel sind auf diesem Server ausgeschaltet")
		return
	}
	if !s.confirmSecondFactor(w, r, user, req.secondFactor) {
		return
	}

	key, err := s.store.CreateAPIKey(userID, req.Name, req.Scopes)
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, key)
}

// handleUpdateAPIKey renames a key or changes its rights; the key itself stays the same.
func (s *Server) handleUpdateAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Name   *string   `json:"name"`
		Scopes *[]string `json:"scopes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	key, err := s.store.UpdateAPIKey(userID, chi.URLParam(r, "id"), req.Name, req.Scopes)
	if errors.Is(err, storage.ErrAPIKeyNotFound) {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, key)
}

func (s *Server) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	keyID := chi.URLParam(r, "id")
	if err := s.store.DeleteAPIKey(userID, keyID); err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// handleWebhookIngest accepts Smarthome / External automation webhooks via ?token=... or X-API-Key or Bearer token
func (s *Server) handleWebhookIngest(w http.ResponseWriter, r *http.Request) {
	// In the URL only API keys are taken (devices that cannot set headers); a session token there would
	// end up in proxy logs as a full login (FLAW-35)
	token := r.URL.Query().Get("token")
	if token != "" && !strings.HasPrefix(token, "mindsift_sec_") {
		writeError(w, http.StatusUnauthorized, "In der URL sind nur API-Keys erlaubt; Sitzungs-Tokens gehören in den Authorization-Header")
		return
	}
	if token == "" {
		token = r.Header.Get("X-API-Key")
	}
	if token == "" && strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		token = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}

	// Same checks as every other request (revoked/outdated sessions, inactive accounts)
	user, key := s.authenticateToken(token)
	if user == nil || (key != nil && key.OAuth) {
		writeError(w, http.StatusUnauthorized, "Ungültiger Webhook-Token oder API-Key")
		return
	}
	if key != nil && s.cfg.RESTAPIKeysOff {
		writeError(w, http.StatusForbidden, "API-Schlüssel gelten auf diesem Server nur für MCP")
		return
	}
	if key != nil {
		r = r.WithContext(withAPIKey(r.Context(), key, storage.OriginAPI))
	} else {
		// A session delivers only once the required second factor is set up (as in authMiddleware)
		claims, err := auth.ValidateToken(s.cfg.JWTSecret, token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Ungültiger Webhook-Token oder API-Key")
			return
		}
		if s.mfaSetupRefused(w, user, claims.ID) {
			return
		}
	}
	actor := actorFrom(r.Context())

	var req struct {
		Title    string   `json:"title"`
		Content  string   `json:"content"`
		Text     string   `json:"text"`
		Message  string   `json:"message"`
		Priority string   `json:"priority"`
		Source   string   `json:"source"`
		Tags     []string `json:"tags"`
		DueDate  string   `json:"dueDate"`
		DueDate2 string   `json:"due_date"`
		// Where it goes: "triage" (default, inbox), "task" or "list_item"; "type" is accepted as well
		Target     string `json:"target"`
		Type       string `json:"type"`
		TaskListID string `json:"taskListId"`
		ListID     string `json:"listId"`
		Category   string `json:"category"`
		Quantity   string `json:"quantity"`
	}

	bodyBytes, _ := io.ReadAll(r.Body)
	if len(bodyBytes) > 0 {
		if jsonErr := json.Unmarshal(bodyBytes, &req); jsonErr != nil {
			plain := strings.TrimSpace(string(bodyBytes))
			if plain != "" {
				req.Content = plain
			}
		}
	}

	if req.Content == "" {
		if req.Text != "" {
			req.Content = req.Text
		} else if req.Message != "" {
			req.Content = req.Message
		}
	}

	dueDate := req.DueDate
	if dueDate == "" {
		dueDate = req.DueDate2
	}

	bodyText := strings.TrimSpace(req.Title)
	if req.Content != "" {
		if bodyText != "" {
			bodyText = bodyText + " — " + strings.TrimSpace(req.Content)
		} else {
			bodyText = strings.TrimSpace(req.Content)
		}
	}
	if bodyText == "" {
		writeError(w, http.StatusBadRequest, "Feld 'title', 'content', 'text' oder 'message' ist erforderlich")
		return
	}

	for _, tag := range req.Tags {
		cleanTag := strings.TrimPrefix(strings.TrimSpace(tag), "#")
		if cleanTag != "" && !strings.Contains(strings.ToLower(bodyText), "#"+strings.ToLower(cleanTag)) {
			bodyText += fmt.Sprintf(" #%s", cleanTag)
		}
	}

	target := strings.ToLower(strings.TrimSpace(req.Target))
	if target == "" {
		target = strings.ToLower(strings.TrimSpace(req.Type))
	}
	switch target {
	case "", "triage", "inbox":
		target = "triage"
	case "task", "list_item":
	default:
		writeError(w, http.StatusBadRequest, "Unbekanntes Ziel – erlaubt: triage, task, list_item")
		return
	}
	if !requireDeliveryScope(w, r, target) {
		return
	}

	source := strings.ToLower(strings.TrimSpace(req.Source))
	if source == "" {
		source = "webhook"
	}

	if target == "list_item" {
		s.ingestListItem(w, user.ID, req.ListID, bodyText, req.Category, req.Quantity, actor)
		return
	}
	if target == "task" {
		s.ingestTask(w, user.ID, bodyText, req.Priority, source, dueDate, req.TaskListID, actor)
		return
	}

	if req.Priority == "" {
		req.Priority = "high"
	}
	thought, err := s.store.CreateThought(user.ID, bodyText, req.Priority, source, dueDate)
	if err != nil {
		writeInternal(w, err)
		return
	}
	s.recordThoughtOrigin(thought, actor, true)

	s.wsHub.BroadcastToUsers(s.taskAudience(thought), "TASK_CREATED", thought)

	writeJSON(w, http.StatusCreated, map[string]any{
		"status":  "ingested",
		"thought": thought,
	})
}

// createTask creates a task directly (POST /webhooks/ingest, MCP tool create_task), optionally in a
// task list the user may write to (otherwise storage.ErrTaskListReadOnly). actor: the API key, if any.
func (s *Server) createTask(userID, content, priority, source, dueDate, taskListID, notes string, actor *apiActor) (*domain.Thought, error) {
	if priority == "" {
		priority = "normal"
	}
	if taskListID != "" && !s.store.CanEditTaskList(userID, taskListID) {
		return nil, storage.ErrTaskListReadOnly
	}
	thought, err := s.store.CreateThoughtWithDetails(userID, content, priority, source, dueDate, taskListID, "todo", notes)
	if err != nil {
		return nil, err
	}
	task, err := s.store.UpdateThoughtTriage(userID, thought.ID, "keep", "task", "", dueDate, taskListID)
	if err != nil {
		return nil, err
	}
	s.recordThoughtOrigin(task, actor, true)
	s.assignCreator(userID, task)
	s.wsHub.BroadcastToUsers(s.taskAudience(task), "TASK_CREATED", task)
	s.notifyTaskAdded(userID, task, nil)
	s.notifyTaskMentions(userID, nil, task)
	return task, nil
}

func (s *Server) ingestTask(w http.ResponseWriter, userID, content, priority, source, dueDate, taskListID string, actor *apiActor) {
	task, err := s.createTask(userID, content, priority, source, dueDate, taskListID, "", actor)
	if errors.Is(err, storage.ErrTaskListReadOnly) {
		writeErrorFrom(w, http.StatusForbidden, err)
		return
	}
	if err != nil {
		writeStoreError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"status": "ingested", "task": task})
}

var errListIDRequired = errors.New("Feld 'listId' ist für Listeneinträge erforderlich")

// addListItem appends an item to a list the user may write to; the error is storage.ErrListReadOnly for
// viewers and "not found" for lists the user cannot see.
func (s *Server) addListItem(userID, listID, content, category, quantity string, actor *apiActor) (*domain.ListItem, error) {
	if strings.TrimSpace(listID) == "" {
		return nil, errListIDRequired
	}
	if err := s.store.EnsureListItemsWritable(userID, listID, ""); err != nil {
		return nil, err
	}
	item, err := s.store.CreateListItem(listID, content, category, quantity, 0, userID)
	if err != nil {
		return nil, err
	}
	s.recordListItemOrigin(item, actor, true)
	s.wsHub.BroadcastListEvent(listID, "ITEM_CREATED", item)
	return item, nil
}

// ingestListItem adds an item to a list the owner of the key may write to.
func (s *Server) ingestListItem(w http.ResponseWriter, userID, listID, content, category, quantity string, actor *apiActor) {
	item, err := s.addListItem(userID, listID, content, category, quantity, actor)
	if err != nil {
		status := http.StatusNotFound
		switch {
		case errors.Is(err, storage.ErrListReadOnly):
			status = http.StatusForbidden
		case errors.Is(err, errListIDRequired):
			status = http.StatusBadRequest
		}
		writeErrorFrom(w, status, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"status": "ingested", "item": item})
}
