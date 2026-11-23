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
// only the app's own window reaches it, in-process, without any port. There is no sign-in and no first-boot
// wizard: the server creates the one account on the first start (prepareDesktopAccount) and the window asks
// for a session with POST /api/v1/auth/desktop whenever it has none. A short setup wizard without the
// account and the server's questions follows once (setup_pending, handleFinishSetup). What needs other people or an address
// others can reach (registration, invites, mail, OIDC, passkeys, public links, web push, calendar feeds) is
// off; config.ApplyDesktop switches the settings, capabilities.go decides what the instance offers (and
// requires refuses those routes), /auth/status tells the app.

// desktopMode: the server runs inside the desktop app.
func (s *Server) desktopMode() bool { return s.cfg.Desktop != nil }

// confirmsWithoutCredentials: sensitive changes (deleting the own data, a new API key …) need no password,
// provider sign-in or second factor. In the desktop app the person at the machine is the account: it has no
// password and no provider, and nothing signs in. The one place that decides it; the confirmations
// (confirmWithSecondFactor, confirmSecondFactor) ask here, and the app shows a plain confirmation instead.
func (s *Server) confirmsWithoutCredentials() bool { return !s.can(capSignIn) }

// notInDesktop refuses a route of the server's own shell that the desktop app replaces (the first-boot
// wizard); what depends on a capability uses requires (capabilities.go).
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
// named after the system's user, without a password of its own (the app signs it in), with the desktop
// app's short setup wizard still to come (setup_pending). A database that already has an account (a later
// start, or a restored backup) stays as it is.
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
	s.auditBy(storage.AuditActorSystem, storage.AuditSourceSystem, storage.AuditAccountCreated, storage.AuditUserTarget(user),
		map[string]string{"role": user.Role, "via": "desktop"})
	// One person: nothing to share with anyone (the sharing options disappear), no registration
	if sys, err := s.store.GetSystemSettings(); err == nil && sys != nil {
		sys.SharingMode = storage.SharingPrivate
		sys.RegistrationMode = storage.RegistrationClosed
		logFailed("Storing the desktop app's settings", s.store.UpdateSystemSettings(sys))
	}
	// The short setup wizard of the desktop app follows (FinishSetupView): language, time zone, name,
	// backups and the help notes, all with defaults that one click accepts (handleFinishSetup)
	logFailed("Marking the setup as unfinished", s.store.SetSetupPending(true), "user_id", user.ID)
	slog.Info("Desktop account created", "username", user.Username, "user_id", user.ID)
	return nil
}

// desktopAlarmDefaults: an instance of the desktop app whose account never saved its alarm settings
// alarms through the system's notifications (task alarms, and the daily summary once it is switched on)
// instead of the server defaults' mail, which the app cannot send. Settings saved once are left alone.
func (s *Server) desktopAlarmDefaults() error {
	u, err := s.desktopAccount()
	if err != nil || u == nil {
		return err
	}
	n := domain.DefaultNotificationSettings(nil)
	n.Events.Due = domain.ChannelChoice{Desktop: true}
	n.DailySummary.Email, n.DailySummary.Desktop = false, true
	if set, err := s.store.SetNotificationSettingsIfUnset(u.ID, n); err != nil || !set {
		return err
	}
	slog.Info("Desktop alarms set to the system's notifications", "user_id", u.ID)
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
// show (a link opened in it) from asking for a session. A foreign Origin or a cross-site Sec-Fetch-Site is
// refused; a request with neither passes: WebKitGTK sends neither to wails://, for the window's own fetch
// POSTs as for a foreign page's (checked under Xvfb, 2026-11-22), so their absence cannot be refused. What
// keeps a foreign page out there: the JSON content type it cannot send without a CORS preflight (which
// nothing here answers), and a foreign page can read no answer (no CORS), so a session it makes is of no use
// to it; WebView2 on Windows sends Origin as browsers do.
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
