package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- HANDLERS ---

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"service": "mindsift",
		"time":    domain.NowISO(),
	})
}

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	count, _ := s.store.CountUsers()
	sys, _ := s.store.GetSystemSettings()
	policy := s.registrationPolicy()
	instanceName := "MindSift"
	if sys != nil {
		if sys.InstanceName != "" {
			instanceName = sys.InstanceName
		}
	}
	status := map[string]interface{}{
		"needsSetup": count == 0,
		// Registering without an invite: allowed at all, how (closed | approval | domain | domain+approval |
		// open) and for which e-mail domains (shown as a hint on the sign-up form)
		"allowRegistration":   policy.Mode != storage.RegistrationClosed,
		"registrationMode":    policy.Mode,
		"registrationDomains": policy.Domains,
		"emailVerification":   policy.VerifyEmail,
		"instanceName":        instanceName,
		"demoMode":            s.cfg.DemoMode,
		"sharingMode":         s.store.SharingMode(),
		"passwordReset":       s.passwordResetAvailable(),
		// AI agents may connect over MCP (MCP_ENABLED or the admin's switch)
		"mcpEnabled": s.mcpEnabled(),
		// Sharing: names suggested while typing, notes shareable by public link (and for how long at most)
		"peopleSearch":      s.peopleSearchEnabled(),
		"publicLinks":       s.publicLinksEnabled(),
		"publicLinkMaxDays": s.publicLinkMaxDays(),
		// Language of the login screen when MindSift does not speak the browser's language
		"defaultLanguage": s.defaultLanguage(),
		// Address to enter as connector in claude.ai / ChatGPT (OAuth); empty while OAuth is off
		"mcpConnectorUrl": func() string {
			if s.oauthEnabled() {
				return s.oauthResource()
			}
			return ""
		}(),
		// How voice input works: "server" (own Whisper), "browser" or "off"; set by STT_* only
		// browserAllowed: whether people may pick the browser's recognition instead of the Whisper server
		"voice": map[string]interface{}{"mode": s.voiceMode(), "maxSeconds": s.cfg.Speech.MaxSeconds, "browserAllowed": !s.cfg.Speech.NoBrowser},
		// Public so the login screen can link Impressum and Datenschutz
		"legal": map[string]interface{}{
			"imprintUrl":        s.cfg.Legal.ImprintURL,
			"hasImprintContent": s.cfg.Legal.ImprintContent != "",
			"privacyUrl":        s.cfg.Legal.PrivacyURL,
			"hasPrivacyContent": s.cfg.Legal.PrivacyContent != "",
			"customLinkLabel":   s.cfg.Legal.CustomLinkLabel,
			"customLinkUrl":     s.cfg.Legal.CustomLinkURL,
		},
	}
	// Countdown to the next demo reset; seconds as well, so client clocks do not matter
	if next := s.demoNextReset(); !next.IsZero() {
		status["demoNextReset"] = next.UTC().Format(time.RFC3339)
		status["demoResetInSeconds"] = int(time.Until(next).Seconds())
		status["demoResetMinutes"] = s.cfg.DemoResetMinutes
	}
	writeJSON(w, http.StatusOK, status)
}

