package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- WORKSPACE FOLDERS ---

// The `type` of WORKSPACE_FOLDERS_UPDATED, so clients fetch only what changed (Doku/api/websocket.md):
// created, moved and restored need the folders only (the notes come as DOC_UPDATED / DOC_CREATED before),
// deleted names the notes that went to the trash, noteMoved the one note moved; mount and shared change
// where or for whom many notes show, clients fetch their note list again.
const (
	folderEventCreated   = "created"
	folderEventDeleted   = "deleted"
	folderEventMoved     = "moved"
	folderEventRestored  = "restored"
	folderEventNoteMoved = "noteMoved"
	folderEventMount     = "mount"
	folderEventShared    = "shared"
)

// isFolderMount: whether the path is where the user placed a shared folder (moving it moves the mount).
func (s *Server) isFolderMount(userID, path string) bool {
	clean := strings.Trim(strings.TrimSpace(path), "/")
	folders, err := s.store.GetSharedFolders(userID)
	if err != nil {
		return false
	}
	for _, f := range folders {
		if f.MountPath != "" && strings.Trim(f.MountPath, "/") == clean {
			return true
		}
	}
	return false
}

func (s *Server) handleGetFolders(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folders, err := s.store.GetFolders(userID)
	if err != nil {
		writeInternal(w, err)
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
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.wsHub.BroadcastToUser(userID, eventFoldersUpdated, map[string]string{"type": folderEventCreated, "path": cleanPath})
	writeJSON(w, http.StatusCreated, map[string]string{"path": cleanPath})
}

func (s *Server) handleDeleteFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderPath := r.URL.Query().Get("path")
	if folderPath == "" {
		writeError(w, http.StatusBadRequest, "Pfad erforderlich")
		return
	}

	// A shared folder its owner deletes stops being shared: everyone it was shared with loses it, also
	// when it held no note of theirs
	var sharedWith []string
	if folders, err := s.store.GetSharedFolders(userID); err == nil {
		clean := strings.Trim(strings.TrimSpace(folderPath), "/")
		for _, f := range folders {
			if f.IsOwner && strings.Trim(f.MountPath, "/") == clean {
				sharedWith, _ = s.store.GetAuthorizedSharedFolderUsers(f.ID)
			}
		}
	}

	deletedDocIDs, err := s.store.DeleteFolder(userID, folderPath)
	if err != nil {
		writeInternal(w, err)
		return
	}

	if deletedDocIDs == nil {
		deletedDocIDs = []string{}
	}
	s.wsHub.BroadcastToUser(userID, eventFoldersUpdated, map[string]any{
		"type": folderEventDeleted, "path": folderPath, "deletedDocIds": deletedDocIDs,
	})
	// Everyone else with access to some of the notes (shared notes, shared folder) gets one event with the
	// notes they lose, without a path (theirs differ), instead of a DOC_DELETED per note
	others := s.othersWithDocs(userID, deletedDocIDs)
	for uid, ids := range others {
		s.wsHub.BroadcastToUser(uid, eventFoldersUpdated, map[string]any{"type": folderEventDeleted, "deletedDocIds": ids})
	}
	for _, uid := range sharedWith {
		if _, told := others[uid]; !told && uid != userID {
			s.wsHub.BroadcastToUser(uid, eventFoldersUpdated, map[string]any{"type": folderEventDeleted, "deletedDocIds": []string{}})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"deleted":       true,
		"deletedDocIds": deletedDocIDs,
	})
}

// othersWithDocs: per user other than the actor, the notes of docIDs they have access to (shares stay
// while a note is in the trash, so this also works right after deleting).
func (s *Server) othersWithDocs(actorID string, docIDs []string) map[string][]string {
	byUser := map[string][]string{}
	for _, docID := range docIDs {
		users, _ := s.store.GetAuthorizedDocUsers(docID)
		for _, uid := range users {
			if uid != actorID {
				byUser[uid] = append(byUser[uid], docID)
			}
		}
	}
	return byUser
}

// handleRestoreFolder brings a folder from the trash back with its subfolders and notes.
func (s *Server) handleRestoreFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docIDs, err := s.store.RestoreFolder(userID, chi.URLParam(r, "id"))
	if err != nil {
		writeTrashError(w, err)
		return
	}
	// Everyone with access to one of the notes gets it back in their list, then reloads their folders
	users := map[string]bool{userID: true}
	for _, docID := range docIDs {
		authorized, _ := s.store.GetAuthorizedDocUsers(docID)
		for _, uid := range authorized {
			users[uid] = true
		}
		s.broadcastDocToAuthorizedUsers(docID, eventDocCreated)
	}
	for uid := range users {
		s.wsHub.BroadcastToUser(uid, eventFoldersUpdated, map[string]string{"type": folderEventRestored, "restored": "folder"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"restored": true, "restoredDocIds": docIDs})
}

