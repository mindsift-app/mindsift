package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- TASK LISTS ---

func (s *Server) handleGetTaskLists(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	lists, err := s.store.GetTaskLists(userID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	muted := s.store.MutedTaskListIDs(userID)
	lang := w.Header().Get("Content-Language")
	for i := range lists {
		lists[i].IsMuted = muted[lists[i].ID]
		lists[i].Columns = storage.LocalizeColumns(lists[i].Columns, lang)
	}
	writeJSON(w, http.StatusOK, lists)
}

// handleMuteTaskList mutes (PUT) or unmutes (DELETE) a task list for the requesting person.
func (s *Server) handleMuteTaskList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	muted := r.Method == http.MethodPut
	if err := s.store.SetTaskListMuted(userID, listID, muted); err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	s.wsHub.BroadcastToUser(userID, eventTaskListUpdated, map[string]string{"id": listID})
	writeJSON(w, http.StatusOK, map[string]bool{"muted": muted})
}

func (s *Server) handleCreateTaskList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		SpaceID string  `json:"spaceId"`
		TeamID  string  `json:"teamId"`
		Title   string  `json:"title"`
		Icon    *string `json:"icon"` // "" = no icon; missing = the default
		Color   string  `json:"color"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	tl, err := s.createTaskList(userID, req.SpaceID, req.TeamID, req.Title, req.Icon, req.Color)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	tl.Columns = storage.LocalizeColumns(tl.Columns, w.Header().Get("Content-Language"))
	writeJSON(w, http.StatusCreated, tl)
}

// createTaskList creates a task list (POST /task-lists, MCP create_task_list) and tells everyone who sees
// it, the creator's other devices and, for a team's list, the team (TASK_LIST_CREATED). icon: nil = the
// default, "" = none.
func (s *Server) createTaskList(userID, spaceID, teamID, title string, icon *string, color string) (*domain.TaskList, error) {
	tl, err := s.store.CreateTaskList(userID, spaceID, teamID, title, derefIcon(icon), color)
	if err != nil {
		return nil, err
	}
	if icon != nil && *icon == "" {
		err = s.store.ClearIcon("task_lists", tl.ID)
		if err == nil {
			tl.Icon = ""
		}
	}
	// Created either way (only the icon may be off): the other apps show it
	s.broadcastTaskListChange(tl.ID, nil, eventTaskListCreated)
	if err != nil {
		return nil, err
	}
	return tl, nil
}

func (s *Server) handleUpdateTaskList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	var req struct {
		Title   *string                `json:"title"`
		Icon    *string                `json:"icon"`
		Color   *string                `json:"color"`
		SpaceID *string                `json:"spaceId"`
		Columns *[]domain.KanbanColumn `json:"columns"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	audienceBefore := s.store.GetTaskListUserIDs(listID)
	tl, err := s.store.UpdateTaskList(userID, listID, req.Title, req.Icon, req.Color, req.SpaceID, req.Columns)
	if err != nil {
		writeStoreError(w, http.StatusBadRequest, err)
		return
	}
	s.broadcastTaskListChange(listID, audienceBefore, eventTaskListUpdated)
	tl.Columns = storage.LocalizeColumns(tl.Columns, w.Header().Get("Content-Language"))
	writeJSON(w, http.StatusOK, tl)
}

func (s *Server) handleDeleteTaskList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	audienceBefore := s.store.GetTaskListUserIDs(listID)
	if err := s.store.DeleteTaskList(userID, listID); err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	s.broadcastTaskListChange(listID, audienceBefore, eventTaskListDeleted)
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleGetTaskListShares(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	if _, err := s.store.GetTaskListByID(userID, listID); err != nil {
		writeError(w, http.StatusNotFound, "Aufgabenliste nicht gefunden oder kein Zugriff")
		return
	}
	shares, err := s.store.GetTaskListShares(listID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, shares)
}

func (s *Server) handleCreateTaskListShare(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	tl, err := s.store.GetTaskListByID(userID, listID)
	if err != nil || tl == nil {
		writeError(w, http.StatusNotFound, "Aufgabenliste nicht gefunden")
		return
	}
	if tl.UserID != userID {
		writeError(w, http.StatusForbidden, "Nur der Eigentümer kann die Liste freigeben")
		return
	}
	var req struct {
		TargetType string `json:"targetType"` // team | user
		TargetID   string `json:"targetId"`
		Permission string `json:"permission"` // editor | viewer
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	permission := strings.ToLower(strings.TrimSpace(req.Permission))
	if permission != "viewer" {
		permission = "editor"
	}
	share, err := s.store.AddTaskListShare(listID, req.TargetType, req.TargetID, permission, userID)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.broadcastTaskListChange(listID, nil, eventTaskListUpdated)
	if tl, err := s.store.GetTaskListByID(userID, listID); err == nil {
		s.notifyShared(userID, req.TargetType, req.TargetID, "tasklist", tl.ID, tl.Title)
	}
	writeJSON(w, http.StatusCreated, share)
}

func (s *Server) handleDeleteTaskListShare(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	shareID := chi.URLParam(r, "shareId")
	tl, err := s.store.GetTaskListByID(userID, listID)
	if err != nil || tl == nil {
		writeError(w, http.StatusNotFound, "Aufgabenliste nicht gefunden")
		return
	}
	if tl.UserID != userID {
		writeError(w, http.StatusForbidden, "Nur der Eigentümer kann Freigaben entfernen")
		return
	}
	audienceBefore := s.store.GetTaskListUserIDs(listID)
	if err := s.store.RemoveTaskListShare(listID, shareID); err != nil {
		writeInternal(w, err)
		return
	}
	s.broadcastTaskListChange(listID, audienceBefore, eventTaskListUpdated)
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// broadcastTaskListChange notifies everyone who could see the list before or can see it now. Only the ID is sent,
// because the list payload depends on the receiver's permission; clients reload their lists.
func (s *Server) broadcastTaskListChange(listID string, audienceBefore []string, event string) {
	users := append(audienceBefore, s.store.GetTaskListUserIDs(listID)...)
	s.wsHub.BroadcastToUsers(users, event, map[string]string{"id": listID})
}