// handleLegalText serves the configured Markdown of the imprint or privacy notice (public, no login).
func (s *Server) handleLegalText(w http.ResponseWriter, r *http.Request) {
	content := ""
	switch chi.URLParam(r, "type") {
	case "imprint":
		content = s.cfg.Legal.ImprintContent
	case "privacy":
		content = s.cfg.Legal.PrivacyContent
	}
	if content == "" {
		writeError(w, http.StatusNotFound, "Kein Text hinterlegt")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": content})
}

func (s *Server) handleFirstBootSetup(w http.ResponseWriter, r *http.Request) {
	count, err := s.store.CountUsers()
	if err != nil || count > 0 {
		writeError(w, http.StatusForbidden, "Ersteinrichtung wurde bereits abgeschlossen")
		return
	}

	var req struct {
		Email             string `json:"email"`
		Password          string `json:"password"`
		DisplayName       string `json:"displayName"`
		InstanceName      string `json:"instanceName"`
		AllowRegistration bool   `json:"allowRegistration"`
		SharingMode       string `json:"sharingMode"`
		CreateSampleData  bool   `json:"createSampleData"`
		DefaultLanguage   string `json:"defaultLanguage"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	if req.DefaultLanguage != "" && !i18n.Valid(req.DefaultLanguage) {
		writeError(w, http.StatusBadRequest, "Diese Sprache gibt es nicht")
		return
	}
	if strings.TrimSpace(req.Email) == "" {
		writeError(w, http.StatusBadRequest, "E-Mail-Adresse erforderlich")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.DisplayName) == "" {
		req.DisplayName = "Administrator"
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Passwort-Hashing")
		return
	}

	user, err := s.store.CreateUser(req.Email, hash, req.DisplayName, "admin")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// The language chosen in the wizard becomes the server's default and the admin's own
	lang := req.DefaultLanguage
	if lang == "" {
		lang = s.requestLanguage(r)
	}
	_ = s.store.SetLanguage(user.ID, lang)

	sys, _ := s.store.GetSystemSettings()
	if sys != nil {
		sys.DefaultLanguage = req.DefaultLanguage
		if strings.TrimSpace(req.InstanceName) != "" {
			sys.InstanceName = strings.TrimSpace(req.InstanceName)
		}
		sys.AllowRegistration = req.AllowRegistration
		sys.RegistrationMode = storage.RegistrationClosed
		if req.AllowRegistration {
			sys.RegistrationMode = storage.RegistrationOpen
		}
		sys.SharingMode = storage.NormalizeSharingMode(req.SharingMode)
		if err := s.store.UpdateSystemSettings(sys); err != nil {
			writeError(w, http.StatusInternalServerError, "Einstellungen konnten nicht gespeichert werden: "+err.Error())
			return
		}
		// In organization mode the first admin starts in an organization named after the instance
		if sys.SharingMode == storage.SharingOrganizations {
			if org, err := s.store.CreateOrganization(sys.InstanceName); err == nil {
				_ = s.store.AddOrganizationMember(org.ID, user.ID)
			}
		}
	}

	if req.CreateSampleData {
		_ = s.store.SeedStarterContent(user)
	}

	token, err := s.startSession(r, user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Token konnte nicht erstellt werden")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"token": token,
		"user":  user,
	})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
		InviteCode  string `json:"inviteCode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	if wait := s.loginGuard.throttle("register", clientIPFrom(r), limitRegisterPerIP); wait > 0 {
		writeThrottled(w, wait)
		return
	}
	req.Email = domain.NormalizeEmail(req.Email)
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "E-Mail-Adresse erforderlich")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.DisplayName) == "" {
		req.DisplayName = strings.Split(req.Email, "@")[0]
	}

	count, _ := s.store.CountUsers()
	role := "member"
	var validInvite *domain.UserInvite
	pending := false // registered without invite while approval is needed
	verify := false  // registered without invite while the address must be confirmed

	if strings.TrimSpace(req.InviteCode) != "" {
		inv, err := s.store.GetUserInviteByCode(req.InviteCode)
		if err != nil {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}
		if inv.Email != "" && domain.NormalizeEmail(inv.Email) != req.Email {
			// The bound address half hidden, so the person sees which one is meant
			writeError(w, http.StatusForbidden, tr(w, "Dieser Einladungscode ist an {email} gebunden", "email", maskEmail(inv.Email)))
			return
		}
		validInvite = inv
		role = domain.RoleMember // invites never make admins (older codes may still say so)
	} else if count == 0 {
		role = "admin"
	} else {
		policy := s.registrationPolicy()
		var err error
		pending, err = policy.registrationOutcome(req.Email)
		verify = policy.VerifyEmail
		if err != nil {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}
		if pending && len(s.store.PendingRegistrationIDs()) >= storage.MaxPendingRegistrations {
			writeError(w, http.StatusTooManyRequests, "Gerade warten zu viele Registrierungen auf Freigabe – bitte später erneut versuchen")
			return
		}
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Fehler beim Passwort-Hashing")
		return
	}

	// The invite is claimed before the account exists, so it cannot be redeemed twice at once
	var claim string
	if validInvite != nil {
		if claim, err = s.store.ClaimUserInvite(validInvite.ID); err != nil {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}
	}

	user, err := s.store.CreateUser(req.Email, hash, req.DisplayName, role)
	if err != nil {
		if validInvite != nil {
			s.store.ReleaseUserInvite(validInvite.ID, claim)
		}
		writeError(w, http.StatusConflict, "E-Mail-Adresse existiert bereits")
		return
	}
	_ = s.store.SetLanguage(user.ID, s.requestLanguage(r))

	if validInvite != nil {
		if err := s.store.FinishUserInvite(validInvite.ID, claim, user.ID); err != nil {
			slog.Error("Marking the invite code as used failed", "invite", validInvite.ID, "error", err)
		}
		for _, orgID := range validInvite.OrganizationIDs {
			_ = s.store.AddOrganizationMember(orgID, user.ID)
		}
	}

	// Waiting for the e-mail confirmation and/or approval: the account exists but stays locked, no session
	if pending || verify {
		inactive := false
		if _, err := s.store.UpdateUser(user.ID, nil, nil, nil, &inactive, nil, nil); err != nil {
			writeError(w, http.StatusInternalServerError, "Konto konnte nicht angelegt werden")
			return
		}
		if pending {
			if err := s.store.AddPendingRegistration(user.ID); err != nil {
				writeError(w, http.StatusInternalServerError, "Konto konnte nicht angelegt werden")
				return
			}
		}
		message := tr(w, "Dein Konto wurde angelegt und wartet auf die Freigabe durch einen Administrator. Du bekommst eine E-Mail, sobald du dich anmelden kannst.")
		if verify {
			// Admins hear about it only once the address is confirmed
			go s.sendVerificationMail(user)
			message = tr(w, "Fast geschafft: Wir haben dir eine E-Mail an {email} geschickt. Bestätige deine Adresse über den Link darin.", "email", user.Email)
			if pending {
				message += " " + tr(w, "Danach schaltet ein Administrator dein Konto frei.")
			}
		} else {
			go s.notifyAdminsOfRegistration(user)
		}
		slog.Info("Registration waiting", "user_id", user.ID, "email", user.Email, "approval", pending, "verify", verify)
		writeJSON(w, http.StatusAccepted, map[string]interface{}{
			"pending": true,
			"verify":  verify,
			"message": message,
		})
		return
	}

	token, err := s.startSession(r, user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Token konnte nicht erstellt werden")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"token": token,
		"user":  user,
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}

	identifier := strings.TrimSpace(req.Login)
	if identifier == "" {
		identifier = strings.TrimSpace(req.Username)
	}
	if identifier == "" {
		identifier = strings.TrimSpace(req.Email)
	}

	if identifier == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "Benutzername/E-Mail und Passwort erforderlich")
		return
	}

	user, err := s.store.GetUserByLogin(identifier)
	// Unknown names are counted under the typed login, so locking looks the same as for real accounts
	account := "login:" + strings.ToLower(identifier)
	if err == nil {
		account = user.ID
	}
	ip := clientIPFrom(r)
	if wait := s.loginGuard.lockedFor(account, ip); wait > 0 {
		slog.Warn("Sign-in locked after failed attempts", "login", identifier, "remote_addr", r.RemoteAddr, "wait", wait.Round(time.Second))
		writeLoginLocked(w, wait)
		return
	}
	if err != nil {
		s.loginGuard.recordFailure(account, ip)
		slog.Warn("Sign-in failed: user does not exist", "login", identifier, "remote_addr", r.RemoteAddr)
		writeError(w, http.StatusUnauthorized, "Benutzername/E-Mail oder Passwort ungültig")
		return
	}
	if !auth.CheckPassword(req.Password, user.PasswordHash) {
		s.loginGuard.recordFailure(account, ip)
		slog.Warn("Sign-in failed: wrong password", "login", identifier, "user_id", user.ID, "display_name", user.DisplayName, "remote_addr", r.RemoteAddr)
		writeError(w, http.StatusUnauthorized, "Benutzername/E-Mail oder Passwort ungültig")
		return
	}
	s.loginGuard.recordSuccess(account, ip)
	if !user.IsActive && s.store.IsEmailUnverified(user.ID) {
		writeErrorCode(w, http.StatusForbidden, "email_unverified", "Bitte bestätige zuerst deine E-Mail-Adresse über den Link, den wir dir geschickt haben")
		return
	}
	if !user.IsActive && s.store.IsPendingRegistration(user.ID) {
		writeError(w, http.StatusForbidden, "Dein Konto wartet noch auf die Freigabe durch einen Administrator")
		return
	}
	if !user.IsActive {
		slog.Warn("Sign-in refused: user account is disabled", "login", identifier, "user_id", user.ID, "display_name", user.DisplayName, "remote_addr", r.RemoteAddr)
		writeError(w, http.StatusForbidden, "Dieses Benutzerkonto ist deaktiviert")
		return
	}

	token, err := s.startSession(r, user)
	if err != nil {
		slog.Error("Creating the sign-in token failed", "login", identifier, "user_id", user.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "Token konnte nicht erstellt werden")
		return
	}

	slog.Info("Sign-in successful", "login", identifier, "user_id", user.ID, "display_name", user.DisplayName, "role", user.Role, "remote_addr", r.RemoteAddr)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"user":  user,
	})
}

