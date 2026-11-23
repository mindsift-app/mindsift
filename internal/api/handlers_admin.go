package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// --- ORGANIZATIONS & TEAMS ---

func (s *Server) handleAdminGetOrganizations(w http.ResponseWriter, r *http.Request) {
	orgs, err := s.store.GetOrganizations()
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, orgs)
}

func (s *Server) handleAdminCreateOrganization(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	org, err := s.store.CreateOrganization(req.Name)
	if err != nil {
		writeOrganizationError(w, err)
		return
	}
	s.audit(r, storage.AuditOrgCreated, auditOrgTarget(org.ID, org.Name), nil)
	writeJSON(w, http.StatusCreated, org)
}

func (s *Server) handleAdminRenameOrganization(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	orgID := chi.URLParam(r, "id")
	before := s.organizationName(orgID)
	if err := s.store.RenameOrganization(orgID, req.Name); err != nil {
		writeOrganizationError(w, err)
		return
	}
	if after := s.organizationName(orgID); after != before {
		s.audit(r, storage.AuditOrgRenamed, auditOrgTarget(orgID, after), map[string]string{"from": before, "to": after})
	}
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (s *Server) handleAdminDeleteOrganization(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "id")
	name := s.organizationName(orgID)
	if err := s.store.DeleteOrganization(orgID); err != nil {
		writeInternal(w, err)
		return
	}
	if name != "" {
		s.audit(r, storage.AuditOrgDeleted, auditOrgTarget(orgID, name), nil)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleAdminAddOrganizationMember(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID string `json:"userId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	orgID := chi.URLParam(r, "id")
	// Idempotent: a person already in the organization changes nothing and is not logged again
	added, err := s.store.JoinOrganization(orgID, req.UserID)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	if added {
		s.auditOrgMember(r, storage.AuditOrgMemberAdded, orgID, req.UserID)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"added": added})
}

// writeOrganizationError: a taken name is 409 (code organization_name_taken), the rest 400.
func writeOrganizationError(w http.ResponseWriter, err error) {
	if errors.Is(err, storage.ErrOrganizationNameTaken) {
		writeErrorCode(w, http.StatusConflict, "organization_name_taken", storage.ErrOrganizationNameTaken.Msg)
		return
	}
	writeErrorFrom(w, http.StatusBadRequest, err)
}

// handleAdminRemoveOrganizationMember takes a person out of an organization; ?dryRun=true only counts
// the shares and group memberships that would go.
func (s *Server) handleAdminRemoveOrganizationMember(w http.ResponseWriter, r *http.Request) {
	orgID, userID := chi.URLParam(r, "id"), chi.URLParam(r, "userId")
	if r.URL.Query().Get("dryRun") == "true" {
		n, err := s.store.RemoveOrganizationMemberImpact(orgID, userID)
		if err != nil {
			writeInternal(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{"affected": n})
		return
	}
	if err := s.store.RemoveOrganizationMember(orgID, userID); err != nil {
		writeInternal(w, err)
		return
	}
	s.auditOrgMember(r, storage.AuditOrgMemberRemoved, orgID, userID)
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
}

// handleAdminSharingImpact counts the shares and group memberships a switch to ?mode= would remove.
func (s *Server) handleAdminSharingImpact(w http.ResponseWriter, r *http.Request) {
	n, err := s.store.PruneSharing(r.URL.Query().Get("mode"), true)
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"affected": n})
}

// --- ADMIN & STAFF PANEL ---

// isAdmin: the caller is a server admin (staff routes also let user managers in).
func isAdmin(u *domain.User) bool { return u != nil && u.Role == domain.RoleAdmin }

// staffUser is a user as the admin user list shows it: without the alarm targets (a Discord webhook
// URL lets anybody post into that channel, own webhooks can be internal services) and without the
// token version. The empty fields here hide the embedded ones of the same name when encoded.
type staffUser struct {
	domain.User
	TokenVersion      int      `json:"tokenVersion,omitempty"`
	AlarmChannels     []string `json:"alarmChannels,omitempty"`
	DiscordWebhookURL string   `json:"discordWebhookUrl,omitempty"`
	CustomWebhookURL  string   `json:"customWebhookUrl,omitempty"`
}

func (s *Server) handleAdminGetUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.GetAllUsers()
	if err != nil {
		writeInternal(w, err)
		return
	}
	pending := s.store.PendingRegistrationIDs()
	unverified := s.store.UnverifiedEmailIDs()
	orgs, _ := s.store.OrganizationIDsOf()
	mfa := s.store.MFAUserIDs()
	out := make([]staffUser, len(users))
	for i, u := range users {
		u.MFAEnabled = mfa[u.ID]
		u.PendingApproval = pending[u.ID]
		u.EmailUnverified = unverified[u.ID]
		u.OrganizationIDs = orgs[u.ID]
		u.NoPassword = !auth.HasPassword(u.PasswordHash)
		out[i] = staffUser{User: u}
	}
	writeJSON(w, http.StatusOK, out)
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
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Email = domain.NormalizeEmail(req.Email)
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "E-Mail-Adresse erforderlich")
		return
	}
	if !validEmail(req.Email) {
		writeError(w, http.StatusBadRequest, "Ungültige E-Mail-Adresse")
		return
	}
	if s.store.EmailInUse(req.Email) {
		writeError(w, http.StatusConflict, "E-Mail-Adresse existiert bereits")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	// Only server admins hand out roles; user managers create members
	if !isAdmin(caller) {
		req.Role = domain.RoleMember
	}
	// Without a display name the account shows its username (the store gives it)

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Passwort-Hash fehlgeschlagen")
		return
	}
	u, err := s.store.CreateUser(req.Email, hash, req.DisplayName, req.Role)
	if err != nil {
		writeEmailError(w, err)
		return
	}
	for _, orgID := range s.store.ValidOrganizationIDs(req.OrganizationIDs) {
		if err := s.store.AddOrganizationMember(orgID, u.ID); err == nil {
			u.OrganizationIDs = append(u.OrganizationIDs, orgID)
		}
	}
	created := map[string]any{"role": u.Role}
	if names := s.organizationNames(u.OrganizationIDs); len(names) > 0 {
		created["organizations"] = names
	}
	s.audit(r, storage.AuditAccountCreated, storage.AuditUserTarget(u), created)
	writeJSON(w, http.StatusCreated, staffUser{User: *u})
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
	if !decodeJSON(w, r, &req) {
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
			writeErrorFrom(w, http.StatusBadRequest, fmt.Errorf("Discord-Webhook: %w", err))
			return
		}
	}
	// Checked before the username changes, so a wrong or taken address does not leave half the change behind
	changesEmail := req.Email != nil && domain.NormalizeEmail(*req.Email) != targetUser.Email
	if changesEmail && domain.NormalizeEmail(*req.Email) != "" && !validEmail(domain.NormalizeEmail(*req.Email)) {
		writeError(w, http.StatusBadRequest, "Ungültige E-Mail-Adresse")
		return
	}
	if changesEmail && s.store.EmailInUse(*req.Email) {
		writeError(w, http.StatusConflict, "E-Mail-Adresse existiert bereits")
		return
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
		writeEmailError(w, err)
		return
	}
	// Locked or a new role: the store signed every session out (token version), live connections end as well
	if (req.IsActive != nil && !*req.IsActive) || u.Role != targetUser.Role {
		s.wsHub.DisconnectUser(targetUserID)
	}
	if req.IsActive != nil && *req.IsActive {
		// Activating by hand counts as approval and vouches for the address
		s.store.ClearPendingRegistration(targetUserID)
		s.store.ClearEmailVerification(targetUserID)
	}
	s.auditUserUpdate(r, targetUser, u)
	u.NoPassword = !auth.HasPassword(u.PasswordHash)
	writeJSON(w, http.StatusOK, staffUser{User: *u})
}

// handleAdminResetPassword sets a new password (server admins only: user managers send people to
// "forgot password" instead) and signs every session out. mustChange: the person has to choose an own
// password at the next sign-in before anything else; revokeKeys: the account's API keys, OAuth grants
// (MCP connections) and calendar subscription go as well. Neither happens unless asked for.
func (s *Server) handleAdminResetPassword(w http.ResponseWriter, r *http.Request) {
	targetUserID := chi.URLParam(r, "id")

	var req struct {
		Password   string `json:"password"`
		MustChange bool   `json:"mustChange"`
		RevokeKeys bool   `json:"revokeKeys"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Passwort-Hash fehlgeschlagen")
		return
	}
	target, err := s.store.GetUserByID(targetUserID)
	if err != nil || target == nil {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}
	s.loginGuard.unlockAccount(targetUserID)
	if err := s.store.ResetPassword(targetUserID, hash, req.MustChange); err != nil {
		writeInternal(w, err)
		return
	}
	s.wsHub.DisconnectUser(targetUserID)
	out := map[string]any{"success": true}
	details := map[string]any{}
	if req.MustChange {
		details["mustChange"] = true
	}
	if req.RevokeKeys {
		keys, grants, feed, err := s.store.RevokeAPIAccess(targetUserID)
		if err != nil {
			s.audit(r, storage.AuditAccountPasswordReset, storage.AuditUserTarget(target), details)
			writeInternal(w, err)
			return
		}
		details["keysRevoked"], details["connectionsRevoked"] = keys, grants
		out["keysRevoked"], out["connectionsRevoked"], out["calendarFeedRevoked"] = keys, grants, feed
		if feed {
			details["calendarFeedRevoked"] = true
		}
	}
	if len(details) == 0 {
		s.audit(r, storage.AuditAccountPasswordReset, storage.AuditUserTarget(target), nil)
	} else {
		s.audit(r, storage.AuditAccountPasswordReset, storage.AuditUserTarget(target), details)
	}
	writeJSON(w, http.StatusOK, out)
}

// handleAdminResetMFA: POST /admin/users/{id}/mfa/reset removes every second factor of an account that
// lost them all (app, passkeys, recovery codes, trusted devices); it signs in with the password alone again.
// Not for the own account (the security settings are there for it); managers only for members, as with deleting.
func (s *Server) handleAdminResetMFA(w http.ResponseWriter, r *http.Request) {
	targetUserID := chi.URLParam(r, "id")
	callerID := auth.GetUserID(r.Context())
	if targetUserID == callerID {
		writeError(w, http.StatusBadRequest, "Deine eigene Zwei-Faktor-Anmeldung änderst du in den Kontoeinstellungen")
		return
	}
	caller, _ := s.store.GetUserByID(callerID)
	target, err := s.store.GetUserByID(targetUserID)
	if err != nil || target == nil {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}
	if !isAdmin(caller) && target.Role != domain.RoleMember {
		writeError(w, http.StatusForbidden, "Keine Berechtigung")
		return
	}
	if err := s.store.ResetMFA(target.ID); err != nil {
		writeInternal(w, err)
		return
	}
	slog.Warn("Two-factor sign-in reset by an administrator", "user_id", target.ID, "by", callerID)
	s.audit(r, storage.AuditAccountMFAReset, storage.AuditUserTarget(target), nil)
	s.notifySecurityChange(target, securityChangeReset)
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
	allowLongWork(w)
	// A rejected registration is deleted the same way; the log says which it was
	pending := s.store.IsPendingRegistration(targetUserID)
	if err := s.deleteAccount(targetUserID, targetUser, time.Now()); err != nil {
		writeInternal(w, err)
		return
	}
	if targetUser != nil {
		var details any
		if pending {
			details = map[string]bool{"pendingRegistration": true}
		}
		s.audit(r, storage.AuditAccountDeleted, storage.AuditUserTarget(targetUser), details)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// deleteAccount deletes an account with its data on behalf of someone else (administration, command
// line). Its backups stay for the retention period, so a mistake can be undone; a rejected registration
// has nothing worth keeping. u is the account as read before (nil when it was not found).
func (s *Server) deleteAccount(userID string, u *domain.User, now time.Time) error {
	if err := s.store.DeleteUser(userID); err != nil {
		return err
	}
	if u != nil && !s.store.IsPendingRegistration(userID) {
		s.keepUserBackups(u, now)
	} else {
		s.removeUserBackups(userID)
	}
	s.store.ClearPendingRegistration(userID)
	return nil
}

// --- INVITES MANAGEMENT ---

func (s *Server) handleAdminGetInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := s.store.GetUserInvites()
	if err != nil {
		writeInternal(w, err)
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
	if !decodeJSON(w, r, &req) {
		return
	}
	inv, err := s.store.CreateUserInvite(callerID, req.Email, req.OrganizationIDs, req.ValidDays, req.MaxUses)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	// Never the code: it lets anybody register while the invite is valid
	invDetails := map[string]any{"maxUses": inv.MaxUses, "expiresAt": inv.ExpiresAt}
	if names := s.organizationNames(inv.OrganizationIDs); len(names) > 0 {
		invDetails["organizations"] = names
	}
	s.audit(r, storage.AuditInviteCreated, auditInviteTarget(inv), invDetails)
	writeJSON(w, http.StatusCreated, inv)
}

func (s *Server) handleAdminDeleteInvite(w http.ResponseWriter, r *http.Request) {
	inviteID := chi.URLParam(r, "id")
	inv, _ := s.store.GetUserInviteByID(inviteID)
	if err := s.store.DeleteUserInvite(inviteID); err != nil {
		writeInternal(w, err)
		return
	}
	if inv != nil {
		s.audit(r, storage.AuditInviteRevoked, auditInviteTarget(inv), nil)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// --- SERVER SETTINGS & SMTP ---

func (s *Server) handleAdminGetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings()
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.settingsForBrowser(settings))
}

// settingsForBrowser hides the SMTP password; the admin only sees whether one is stored or comes from
// SMTP_PASS.
func (s *Server) settingsForBrowser(settings *domain.SystemSettings) *domain.SystemSettings {
	out := *s.withEnvLocks(settings)
	out.SMTPPassSet = out.SMTPPass != ""
	out.SMTPPass = ""
	// The mail server of the environment is shown as in effect (without its password) and locked
	out.SMTPConfiguredViaEnv = s.smtpViaEnv()
	out.SMTPDisabledViaEnv = s.cfg.SMTPDisabled
	legal := s.legal()
	out.Legal = &legal
	out.Speech = s.speechForAdmin()
	if s.smtpViaEnv() {
		env := s.smtpFromEnv()
		out.SMTPHost, out.SMTPPort, out.SMTPUser, out.SMTPFrom, out.SMTPFromName = env.Host, env.Port, env.User, env.From, env.FromName
		out.SMTPTLS, out.SMTPSkipVerify = env.TLS, env.SkipVerify
		out.SMTPPassSet, out.SMTPPassViaEnv, out.SMTPPassUnreadable = env.Pass != "", env.Pass != "", false
		if env.Pass != "" {
			out.SMTPPassEnvHost, out.SMTPPassEnvUser = env.Host, env.User
		}
	}
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
	if s.cfg.CalendarFeeds != nil {
		on := *s.cfg.CalendarFeeds
		out.CalendarFeeds = &on
		out.CalendarFeedsViaEnv = true
	}
	if s.cfg.DemoMode {
		off := false
		out.LinkPreviews = &off // the demo sends nothing out
	}
	if s.cfg.Media.ImageQuality != "" {
		out.ImageQuality = s.cfg.Media.ImageQuality
		out.ImageQualityViaEnv = true
	}
	audio := s.audioSettings()
	out.AudioCompression, out.AudioCompressionViaEnv = audio.Compression, s.cfg.Media.AudioCompression != ""
	out.AudioBitrate, out.AudioBitrateViaEnv = audio.Bitrate, s.cfg.Media.AudioBitrate > 0
	out.AudioLimitMB, out.AudioLimitMBViaEnv = audio.LimitMB, s.cfg.Media.MaxAudioMB > 0
	out.AudioUploads, out.AudioUploadsViaEnv = &audio.Uploads, s.cfg.Media.AudioUploads != nil
	img := s.imageSettings()
	out.Images, out.ImagesViaEnv = &img.Enabled, s.cfg.Media.Images != nil
	// The switch for external images shows its own choice even while images are off (greyed out
	// there); the environment fixes it, the demo never copies
	if env := s.cfg.Media.ExternalImages; env != nil || s.cfg.DemoMode {
		on := env != nil && *env && !s.cfg.DemoMode
		out.ExternalImages, out.ExternalImagesViaEnv = &on, true
	}
	out.ImageLimitMB, out.ImageLimitMBViaEnv = img.LimitMB, s.cfg.Media.MaxImageMB > 0
	quota := s.mediaQuotaMB()
	out.MediaQuotaMB, out.MediaQuotaMBViaEnv = &quota, s.cfg.Media.QuotaMB >= 0
	out.EmailLinksAvailable = s.emailLinksAvailable()
	out.DefaultLanguage = s.defaultLanguage()
	out.OIDC = s.oidcStatusForAdmin()
	out.ServerTime = serverTimeNow()
	return &out
}

// serverTimeNow: the zone the server works in, where it comes from, its time now, and the zone it would
// use without the setting.
func serverTimeNow() *domain.ServerTime {
	z := clock.Current()
	return &domain.ServerTime{Zone: z.Name(), Source: z.Source, Now: time.Now().In(z.Loc).Format(time.RFC3339), Fallback: clock.Fallback().Name()}
}

// ApplyTimeZone puts the server's time zone in effect: the stored setting, else TZ, else UTC. Called at
// start and whenever the administration saves the settings.
func (s *Server) ApplyTimeZone() {
	setting := ""
	if sys, err := s.store.GetSystemSettings(); err == nil && sys.TimeZone != nil {
		setting = *sys.TimeZone
	}
	before := clock.Current()
	z, err := clock.Apply(setting)
	if err != nil {
		slog.Warn("A time zone could not be read and is skipped", "error", err)
	}
	// Once at start, then only when it changed (the administration saves all settings together)
	if first := !timeZoneLogged.Swap(true); first || z.Name() != before.Name() || z.Source != before.Source {
		slog.Info("Time zone", "zone", z.Name(), "source", z.Source)
	}
}

var timeZoneLogged atomic.Bool

func (s *Server) handleAdminUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings domain.SystemSettings
	if !decodeJSON(w, r, &settings) {
		return
	}
	// Empty means unchanged (the browser never has it); without SMTP user the password goes too. One that
	// no longer decrypts (SECRETS_KEY changed) stays stored until a new one is entered.
	settings.SMTPPassUnreadable = false
	if settings.SMTPPass == "" && strings.TrimSpace(settings.SMTPUser) != "" {
		if cur, err := s.store.GetSystemSettings(); err == nil {
			settings.SMTPPass, settings.SMTPPassUnreadable = cur.SMTPPass, cur.SMTPPassUnreadable
		}
	}
	// Mail server, backups and the network switches the environment fixes keep what is stored
	if cur, err := s.store.GetSystemSettings(); err == nil {
		s.keepEnvLocked(&settings, cur)
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
	if s.cfg.CalendarFeeds != nil {
		settings.CalendarFeeds = nil // fixed by CALENDAR_FEEDS
	}
	if s.cfg.Media.ImageQuality != "" {
		settings.ImageQuality = "" // fixed by MEDIA_IMAGE_QUALITY
	}
	if s.cfg.Media.AudioCompression != "" {
		settings.AudioCompression = "" // fixed by MEDIA_AUDIO_COMPRESSION
	}
	if s.cfg.Media.AudioBitrate > 0 {
		settings.AudioBitrate = 0 // fixed by MEDIA_AUDIO_BITRATE
	}
	if s.cfg.Media.MaxAudioMB > 0 {
		settings.AudioLimitMB = 0 // fixed by MEDIA_MAX_AUDIO_MB
	}
	if s.cfg.Media.AudioUploads != nil {
		settings.AudioUploads = nil // fixed by MEDIA_AUDIO_UPLOADS
	}
	if s.cfg.Media.Images != nil {
		settings.Images = nil // fixed by MEDIA_IMAGES
	}
	if s.cfg.Media.ExternalImages != nil || s.cfg.DemoMode {
		settings.ExternalImages = nil // fixed by MEDIA_EXTERNAL_IMAGES (and off in the demo)
	}
	if s.cfg.Media.MaxImageMB > 0 {
		settings.ImageLimitMB = 0 // fixed by MEDIA_MAX_IMAGE_MB
	}
	if s.cfg.Media.QuotaMB >= 0 {
		settings.MediaQuotaMB = nil // fixed by MEDIA_QUOTA_MB
	}
	settings.ImagesViaEnv, settings.ExternalImagesViaEnv, settings.ImageLimitMBViaEnv, settings.MediaQuotaMBViaEnv = false, false, false, false
	settings.AudioUploadsViaEnv = false
	settings.PeopleSearchViaEnv, settings.PublicLinksViaEnv, settings.PublicLinkMaxDaysViaEnv, settings.CalendarFeedsViaEnv = false, false, false, false
	settings.ImageQualityViaEnv, settings.AudioCompressionViaEnv, settings.AudioBitrateViaEnv, settings.AudioLimitMBViaEnv = false, false, false, false
	if settings.MFARequired != nil && !storage.ValidMFARequired(*settings.MFARequired) {
		writeErrorFrom(w, http.StatusBadRequest, storage.ErrInvalidMFARequired)
		return
	}
	if settings.ImageQuality != "" && !storage.ValidImageQuality(settings.ImageQuality) {
		writeErrorFrom(w, http.StatusBadRequest, storage.ErrInvalidImageQuality)
		return
	}
	if settings.AudioCompression != "" && !storage.ValidAudioCompression(settings.AudioCompression) {
		writeErrorFrom(w, http.StatusBadRequest, storage.ErrInvalidAudioCompression)
		return
	}
	if settings.AudioBitrate != 0 && !storage.ValidAudioBitrate(settings.AudioBitrate) {
		writeErrorFrom(w, http.StatusBadRequest, storage.ErrInvalidAudioBitrate)
		return
	}
	if settings.Speech != nil {
		if err := storage.ValidateSpeech(settings.Speech); err != nil {
			writeErrorFrom(w, http.StatusBadRequest, err)
			return
		}
	}
	if settings.Legal != nil {
		if err := storage.ValidateLegal(settings.Legal); err != nil {
			writeErrorFrom(w, http.StatusBadRequest, err)
			return
		}
	}
	if settings.ImageLimitMB < 0 || settings.ImageLimitMB > storage.MaxImageLimitMB {
		writeErrorFrom(w, http.StatusBadRequest, storage.ErrInvalidImageLimit)
		return
	}
	if q := settings.MediaQuotaMB; q != nil && (*q < 0 || *q > storage.MaxMediaQuotaMB) {
		writeErrorFrom(w, http.StatusBadRequest, storage.ErrInvalidMediaQuota)
		return
	}
	if settings.AudioLimitMB < 0 || settings.AudioLimitMB > storage.MaxAudioLimitMB {
		writeErrorFrom(w, http.StatusBadRequest, i18n.NewError("Größenbegrenzung für Audiodateien: 1 bis {mb} MB", "mb", strconv.Itoa(storage.MaxAudioLimitMB)))
		return
	}
	if settings.DefaultLanguage != "" && !i18n.Valid(settings.DefaultLanguage) {
		writeError(w, http.StatusBadRequest, storage.ErrInvalidLanguage.Error())
		return
	}
	settings.ServerTime = nil // read only
	if settings.TimeZone != nil && strings.TrimSpace(*settings.TimeZone) != "" {
		if _, err := clock.Load(*settings.TimeZone); err != nil {
			writeErrorFrom(w, http.StatusBadRequest, storage.ErrInvalidTimeZone)
			return
		}
	}
	previousMode := s.store.SharingMode()
	linksBefore := s.emailLinksAvailable()
	before, _ := s.store.GetSystemSettings()
	if err := s.store.UpdateSystemSettings(&settings); err != nil {
		writeInternal(w, err)
		return
	}
	if after, err := s.store.GetSystemSettings(); err == nil {
		if changes := settingsChanges(before, after); len(changes) > 0 {
			s.audit(r, storage.AuditSettingsChanged, storage.AuditEntry{TargetKind: storage.AuditTargetSettings}, auditChanges{Changes: changes})
		}
	}
	// A new time zone counts from now on: due dates, alarms, the daily summary and backups read it
	if settings.TimeZone != nil {
		s.ApplyTimeZone()
	}
	// The Whisper server or its model may be new: check it (and fetch a missing model) in the background
	if settings.Speech != nil {
		s.kickVoiceCheck()
	}
	// The admin gave an address while no mail could go out (setup wizard): its link follows now
	if !linksBefore && s.emailLinksAvailable() {
		s.sendWaitingEmailLink(auth.GetUserID(r.Context()))
	}
	// A stricter mode takes away what is no longer allowed (shares, group memberships, assignments)
	if settings.SharingMode != previousMode {
		if _, err := s.store.PruneSharing(settings.SharingMode, false); err != nil {
			writeError(w, http.StatusInternalServerError, "Freigaben konnten nicht angepasst werden: "+clientMessage(err))
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
		// A mail server to try before it is stored (setup wizard); left out, the configured one
		SMTP *setupSMTP `json:"smtp"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	send := s.sendMailContent
	if req.SMTP != nil {
		if err := req.SMTP.check(); err != nil {
			writeErrorFrom(w, http.StatusBadRequest, err)
			return
		}
		cfg := req.SMTP.settings()
		send = func(to, subject string, c mailContent) error {
			text, html := renderMail(c)
			return s.sendEmailHTMLWith(cfg, to, subject, text, html)
		}
	}
	toEmail := strings.TrimSpace(req.ToEmail)
	if toEmail == "" && user != nil {
		toEmail = user.Email
	}
	if toEmail == "" {
		writeError(w, http.StatusBadRequest, "Ziel-E-Mail-Adresse erforderlich")
		return
	}

	lang := s.requestLanguage(r)
	// The answer says what the mail server said, also when that takes it a minute
	allowLongWork(w)
	if err := send(toEmail, i18n.T(lang, "MindSift: SMTP-Test"), mailContent{
		Lang:      lang,
		Preheader: i18n.T(lang, "Die SMTP-Konfiguration funktioniert"),
		Greeting:  i18n.T(lang, "Es funktioniert!"),
		Intro:     i18n.T(lang, "Die SMTP-Konfiguration deiner MindSift-Instanz ist richtig eingerichtet: Alarme, Tageszusammenfassungen und Passwort-Links kommen an."),
		Footer:    i18n.T(lang, "Diese Test-E-Mail wurde in den Administratoreinstellungen ausgelöst."),
	}); err != nil {
		writeError(w, http.StatusBadGateway, tr(w, "SMTP-Fehler")+": "+trErr(w, err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sent":    true,
		"toEmail": toEmail,
	})
}
