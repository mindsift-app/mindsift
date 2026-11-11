package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func (s *Server) handleCaptureInbox(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Content      string `json:"content"`
		Priority     string `json:"priority"`
		Source       string `json:"source"`
		DueDate      string `json:"dueDate"`
		DueDate2     string `json:"due_date"`
		Target       string `json:"target"` // inbox | task | list_item | document
		TargetListID string `json:"targetListId"`
		TargetList2  string `json:"target_list_id"`
		TaskListID   string `json:"taskListId"`
		TaskListID2  string `json:"task_list_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	dueDate := req.DueDate
	if dueDate == "" {
		dueDate = req.DueDate2
	}
	targetListID := req.TargetListID
	if targetListID == "" {
		targetListID = req.TargetList2
	}
	taskListID := req.TaskListID
	if taskListID == "" {
		taskListID = req.TaskListID2
	}

	source := strings.ToLower(strings.TrimSpace(req.Source))
	if source == "" {
		source = strings.ToLower(strings.TrimSpace(r.URL.Query().Get("source")))
	}
	if source == "" {
		source = strings.ToLower(strings.TrimSpace(r.Header.Get("X-Source")))
	}
	if source == "" {
		// When called via API key or webhook token, automatically default source to "webhook"
		if r.Header.Get("X-API-Key") != "" ||
			strings.HasPrefix(r.Header.Get("Authorization"), "Bearer mindsift_sec_") ||
			strings.HasPrefix(r.URL.Query().Get("token"), "mindsift_sec_") {
			source = "webhook"
		} else {
			source = "manual"
		}
	}

	if !requireDeliveryScope(w, r, strings.TrimSpace(req.Target)) {
		return
	}

	thought, err := s.store.CreateThoughtWithDetails(userID, req.Content, req.Priority, source, dueDate, taskListID, "todo", "")
	if err != nil {
		writeStoreError(w, http.StatusBadRequest, err)
		return
	}
	// Before a conversion, so a list item made from it takes the origin along
	s.recordThoughtOrigin(thought, actorFrom(r.Context()), true)

	target := strings.TrimSpace(req.Target)
	if target == "task" || target == "document" || (target == "list_item" && targetListID != "") {
		if converted, convErr := s.store.UpdateThoughtTriage(userID, thought.ID, "keep", target, targetListID, dueDate, taskListID); convErr == nil && converted != nil {
			thought = converted
			if target == "list_item" && targetListID != "" {
				if lst, lErr := s.store.GetListByID(userID, targetListID); lErr == nil && lst != nil {
					s.wsHub.BroadcastListEvent(lst.ID, "LIST_UPDATED", lst)
				}
			}
		}
	}

	s.assignCreator(userID, thought)
	s.wsHub.BroadcastToUsers(s.taskAudience(thought), "TASK_CREATED", thought)
	s.notifyTaskAdded(userID, thought, nil)
	writeJSON(w, http.StatusCreated, thought)
}

func (s *Server) handleGetThoughts(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	status := r.URL.Query().Get("status")
	thoughts, err := s.store.GetThoughts(userID, status, 250)
	if err != nil {
		writeInternal(w, err)
		return
	}
	s.markWatching(userID, thoughts)
	writeJSON(w, http.StatusOK, thoughts)
}

func (s *Server) handleGetThought(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	thoughtID := chi.URLParam(r, "id")
	thought, err := s.store.GetThoughtByID(userID, thoughtID)
	if err != nil || thought == nil {
		writeError(w, http.StatusNotFound, "Aufgabe nicht gefunden")
		return
	}
	writeJSON(w, http.StatusOK, thought)
}

func (s *Server) handleGetTriageDeck(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	thoughts, err := s.store.GetThoughts(userID, "inbox", 100)
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, thoughts)
}

func (s *Server) handleTriageAction(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	thoughtID := chi.URLParam(r, "id")

	var req struct {
		Action       string `json:"action"` // keep | discard | restore
		ConvertTo    string `json:"convertTo"`
		ConvertTo2   string `json:"convert_to"`
		TargetListID string `json:"targetListId"`
		TargetList2  string `json:"target_list_id"`
		TaskListID   string `json:"taskListId"`
		TaskListID2  string `json:"task_list_id"`
		DueDate      string `json:"dueDate"`
		DueDate2     string `json:"due_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	convertTo := req.ConvertTo
	if convertTo == "" {
		convertTo = req.ConvertTo2
	}
	targetListID := req.TargetListID
	if targetListID == "" {
		targetListID = req.TargetList2
	}
	taskListID := req.TaskListID
	if taskListID == "" {
		taskListID = req.TaskListID2
	}
	dueDate := req.DueDate
	if dueDate == "" {
		dueDate = req.DueDate2
	}

	updated, err := s.store.UpdateThoughtTriage(userID, thoughtID, req.Action, convertTo, targetListID, dueDate, taskListID)
	if err != nil {
		writeStoreError(w, http.StatusBadRequest, err)
		return
	}

	// If converted to a list item, broadcast via WebSocket to the space
	if convertTo == "list_item" && targetListID != "" {
		if lst, err := s.store.GetListByID(userID, targetListID); err == nil && lst != nil {
			s.wsHub.BroadcastListEvent(lst.ID, "LIST_UPDATED", lst)
		}
	}

	s.assignCreator(userID, updated)
	s.wsHub.BroadcastToUsers(s.taskAudience(updated), "TASK_UPDATED", updated)
	s.notifyTaskAdded(userID, updated, nil)
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleGetTasks(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	q := r.URL.Query()
	tasks, err := s.store.GetTasks(userID, q.Get("taskListId"))
	if err != nil {
		writeInternal(w, err)
		return
	}
	tasks, err = filterTasks(tasks, q.Get("status"), q.Get("due"), time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tasks)
}

// filterTasks narrows GET /tasks for scripts and smart homes; without parameters nothing changes.
// status: open | done | all (default). due: today | overdue | YYYY-MM-DD (due on or before that day).
// Days count in the server's time zone like due dates themselves (now is passed in for tests).
func filterTasks(tasks []domain.Thought, status, due string, now time.Time) ([]domain.Thought, error) {
	switch status {
	case "", "all", "open", "done":
	default:
		return nil, errors.New("status: open, done oder all")
	}
	today := now.In(time.Local).Format("2006-01-02")
	var match func(day string) bool
	switch {
	case due == "":
	case due == "today":
		match = func(day string) bool { return day == today }
	case due == "overdue":
		match = func(day string) bool { return day < today }
	default:
		if _, err := time.Parse("2006-01-02", due); err != nil {
			return nil, errors.New("due: today, overdue oder ein Datum JJJJ-MM-TT")
		}
		match = func(day string) bool { return day <= due }
	}
	out := make([]domain.Thought, 0, len(tasks))
	for _, t := range tasks {
		if (status == "open" && t.IsCompleted) || (status == "done" && !t.IsCompleted) {
			continue
		}
		// Overdue only makes sense for open tasks
		if due == "overdue" && t.IsCompleted {
			continue
		}
		if match != nil && (t.DueDate == "" || !match(t.DueDate[:min(10, len(t.DueDate))])) {
			continue
		}
		out = append(out, t)
	}
	return out, nil
}

func (s *Server) handleReorderTasks(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	taskListID := chi.URLParam(r, "id")
	if taskListID == "" {
		taskListID = r.URL.Query().Get("taskListId")
	}

	var req struct {
		Items []domain.ThoughtReorderItem `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	if taskListID != "" && !s.store.CanEditTaskList(userID, taskListID) {
		writeError(w, http.StatusForbidden, storage.ErrTaskListReadOnly.Error())
		return
	}
	// ReorderTasks updates by ID only, so every item must be a task the caller may edit
	audience := []string{userID}
	for _, it := range req.Items {
		th, err := s.store.GetThoughtByID(userID, it.ID)
		if err != nil {
			writeError(w, http.StatusNotFound, "Aufgabe nicht gefunden")
			return
		}
		if th.TaskListID != "" && !s.store.CanEditTaskList(userID, th.TaskListID) {
			writeError(w, http.StatusForbidden, storage.ErrTaskListReadOnly.Error())
			return
		}
		audience = append(audience, s.taskAudience(th)...)
	}

	if err := s.store.ReorderTasks(taskListID, req.Items); err != nil {
		writeInternal(w, err)
		return
	}

	s.wsHub.BroadcastToUsers(audience, "TASK_REORDERED", map[string]any{
		"taskListId": taskListID,
		"items":      req.Items,
		"userId":     userID,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// taskPatch is a partial change of a task; nil fields stay as they are. Shared by PATCH /thoughts/{id}
// and the MCP tools.
type taskPatch struct {
	Content      *string           `json:"content"`
	IsCompleted  *bool             `json:"isCompleted"`
	DueDate      *string           `json:"dueDate"`
	Priority     *string           `json:"priority"`
	TaskListID   *string           `json:"taskListId"`
	KanbanStatus *string           `json:"kanbanStatus"`
	Notes        *string           `json:"notes"`
	Subtasks     *[]domain.SubTask `json:"subtasks"`
	Tags         *[]string         `json:"tags"`
	Assignees    *[]string         `json:"assignees"`
	Recurrence   *string           `json:"recurrence"`
	Reminders    *[]int            `json:"reminders"`
	// actor: the API key making the change (recorded as the task's origin); nil for the app
	actor *apiActor
}

// updateTask applies a patch, keeps a linked note block in step, tells everyone who sees the task
// and sends the notifications. Errors come from the store (writeStoreError maps them).
func (s *Server) updateTask(userID, thoughtID string, req taskPatch) (*domain.Thought, error) {
	before, _ := s.store.GetThoughtByID(userID, thoughtID)
	// The rule is set first, so completing a task in the same request already repeats it
	if req.Recurrence != nil {
		if err := s.store.SetTaskRecurrence(userID, thoughtID, strings.TrimSpace(*req.Recurrence)); err != nil {
			return nil, err
		}
	}
	if req.Reminders != nil {
		if _, err := s.store.SetTaskReminders(userID, thoughtID, *req.Reminders); err != nil {
			return nil, err
		}
	}
	updated, err := s.store.UpdateThoughtDetails(userID, thoughtID, req.Content, req.IsCompleted, req.DueDate, req.Priority, req.TaskListID, req.KanbanStatus, req.Notes, req.Subtasks, req.Tags)
	if err != nil {
		return nil, err
	}
	s.recordThoughtOrigin(updated, req.actor, false)
	if req.Assignees != nil {
		assignees, err := s.store.SetTaskAssignees(userID, thoughtID, *req.Assignees)
		if err != nil {
			return nil, err
		}
		updated.Assignees = assignees
	}
	if docID := s.store.SyncTaskToDoc(userID, thoughtID); docID != "" {
		_, head, _ := s.store.GetDocOpsSince(docID, 0, 0)
		s.notifyDocChanged(docID, head)
	}
	s.wsHub.BroadcastToUsers(append(s.taskAudience(before), s.taskAudience(updated)...), "TASK_UPDATED", updated)
	s.notifyTaskChange(userID, before, updated, false)
	s.notifyTaskMentions(userID, before, updated)
	updated.IsWatching = s.store.WatchedTaskIDs(userID)[updated.ID]
	return updated, nil
}

func (s *Server) handleUpdateThought(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	thoughtID := chi.URLParam(r, "id")

	var req taskPatch
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	req.actor = actorFrom(r.Context())
	updated, err := s.updateTask(userID, thoughtID, req)
	if err != nil {
		writeStoreError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleUnlinkEnhancedTask(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	thoughtID := chi.URLParam(r, "id")
	if err := s.store.UnlinkTaskFromDocBlock(userID, thoughtID); err != nil {
		writeStoreError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"unlinked": true})
}

// deleteTask removes a task, tells everyone who saw it and notifies its watchers. Shared by
// DELETE /thoughts/{id} and the MCP tool delete_task.
func (s *Server) deleteTask(userID, thoughtID string) error {
	th, err := s.store.GetThoughtByID(userID, thoughtID)
	if err == nil && th.TaskListID != "" && !s.store.CanEditTaskList(userID, th.TaskListID) {
		return storage.ErrTaskListReadOnly
	}
	audience := s.taskAudience(th)
	if err := s.store.DeleteThought(userID, thoughtID); err != nil {
		return err
	}
	if th != nil {
		s.notifyTaskChange(userID, th, nil, true)
	}
	s.wsHub.BroadcastToUsers(audience, "TASK_DELETED", map[string]string{"id": thoughtID})
	return nil
}

func (s *Server) handleDeleteThought(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	if err := s.deleteTask(userID, chi.URLParam(r, "id")); err != nil {
		writeStoreError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handlePurgeDiscarded(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	count, err := s.store.PurgeDiscardedThoughts(userID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"purged": count})
}

// --- SEARCH & EXPORT ---

// handleSearch: GET /search?q= – everything, or narrowed by type (document|thought|list_item), limit
// (hits per kind, up to 200) and filters: taskStatus, taskListId, priority, due (today|overdue|week),
// folder, listId, itemStatus.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	qs := r.URL.Query()
	q := qs.Get("q")
	opts := storage.SearchOptions{
		Type:       qs.Get("type"),
		TaskStatus: qs.Get("taskStatus"),
		TaskListID: qs.Get("taskListId"),
		Priority:   qs.Get("priority"),
		Due:        qs.Get("due"),
		Today:      time.Now().In(time.Local).Format("2006-01-02"),
		Folder:     qs.Get("folder"),
		ListID:     qs.Get("listId"),
		ItemStatus: qs.Get("itemStatus"),
		Context:    qs.Get("context") == "1",
	}
	if opts.Type != "" && !slices.Contains(storage.SearchTypes, opts.Type) {
		writeError(w, http.StatusBadRequest, "type: document, thought oder list_item")
		return
	}
	if n, err := strconv.Atoi(qs.Get("limit")); err == nil {
		opts.Limit = n
	}
	res, err := s.store.SearchCtx(r.Context(), userID, q, opts)
	if r.Context().Err() != nil {
		return // given up by the client (typed on, search closed)
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}