// handlePurgeFolder deletes a folder in the trash with its notes for good.
func (s *Server) handlePurgeFolder(w http.ResponseWriter, r *http.Request) {
	docIDs, err := s.store.PurgeFolder(auth.GetUserID(r.Context()), chi.URLParam(r, "id"))
	if err != nil {
		writeTrashError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "deletedDocIds": docIDs})
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
	// Moving the place of a shared folder moves no note, but every note in it shows elsewhere
	eventType := folderEventMoved
	if s.isFolderMount(userID, req.SourcePath) {
		eventType = folderEventMount
	}
	newPath, movedDocIDs, err := s.store.MoveFolder(userID, req.SourcePath, req.TargetParentPath)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.answerFolderMoved(w, userID, eventType, req.SourcePath, newPath, movedDocIDs)
}

// handleRenameFolder: POST /folders/rename {path, name} – the folder gets a new name in the same place,
// with its notes and subfolders; 409 when a folder of that name is already there.
func (s *Server) handleRenameFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	eventType := folderEventMoved
	if s.isFolderMount(userID, req.Path) {
		eventType = folderEventMount
	}
	newPath, movedDocIDs, err := s.store.RenameFolder(userID, req.Path, req.Name)
	if errors.Is(err, storage.ErrFolderExists) {
		writeErrorFrom(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.answerFolderMoved(w, userID, eventType, req.Path, newPath, movedDocIDs)
}

// answerFolderMoved tells everyone with the moved notes and the person's other tabs and devices, and
// answers with the folder's new path.
func (s *Server) answerFolderMoved(w http.ResponseWriter, userID, eventType, sourcePath, newPath string, movedDocIDs []string) {
	for _, id := range movedDocIDs {
		s.broadcastDocToAuthorizedUsers(id, eventDocUpdated)
	}
	s.wsHub.BroadcastToUser(userID, eventFoldersUpdated, map[string]string{
		"type":       eventType,
		"sourcePath": sourcePath,
		"newPath":    newPath,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"newPath":     newPath,
		"movedDocIds": movedDocIDs,
	})
}

// --- WORKSPACE SHARED FOLDERS ---

func (s *Server) handleGetSharedFolders(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folders, err := s.store.GetSharedFolders(userID)
	if err != nil {
		writeInternal(w, err)
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
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.wsHub.BroadcastToUser(userID, eventFoldersUpdated, map[string]string{"type": folderEventShared, "folderId": folder.ID})
	writeJSON(w, http.StatusCreated, folder)
}

func (s *Server) handleGetSharedFolderByID(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderID := chi.URLParam(r, "id")
	folder, err := s.store.GetSharedFolderByID(userID, folderID)
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, folder)
}

func (s *Server) handleDeleteSharedFolder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	folderID := chi.URLParam(r, "id")
	audience := s.store.GetSharedFolderUserIDs(folderID)
	if err := s.store.DeleteSharedFolder(userID, folderID); err != nil {
		writeInternal(w, err)
		return
	}
	s.wsHub.BroadcastToUsers(append(audience, userID), eventFoldersUpdated, map[string]string{"type": folderEventShared, "folderId": folderID})
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
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.wsHub.BroadcastToUser(userID, eventFoldersUpdated, map[string]string{"type": folderEventMount, "folderId": folderID, "mountPath": req.MountPath})
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
		writeInternal(w, err)
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
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	s.notifyShared(userID, share.TargetType, share.TargetID, "folder", folderID, s.store.SharedFolderName(folderID))
	s.wsHub.BroadcastToUsers(s.store.GetSharedFolderUserIDs(folderID), eventFoldersUpdated, map[string]string{"type": folderEventShared, "folderId": folderID})
	if docIDs, err := s.store.GetSharedFolderDocIDs(folderID); err == nil {
		for _, docID := range docIDs {
			s.broadcastDocToAuthorizedUsers(docID, eventDocCreated)
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
		writeInternal(w, err)
		return
	}
	audienceAfter := s.store.GetSharedFolderUserIDs(folderID)
	stillAllowed := make(map[string]bool, len(audienceAfter))
	for _, uid := range audienceAfter {
		stillAllowed[uid] = true
	}
	s.wsHub.BroadcastToUsers(append(audienceBefore, audienceAfter...), eventFoldersUpdated, map[string]string{"type": folderEventShared, "folderId": folderID})
	for _, docID := range docIDs {
		// Users who lost access remove the notes; the rest refresh them
		for _, uid := range audienceBefore {
			if !stillAllowed[uid] {
				s.wsHub.BroadcastToUser(uid, eventDocDeleted, map[string]string{"id": docID})
			}
		}
		s.broadcastDocToAuthorizedUsers(docID, eventDocUpdated)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// --- WORKSPACE TAGS & PAGES ---

func (s *Server) handleGetWorkspaceTags(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	tags, err := s.store.GetWorkspaceTags(userID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func (s *Server) handleGetTagDetails(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	tag := chi.URLParam(r, "tag")
	details, err := s.store.GetTagDetails(userID, tag)
	if err != nil {
		writeInternal(w, err)
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
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"tag":       tag,
		"content":   req.Content,
		"updatedAt": updatedAt,
	})
}
