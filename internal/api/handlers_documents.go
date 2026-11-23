package api

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- DOCUMENTS ---

// broadcastDocToAuthorizedUsers sends each person with access the note as they see it, as the note list
// has it (no bullets, with the counts; clients with the note open get its bullets by sync). Pin, folder
// placement and permission are personal, so the note's room gets no copy of its own: every connection
// in it belongs to one of these people and already has theirs (someone else's copy would overwrite
// their pin and place, e.g. unpin the note for the owner after sharing it).
func (s *Server) broadcastDocToAuthorizedUsers(docID, event string) {
	users, err := s.store.GetAuthorizedDocUsers(docID)
	if err != nil {
		return
	}
	for _, uid := range users {
		if userDoc, err := s.store.GetDocumentListItem(uid, docID); err == nil && userDoc != nil {
			s.wsHub.BroadcastToUser(uid, event, userDoc)
		}
	}
}

// maxDocListsBuilding: note lists built at the same time, a guard for memory (a few KB per note while
// it is built) against a burst of sign-ins, each loading the list at start. It must not be the
// bottleneck: on a busy server a build waits for CPU and database connections like every request, and
// 4 slots then let through fewer lists than arrived (load test 2026-11-14, 1,200 people on 1 CPU: 220 of
// 263 lists ran into the client's 30 s timeout while other requests took about 8 s).
const maxDocListsBuilding = 32

// handleGetDocuments: GET /documents, the note list without bullets (storage.GetDocumentList). Waits for
// a free slot; when the client gives up, waiting or building, the build stops.
func (s *Server) handleGetDocuments(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	select {
	case s.docLists <- struct{}{}:
		defer func() { <-s.docLists }()
	case <-r.Context().Done():
		return
	}
	if r.Context().Err() != nil {
		return
	}
	docs, err := s.store.GetDocumentList(r.Context(), userID)
	if r.Context().Err() != nil {
		return // nobody waits for the answer; a cancelled query is no server error
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, docs)
}

// handleGetNoteTodos: GET /documents/todos, the to-dos with text of all notes the user can see.
func (s *Server) handleGetNoteTodos(w http.ResponseWriter, r *http.Request) {
	todos, err := s.store.ListNoteTodos(auth.GetUserID(r.Context()))
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, todos)
}

