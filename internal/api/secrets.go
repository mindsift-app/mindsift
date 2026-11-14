package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Hidden values in notes (storage/secrets.go). The routes sit among the note routes, which API keys
// and MCP cannot reach (apikey_access.go), so only a login creates, reveals or changes a value.

const secretCipherPrefix = storage.SealedPrefix

// sealSecret encrypts with SECRETS_KEY (AES-256-GCM, storage/sealed.go); the secret's id is bound in as
// additional data, so a ciphertext copied into another row does not open.
func (s *Server) sealSecret(id, value string) (string, error) {
	return storage.SealValue(s.cfg.SecretsKey, id, value)
}

func (s *Server) openSecret(id, ciphertext string) (string, error) {
	return storage.OpenValue(s.cfg.SecretsKey, id, ciphertext)
}

func readSecretValue(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req struct {
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return "", false
	}
	if strings.TrimSpace(req.Value) == "" || len(req.Value) > storage.MaxSecretLength {
		writeError(w, http.StatusBadRequest, "Der Wert ist leer oder zu lang")
		return "", false
	}
	return req.Value, true
}

// handleCreateSecret: POST /documents/{id}/secrets {value} → {id, ref}; needs write access.
func (s *Server) handleCreateSecret(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	if !s.canEditDoc(userID, docID) {
		writeError(w, http.StatusForbidden, "Keine Schreibrechte für diese Notiz")
		return
	}
	value, ok := readSecretValue(w, r)
	if !ok {
		return
	}
	id := storage.NewSecretID()
	sealed, err := s.sealSecret(id, value)
	if err == nil {
		err = s.store.CreateSecret(id, docID, userID, sealed)
	}
	if err != nil {
		slog.Error("Storing a hidden value failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Versteckter Wert konnte nicht gespeichert werden")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "ref": "{{secret:" + id + "}}"})
}

// secretFor looks up a secret of the note {id}, for whoever can see that note (with write, whoever may
// edit it). A value belongs to exactly one note: a bullet copied or moved into another note has a copy
// of its own there (storage/secret_gate.go), so a reference to the value of another note reveals nothing.
func (s *Server) secretFor(w http.ResponseWriter, r *http.Request, write bool) (*storage.NoteSecret, bool) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	role := s.store.DocRole(userID, docID)
	if role == "" || (write && !storage.CanEditDoc(role)) {
		if role == "" {
			writeError(w, http.StatusNotFound, "Notiz nicht gefunden")
		} else {
			writeError(w, http.StatusForbidden, "Keine Schreibrechte für diese Notiz")
		}
		return nil, false
	}
	sec, err := s.store.GetSecret(chi.URLParam(r, "secretId"))
	if errors.Is(err, storage.ErrSecretNotFound) || (err == nil && sec.DocumentID != docID) {
		writeErrorCode(w, http.StatusNotFound, "secret_gone", storage.ErrSecretNotFound.Error())
		return nil, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Versteckter Wert konnte nicht gelesen werden")
		return nil, false
	}
	return sec, true
}

// handleRevealSecret: GET /documents/{id}/secrets/{secretId} → {value}
func (s *Server) handleRevealSecret(w http.ResponseWriter, r *http.Request) {
	sec, ok := s.secretFor(w, r, false)
	if !ok {
		return
	}
	value, err := s.openSecret(sec.ID, sec.Ciphertext)
	if err != nil {
		slog.Warn("A hidden value could not be decrypted (SECRETS_KEY or secrets.key changed?)", "id", sec.ID)
		writeErrorCode(w, http.StatusConflict, "secret_unreadable", "Versteckter Wert konnte nicht entschlüsselt werden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"value": value})
}

// handleUpdateSecret: PUT /documents/{id}/secrets/{secretId} {value}; needs write access.
func (s *Server) handleUpdateSecret(w http.ResponseWriter, r *http.Request) {
	sec, ok := s.secretFor(w, r, true)
	if !ok {
		return
	}
	value, ok := readSecretValue(w, r)
	if !ok {
		return
	}
	sealed, err := s.sealSecret(sec.ID, value)
	if err == nil {
		err = s.store.UpdateSecret(sec.ID, sealed)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Versteckter Wert konnte nicht gespeichert werden")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) runSecretSweep(now time.Time) {
	res, err := s.store.SweepSecrets(now)
	// Notes whose bullets got copies of their own: open editors fetch the change
	for _, docID := range res.Split.Notes {
		s.notifyDocChanged(docID, s.store.DocHead(docID))
	}
	if err != nil {
		slog.Error("Cleaning up hidden values failed", "error", err)
		return
	}
	if res.Split.Unreadable > 0 {
		slog.Warn("References to hidden values of other notes cannot be copied, their values do not decrypt (SECRETS_KEY or secrets.key changed?); they show nothing until the key is right again",
			"references", res.Split.Unreadable)
	}
	if res.Split.Copied+res.Split.Replaced+res.Orphaned+res.Restored+res.Deleted > 0 {
		slog.Info("Hidden values cleaned up", "copied", res.Split.Copied, "placeholders", res.Split.Replaced,
			"orphaned", res.Orphaned, "restored", res.Restored, "deleted", res.Deleted)
	}
}