func (s *Server) handleQuickStart(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusForbidden, "Automatischer Gast-Login ist deaktiviert – bitte anmelden")
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	user, err := s.store.GetUserByID(userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}
	stats, _ := s.store.GetDashboardStats(userID)
	ns := s.store.NotificationSettingsOf(userID)
	user.NotificationSettings = &ns
	s.fillUserPreferences(user)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user":  user,
		"stats": stats,
		// The settings disable "Delete account" for the last administrator
		"isLastAdmin": s.store.IsLastAdmin(userID),
	})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	stats, err := s.store.GetDashboardStats(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// handlePurgeOwnData deletes all notes, tasks, thoughts and lists of the caller; the account stays.
func (s *Server) handlePurgeOwnData(w http.ResponseWriter, r *http.Request) {
	user, ok := s.confirmPassword(w, r)
	if !ok {
		return
	}
	if err := s.store.PurgeUserData(user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("User deleted all their own data", "user_id", user.ID)
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// handleDeleteOwnAccount deletes the caller's account with all data; never the last administrator.
func (s *Server) handleDeleteOwnAccount(w http.ResponseWriter, r *http.Request) {
	user, ok := s.confirmPassword(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteOwnAccount(user.ID); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, storage.ErrLastAdmin) {
			status = http.StatusForbidden
		}
		writeError(w, status, err.Error())
		return
	}
	s.removeUserBackups(user.ID)
	slog.Info("User deleted their account", "user_id", user.ID)
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// importUpload reads the multipart field "file" (max. storage.MaxImportUploadBytes).
func importUpload(w http.ResponseWriter, r *http.Request) ([]byte, string, error) {
	allowLongTransfer(w)
	r.Body = http.MaxBytesReader(w, r.Body, storage.MaxImportUploadBytes+1<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		return nil, "", fmt.Errorf("Keine Datei erhalten oder Datei zu groß (max. 100 MB)")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, storage.MaxImportUploadBytes+1))
	if err != nil || len(data) > storage.MaxImportUploadBytes {
		return nil, "", fmt.Errorf("Datei zu groß (max. 100 MB)")
	}
	return data, header.Filename, nil
}

// --- USER SETTINGS & ALARMS ---

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	// The session must really end; the client is told if it did not
	if sid := sessionIDFrom(r); sid != "" {
		if err := s.store.RevokeSession(userID, sid); err != nil && !errors.Is(err, storage.ErrSessionNotFound) {
			writeError(w, http.StatusInternalServerError, "Abmelden fehlgeschlagen")
			return
		}
	}
	// Streams are not tied to one session; other devices reconnect with a new ticket on their own
	s.wsHub.DisconnectUser(userID)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleRevokeAllSessions(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	if err := s.store.RevokeAllUserTokens(userID); err != nil {
		writeError(w, http.StatusInternalServerError, "Sitzungen konnten nicht beendet werden")
		return
	}
	s.wsHub.DisconnectUser(userID)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleUpdateUserSettings(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		DisplayName         *string   `json:"displayName"`
		Username            *string   `json:"username"` // for signing in (storage/username.go)
		Email               *string   `json:"email"`
		Password            *string   `json:"password"`
		AvatarURL           *string   `json:"avatarUrl"`
		AlarmChannels       *[]string `json:"alarmChannels"`
		AlarmEmail          *string   `json:"alarmEmail"`
		DiscordWebhookURL   *string   `json:"discordWebhookUrl"`
		CustomWebhookURL    *string   `json:"customWebhookUrl"`
		NotifyBeforeMinutes *int      `json:"notifyBeforeMinutes"`
		// Needed to change password or e-mail address (FLAW-30)
		CurrentPassword string `json:"currentPassword"`
		// Which notifications go where (notify.go)
		NotificationSettings *domain.NotificationSettings `json:"notificationSettings"`
		// Days after which completed tasks are deleted (done_cleanup.go)
		DoneRetentionDays *int `json:"doneRetentionDays"`
		// Voice input: "" (Whisper server, the default) or "browser"
		VoiceInput *string `json:"voiceInput"`
		// Language voice input is recognized in: "", "auto" or a Whisper language (storage/voice_language.go)
		VoiceLanguage *string `json:"voiceLanguage"`
		// Language of the app: a supported code or "" (browser, then the server's default)
		Language *string `json:"language"`
		// All retention delays at once (storage/retention.go)
		Retention *domain.Retention `json:"retention"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	before, err := s.store.GetUserByID(userID)
	if err != nil || before == nil {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}
	changesPassword := req.Password != nil && strings.TrimSpace(*req.Password) != ""
	changesEmail := req.Email != nil && !strings.EqualFold(strings.TrimSpace(*req.Email), before.Email)
	// The shared demo accounts keep the names everybody signs in with
	changesUsername := req.Username != nil && strings.ToLower(strings.TrimSpace(*req.Username)) != before.Username
	if (changesPassword || changesEmail || changesUsername) && s.cfg.DemoMode {
		writeError(w, http.StatusForbidden, "In der Demo deaktiviert")
		return
	}
	if (changesPassword || changesEmail) && !s.checkCurrentPassword(w, r, before, req.CurrentPassword) {
		return
	}
	// Alarm URLs are checked before they are stored (SSRF protection, see netguard.go)
	allowPrivate := s.allowPrivateWebhooks()
	if req.DiscordWebhookURL != nil {
		if err := validateWebhookURL(*req.DiscordWebhookURL, true, allowPrivate); err != nil {
			writeError(w, http.StatusBadRequest, "Discord-Webhook: "+err.Error())
			return
		}
	}
	if req.CustomWebhookURL != nil {
		if err := validateWebhookURL(*req.CustomWebhookURL, false, allowPrivate); err != nil {
			writeError(w, http.StatusBadRequest, "Webhook-URL: "+err.Error())
			return
		}
	}
	if req.Password != nil && strings.TrimSpace(*req.Password) != "" {
		if err := auth.ValidatePassword(*req.Password); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		hash, err := auth.HashPassword(*req.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Fehler beim Hashen des Passworts")
			return
		}
		if err := s.store.UpdateUserPassword(userID, hash); err != nil {
			writeError(w, http.StatusInternalServerError, "Passwort konnte nicht gespeichert werden")
			return
		}
		// Every other device is logged out; this one keeps its session with a fresh token
		sid := sessionIDFrom(r)
		if err := s.store.RevokeOtherSessions(userID, sid); err != nil {
			writeError(w, http.StatusInternalServerError, "Andere Sitzungen konnten nicht beendet werden")
			return
		}
		s.wsHub.DisconnectUser(userID)
		if fresh, err := s.store.GetUserByID(userID); err == nil {
			current := &auth.Claims{}
			current.ID = sid
			s.renewSessionToken(w, fresh, current, true)
		}
	}
	if changesUsername {
		if err := s.store.SetUsername(userID, *req.Username); err != nil {
			writeUsernameError(w, err)
			return
		}
	}
	u, err := s.store.UpdateUserFull(
		userID,
		req.DisplayName,
		req.Email,
		nil,
		nil,
		req.AlarmChannels,
		req.AlarmEmail,
		req.DiscordWebhookURL,
		req.CustomWebhookURL,
		req.NotifyBeforeMinutes,
		req.AvatarURL,
	)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if changesPassword || changesEmail {
		s.notifyAccountChange(before, changesPassword, changesEmail, u.Email)
	}
	if req.NotificationSettings != nil {
		if err := s.store.SetNotificationSettings(userID, *req.NotificationSettings); err != nil {
			writeError(w, http.StatusInternalServerError, "Benachrichtigungen konnten nicht gespeichert werden")
			return
		}
	}
	if req.DoneRetentionDays != nil {
		if *req.DoneRetentionDays == 0 && !s.allowNeverRetention() {
			writeError(w, http.StatusBadRequest, storage.ErrRetentionNever.Error())
			return
		}
		if err := s.store.SetDoneRetentionDays(userID, *req.DoneRetentionDays); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if req.VoiceInput != nil {
		if err := s.store.SetVoiceInput(userID, *req.VoiceInput); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if req.VoiceLanguage != nil {
		if err := s.store.SetVoiceLanguage(userID, *req.VoiceLanguage); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if req.Language != nil {
		if err := s.store.SetLanguage(userID, *req.Language); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if req.Retention != nil {
		if err := s.store.SetRetention(userID, *req.Retention, s.allowNeverRetention()); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	ns := s.store.NotificationSettingsOf(userID)
	u.NotificationSettings = &ns
	s.fillUserPreferences(u)
	writeJSON(w, http.StatusOK, u)
}

// checkCurrentPassword verifies the current password for sensitive changes; wrong attempts count
// towards the login protection, so this cannot be used to guess the password.
func (s *Server) checkCurrentPassword(w http.ResponseWriter, r *http.Request, user *domain.User, password string) bool {
	ip := clientIPFrom(r)
	if wait := s.loginGuard.lockedFor(user.ID, ip); wait > 0 {
		writeLoginLocked(w, wait)
		return false
	}
	// A forgotten field is no guess and does not count as a failure
	if password == "" || !auth.CheckPassword(password, user.PasswordHash) {
		if password != "" {
			s.loginGuard.recordFailure(user.ID, ip)
		}
		writeError(w, http.StatusForbidden, "Bitte gib zur Bestätigung dein aktuelles Passwort richtig ein")
		return false
	}
	return true
}

// notifyAccountChange tells the previous address about a new password or e-mail address, so a
// takeover does not go unnoticed. Only when mail is set up; errors are logged, never shown.
func (s *Server) notifyAccountChange(before *domain.User, password, email bool, newEmail string) {
	if _, err := s.smtpSettings(); err != nil || before.Email == "" {
		return
	}
	lang := s.userLanguage(before.ID)
	var intro string
	switch {
	case password && email:
		intro = i18n.T(lang, "In MindSift wurden dein Passwort und die E-Mail-Adresse deines Kontos geändert, die neue Adresse ist {email}.", "email", newEmail)
	case email:
		intro = i18n.T(lang, "In MindSift wurde die E-Mail-Adresse deines Kontos auf {email} geändert.", "email", newEmail)
	default:
		intro = i18n.T(lang, "In MindSift wurde dein Passwort geändert.")
	}
	c := mailContent{
		Lang:      lang,
		Preheader: i18n.T(lang, "Änderung an deinem MindSift-Konto"),
		Greeting:  mailGreeting(lang, time.Now(), before.DisplayName),
		Intro:     intro,
		Notice:    i18n.T(lang, "Warst du das nicht? Setze bitte sofort dein Passwort zurück und beende alle Sitzungen in den Kontoeinstellungen, oder wende dich an die Administration."),
		Footer:    mailFooterAccount(lang),
	}
	if link := s.notifyLink(); link != "" {
		c.Button = &mailButton{Label: i18n.T(lang, "MindSift öffnen"), URL: link}
	}
	go func() {
		_ = s.sendMailContent(before.Email, i18n.T(lang, "MindSift: Änderung an deinem Konto"), c)
	}()
}

func (s *Server) handleTestUserAlarm(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	user, err := s.store.GetUserByID(userID)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}

	var req struct {
		Channel string `json:"channel"` // email | discord | webhook
		Target  string `json:"target"`  // optional override URL or email
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}

	channel := strings.ToLower(strings.TrimSpace(req.Channel))
	target := strings.TrimSpace(req.Target)
	// The test looks like the real alarms, so it is in the language they come in
	lang := s.userLanguage(userID)
	testTitle := i18n.T(lang, "Test-Alarm von MindSift")

	switch channel {
	case "discord":
		url := target
		if url == "" {
			url = user.DiscordWebhookURL
		}
		if url == "" {
			writeError(w, http.StatusBadRequest, "Bitte eine Discord Webhook URL angeben")
			return
		}
		if err := s.sendDiscordNotification(lang, url, testTitle, i18n.T(lang, "Dein Discord-Alarmkanal funktioniert einwandfrei!"), domain.HumanDue(lang, domain.NowISO()[:10]), "normal"); err != nil {
			writeError(w, http.StatusBadGateway, "Discord-Fehler: "+err.Error())
			return
		}
	case "webhook":
		url := target
		if url == "" {
			url = user.CustomWebhookURL
		}
		if url == "" {
			writeError(w, http.StatusBadRequest, "Bitte eine Webhook-URL angeben")
			return
		}
		if err := s.sendCustomWebhookNotification(url, "test_alarm", testTitle, i18n.T(lang, "Dein eigener Webhook empfängt MindSift-Alarme!"), domain.NowISO()[:10], "normal"); err != nil {
			writeError(w, http.StatusBadGateway, "Webhook-Fehler: "+err.Error())
			return
		}
	case "email":
		toEmail := target
		if toEmail == "" {
			toEmail = user.AlarmEmail
		}
		if toEmail == "" {
			toEmail = user.Email
		}
		sample := time.Date(2026, 1, 1, 18, 0, 0, 0, time.Local)
		if err := s.sendMailContent(toEmail, "⏰ "+i18n.T(lang, "MindSift Test-Alarm"), mailContent{
			Lang:      lang,
			Preheader: i18n.T(lang, "Dein E-Mail-Alarmkanal funktioniert"),
			Greeting:  mailGreeting(lang, time.Now(), user.DisplayName),
			Intro:     i18n.T(lang, "Dein E-Mail-Alarmkanal in MindSift ist eingerichtet und einsatzbereit. So sehen deine Alarme aus:"),
			Sections: []mailSection{{Items: []mailItem{{
				Title: i18n.T(lang, "Beispiel: Heizung entlüften"),
				Meta:  i18n.T(lang, "Fällig: heute, {time}", "time", i18n.Clock(lang, sample)) + " · " + domain.PriorityLabel(lang, "high"),
				Tone:  "warning",
			}}}},
			Footer: mailFooterAlarms(lang),
		}); err != nil {
			writeError(w, http.StatusBadGateway, tr(w, "E-Mail-Versand fehlgeschlagen")+": "+trErr(w, err))
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "Unbekannter Alarm-Kanal (erlaubt: email, discord, webhook)")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"sent":    true,
		"channel": channel,
	})
}

// fillUserPreferences adds the settings kept outside the user row's own fields.
func (s *Server) fillUserPreferences(u *domain.User) {
	allowNever := s.allowNeverRetention()
	r := s.store.RetentionOf(u.ID, allowNever)
	u.Retention = &r
	u.RetentionNeverAllowed = allowNever
	u.DoneRetentionDays = r.DoneTasks
	u.VoiceInput = s.store.VoiceInput(u.ID)
	u.VoiceLanguage = s.store.VoiceLanguage(u.ID)
	u.Language = s.store.Language(u.ID)
	u.Organizations = s.store.UserOrganizations(u.ID)
}

// maskEmail shows an address only in part ("an***@example.com"): enough to tell it apart, without
// giving it away to whoever holds the code
func maskEmail(email string) string {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return "***"
	}
	local := []rune(email[:at])
	keep := 2
	if len(local) <= 3 {
		keep = 1
	}
	if len(local) < keep {
		keep = len(local)
	}
	return string(local[:keep]) + "***" + email[at:]
}
