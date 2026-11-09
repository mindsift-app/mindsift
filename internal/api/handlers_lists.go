package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- REALTIME LISTS & SHARING ---

func (s *Server) handleGetAllLists(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	lists, err := s.store.GetAllListsForUser(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, lists)
}

func (s *Server) handleGetListByID(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	lst, err := s.store.GetListByID(userID, listID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Liste nicht gefunden")
		return
	}
	writeJSON(w, http.StatusOK, lst)
}

func (s *Server) handleCreateList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Title    string  `json:"title"`
		Icon     *string `json:"icon"` // "" = no icon; missing = the default
		ListType string  `json:"listType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	lst, err := s.store.CreateList(userID, req.Title, derefIcon(req.Icon), req.ListType)
	if err == nil && lst != nil && req.Icon != nil && *req.Icon == "" {
		if err = s.store.ClearIcon("lists", lst.ID); err == nil {
			lst.Icon = ""
		}
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.wsHub.BroadcastListEvent(lst.ID, "LIST_CREATED", lst)
	writeJSON(w, http.StatusCreated, lst)
}

func (s *Server) handleDeleteList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	if err := s.store.DeleteList(userID, listID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.wsHub.BroadcastListEvent(listID, "LIST_DELETED", map[string]string{"listId": listID})
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleUpdateList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	var req struct {
		Title *string `json:"title"`
		Icon  *string `json:"icon"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	l, err := s.store.UpdateList(userID, listID, req.Title, req.Icon)
	switch {
	case errors.Is(err, storage.ErrListNotFound):
		writeError(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, storage.ErrListReadOnly):
		writeError(w, http.StatusForbidden, err.Error())
		return
	case err != nil:
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.wsHub.BroadcastListEvent(listID, "LIST_UPDATED", l)
	writeJSON(w, http.StatusOK, l)
}

func (s *Server) handleGetListShares(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	// Only someone with access to the list may see with whom it is shared
	if _, err := s.store.GetListByID(userID, listID); err != nil {
		writeError(w, http.StatusNotFound, "Liste nicht gefunden oder kein Zugriff")
		return
	}
	shares, err := s.store.GetListShares(listID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, shares)
}

