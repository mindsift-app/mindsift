package api

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
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

const secretCipherPrefix = "v1:"

// sealSecret encrypts with AES-256-GCM; the secret's id is bound in as additional data, so a
// ciphertext copied into another row does not open.
func (s *Server) sealSecret(id, value string) (string, error) {
	gcm, err := s.secretAEAD()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(value), []byte(id))
	return secretCipherPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

func (s *Server) openSecret(id, ciphertext string) (string, error) {
	gcm, err := s.secretAEAD()
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ciphertext, secretCipherPrefix))
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("malformed ciphertext")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], []byte(id))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func (s *Server) secretAEAD() (cipher.AEAD, error) {
	block, err := aes.NewCipher(s.cfg.SecretsKey)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
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
		writeError(w, http.StatusInternalServerError, "Geheimnis konnte nicht gespeichert werden")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "ref": "{{secret:" + id + "}}"})
}

// secretFor looks up a secret as seen from the note {id} it is shown in. Its own note: whoever can see
// (or with write, edit) that note. Another note (the bullet was moved or pasted there): the bullet must
// be there and the person must also be allowed to see the note the secret belongs to, so copying a
// reference into one's own note reveals nothing. If the secret's note no longer holds it, it moves here.
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
	if errors.Is(err, storage.ErrSecretNotFound) {
		writeErrorCode(w, http.StatusNotFound, "secret_gone", storage.ErrSecretNotFound.Error())
		return nil, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Geheimnis konnte nicht gelesen werden")
		return nil, false
	}
	if sec.DocumentID != docID {
		if !s.store.DocReferencesSecret(docID, sec.ID) || s.store.DocRole(userID, sec.DocumentID) == "" {
			writeErrorCode(w, http.StatusNotFound, "secret_gone", storage.ErrSecretNotFound.Error())
			return nil, false
		}
		if storage.CanEditDoc(role) && !s.store.DocReferencesSecret(sec.DocumentID, sec.ID) {
			if err := s.store.MoveSecret(sec.ID, docID); err == nil {
				sec.DocumentID = docID
			}
		}
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
		writeErrorCode(w, http.StatusConflict, "secret_unreadable", "Geheimnis konnte nicht entschlüsselt werden")
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
		writeError(w, http.StatusInternalServerError, "Geheimnis konnte nicht gespeichert werden")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) runSecretSweep(now time.Time) {
	res, err := s.store.SweepSecrets(now)
	if err != nil {
		slog.Error("Cleaning up hidden values failed", "error", err)
		return
	}
	if res.Orphaned+res.Restored+res.Moved+res.Deleted > 0 {
		slog.Info("Hidden values cleaned up", "verwaist", res.Orphaned, "wieder_verwendet", res.Restored, "umgezogen", res.Moved, "geloescht", res.Deleted)
	}
}
