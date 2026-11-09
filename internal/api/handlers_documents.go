package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- DOCUMENTS ---

func (s *Server) broadcastDocToAuthorizedUsers(docID, event string) {
	users, err := s.store.GetAuthorizedDocUsers(docID)
	if err != nil {
		return
	}
	var firstDoc *domain.Document
	for _, uid := range users {
		if userDoc, err := s.store.GetDocumentByID(uid, docID); err == nil && userDoc != nil {
			if firstDoc == nil {
				firstDoc = userDoc
			}
			s.wsHub.BroadcastToUser(uid, event, userDoc)
		}
	}
	if s.wsHub != nil && firstDoc != nil {
		s.wsHub.BroadcastRoom("doc:"+docID, event, firstDoc, nil)
	}
}

func (s *Server) handleGetDocuments(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docs, err := s.store.GetDocuments(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, docs)
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	doc, err := s.store.CreateDocument(userID, req.SpaceID, req.Title, derefIcon(req.Icon), req.FolderPath, req.Blocks, req.Tags, req.IsPinned)
	if err == nil && doc != nil && req.Icon != nil && *req.Icon == "" {
		if err = s.store.ClearIcon("documents", doc.ID); err == nil {
			doc.Icon = ""
		}
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.broadcastDocToAuthorizedUsers(doc.ID, "DOC_CREATED")
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
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	if req.Blocks != nil {
		writeError(w, http.StatusBadRequest, "Blöcke werden über POST /api/v1/docs/{id}/sync gespeichert")
		return
	}

	doc, err := s.store.UpdateDocument(userID, docID, req.Title, req.Icon, req.FolderPath, req.IsPinned)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Title != nil {
		_, head, _ := s.store.GetDocOpsSince(docID, 0, 0)
		s.notifyDocChanged(docID, head)
	}
	if req.Title != nil || req.Icon != nil || req.FolderPath != nil {
		s.broadcastDocToAuthorizedUsers(docID, "DOC_UPDATED")
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
		s.wsHub.BroadcastToUser(uid, "DOC_DELETED", map[string]string{"id": docID})
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleGetTrash(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.GetTrash(auth.GetUserID(r.Context()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
	// Everyone with access reloads their tree, so the note is back for shared users as well
	authorized, _ := s.store.GetAuthorizedDocUsers(docID)
	for _, uid := range append(authorized, userID) {
		s.wsHub.BroadcastToUser(uid, "WORKSPACE_FOLDERS_UPDATED", map[string]string{"restored": docID})
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
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"deleted": len(ids)})
}

func writeTrashError(w http.ResponseWriter, err error) {
	if errors.Is(err, storage.ErrNotInTrash) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func (s *Server) handleCreateEnhancedTask(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	blockID := chi.URLParam(r, "blockId")

	var req struct {
		Content string `json:"content"`
		Checked bool   `json:"checked"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	thought, err := s.store.CreateTaskFromDocBlock(userID, docID, blockID, req.Content, req.Checked)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
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

	s.wsHub.BroadcastToUser(userID, "TASK_CREATED", thought)
	writeJSON(w, http.StatusCreated, thought)
}

func (s *Server) handleMoveDocument(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	var req struct {
		FolderPath string `json:"folderPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	doc, err := s.store.MoveDocument(userID, docID, req.FolderPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.wsHub.BroadcastDocEvent(docID, "DOC_UPDATED", doc)
	s.broadcastDocToAuthorizedUsers(docID, "DOC_UPDATED")
	docUsers, _ := s.store.GetAuthorizedDocUsers(docID)
	s.wsHub.BroadcastToUsers(append(docUsers, userID), "WORKSPACE_FOLDERS_UPDATED", map[string]string{"docId": docID})
	writeJSON(w, http.StatusOK, doc)
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
		writeError(w, http.StatusInternalServerError, err.Error())
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	if req.TeamID != "" {
		share, err := s.store.CreateDocTeamShare(userID, docID, req.TeamID, req.Permission)
		if err == nil {
			defer s.notifyShared(userID, "team", req.TeamID, "note", docID, s.docTitle(userID, docID))
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.broadcastDocToAuthorizedUsers(docID, "DOC_CREATED")
		s.broadcastDocToAuthorizedUsers(docID, "DOC_UPDATED")
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
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.notifyShared(userID, "user", share.UserID, "note", docID, s.docTitle(userID, docID))
	s.broadcastDocToAuthorizedUsers(docID, "DOC_CREATED")
	s.broadcastDocToAuthorizedUsers(docID, "DOC_UPDATED")
	writeJSON(w, http.StatusCreated, share)
}

func (s *Server) handleDeleteDocShare(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	targetUserID := chi.URLParam(r, "userId")
	if err := s.store.DeleteDocShare(userID, docID, targetUserID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.wsHub.BroadcastToUser(targetUserID, "DOC_DELETED", map[string]string{"id": docID})
	s.broadcastDocToAuthorizedUsers(docID, "DOC_UPDATED")
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleGetCollaborators(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	users, err := s.store.GetDirectory(userID, s.peopleSearchEnabled())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