// handleGetBlock: GET /blocks/{id}, one bullet of a note the user may read (for links to a bullet).
func (s *Server) handleGetBlock(w http.ResponseWriter, r *http.Request) {
	b, err := s.store.GetBlockForUser(auth.GetUserID(r.Context()), chi.URLParam(r, "id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Nicht gefunden")
		return
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (s *Server) handleCreateDocument(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		SpaceID    string                 `json:"spaceId"`
		Title      string                 `json:"title"`
		Icon       *string                `json:"icon"` // "" = no icon; missing = the default
		FolderPath string                 `json:"folderPath"`
		Blocks     []domain.DocumentBlock `json:"blocks"`
		Tags       []string               `json:"tags"`
		IsPinned   bool                   `json:"isPinned"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := storage.CheckNoteTitle(req.Title, ""); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}

	doc, err := s.store.CreateDocument(userID, req.SpaceID, req.Title, derefIcon(req.Icon), req.FolderPath, req.Blocks, req.Tags, req.IsPinned)
	if err == nil && doc != nil && req.Icon != nil && *req.Icon == "" {
		if err = s.store.ClearIcon("documents", doc.ID); err == nil {
			doc.Icon = ""
		}
	}
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.afterDocCreated(userID, doc, false)
	writeJSON(w, http.StatusCreated, doc)
}

func (s *Server) handleGetDocument(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	doc, err := s.store.GetDocumentByID(userID, docID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Dokument nicht gefunden")
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

func (s *Server) handleGetBacklinks(w http.ResponseWriter, r *http.Request) {
	links, err := s.store.GetBacklinks(auth.GetUserID(r.Context()), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "Dokument nicht gefunden")
		return
	}
	writeJSON(w, http.StatusOK, links)
}

func (s *Server) handleUpdateDocument(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")

	var req struct {
		Title      *string                 `json:"title"`
		Icon       *string                 `json:"icon"`
		FolderPath *string                 `json:"folderPath"`
		Blocks     *[]domain.DocumentBlock `json:"blocks"`
		IsPinned   *bool                   `json:"isPinned"`
		// Personal like the pin: any note the person can read may be one of their templates
		IsTemplate *bool `json:"isTemplate"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Blocks != nil {
		writeError(w, http.StatusBadRequest, "Blöcke werden über POST /api/v1/docs/{id}/sync gespeichert")
		return
	}

	if req.IsTemplate != nil {
		if err := s.store.SetDocTemplate(userID, docID, *req.IsTemplate); err != nil {
			writeStoreError(w, http.StatusBadRequest, err)
			return
		}
	}
	doc, err := s.store.UpdateDocument(userID, docID, req.Title, req.Icon, req.FolderPath, req.IsPinned)
	if err != nil {
		// A note without access is a missing note (404), not an internal error (pentest 2026-11-13, P1)
		writeStoreError(w, http.StatusBadRequest, err)
		return
	}
	if req.Title != nil {
		_, head, _ := s.store.GetDocOpsSince(docID, 0, 0)
		s.notifyDocChanged(docID, head)
	}
	if req.Title != nil || req.Icon != nil || req.FolderPath != nil {
		s.broadcastDocToAuthorizedUsers(docID, eventDocUpdated)
		if req.FolderPath != nil {
			s.announceNoteMoved(userID, docID)
		}
	} else if req.IsPinned != nil || req.IsTemplate != nil {
		// Pin and template mark are the person's own: only their other tabs and devices hear of it
		if listed, err := s.store.GetDocumentListItem(userID, docID); err == nil && listed != nil {
			s.wsHub.BroadcastToUser(userID, eventDocUpdated, listed)
		}
	}
	writeJSON(w, http.StatusOK, doc)
}

func (s *Server) handleDeleteDocument(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	authorizedUsers, _ := s.store.GetAuthorizedDocUsers(docID)

	if err := s.store.DeleteDocument(userID, docID); err != nil {
		writeStoreError(w, http.StatusInternalServerError, err)
		return
	}
	for _, uid := range authorizedUsers {
		s.wsHub.BroadcastToUser(uid, eventDocDeleted, map[string]string{"id": docID})
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleGetTrash(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.GetTrash(auth.GetUserID(r.Context()))
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleRestoreDocument(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	if err := s.store.RestoreDocument(userID, docID); err != nil {
		writeTrashError(w, err)
		return
	}
	// Everyone with access gets the note back in their list (shared users as well), then reloads their folders
	s.broadcastDocToAuthorizedUsers(docID, eventDocCreated)
	authorized, _ := s.store.GetAuthorizedDocUsers(docID)
	for _, uid := range append(authorized, userID) {
		s.wsHub.BroadcastToUser(uid, eventFoldersUpdated, map[string]string{"type": folderEventRestored, "restored": docID})
	}
	writeJSON(w, http.StatusOK, map[string]bool{"restored": true})
}

func (s *Server) handlePurgeDocument(w http.ResponseWriter, r *http.Request) {
	if err := s.store.PurgeDocument(auth.GetUserID(r.Context()), chi.URLParam(r, "id")); err != nil {
		writeTrashError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleEmptyTrash(w http.ResponseWriter, r *http.Request) {
	ids, err := s.store.EmptyTrash(auth.GetUserID(r.Context()))
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"deleted": len(ids)})
}

func writeTrashError(w http.ResponseWriter, err error) {
	if errors.Is(err, storage.ErrNotInTrash) {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	writeInternal(w, err)
}

func (s *Server) handleCreateEnhancedTask(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	blockID := chi.URLParam(r, "blockId")

	var req struct {
		Content string `json:"content"`
		Checked bool   `json:"checked"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	thought, err := s.store.CreateTaskFromDocBlock(userID, docID, blockID, req.Content, req.Checked)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	// Checkboxes already right under it become its subtasks (task_doc_sync.go)
	if len(s.store.ReconcileDocTaskLinks(docID)) > 0 {
		if fresh, err := s.store.GetThoughtByIDUnchecked(thought.ID); err == nil && fresh != nil {
			thought = fresh
		}
	}
	_, head, _ := s.store.GetDocOpsSince(docID, 0, 0)
	s.notifyDocChanged(docID, head)

	// Always a personal task of its creator (storage.CreateTaskFromDocBlock, no task list), so nobody else
	// sees it and no list's members are told (notifyTaskAdded); taskAudience like every other TASK_CREATED
	s.wsHub.BroadcastToUsers(s.taskAudience(thought), eventTaskCreated, thought)
	writeJSON(w, http.StatusCreated, thought)
}

func (s *Server) handleMoveDocument(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	var req struct {
		FolderPath string `json:"folderPath"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	doc, err := s.store.MoveDocument(userID, docID, req.FolderPath)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.broadcastDocToAuthorizedUsers(docID, eventDocUpdated)
	s.announceNoteMoved(userID, docID)
	writeJSON(w, http.StatusOK, doc)
}

// announceNoteMoved tells everyone with the note that it changed folder: the folder it went into is kept
// as a folder now (storage.MoveDocument), so their folder lists are fetched again.
func (s *Server) announceNoteMoved(userID, docID string) {
	docUsers, _ := s.store.GetAuthorizedDocUsers(docID)
	s.wsHub.BroadcastToUsers(append(docUsers, userID), eventFoldersUpdated, map[string]string{"type": folderEventNoteMoved, "docId": docID})
}

// --- DOCUMENT SHARING & COLLABORATION ---

func (s *Server) handleGetDocShares(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	// Only someone with access to the note may see with whom it is shared
	if s.store.DocRole(userID, docID) == "" {
		writeError(w, http.StatusNotFound, storage.ErrDocNotFound.Error())
		return
	}
	shares, err := s.store.GetDocShares(docID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, shares)
}

func (s *Server) handleCreateDocShare(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	var req struct {
		UserID     string `json:"userId"`
		Email      string `json:"email"`
		TeamID     string `json:"teamId"`
		Permission string `json:"permission"` // read | write
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.TeamID != "" {
		share, err := s.store.CreateDocTeamShare(userID, docID, req.TeamID, req.Permission)
		if err == nil {
			defer s.notifyShared(userID, "team", req.TeamID, "note", docID, s.docTitle(userID, docID))
		}
		if err != nil {
			writeErrorFrom(w, http.StatusBadRequest, err)
			return
		}
		s.broadcastDocToAuthorizedUsers(docID, eventDocCreated)
		s.broadcastDocToAuthorizedUsers(docID, eventDocUpdated)
		writeJSON(w, http.StatusCreated, share)
		return
	}

	target := req.UserID
	if target == "" {
		target = req.Email
	}
	if target == "" {
		writeError(w, http.StatusBadRequest, "Benutzer-ID, E-Mail oder Team erforderlich")
		return
	}

	share, err := s.store.CreateDocShare(userID, docID, target, req.Permission)
	if err != nil {
		writeStoreError(w, http.StatusBadRequest, err)
		return
	}
	s.notifyShared(userID, "user", share.UserID, "note", docID, s.docTitle(userID, docID))
	s.broadcastDocToAuthorizedUsers(docID, eventDocCreated)
	s.broadcastDocToAuthorizedUsers(docID, eventDocUpdated)
	writeJSON(w, http.StatusCreated, share)
}

func (s *Server) handleDeleteDocShare(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	targetUserID := chi.URLParam(r, "userId")
	if err := s.store.DeleteDocShare(userID, docID, targetUserID); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.wsHub.BroadcastToUser(targetUserID, eventDocDeleted, map[string]string{"id": docID})
	s.broadcastDocToAuthorizedUsers(docID, eventDocUpdated)
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleGetCollaborators(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	users, err := s.store.GetDirectory(userID, s.peopleSearchEnabled())
	if err != nil {
		writeInternal(w, err)
		return
	}
	// The directory without the viewer: only the public view, never webhooks, alarm e-mail or role
	others := make([]domain.PublicUser, 0, len(users))
	for _, u := range users {
		if u.ID != userID {
			others = append(others, u)
		}
	}
	writeJSON(w, http.StatusOK, others)
}

func (s *Server) docTitle(userID, docID string) string {
	if d, err := s.store.GetDocumentByID(userID, docID); err == nil && d.Title != "" {
		return d.Title
	}
	return i18n.T(s.userLanguage(userID), "Unbenannte Notiz")
}

// derefIcon: the icon of a create request; a missing one lets the store pick the default.
func derefIcon(icon *string) string {
	if icon == nil {
		return ""
	}
	return *icon
}
