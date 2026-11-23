package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

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
		writeInternal(w, err)
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

// listForEveryone is a list as LIST_UPDATED sends it to everyone in its room: without isOwner and role,
// which are the changer's own and differ per person.
type listForEveryone struct {
	ID        string                  `json:"id"`
	UserID    string                  `json:"userId"`
	OwnerName string                  `json:"ownerName,omitempty"`
	Title     string                  `json:"title"`
	Icon      string                  `json:"icon"`
	ListType  string                  `json:"listType"`
	Items     []domain.ListItem       `json:"items"`
	Shares    []domain.ListShare      `json:"shares,omitempty"`
	Members   []domain.TaskListMember `json:"members,omitempty"`
	UpdatedAt string                  `json:"updatedAt"`
	CreatedAt string                  `json:"createdAt"`
}

// broadcastListUpdated sends LIST_UPDATED with what is the same for everyone who sees the list, to all
// of them (broadcastListAudience), not only to its room: the list overview shows title and icon of every
// list, also of the ones not open. The entries' own events (ITEM_*) stay with the room: the overview
// shows no entries of a list not open, and sending them all to everyone would multiply the traffic of a
// busy list for nothing.
func (s *Server) broadcastListUpdated(l *domain.SharedList) {
	if l == nil {
		return
	}
	s.broadcastListAudience(l.ID, nil, eventListUpdated, listForEveryone{
		ID: l.ID, UserID: l.UserID, OwnerName: l.OwnerName, Title: l.Title, Icon: l.Icon, ListType: l.ListType,
		Items: l.Items, Shares: l.Shares, Members: l.Members, UpdatedAt: l.UpdatedAt, CreatedAt: l.CreatedAt,
	})
}

func (s *Server) handleCreateList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Title    string  `json:"title"`
		Icon     *string `json:"icon"` // "" = no icon; missing = the default
		ListType string  `json:"listType"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	lst, err := s.createList(userID, req.Title, req.Icon, req.ListType)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, lst)
}

// createList creates a list (POST /lists, MCP create_list). Shared with nobody yet: only the creator's
// other devices learn of it (its room has no one in it). icon: nil = the default, "" = none.
func (s *Server) createList(userID, title string, icon *string, listType string) (*domain.SharedList, error) {
	lst, err := s.store.CreateList(userID, title, derefIcon(icon), listType)
	if err != nil {
		return nil, err
	}
	if icon != nil && *icon == "" {
		err = s.store.ClearIcon("lists", lst.ID)
		if err == nil {
			lst.Icon = ""
		}
	}
	s.wsHub.BroadcastToUser(userID, eventListCreated, lst)
	if err != nil {
		return nil, err
	}
	return lst, nil
}

// broadcastListAudience sends a list event to everyone who could see the list before the change
// (before, read before it) or sees it now, on all their connections: also the people who have the
// list overview open but not this list (its room). Same message as BroadcastListEvent (with listId).
// With before (a change that can take the list away), whoever lost it leaves its room first
// (dropLostListRoom): the room's ITEM_* carry the entries.
func (s *Server) broadcastListAudience(listID string, before []string, event string, payload any) {
	if before != nil {
		s.dropLostListRoom(listID)
	}
	s.wsHub.BroadcastListToUsers(append(before, s.store.GetListUserIDs(listID)...), listID, event, payload)
}

func (s *Server) handleDeleteList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	audienceBefore := s.store.GetListUserIDs(listID)
	if err := s.store.DeleteList(userID, listID); err != nil {
		if errors.Is(err, storage.ErrListOwnerOnly) {
			writeErrorFrom(w, http.StatusForbidden, err)
			return
		}
		writeStoreError(w, http.StatusInternalServerError, err)
		return
	}
	// Everyone who saw it, not only its room: the list overview of the others drops it too
	s.broadcastListAudience(listID, audienceBefore, eventListDeleted, map[string]string{"listId": listID})
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleUpdateList(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	var req struct {
		Title *string `json:"title"`
		Icon  *string `json:"icon"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	l, err := s.store.UpdateList(userID, listID, req.Title, req.Icon)
	switch {
	case errors.Is(err, storage.ErrListNotFound):
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	case errors.Is(err, storage.ErrListReadOnly):
		writeErrorFrom(w, http.StatusForbidden, err)
		return
	case err != nil:
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.broadcastListUpdated(l)
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
		writeInternal(w, err)
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
	if !decodeJSON(w, r, &req) {
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
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}

	if l, err := s.store.GetListByID(currentUserID, listID); err == nil {
		s.notifyShared(currentUserID, targetType, share.TargetID, "list", listID, l.Title)
	}
	// The people it is shared with now (a team's members) and everyone who saw it before
	s.broadcastListAudience(listID, nil, eventListShared, share)

	writeJSON(w, http.StatusCreated, share)
}

