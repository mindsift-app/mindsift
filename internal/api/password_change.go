package api

import (
	"net/http"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// A new password at the next sign-in. When the administration resets a password and asks for it (admin API
// with mustChange, `mindsift reset-password --must-change`), the account's password sessions reach nothing
// but choosing an own password (POST /auth/password), reading themselves and signing out, like the required
// second factor (mfa.go). The new password clears the request (storage.UpdateUserPassword), as does a
// password set through the mail link.
//
// API keys and OAuth grants (MCP) keep working meanwhile: they do not sign in with the password, and a
// person who forgot the password should not find their scripts and AI clients broken. If the reset is
// about a leaked account, the administration revokes them in the same step (revokeKeys, --revoke-keys).
// Sessions from the OIDC provider are not held up either: they did not use the password.

// passwordChangeMissingFor: the account's session sessionID has to choose a new password first. Never in the
// demo, whose accounts everybody shares.
func (s *Server) passwordChangeMissingFor(user *domain.User, sessionID string) bool {
	return !s.cfg.DemoMode && user.MustChangePassword && s.store.SessionVia(sessionID) != storage.SessionViaOIDC
}

// passwordChangeRefused answers 403 password_change_required while passwordChangeMissingFor. For every
// place that takes a session token, as mfaSetupRefused; never for API keys.
func (s *Server) passwordChangeRefused(w http.ResponseWriter, user *domain.User, sessionID string) bool {
	if !s.passwordChangeMissingFor(user, sessionID) {
		return false
	}
	writeErrorCode(w, http.StatusForbidden, "password_change_required", "Bitte lege zuerst ein neues Passwort fest")
	return true
}

// sessionRestricted: a session that still has to choose a new password or set up the required second factor
// gets nothing but those steps (streams and webhook deliveries included). The password comes first.
func (s *Server) sessionRestricted(w http.ResponseWriter, user *domain.User, sessionID string) bool {
	return s.passwordChangeRefused(w, user, sessionID) || s.mfaSetupRefused(w, user, sessionID)
}

// passwordChangePath: what a session may do while it has to choose a new password.
func passwordChangePath(path string) bool {
	switch path {
	case "/api/v1/auth/me", "/api/v1/auth/logout", ownPasswordPath:
		return true
	}
	return false
}

const ownPasswordPath = "/api/v1/auth/password"

// handleChangeOwnPassword: POST /auth/password {currentPassword, password, code | passkeyToken+passkey} sets a
// new own password. The current one is always asked for; the second factor only when the administration
// did not ask for the change (the session signed in with it a moment ago). The new one has to differ from
// the current one. Other sessions are signed out, this one goes on with a fresh token.
func (s *Server) handleChangeOwnPassword(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		Password        string `json:"password"`
		secondFactor
	}
	if !decodeJSONLimit(w, r, 1<<16, &req) {
		return
	}
	if s.cfg.DemoMode {
		writeError(w, http.StatusForbidden, "In der Demo deaktiviert")
		return
	}
	if !s.passwordLoginFor(user) {
		s.writePasswordLoginOff(w)
		return
	}
	if user.MustChangePassword {
		if !s.checkCurrentPassword(w, r, user, req.CurrentPassword) {
			return
		}
	} else if !s.confirmWithSecondFactor(w, r, user, req.CurrentPassword, req.secondFactor) {
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	if auth.CheckPassword(req.Password, user.PasswordHash) {
		writeErrorCode(w, http.StatusBadRequest, "password_unchanged", "Das neue Passwort muss sich vom bisherigen unterscheiden")
		return
	}
	if !s.setOwnPassword(w, r, user.ID, req.Password) {
		return
	}
	s.notifyAccountChange(user, true, false, "")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// setOwnPassword stores a new password the person chose (POST /auth/password, PATCH /auth/settings): every
// other device is signed out, this one keeps its session with a fresh token. Writes the error itself.
func (s *Server) setOwnPassword(w http.ResponseWriter, r *http.Request, userID, password string) bool {
	hash, err := auth.HashPassword(password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Hashen des Passworts")
		return false
	}
	if err := s.store.UpdateUserPassword(userID, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "Passwort konnte nicht gespeichert werden")
		return false
	}
	sid := sessionIDFrom(r)
	if err := s.store.RevokeOtherSessions(userID, sid); err != nil {
		writeError(w, http.StatusInternalServerError, "Andere Sitzungen konnten nicht beendet werden")
		return false
	}
	s.wsHub.DisconnectUser(userID)
	s.auditOwn(r, storage.AuditAccountPasswordChanged, nil)
	if fresh, err := s.store.GetUserByID(userID); err == nil {
		current := &auth.Claims{}
		current.ID = sid
		s.renewSessionToken(w, fresh, current, true)
	}
	return true
}
