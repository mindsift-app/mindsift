package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// Notification center (the bell): the person's latest entries, marking them as read, clearing them.

const (
	dueCenterText = "„{title}“ ist fällig ({due})"
	// An early reminder (a day or more ahead)
	remindCenterText = "„{title}“ ist am {due} fällig"
)

func (s *Server) handleGetCenter(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	items, unread, err := s.store.CenterEntries(userID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "unread": unread})
}

// handleCenterRead marks entries as read: {"ids": [...]}, without ids all of them.
func (s *Server) handleCenterRead(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Ungültiges JSON")
			return
		}
	}
	if err := s.store.MarkCenterRead(userID, req.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.wsHub.BroadcastToUser(userID, "NOTIFICATIONS_READ", map[string]any{"ids": req.IDs})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleClearCenter(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	if err := s.store.ClearCenter(userID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.wsHub.BroadcastToUser(userID, "NOTIFICATIONS_CLEARED", map[string]any{})
	w.WriteHeader(http.StatusNoContent)
}