func (s *Server) handleDeleteListShare(w http.ResponseWriter, r *http.Request) {
	currentUserID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	shareID := chi.URLParam(r, "shareId")

	audienceBefore := s.store.GetListUserIDs(listID)
	if err := s.store.RemoveListShare(currentUserID, listID, shareID); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}

	// Also to the people who lost it, so their list overview drops it, whether it was open or not
	s.broadcastListAudience(listID, audienceBefore, eventListUnshared, map[string]string{
		"listId":  listID,
		"shareId": shareID,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// GET /lists/{id}/suggestions?q=&limit=: entries added to the list before, for suggestions while typing a
// new one (storage/list_suggestions.go). Everyone who may read the list may read them.
func (s *Server) handleListItemSuggestions(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	if s.store.ListRole(userID, listID) == "" {
		writeErrorFrom(w, http.StatusNotFound, storage.ErrListNotFound)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.store.ListItemSuggestions(listID, r.URL.Query().Get("q"), limit, time.Now())
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
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
	if !decodeJSON(w, r, &req) {
		return
	}

	item, err := s.addListItem(userID, listID, req.Content, req.Category, req.Quantity, actorFrom(r.Context()))
	if err != nil {
		writeListItemError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

// setListItemDone checks an item off (or back on) and tells the list's viewers. Shared by
// PATCH /lists/{id}/items/{itemId} and the MCP tool check_list_item; access is checked first.
func (s *Server) setListItemDone(userID, listID, itemID string, done bool, actor *apiActor) (*domain.ListItem, error) {
	return s.setListItemDoneAt(userID, listID, itemID, done, time.Time{}, actor)
}

// setListItemDoneAt is setListItemDone for a change made at a given time (zero: now), e.g. on a phone
// that was offline. Already in that state, or changed by somebody after at: nothing is written and
// nobody is told; the item comes back as stored (storage.SetListItemDone).
func (s *Server) setListItemDoneAt(userID, listID, itemID string, done bool, at time.Time, actor *apiActor) (*domain.ListItem, error) {
	if err := s.store.EnsureListItemsWritable(userID, listID, itemID); err != nil {
		return nil, err
	}
	// The name is stored with the item for everyone who sees the list (in nobody's language); without
	// one the app shows none
	user, _ := s.store.GetUserByID(userID)
	userName := ""
	if user != nil {
		userName = user.DisplayName
	}
	item, changed, err := s.store.SetListItemDone(itemID, done, at, userID, userName)
	if err != nil {
		return nil, err
	}
	if !changed {
		return item, nil
	}
	s.recordListItemOrigin(item, actor, false)
	s.wsHub.BroadcastListEvent(listID, eventItemToggled, item)
	return item, nil
}

// changeTime is when a change sent late was made, on the server's clock: changedAt and sentAt are the
// sender's clock (milliseconds since 1970) at the change and at sending, so only the time in between
// counts and a phone clock that is off does not matter. Zero (now) without them.
func changeTime(changedAt, sentAt int64, now time.Time) time.Time {
	if changedAt <= 0 || sentAt <= 0 || sentAt <= changedAt {
		return time.Time{}
	}
	return now.Add(-time.Duration(sentAt-changedAt) * time.Millisecond)
}

func (s *Server) handleToggleListItem(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	listID := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")
	if !s.listItemsWriteAllowed(w, r, itemID) {
		return
	}

	// isCompleted is the wanted state, never a toggle. changedAt and sentAt: a change made offline and
	// sent later by the app's outbox (changeTime)
	var req struct {
		IsCompleted bool  `json:"isCompleted"`
		ChangedAt   int64 `json:"changedAt"`
		SentAt      int64 `json:"sentAt"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	at := changeTime(req.ChangedAt, req.SentAt, time.Now())
	item, err := s.setListItemDoneAt(userID, listID, itemID, req.IsCompleted, at, actorFrom(r.Context()))
	// Deleted (or the list unshared) since the check above: 404 like that check, not 400
	if err != nil {
		writeListItemError(w, err)
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
	if !decodeJSON(w, r, &req) {
		return
	}

	item, err := s.updateListItem(auth.GetUserID(r.Context()), listID, itemID, req.Content, req.Category, req.Quantity, actorFrom(r.Context()))
	if err != nil {
		writeListItemError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// updateListItem changes text, category or quantity of an item (nil: unchanged) and tells the list's
// viewers. Shared by PATCH /lists/{id}/items/{itemId} with content fields and the MCP tool
// update_list_item; access is checked first.
func (s *Server) updateListItem(userID, listID, itemID string, content, category, quantity *string, actor *apiActor) (*domain.ListItem, error) {
	if err := s.store.EnsureListItemsWritable(userID, listID, itemID); err != nil {
		return nil, err
	}
	item, err := s.store.UpdateListItem(itemID, content, category, quantity)
	if err != nil {
		return nil, err
	}
	s.recordListItemOrigin(item, actor, false)
	s.wsHub.BroadcastListEvent(listID, eventItemUpdated, item)
	return item, nil
}

// writeListItemError answers a failed change of a list entry: gone (the entry, or the list for this
// person, since the check before) 404, read only 403, anything else (empty text …) 400.
func writeListItemError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrListItemNotFound), errors.Is(err, storage.ErrListNotFound):
		writeErrorFrom(w, http.StatusNotFound, err)
	case errors.Is(err, storage.ErrListReadOnly):
		writeErrorFrom(w, http.StatusForbidden, err)
	default:
		writeErrorFrom(w, http.StatusBadRequest, err)
	}
}

func (s *Server) handleDeleteListItem(w http.ResponseWriter, r *http.Request) {
	listID := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")
	if !s.listItemsWriteAllowed(w, r, itemID) {
		return
	}

	_, err := s.store.DeleteListItem(itemID)
	if err != nil {
		writeInternal(w, err)
		return
	}

	s.wsHub.BroadcastListEvent(listID, eventItemDeleted, map[string]string{
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
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.TargetListID == "" {
		writeError(w, http.StatusBadRequest, "Zielliste fehlt")
		return
	}
	if req.TargetListID == listID {
		writeError(w, http.StatusBadRequest, "Eintrag ist bereits in dieser Liste")
		return
	}
	if err := s.store.EnsureListItemsWritable(userID, req.TargetListID, ""); err != nil {
		if errors.Is(err, storage.ErrListReadOnly) {
			writeErrorFrom(w, http.StatusForbidden, err)
		} else {
			writeErrorFrom(w, http.StatusNotFound, err)
		}
		return
	}

	item, err := s.store.MoveListItem(itemID, req.TargetListID)
	if err != nil {
		writeInternal(w, err)
		return
	}

	s.wsHub.BroadcastListEvent(listID, eventItemDeleted, map[string]string{
		"itemId": itemID,
		"listId": listID,
	})
	s.wsHub.BroadcastListEvent(req.TargetListID, eventItemCreated, item)
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleClearCompletedItems(w http.ResponseWriter, r *http.Request) {
	listID := chi.URLParam(r, "id")
	if !s.listItemsWriteAllowed(w, r, "") {
		return
	}
	removed, err := s.store.ClearCompletedListItems(listID)
	if err != nil {
		writeInternal(w, err)
		return
	}

	s.wsHub.BroadcastListEvent(listID, eventListCleared, map[string]any{
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
	if !decodeJSON(w, r, &req) {
		return
	}

	if err := s.store.ReorderListItems(listID, req.Items); err != nil {
		writeInternal(w, err)
		return
	}

	s.wsHub.BroadcastListEvent(listID, eventItemReordered, map[string]any{
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
		if !decodeJSON(w, r, &req) {
			return
		}
		if len(req.IDs) > 1000 {
			writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
			return
		}
		if err := s.store.SetListOrder(auth.GetUserID(r.Context()), kind, req.IDs); err != nil {
			writeInternal(w, err)
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
		writeErrorFrom(w, http.StatusForbidden, err)
	default:
		writeErrorFrom(w, http.StatusNotFound, err)
	}
	return false
}
