package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- ORGANIZATIONS & TEAMS ---

func (s *Server) handleAdminGetOrganizations(w http.ResponseWriter, r *http.Request) {
	orgs, err := s.store.GetOrganizations()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, orgs)
}

func (s *Server) handleAdminCreateOrganization(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	org, err := s.store.CreateOrganization(req.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, org)
}

func (s *Server) handleAdminRenameOrganization(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	if err := s.store.RenameOrganization(chi.URLParam(r, "id"), req.Name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (s *Server) handleAdminDeleteOrganization(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteOrganization(chi.URLParam(r, "id")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleAdminAddOrganizationMember(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	if err := s.store.AddOrganizationMember(chi.URLParam(r, "id"), req.UserID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"added": true})
}

// handleAdminRemoveOrganizationMember takes a person out of an organization; ?dryRun=true only counts
// the shares and group memberships that would go.
func (s *Server) handleAdminRemoveOrganizationMember(w http.ResponseWriter, r *http.Request) {
	orgID, userID := chi.URLParam(r, "id"), chi.URLParam(r, "userId")
	if r.URL.Query().Get("dryRun") == "true" {
		n, err := s.store.RemoveOrganizationMemberImpact(orgID, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{"affected": n})
		return
	}
	if err := s.store.RemoveOrganizationMember(orgID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
}

// handleAdminSharingImpact counts the shares and group memberships a switch to ?mode= would remove.
func (s *Server) handleAdminSharingImpact(w http.ResponseWriter, r *http.Request) {
	n, err := s.store.PruneSharing(r.URL.Query().Get("mode"), true)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"affected": n})
}

// --- ADMIN & STAFF PANEL ---

// isAdmin: the caller is a server admin (staff routes also let user managers in).
func isAdmin(u *domain.User) bool { return u != nil && u.Role == domain.RoleAdmin }

func (s *Server) handleAdminGetUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.GetAllUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	pending := s.store.PendingRegistrationIDs()
	unverified := s.store.UnverifiedEmailIDs()
	orgs, _ := s.store.OrganizationIDsOf()
	for i := range users {
		users[i].PendingApproval = pending[users[i].ID]
		users[i].EmailUnverified = unverified[users[i].ID]
		users[i].OrganizationIDs = orgs[users[i].ID]
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	callerID := auth.GetUserID(r.Context())
	caller, _ := s.store.GetUserByID(callerID)

	var req struct {
		Email           string   `json:"email"`
		Password        string   `json:"password"`
		DisplayName     string   `json:"displayName"`
		Role            string   `json:"role"`
		OrganizationIDs []string `json:"organizationIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "E-Mail-Adresse erforderlich")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Only server admins hand out roles; user managers create members
	if !isAdmin(caller) {
		req.Role = domain.RoleMember
	}
	if strings.TrimSpace(req.DisplayName) == "" {
		req.DisplayName = strings.Split(req.Email, "@")[0]
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Passwort-Hash fehlgeschlagen")
		return
	}
	u, err := s.store.CreateUser(req.Email, hash, req.DisplayName, req.Role)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	for _, orgID := range s.store.ValidOrganizationIDs(req.OrganizationIDs) {
		if err := s.store.AddOrganizationMember(orgID, u.ID); err == nil {
			u.OrganizationIDs = append(u.OrganizationIDs, orgID)
		}
	}
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	callerID := auth.GetUserID(r.Context())
	caller, _ := s.store.GetUserByID(callerID)
	targetUserID := chi.URLParam(r, "id")
	targetUser, err := s.store.GetUserByID(targetUserID)
	if err != nil || targetUser == nil {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}

	// User managers only look after members
	if !isAdmin(caller) && targetUser.Role != domain.RoleMember {
		writeError(w, http.StatusForbidden, "Nur Server-Administratoren können Konten von Administratoren und der Benutzerverwaltung bearbeiten")
		return
	}

	var req struct {
		DisplayName       *string `json:"displayName"`
		Username          *string `json:"username"`
		Email             *string `json:"email"`
		Role              *string `json:"role"`
		IsActive          *bool   `json:"isActive"`
		DiscordWebhookURL *string `json:"discordWebhookUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	// Roles, e-mail and username stay with server admins: a new address plus "forgot password" would hand
	// a user manager the account
	if !isAdmin(caller) && (req.Role != nil || req.Email != nil || req.Username != nil || req.DiscordWebhookURL != nil) {
		writeError(w, http.StatusForbidden, "Nur Server-Administratoren können Rolle, E-Mail-Adresse und Benutzernamen ändern")
		return
	}

	if req.DiscordWebhookURL != nil {
		if err := validateWebhookURL(*req.DiscordWebhookURL, true, s.allowPrivateWebhooks()); err != nil {
			writeError(w, http.StatusBadRequest, "Discord-Webhook: "+err.Error())
			return
		}
	}
	if req.Username != nil && strings.ToLower(strings.TrimSpace(*req.Username)) != targetUser.Username {
		if s.cfg.DemoMode {
			writeError(w, http.StatusForbidden, "In der Demo deaktiviert")
			return
		}
		if err := s.store.SetUsername(targetUserID, *req.Username); err != nil {
			writeUsernameError(w, err)
			return
		}
	}
	u, err := s.store.UpdateUser(targetUserID, req.DisplayName, req.Email, req.Role, req.IsActive, req.DiscordWebhookURL, nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.IsActive != nil && !*req.IsActive {
		s.wsHub.DisconnectUser(targetUserID)
	}
	if req.IsActive != nil && *req.IsActive {
		// Activating by hand counts as approval and vouches for the address
		s.store.ClearPendingRegistration(targetUserID)
		s.store.ClearEmailVerification(targetUserID)
	}
	writeJSON(w, http.StatusOK, u)
}

// handleAdminResetPassword sets a new password (server admins only: user managers send people to
// "forgot password" instead).
func (s *Server) handleAdminResetPassword(w http.ResponseWriter, r *http.Request) {
	targetUserID := chi.URLParam(r, "id")

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Neues Passwort erforderlich")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Passwort-Hash fehlgeschlagen")
		return
	}
	s.loginGuard.unlockAccount(targetUserID)
	if err := s.store.UpdateUserPassword(targetUserID, hash); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.wsHub.DisconnectUser(targetUserID)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	targetUserID := chi.URLParam(r, "id")
	currUserID := auth.GetUserID(r.Context())
	if targetUserID == currUserID {
		writeError(w, http.StatusBadRequest, "Sie können Ihren eigenen Benutzer nicht löschen")
		return
	}
	caller, _ := s.store.GetUserByID(currUserID)
	targetUser, _ := s.store.GetUserByID(targetUserID)
	if !isAdmin(caller) && targetUser != nil && targetUser.Role != domain.RoleMember {
		writeError(w, http.StatusForbidden, "Keine Berechtigung zum Löschen dieses Kontos")
		return
	}
	if err := s.store.DeleteUser(targetUserID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Deleted by someone else: the backups stay for the retention period (a mistake can be undone);
	// a rejected registration has nothing worth keeping
	if targetUser != nil && !s.store.IsPendingRegistration(targetUserID) {
		s.keepUserBackups(targetUser, time.Now())
	} else {
		s.removeUserBackups(targetUserID)
	}
	s.store.ClearPendingRegistration(targetUserID)
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// --- INVITES MANAGEMENT ---

func (s *Server) handleAdminGetInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := s.store.GetUserInvites()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, invites)
}

func (s *Server) handleAdminCreateInvite(w http.ResponseWriter, r *http.Request) {
	callerID := auth.GetUserID(r.Context())

	// Invites always create members (a code that makes admins must not exist); roles are given later
	var req struct {
		Email           string   `json:"email"`
		OrganizationIDs []string `json:"organizationIds"`
		ValidDays       int      `json:"validDays"`
		MaxUses         int      `json:"maxUses"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	inv, err := s.store.CreateUserInvite(callerID, req.Email, req.OrganizationIDs, req.ValidDays, req.MaxUses)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

func (s *Server) handleAdminDeleteInvite(w http.ResponseWriter, r *http.Request) {
	inviteID := chi.URLParam(r, "id")
	if err := s.store.DeleteUserInvite(inviteID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// --- SERVER SETTINGS & SMTP ---

func (s *Server) handleAdminGetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.settingsForBrowser(settings))
}

// settingsForBrowser hides the SMTP password; the admin only sees whether one is stored.
func (s *Server) settingsForBrowser(settings *domain.SystemSettings) *domain.SystemSettings {
	out := *settings
	out.SMTPPassSet = out.SMTPPass != ""
	out.SMTPPass = ""
	out.SMTPConfiguredViaEnv = strings.TrimSpace(s.cfg.SMTPHost) != ""
	// What the environment fixes is shown as in effect and locked in the form
	if s.cfg.RegistrationMode != "" {
		out.RegistrationMode = s.cfg.RegistrationMode
		out.AllowRegistration = out.RegistrationMode == storage.RegistrationOpen
		out.RegistrationConfiguredViaEnv = true
	}
	if s.cfg.RegistrationDomains != "" {
		out.RegistrationDomains = strings.Join(storage.ParseEmailDomains(s.cfg.RegistrationDomains), ", ")
		out.RegistrationConfiguredViaEnv = true
	}
	if s.cfg.RegistrationVerifyEmail != "" {
		out.RegistrationVerifyEmail = s.cfg.RegistrationVerifyEmail == "true"
		out.RegistrationVerifyViaEnv = true
	}
	if s.cfg.RetentionAllowNever != nil {
		allow := *s.cfg.RetentionAllowNever
		out.RetentionAllowNever = &allow
		out.RetentionNeverViaEnv = true
	}
	if s.cfg.MCPEnabled != nil {
		on := *s.cfg.MCPEnabled
		out.MCPEnabled = &on
		out.MCPViaEnv = true
	}
	if s.cfg.PeopleSearch != nil {
		on := *s.cfg.PeopleSearch
		out.PeopleSearch = &on
		out.PeopleSearchViaEnv = true
	}
	if s.cfg.PublicLinks != nil || s.cfg.DemoMode {
		on := s.publicLinksEnabled()
		out.PublicLinks = &on
		out.PublicLinksViaEnv = true
	}
	if s.cfg.PublicLinkMaxDays > 0 {
		out.PublicLinkMaxDays = s.cfg.PublicLinkMaxDays
		out.PublicLinkMaxDaysViaEnv = true
	}
	out.EmailLinksAvailable = s.emailLinksAvailable()
	out.DefaultLanguage = s.defaultLanguage()
	return &out
}

func (s *Server) handleAdminUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings domain.SystemSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	// Empty means unchanged (the browser never has it); without SMTP user the password goes too
	if settings.SMTPPass == "" && strings.TrimSpace(settings.SMTPUser) != "" {
		if cur, err := s.store.GetSystemSettings(); err == nil {
			settings.SMTPPass = cur.SMTPPass
		}
	}
	// Registration fixed by the environment cannot be changed here (the stored value stays as it was)
	if s.cfg.RegistrationMode != "" || s.cfg.RegistrationDomains != "" {
		if cur, err := s.store.GetSystemSettings(); err == nil {
			if s.cfg.RegistrationMode != "" {
				settings.RegistrationMode, settings.AllowRegistration = cur.RegistrationMode, cur.AllowRegistration
			}
			if s.cfg.RegistrationDomains != "" {
				settings.RegistrationDomains = cur.RegistrationDomains
			}
		}
	}
	if s.cfg.RegistrationVerifyEmail != "" {
		if cur, err := s.store.GetSystemSettings(); err == nil {
			settings.RegistrationVerifyEmail = cur.RegistrationVerifyEmail
		}
	}
	if s.cfg.RetentionAllowNever != nil {
		settings.RetentionAllowNever = nil // fixed by RETENTION_ALLOW_NEVER, the stored value stays
	}
	settings.RetentionNeverViaEnv = false
	if s.cfg.MCPEnabled != nil {
		settings.MCPEnabled = nil // fixed by MCP_ENABLED, the stored value stays
	}
	settings.MCPViaEnv = false
	if s.cfg.PeopleSearch != nil {
		settings.PeopleSearch = nil // fixed by PEOPLE_SEARCH
	}
	if s.cfg.PublicLinks != nil {
		settings.PublicLinks = nil // fixed by PUBLIC_LINKS
	}
	if s.cfg.PublicLinkMaxDays > 0 {
		settings.PublicLinkMaxDays = 0 // fixed by PUBLIC_LINKS_MAX_DAYS
	}
	settings.PeopleSearchViaEnv, settings.PublicLinksViaEnv, settings.PublicLinkMaxDaysViaEnv = false, false, false
	if settings.DefaultLanguage != "" && !i18n.Valid(settings.DefaultLanguage) {
		writeError(w, http.StatusBadRequest, storage.ErrInvalidLanguage.Error())
		return
	}
	previousMode := s.store.SharingMode()
	if err := s.store.UpdateSystemSettings(&settings); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// A stricter mode takes away what is no longer allowed (shares, group memberships, assignments)
	if settings.SharingMode != previousMode {
		if _, err := s.store.PruneSharing(settings.SharingMode, false); err != nil {
			writeError(w, http.StatusInternalServerError, "Freigaben konnten nicht angepasst werden: "+err.Error())
			return
		}
	}
	saved, _ := s.store.GetSystemSettings()
	if saved == nil {
		saved = &settings
	}
	writeJSON(w, http.StatusOK, s.settingsForBrowser(saved))
}

func (s *Server) handleAdminTestSMTP(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	user, _ := s.store.GetUserByID(userID)

	var req struct {
		ToEmail string `json:"toEmail"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	toEmail := strings.TrimSpace(req.ToEmail)
	if toEmail == "" && user != nil {
		toEmail = user.Email
	}
	if toEmail == "" {
		writeError(w, http.StatusBadRequest, "Ziel-E-Mail-Adresse erforderlich")
		return
	}

	lang := s.requestLanguage(r)
	if err := s.sendMailContent(toEmail, i18n.T(lang, "MindSift: SMTP-Test"), mailContent{
		Lang:      lang,
		Preheader: i18n.T(lang, "Die SMTP-Konfiguration funktioniert"),
		Greeting:  i18n.T(lang, "Es funktioniert!"),
		Intro:     i18n.T(lang, "Die SMTP-Konfiguration deiner MindSift-Instanz ist richtig eingerichtet: Alarme, Tageszusammenfassungen und Passwort-Links kommen an."),
		Footer:    i18n.T(lang, "Diese Test-E-Mail wurde in den Administratoreinstellungen ausgelöst."),
	}); err != nil {
		writeError(w, http.StatusBadGateway, tr(w, "SMTP-Fehler")+": "+trErr(w, err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"sent":    true,
		"toEmail": toEmail,
	})
}
