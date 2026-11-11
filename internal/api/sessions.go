package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Sessions (FLAW-31): a login creates a server-side session (device, address, last use) whose ID is
// the token's JWT ID. Requests renew the token once a day through the X-Session-Token response
// header, so active devices stay logged in while idle sessions end after 30 days.

const tokenRenewAfter = 24 * time.Hour

type sessionIDKey struct{}

func sessionIDFrom(r *http.Request) string {
	id, _ := r.Context().Value(sessionIDKey{}).(string)
	return id
}

// startSession creates the session for a fresh login and returns its token.
func (s *Server) startSession(r *http.Request, user *domain.User) (string, error) {
	sid, err := s.store.CreateSession(user.ID, r.UserAgent(), clientIPFrom(r).ip)
	if err != nil {
		return "", err
	}
	return auth.GenerateToken(s.cfg.JWTSecret, user.ID, user.Email, user.DisplayName, user.TokenVersion, sid)
}

// renewSessionToken sends a fresh token for the current session when the presented one is old (or
// right away when force is set, e.g. after the own password changed).
func (s *Server) renewSessionToken(w http.ResponseWriter, user *domain.User, claims *auth.Claims, force bool) {
	if claims == nil || claims.ID == "" {
		return
	}
	if !force && claims.IssuedAt != nil && time.Since(claims.IssuedAt.Time) < tokenRenewAfter {
		return
	}
	if token, err := auth.GenerateToken(s.cfg.JWTSecret, user.ID, user.Email, user.DisplayName, user.TokenVersion, claims.ID); err == nil {
		w.Header().Set("X-Session-Token", token)
	}
}

func withSession(ctx context.Context, sessionID string) context.Context {
	return context.WithValue(ctx, sessionIDKey{}, sessionID)
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListSessions(auth.GetUserID(r.Context()), sessionIDFrom(r))
	if err != nil {
		writeInternal(w, err)
		return
	}
	if s.cfg.DemoMode {
		// Demo visitors share the accounts; the others' devices and addresses are none of their business
		own := list[:0]
		for _, sess := range list {
			if sess.Current {
				own = append(own, sess)
			}
		}
		list = own
	}
	writeJSON(w, http.StatusOK, list)
}

// handleEndSession logs out one device.
func (s *Server) handleEndSession(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	if err := s.store.RevokeSession(userID, chi.URLParam(r, "id")); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, storage.ErrSessionNotFound) {
			status = http.StatusNotFound
		}
		writeErrorFrom(w, status, err)
		return
	}
	// That device's streams end; the others reconnect with their still valid sessions
	s.wsHub.DisconnectUser(userID)
	writeJSON(w, http.StatusOK, map[string]bool{"ended": true})
}
