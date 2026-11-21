package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Desktop mode (config.Desktop, set by the desktop app): the server runs inside the app for one person and
// only the app's own window reaches it, in-process, without any port. There is no sign-in and no setup
// wizard: the server creates the one account on the first start (prepareDesktopAccount) and the window asks
// for a session with POST /api/v1/auth/desktop whenever it has none. What needs other people or an address
// others can reach (registration, invites, mail, OIDC, passkeys, public links, web push, calendar feeds) is
// off; config.ApplyDesktop switches the settings, notInDesktop the routes, /auth/status tells the app.

// desktopMode: the server runs inside the desktop app.
func (s *Server) desktopMode() bool { return s.cfg.Desktop != nil }

// notInDesktop refuses a route that makes no sense in the desktop app (registration, invites, push …).
func (s *Server) notInDesktop(h http.HandlerFunc) http.HandlerFunc {
	if !s.desktopMode() {
		return h
	}
	return func(w http.ResponseWriter, r *http.Request) {
		writeErrorCode(w, http.StatusForbidden, "desktop_off", "In der Desktop-App nicht verfügbar")
	}
}

// desktopStatus: what /auth/status tells the app about desktop mode (nil on a normal server): the platform
// and the realtime transport the window must use (config.Desktop.Realtime).
func (s *Server) desktopStatus() map[string]string {
	if !s.desktopMode() {
		return nil
	}
	return map[string]string{"platform": s.cfg.Desktop.Platform, "realtime": s.cfg.Desktop.Realtime()}
}

// prepareDesktopAccount creates the one account of the desktop app on its first start: an administrator
// named after the system's user, without a password of its own (the app signs it in), with the MindSift help
// as notes. A database that already has an account (a later start, or a restored backup) stays as it is.
func (s *Server) prepareDesktopAccount() error {
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	count, err := s.store.CountUsers()
	if err != nil {
		return fmt.Errorf("counting the accounts: %w", err)
	}
	if count > 0 {
		return nil
	}
	hash, err := auth.NoPasswordHash()
	if err != nil {
		return err
	}
	d := s.cfg.Desktop
	username := desktopUsername(d.Username)
	name := strings.TrimSpace(d.DisplayName)
	if name == "" {
		name = username
	}
	user, err := s.store.CreateUserWithUsername("", username, hash, name, domain.RoleAdmin)
	if err != nil {
		return fmt.Errorf("creating the account: %w", err)
	}
	s.auditBy(storage.AuditActorSystem, storage.AuditSourceSystem, storage.AuditAccountCreated, auditUserTarget(user),
		map[string]string{"role": user.Role, "via": "desktop"})
	logFailed("Creating the help notes", s.store.SeedHelpNotes(user), "user_id", user.ID)
	// One person: nothing to share with anyone (the sharing options disappear); daily backups on, since no
	// administrator sets them up
	if sys, err := s.store.GetSystemSettings(); err == nil && sys != nil {
		sys.SharingMode = storage.SharingPrivate
		sys.RegistrationMode = storage.RegistrationClosed
		sys.BackupEnabled = true
		logFailed("Storing the desktop app's settings", s.store.UpdateSystemSettings(sys))
	}
	slog.Info("Desktop account created", "username", user.Username, "user_id", user.ID)
	return nil
}

// desktopUsername: the system's login name as a MindSift username (lower case; a Windows domain in front
// dropped), "me" when it does not fit the rules.
func desktopUsername(login string) string {
	if i := strings.LastIndexAny(login, `\/`); i >= 0 {
		login = login[i+1:]
	}
	u := strings.ToLower(strings.TrimSpace(login))
	if storage.ValidUsername(u) {
		return u
	}
	return "me"
}

// desktopAccount: the account the app signs in, the oldest administrator (the one the app created, unless
// a restored backup brought others; then the oldest of them), else the oldest account.
func (s *Server) desktopAccount() (*domain.User, error) {
	users, err := s.store.GetAllUsers()
	if err != nil {
		return nil, err
	}
	for i := range users {
		if users[i].Role == domain.RoleAdmin && users[i].IsActive {
			return &users[i], nil
		}
	}
	for i := range users {
		if users[i].IsActive {
			return &users[i], nil
		}
	}
	return nil, nil
}

// desktopOriginAllowed: the request comes from the app's own window. Nothing else can reach the router of
// the desktop app anyway (it listens on no port); this keeps a page of another origin that the window might
// show (a link opened in it) from asking for a session. Browsers send Origin with every POST from a page; a
// request without one is no page's and passes, Sec-Fetch-Site still has to say it is not cross-site.
func (s *Server) desktopOriginAllowed(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
		return false
	}
	origin := r.Header.Get("Origin")
	return origin == "" || strings.EqualFold(origin, s.cfg.Desktop.Origin)
}

// handleDesktopSession: POST /api/v1/auth/desktop, only in desktop mode. A session for the app's one
// account, answered like a sign-in ({token, user}). The app calls it when it has no session: at the first
// start, after the session ended (idle for a month) and after signing out, so it never shows a sign-in.
func (s *Server) handleDesktopSession(w http.ResponseWriter, r *http.Request) {
	if !s.desktopMode() {
		writeError(w, http.StatusNotFound, "Nicht gefunden")
		return
	}
	if !jsonContentType(r) {
		writeError(w, http.StatusUnsupportedMediaType, "Anfrage muss als JSON (Content-Type: application/json) gesendet werden")
		return
	}
	if !s.desktopOriginAllowed(r) {
		slog.Warn("Desktop session refused: request from another origin", "origin", r.Header.Get("Origin"), "site", r.Header.Get("Sec-Fetch-Site"))
		writeError(w, http.StatusForbidden, "Keine Berechtigung")
		return
	}
	user, err := s.desktopAccount()
	if err == nil && user == nil {
		// The account was removed (or a restored backup has none active): the app makes a new one
		if err = s.prepareDesktopAccount(); err == nil {
			user, err = s.desktopAccount()
		}
	}
	if err != nil || user == nil {
		if err == nil {
			err = fmt.Errorf("no active account")
		}
		writeInternal(w, err)
		return
	}
	token, err := s.startSession(r, user, storage.SessionViaDesktop)
	if err != nil {
		slog.Error("Creating the desktop session failed", "user_id", user.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "Token konnte nicht erstellt werden")
		return
	}
	slog.Info("Desktop session started", "user_id", user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}
