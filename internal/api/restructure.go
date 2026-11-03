package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Turning a branch into its own note and merging notes (storage/restructure.go). The editor sends its
// client ID, so its own block leases do not block the change.

func (s *Server) restructureActor(r *http.Request, clientID string) collab.Actor {
	userID := auth.GetUserID(r.Context())
	a := collab.Actor{UserID: userID, ClientID: clientID}
	if u, err := s.store.GetUserByID(userID); err == nil {
		a.Name = u.DisplayName
	}
	return a
}

func restructureStatus(err error) int {
	var stillLinked *storage.StillLinkedError
	switch {
	case errors.Is(err, storage.ErrBranchLocked), errors.As(err, &stillLinked):
		return http.StatusConflict
	case errors.Is(err, storage.ErrBlockNotFound), errors.Is(err, storage.ErrDocNotFound), errors.Is(err, storage.ErrLinkedMissing):
		return http.StatusNotFound
	case errors.Is(err, storage.ErrMergeSelf), errors.Is(err, storage.ErrDocInTrash), errors.Is(err, storage.ErrAlreadyNote),
		errors.Is(err, storage.ErrNotNoteLink):
		return http.StatusBadRequest
	case errors.Is(err, storage.ErrMergeNotOwner), errors.Is(err, storage.ErrInlineOwner):
		return http.StatusForbidden
	}
	return http.StatusInternalServerError
}

// handleExtractBranch: POST /documents/{id}/extract {blockId, clientId}
func (s *Server) handleExtractBranch(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	if !storage.CanEditDoc(s.store.DocRole(userID, docID)) {
		writeError(w, http.StatusForbidden, "Keine Schreibrechte für diese Notiz")
		return
	}
	var req struct {
		BlockID  string `json:"blockId"`
		ClientID string `json:"clientId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.BlockID == "" {
		writeError(w, http.StatusBadRequest, "blockId fehlt")
		return
	}
	created, link, err := s.store.ExtractBranch(userID, docID, req.BlockID, s.restructureActor(r, req.ClientID), s.leases.View(docID))
	if err != nil {
		writeError(w, restructureStatus(err), trErr(w, err))
		return
	}
	if full, err := s.store.GetDocumentByID(userID, created.ID); err == nil {
		created = full
	}
	s.broadcastDocToAuthorizedUsers(created.ID, "DOC_CREATED")
	writeJSON(w, http.StatusCreated, map[string]interface{}{"document": created, "link": link})
}

// handleUndoExtract: POST /documents/{id}/extract/undo puts the extracted note {id} into the trash.
func (s *Server) handleUndoExtract(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	users, _ := s.store.GetAuthorizedDocUsers(docID)
	if err := s.store.UndoExtract(userID, docID); err != nil {
		writeError(w, restructureStatus(err), trErr(w, err))
		return
	}
	for _, uid := range users {
		s.wsHub.BroadcastToUser(uid, "DOC_DELETED", map[string]string{"id": docID})
	}
	writeJSON(w, http.StatusOK, map[string]bool{"undone": true})
}

// handleInlineNote: POST /documents/{id}/inline {blockId} – the way back from extracting: returns the
// linked note's blocks for the bullet and puts that note into the trash (undo: POST /documents/{note}/restore).
func (s *Server) handleInlineNote(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	if !storage.CanEditDoc(s.store.DocRole(userID, docID)) {
		writeError(w, http.StatusForbidden, "Keine Schreibrechte für diese Notiz")
		return
	}
	var req struct {
		BlockID string `json:"blockId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.BlockID == "" {
		writeError(w, http.StatusBadRequest, "blockId fehlt")
		return
	}
	res, err := s.store.InlineNote(userID, docID, req.BlockID)
	if err != nil {
		writeError(w, restructureStatus(err), trErr(w, err))
		return
	}
	users, _ := s.store.GetAuthorizedDocUsers(res.SourceID)
	for _, uid := range users {
		s.wsHub.BroadcastToUser(uid, "DOC_DELETED", map[string]string{"id": res.SourceID})
	}
	writeJSON(w, http.StatusOK, res)
}

// handleMergeDocuments: POST /documents/{id}/merge {sourceId, clientId} appends the source to this note.
func (s *Server) handleMergeDocuments(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	targetID := chi.URLParam(r, "id")
	if !storage.CanEditDoc(s.store.DocRole(userID, targetID)) {
		writeError(w, http.StatusForbidden, "Keine Schreibrechte für die Zielnotiz")
		return
	}
	var req struct {
		SourceID string `json:"sourceId"`
		ClientID string `json:"clientId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SourceID == "" {
		writeError(w, http.StatusBadRequest, "sourceId fehlt")
		return
	}
	sourceUsers, _ := s.store.GetAuthorizedDocUsers(req.SourceID)
	res, err := s.store.MergeDocuments(userID, req.SourceID, targetID, s.restructureActor(r, req.ClientID), s.leases.View(targetID))
	if err != nil {
		writeError(w, restructureStatus(err), trErr(w, err))
		return
	}
	s.notifyDocChanged(targetID, s.store.DocHead(targetID))
	for _, uid := range sourceUsers {
		s.wsHub.BroadcastToUser(uid, "DOC_DELETED", map[string]string{"id": req.SourceID})
	}
	writeJSON(w, http.StatusOK, res)
}

// handleUndoMerge: POST /documents/{id}/merge/undo {sourceId, headingId, clientId}
func (s *Server) handleUndoMerge(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	targetID := chi.URLParam(r, "id")
	if !storage.CanEditDoc(s.store.DocRole(userID, targetID)) {
		writeError(w, http.StatusForbidden, "Keine Schreibrechte für die Zielnotiz")
		return
	}
	var req struct {
		SourceID  string `json:"sourceId"`
		HeadingID string `json:"headingId"`
		ClientID  string `json:"clientId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SourceID == "" || req.HeadingID == "" {
		writeError(w, http.StatusBadRequest, "sourceId und headingId fehlen")
		return
	}
	m := storage.MergeResult{TargetID: targetID, SourceID: req.SourceID, HeadingID: req.HeadingID}
	if err := s.store.UndoMerge(userID, m, s.restructureActor(r, req.ClientID), s.leases.View(targetID)); err != nil {
		writeError(w, restructureStatus(err), trErr(w, err))
		return
	}
	s.notifyDocChanged(targetID, s.store.DocHead(targetID))
	s.broadcastDocToAuthorizedUsers(req.SourceID, "DOC_CREATED")
	writeJSON(w, http.StatusOK, map[string]bool{"undone": true})
}
