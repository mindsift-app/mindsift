package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
)

// --- WORKSPACE FOLDERS ---

func (s *Server) handleGetFolders(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folders, err := s.store.GetFolders(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, folders)
}

func (s *Server) handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	cleanPath, err := s.store.CreateFolder(userID, req.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.wsHub.BroadcastToUser(userID, "WORKSPACE_FOLDERS_UPDATED", map[string]string{"path": cleanPath})
	writeJSON(w, http.StatusCreated, map[string]string{"path": cleanPath})
}

func (s *Server) handleDeleteFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderPath := r.URL.Query().Get("path")
	if folderPath == "" {
		writeError(w, http.StatusBadRequest, "Pfad erforderlich")
		return
	}

	deletedDocIDs, err := s.store.DeleteFolder(userID, folderPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	for _, docID := range deletedDocIDs {
		s.wsHub.BroadcastDocEvent(docID, "DOC_DELETED", map[string]string{"id": docID})
	}
	s.wsHub.BroadcastToUser(userID, "WORKSPACE_FOLDERS_UPDATED", map[string]string{"path": folderPath})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"deleted":       true,
		"deletedDocIds": deletedDocIDs,
	})
}

// handleRestoreFolder brings a folder from the trash back with its subfolders and notes.
func (s *Server) handleRestoreFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docIDs, err := s.store.RestoreFolder(userID, chi.URLParam(r, "id"))
	if err != nil {
		writeTrashError(w, err)
		return
	}
	// Everyone with access to one of the notes reloads their tree
	users := map[string]bool{userID: true}
	for _, docID := range docIDs {
		authorized, _ := s.store.GetAuthorizedDocUsers(docID)
		for _, uid := range authorized {
			users[uid] = true
		}
	}
	for uid := range users {
		s.wsHub.BroadcastToUser(uid, "WORKSPACE_FOLDERS_UPDATED", map[string]string{"restored": "folder"})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"restored": true, "restoredDocIds": docIDs})
}

// handlePurgeFolder deletes a folder in the trash with its notes for good.
func (s *Server) handlePurgeFolder(w http.ResponseWriter, r *http.Request) {
	docIDs, err := s.store.PurgeFolder(auth.GetUserID(r.Context()), chi.URLParam(r, "id"))
	if err != nil {
		writeTrashError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"deleted": true, "deletedDocIds": docIDs})
}

func (s *Server) handleMoveFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		SourcePath       string `json:"sourcePath"`
		TargetParentPath string `json:"targetParentPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	newPath, movedDocIDs, err := s.store.MoveFolder(userID, req.SourcePath, req.TargetParentPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	for _, id := range movedDocIDs {
		if doc, err := s.store.GetDocumentByID(userID, id); err == nil && doc != nil {
			s.wsHub.BroadcastDocEvent(id, "DOC_UPDATED", doc)
			s.broadcastDocToAuthorizedUsers(id, "DOC_UPDATED")
		}
	}
	s.wsHub.BroadcastToUser(userID, "WORKSPACE_FOLDERS_UPDATED", map[string]string{
		"sourcePath": req.SourcePath,
		"newPath":    newPath,
	})
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"newPath":     newPath,
		"movedDocIds": movedDocIDs,
	})
}

// --- WORKSPACE SHARED FOLDERS ---

func (s *Server) handleGetSharedFolders(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folders, err := s.store.GetSharedFolders(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, folders)
}

func (s *Server) handleCreateSharedFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Name      string `json:"name"`
		MountPath string `json:"mountPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	folder, err := s.store.CreateSharedFolder(userID, req.Name, req.MountPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.wsHub.BroadcastToUser(userID, "WORKSPACE_FOLDERS_UPDATED", folder)
	writeJSON(w, http.StatusCreated, folder)
}

func (s *Server) handleGetSharedFolderByID(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderID := chi.URLParam(r, "id")
	folder, err := s.store.GetSharedFolderByID(userID, folderID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, folder)
}