func (s *Server) handleCreateListShare(w http.ResponseWriter, r *http.Request) {
	currentUserID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")

	var req struct {
		TargetType string `json:"targetType"` // "user" or "team"
		TargetID   string `json:"targetId"`   // userId/email or teamId
		Role       string `json:"role"`       // "editor" or "viewer"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	targetType := strings.ToLower(strings.TrimSpace(req.TargetType))
	if targetType != "team" {
		targetType = "user"
	}

	role := strings.ToLower(strings.TrimSpace(req.Role))
	if role != "viewer" && role != "editor" {
		role = "editor"
	}

	share, err := s.store.AddListShare(currentUserID, listID, targetType, req.TargetID, role)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if l, err := s.store.GetListByID(currentUserID, listID); err == nil {
		s.notifyShared(currentUserID, targetType, share.TargetID, "list", listID, l.Title)
	}
	if targetType == "team" {
		members, _ := s.store.GetTeamMembers(share.TargetID)
		for _, tm := range members {
			s.wsHub.BroadcastToUser(tm.UserID, "LIST_SHARED", share)
		}
	} else {
		s.wsHub.BroadcastToUser(share.TargetID, "LIST_SHARED", share)
	}
	s.wsHub.BroadcastListEvent(listID, "LIST_SHARED", share)

	writeJSON(w, http.StatusCreated, share)
}

func (s *Server) handleDeleteListShare(w http.ResponseWriter, r *http.Request) {
	currentUserID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	shareID := chi.URLParam(r, "shareId")

	if err := s.store.RemoveListShare(currentUserID, listID, shareID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	s.wsHub.BroadcastListEvent(listID, "LIST_UNSHARED", map[string]string{
		"listId":  listID,
		"shareId": shareID,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleCreateListItem(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	if !s.listItemsWriteAllowed(w, r, "") {
		return
	}
	var req struct {
		Content  string `json:"content"`
		Category string `json:"category"`
		Quantity string `json:"quantity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	item, err := s.store.CreateListItem(listID, req.Content, req.Category, req.Quantity, 0, userID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.recordListItemOrigin(item, actorFrom(r.Context()), true)

	s.wsHub.BroadcastListEvent(listID, "ITEM_CREATED", item)
	writeJSON(w, http.StatusCreated, item)
}

// setListItemDone checks an item off (or back on) and tells the list's viewers. Shared by
// PATCH /lists/{id}/items/{itemId} and the MCP tool check_list_item; access is checked first.
func (s *Server) setListItemDone(userID, listID, itemID string, done bool, actor *apiActor) (*domain.ListItem, error) {
	if err := s.store.EnsureListItemsWritable(userID, listID, itemID); err != nil {
		return nil, err
	}
	user, _ := s.store.GetUserByID(userID)
	userName := "Mitglied"
	if user != nil {
		userName = user.DisplayName
	}
	item, err := s.store.ToggleListItem(itemID, done, userID, userName)
	if err != nil {
		return nil, err
	}
	s.recordListItemOrigin(item, actor, false)
	s.wsHub.BroadcastListEvent(listID, "ITEM_TOGGLED", item)
	return item, nil
}

func (s *Server) handleToggleListItem(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")
	if !s.listItemsWriteAllowed(w, r, itemID) {
		return
	}

	var req struct {
		IsCompleted bool `json:"isCompleted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	item, err := s.setListItemDone(userID, listID, itemID, req.IsCompleted, actorFrom(r.Context()))
	if errors.Is(err, storage.ErrListItemNotFound) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateListItem(w http.ResponseWriter, r *http.Request) {
	listID := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")
	if !s.listItemsWriteAllowed(w, r, itemID) {
		return
	}

	var req struct {
		Content  *string `json:"content"`
		Category *string `json:"category"`
		Quantity *string `json:"quantity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	item, err := s.store.UpdateListItem(itemID, req.Content, req.Category, req.Quantity)
	if errors.Is(err, storage.ErrListItemNotFound) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.recordListItemOrigin(item, actorFrom(r.Context()), false)

	s.wsHub.BroadcastListEvent(listID, "ITEM_UPDATED", item)
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteListItem(w http.ResponseWriter, r *http.Request) {
	listID := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")
	if !s.listItemsWriteAllowed(w, r, itemID) {
		return
	}

	_, err := s.store.DeleteListItem(itemID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.wsHub.BroadcastListEvent(listID, "ITEM_DELETED", map[string]string{
		"itemId": itemID,
		"listId": listID,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// handleMoveListItem moves an item into another list; the user must be allowed to edit both lists
func (s *Server) handleMoveListItem(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")
	if !s.listItemsWriteAllowed(w, r, itemID) {
		return
	}
	var req struct {
		TargetListID string `json:"targetListId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TargetListID == "" {
		writeError(w, http.StatusBadRequest, "Zielliste fehlt")
		return
	}
	if req.TargetListID == listID {
		writeError(w, http.StatusBadRequest, "Eintrag ist bereits in dieser Liste")
		return
	}
	if err := s.store.EnsureListItemsWritable(userID, req.TargetListID, ""); err != nil {
		if errors.Is(err, storage.ErrListReadOnly) {
			writeError(w, http.StatusForbidden, err.Error())
		} else {
			writeError(w, http.StatusNotFound, err.Error())
		}
		return
	}

	item, err := s.store.MoveListItem(itemID, req.TargetListID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.wsHub.BroadcastListEvent(listID, "ITEM_DELETED", map[string]string{
		"itemId": itemID,
		"listId": listID,
	})
	s.wsHub.BroadcastListEvent(req.TargetListID, "ITEM_CREATED", item)
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleClearCompletedItems(w http.ResponseWriter, r *http.Request) {
	listID := chi.URLParam(r, "id")
	if !s.listItemsWriteAllowed(w, r, "") {
		return
	}
	removed, err := s.store.ClearCompletedListItems(listID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.wsHub.BroadcastListEvent(listID, "LIST_CLEARED", map[string]interface{}{
		"listId":  listID,
		"removed": removed,
	})
	writeJSON(w, http.StatusOK, map[string]int64{"removed": removed})
}

func (s *Server) handleReorderListItems(w http.ResponseWriter, r *http.Request) {
	listID := chi.URLParam(r, "id")
	if !s.listItemsWriteAllowed(w, r, "") {
		return
	}
	var req struct {
		Items []domain.ListItemReorderItem `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := s.store.ReorderListItems(listID, req.Items); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.wsHub.BroadcastListEvent(listID, "ITEM_REORDERED", map[string]interface{}{
		"listId": listID,
		"items":  req.Items,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// handleListOrder: PUT /task-lists/order and /lists/order {"ids"} – the person's own order of the tabs.
func (s *Server) handleListOrder(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			IDs []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) > 1000 {
			writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
			return
		}
		if err := s.store.SetListOrder(auth.GetUserID(r.Context()), kind, req.IDs); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// listItemsWriteAllowed answers 404 (no access, or item not in this list) or 403 (viewer) and returns
// false; every request changing list items goes through it.
func (s *Server) listItemsWriteAllowed(w http.ResponseWriter, r *http.Request, itemID string) bool {
	err := s.store.EnsureListItemsWritable(auth.GetUserID(r.Context()), chi.URLParam(r, "id"), itemID)
	switch {
	case err == nil:
		return true
	case errors.Is(err, storage.ErrListReadOnly):
		writeError(w, http.StatusForbidden, err.Error())
	default:
		writeError(w, http.StatusNotFound, err.Error())
	}
	return false
}
