package api

import (
	"errors"
	"net/http"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// errDocReadOnly: the user sees the note but may not change it (shared for reading, or in the trash)
var errDocReadOnly = errors.New("Keine Schreibrechte für diese Notiz (nur Lesen oder im Papierkorb)")

// docWritable is the one check that the user may change the note docID: storage.ErrDocNotFound when they
// cannot see it (someone else's and a missing note are the same), errDocReadOnly when they may only read it.
func (s *Server) docWritable(userID, docID string) error {
	role := s.store.DocRole(userID, docID)
	if role == "" {
		return storage.ErrDocNotFound
	}
	if !storage.CanEditDoc(role) {
		return errDocReadOnly
	}
	return nil
}

// requireDocEdit checks a request that changes the note docID: 404 without access, 403 with read access
// only (docWritable); it answers and returns false then.
func (s *Server) requireDocEdit(w http.ResponseWriter, r *http.Request, docID string) (userID string, ok bool) {
	userID = auth.GetUserID(r.Context())
	return userID, answerDocWritable(w, s.docWritable(userID, docID))
}

// targetDocEditable is requireDocEdit for the second note of a request (the target of a move or merge).
func (s *Server) targetDocEditable(w http.ResponseWriter, userID, docID string) bool {
	err := s.docWritable(userID, docID)
	if errors.Is(err, errDocReadOnly) {
		err = errTargetReadOnly
	}
	return answerDocWritable(w, err)
}

var errTargetReadOnly = errors.New("Keine Schreibrechte für die Zielnotiz")

// answerDocWritable answers a refusal of docWritable (403 read only, else 404) and reports whether there was none.
func answerDocWritable(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, errDocReadOnly), errors.Is(err, errTargetReadOnly):
		writeErrorFrom(w, http.StatusForbidden, err)
	default:
		writeErrorFrom(w, http.StatusNotFound, err)
	}
	return false
}