func (s *Server) handleDeleteSharedFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderID := chi.URLParam(r, "id")
	audience := s.store.GetSharedFolderUserIDs(folderID)
	if err := s.store.DeleteSharedFolder(userID, folderID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.wsHub.BroadcastToUsers(append(audience, userID), "WORKSPACE_FOLDERS_UPDATED", map[string]string{"folderId": folderID})
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleUpdateFolderMount(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderID := chi.URLParam(r, "id")
	var req struct {
		MountPath string `json:"mountPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	if err := s.store.UpdateFolderMount(userID, folderID, req.MountPath); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.wsHub.BroadcastToUser(userID, "WORKSPACE_FOLDERS_UPDATED", map[string]string{"folderId": folderID, "mountPath": req.MountPath})
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (s *Server) handleGetFolderShares(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderID := chi.URLParam(r, "id")
	// Only someone with access to the folder may see with whom it is shared
	if _, err := s.store.GetSharedFolderByID(userID, folderID); err != nil {
		writeError(w, http.StatusNotFound, "Ordner nicht gefunden oder kein Zugriff")
		return
	}
	shares, err := s.store.GetFolderShares(folderID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, shares)
}

func (s *Server) handleCreateFolderShare(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderID := chi.URLParam(r, "id")
	var req struct {
		TargetType string `json:"targetType"` // team | user
		TargetID   string `json:"targetId"`
		UserId     string `json:"userId"`
		Email      string `json:"email"`
		TeamId     string `json:"teamId"`
		Permission string `json:"permission"` // read | write
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	targetType := req.TargetType
	targetIdentifier := req.TargetID
	if targetIdentifier == "" {
		if req.TeamId != "" {
			targetType = "team"
			targetIdentifier = req.TeamId
		} else if req.UserId != "" {
			targetType = "user"
			targetIdentifier = req.UserId
		} else if req.Email != "" {
			targetType = "user"
			targetIdentifier = req.Email
		}
	}

	share, err := s.store.CreateFolderShare(userID, folderID, targetType, targetIdentifier, req.Permission)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.notifyShared(userID, share.TargetType, share.TargetID, "folder", s.store.SharedFolderName(folderID))
	s.wsHub.BroadcastToUsers(s.store.GetSharedFolderUserIDs(folderID), "WORKSPACE_FOLDERS_UPDATED", map[string]string{"folderId": folderID})
	if docIDs, err := s.store.GetSharedFolderDocIDs(folderID); err == nil {
		for _, docID := range docIDs {
			s.broadcastDocToAuthorizedUsers(docID, "DOC_CREATED")
		}
	}
	writeJSON(w, http.StatusCreated, share)
}

func (s *Server) handleDeleteFolderShare(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderID := chi.URLParam(r, "id")
	shareID := chi.URLParam(r, "shareId")
	docIDs, _ := s.store.GetSharedFolderDocIDs(folderID)
	audienceBefore := s.store.GetSharedFolderUserIDs(folderID)
	if err := s.store.DeleteFolderShare(userID, folderID, shareID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	audienceAfter := s.store.GetSharedFolderUserIDs(folderID)
	stillAllowed := make(map[string]bool, len(audienceAfter))
	for _, uid := range audienceAfter {
		stillAllowed[uid] = true
	}
	s.wsHub.BroadcastToUsers(append(audienceBefore, audienceAfter...), "WORKSPACE_FOLDERS_UPDATED", map[string]string{"folderId": folderID})
	for _, docID := range docIDs {
		// Users who lost access remove the notes; the rest refresh them
		for _, uid := range audienceBefore {
			if !stillAllowed[uid] {
				s.wsHub.BroadcastToUser(uid, "DOC_DELETED", map[string]string{"id": docID})
			}
		}
		s.broadcastDocToAuthorizedUsers(docID, "DOC_UPDATED")
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// --- WORKSPACE TAGS & PAGES ---

func (s *Server) handleGetWorkspaceTags(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	tags, err := s.store.GetWorkspaceTags(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func (s *Server) handleGetTagDetails(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	tag := chi.URLParam(r, "tag")
	details, err := s.store.GetTagDetails(userID, tag)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, details)
}

func (s *Server) handleUpdateTagPageNote(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	tag := chi.URLParam(r, "tag")
	var req struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	updatedAt, err := s.store.UpdateTagPageNote(userID, tag, req.Content)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"tag":       tag,
		"content":   req.Content,
		"updatedAt": updatedAt,
	})
}
