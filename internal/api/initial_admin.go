package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"strings"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The first administrator from the environment: ADMIN_USER and ADMIN_PASSWORD (or ADMIN_PASSWORD_FILE for
// a Docker secret; ADMIN_EMAIL optional) create the account on the first start, before the server listens, so a fresh instance is never open to
// whoever comes first. They only act while there is no account; afterwards they are ignored. The
// wizard's other questions (language, registration, sharing …) follow after the admin's first sign-in
// (setup_pending, handleFinishSetup).

// CreateInitialAdmin creates the first administrator from ADMIN_USER / ADMIN_PASSWORD / ADMIN_EMAIL when
// they are set and the database has no account yet. An error means the variables are set but cannot be
// used (missing, too short, invalid): the caller stops the server, since starting anyway would leave the
// first-boot setup open to the first visitor, which the variables are there to prevent. The password
// never appears in the log or in the error.
func (s *Server) CreateInitialAdmin() error {
	a := s.cfg.InitialAdmin
	// The password is not needed any longer than this
	defer func() { s.cfg.InitialAdmin.Password = "" }()
	if !a.Set() {
		return nil
	}
	if s.cfg.DemoMode {
		slog.Warn("ADMIN_USER / ADMIN_PASSWORD / ADMIN_EMAIL are ignored in demo mode: the demo has its own accounts (admin/admin, user/user)")
		return nil
	}

	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	count, err := s.store.CountUsers()
	if err != nil {
		return fmt.Errorf("counting the accounts: %w", err)
	}
	if count > 0 {
		slog.Info("ADMIN_USER / ADMIN_PASSWORD are set, but accounts already exist: ignored (they only act on the first start and can be removed)")
		return nil
	}

	// ADMIN_PASSWORD_FILE is read only now, when the account is really created
	password, err := a.ResolvePassword()
	if err != nil {
		return err
	}
	username, email, err := checkInitialAdmin(a.User, password, a.Email)
	if err != nil {
		return err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("hashing ADMIN_PASSWORD: %w", err)
	}
	user, err := s.store.CreateUserWithUsername(email, username, hash, a.User, domain.RoleAdmin)
	if err != nil {
		return fmt.Errorf("creating the account: %w", err)
	}
	// The wizard's other questions come after the first sign-in
	if err := s.store.SetSetupPending(true); err != nil {
		logFailed("Marking the setup as unfinished", err, "user_id", user.ID)
	}

	attrs := []any{"username", user.Username, "user_id", user.ID}
	if email != "" {
		attrs = append(attrs, "email", email)
	}
	slog.Info("First administrator created from ADMIN_USER / ADMIN_PASSWORD; the variables are ignored from now on and can be removed", attrs...)
	if email == "" {
		slog.Info("No ADMIN_EMAIL: the administrator signs in with the username; add and confirm an email address in the profile for password reset and mail notifications")
	}
	return nil
}

// checkInitialAdmin applies the setup wizard's rules to the variables: both name and password, a valid
// username (lower case is made lower case), the wizard's password rule, a bare email address if any. The
// messages name the variable and never contain the password.
func checkInitialAdmin(user, password, email string) (username, cleanEmail string, err error) {
	if user == "" || strings.TrimSpace(password) == "" {
		missing := "ADMIN_USER"
		if user != "" {
			missing = "ADMIN_PASSWORD"
		}
		return "", "", fmt.Errorf("%s is not set: ADMIN_USER and ADMIN_PASSWORD go together (ADMIN_EMAIL is optional)", missing)
	}
	username = strings.ToLower(user)
	if !storage.ValidUsername(username) {
		return "", "", errors.New("ADMIN_USER is not a valid username: 2 to 32 characters, lower case letters, digits, dot, dash and underscore, starting and ending with a letter or digit (put an email address into ADMIN_EMAIL)")
	}
	switch err := auth.ValidatePassword(password); {
	case errors.Is(err, auth.ErrPasswordTooShort):
		return "", "", fmt.Errorf("ADMIN_PASSWORD is too short: at least %d characters, not only spaces", auth.MinPasswordLength)
	case errors.Is(err, auth.ErrPasswordTooLong):
		return "", "", errors.New("ADMIN_PASSWORD is too long: at most 72 bytes")
	case err != nil:
		return "", "", errors.New("ADMIN_PASSWORD is not accepted")
	}
	if email != "" {
		cleanEmail = domain.NormalizeEmail(email)
		if !validEmail(cleanEmail) {
			return "", "", errors.New("ADMIN_EMAIL is not a valid email address (a bare address such as admin@example.com)")
		}
	}
	return username, cleanEmail, nil
}

// handleFinishSetup: POST /admin/setup – the wizard's instance settings for an administrator who came from
// ADMIN_USER. Only once, while the setup is unfinished; afterwards the admin settings change them.
func (s *Server) handleFinishSetup(w http.ResponseWriter, r *http.Request) {
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	if !s.store.SetupPending() {
		writeError(w, http.StatusConflict, "Ersteinrichtung wurde bereits abgeschlossen")
		return
	}
	var req setupChoices
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	if err := req.check(); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	user, err := s.store.GetUserByID(auth.GetUserID(r.Context()))
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}
	if err := s.applySetupChoices(r, user, req); err != nil {
		writeError(w, http.StatusInternalServerError, "Einstellungen konnten nicht gespeichert werden: "+clientMessage(err))
		return
	}
	if err := s.store.SetSetupPending(false); err != nil {
		writeInternal(w, err)
		return
	}
	slog.Info("Setup finished by the administrator from ADMIN_USER", "user_id", user.ID)
	writeJSON(w, http.StatusOK, map[string]bool{"done": true})
}

// jsonContentType: the request says its body is JSON (application/json, parameters such as charset allowed).
func jsonContentType(r *http.Request) bool {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mt == "application/json"
}
