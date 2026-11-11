package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Registration without an invite (mode and e-mail domains), approval of waiting accounts, and sending
// invite links by mail.

type registrationPolicy struct {
	Mode    string
	Domains []string
	ViaEnv  bool
	// VerifyEmail: self-registrations confirm their address by link first (only when mails with links
	// can go out, see emailLinksAvailable)
	VerifyEmail bool
}

// registrationPolicy: the environment (REGISTRATION_MODE / REGISTRATION_DOMAINS) wins over the admin
// settings, so an operator can lock it down for good.
func (s *Server) registrationPolicy() registrationPolicy {
	p := registrationPolicy{Mode: storage.RegistrationClosed}
	if sys, _ := s.store.GetSystemSettings(); sys != nil {
		p.Mode = sys.RegistrationMode
		p.Domains = storage.ParseEmailDomains(sys.RegistrationDomains)
		p.VerifyEmail = sys.RegistrationVerifyEmail
	}
	if s.cfg.RegistrationVerifyEmail != "" {
		p.VerifyEmail = s.cfg.RegistrationVerifyEmail == "true"
	}
	p.VerifyEmail = p.VerifyEmail && s.emailLinksAvailable()
	if s.cfg.RegistrationMode != "" {
		p.Mode, p.ViaEnv = s.cfg.RegistrationMode, true
	}
	if s.cfg.RegistrationDomains != "" {
		p.Domains, p.ViaEnv = storage.ParseEmailDomains(s.cfg.RegistrationDomains), true
	}
	return p
}

// registrationOutcome decides for a sign-up without invite: allowed at all, and active at once or
// waiting for approval. The error is shown to the person.
func (p registrationPolicy) registrationOutcome(email string) (pending bool, err error) {
	inDomains := storage.EmailInDomains(email, p.Domains)
	switch p.Mode {
	case storage.RegistrationOpen:
		return false, nil
	case storage.RegistrationApproval:
		return true, nil
	case storage.RegistrationDomain:
		if !inDomains {
			return false, i18n.NewError("Registrierung nur mit E-Mail-Adressen von {domains}", "domains", domainList(p.Domains))
		}
		return false, nil
	case storage.RegistrationDomainApproval:
		return !inDomains, nil
	}
	return false, errors.New("Öffentliche Registrierung ist deaktiviert – bitte nutze einen Einladungscode vom Administrator")
}

func domainList(domains []string) string {
	if len(domains) == 0 {
		return "freigegebenen Domains"
	}
	out := make([]string, len(domains))
	for i, d := range domains {
		out[i] = "@" + strings.TrimPrefix(d, "*.")
	}
	return strings.Join(out, ", ")
}

// emailLinksAvailable: mails with links to people who are not logged in can go out – a mail server
// and BASE_URL (links to strangers are never built from the request's Host header).
func (s *Server) emailLinksAvailable() bool {
	return s.passwordResetAvailable()
}

// sendVerificationMail mails the confirmation link of a new account.
func (s *Server) sendVerificationMail(user *domain.User) {
	raw, err := s.store.CreateEmailVerification(user.ID)
	if err != nil {
		if !errors.Is(err, storage.ErrResetTooSoon) {
			slog.Warn("Creating the confirmation link failed", "user_id", user.ID, "error", err)
		}
		return
	}
	link := strings.TrimRight(s.cfg.BaseURL, "/") + "/?verifyToken=" + url.QueryEscape(raw)
	lang := s.userLanguage(user.ID)
	err = s.sendMailContent(user.Email, i18n.T(lang, "MindSift: Bitte bestätige deine E-Mail-Adresse"), mailContent{
		Lang:      lang,
		Preheader: i18n.T(lang, "Ein Klick, dann ist dein Konto bereit"),
		Greeting:  mailGreeting(lang, time.Now(), user.DisplayName),
		Intro:     i18n.T(lang, "Du hast dich bei MindSift registriert. Bitte bestätige noch deine E-Mail-Adresse."),
		Button:    &mailButton{Label: i18n.T(lang, "E-Mail-Adresse bestätigen"), URL: link},
		Note: i18n.T(lang, "Der Link gilt 48 Stunden. Hast du dich nicht registriert, ignoriere diese E-Mail – das Konto wird dann automatisch gelöscht.") + "\n" +
			i18n.T(lang, "Falls der Knopf nicht geht: {link}", "link", link),
		Footer: mailFooterAccount(lang),
	})
	if err != nil {
		slog.Warn("Confirmation email not sent", "user_id", user.ID, "error", err)
	}
}

// handleVerifyEmail: POST /auth/verify-email {"token"} – the link from the mail. Without approval the
// account is active now, otherwise it goes on to the admins.
func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil || strings.TrimSpace(req.Token) == "" {
		writeError(w, http.StatusBadRequest, storage.ErrVerificationInvalid.Error())
		return
	}
	userID, err := s.store.ConfirmEmailVerification(strings.TrimSpace(req.Token))
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	user, err := s.store.GetUserByID(userID)
	if err != nil || user == nil {
		writeError(w, http.StatusBadRequest, storage.ErrVerificationInvalid.Error())
		return
	}
	if s.store.IsPendingRegistration(userID) {
		go s.notifyAdminsOfRegistration(user)
		writeJSON(w, http.StatusOK, map[string]any{
			"verified": true, "pending": true,
			"message": tr(w, "Deine E-Mail-Adresse ist bestätigt. Ein Administrator schaltet dein Konto noch frei – du bekommst dann eine E-Mail."),
		})
		return
	}
	active := true
	if _, err := s.store.UpdateUser(userID, nil, nil, nil, &active, nil, nil); err != nil {
		writeError(w, http.StatusInternalServerError, "Konto konnte nicht freigeschaltet werden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"verified": true, "pending": false,
		"message": tr(w, "Deine E-Mail-Adresse ist bestätigt. Du kannst dich jetzt anmelden."),
	})
}

// handleResendVerification: POST /auth/resend-verification {"email"} – always the same answer, the
// mail goes out in the background (at most every 2 minutes per account).
func (s *Server) handleResendVerification(w http.ResponseWriter, r *http.Request) {
	if wait := s.loginGuard.throttle("forgot", clientIPFrom(r), limitForgotPerIP); wait > 0 {
		writeThrottled(w, wait)
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil || strings.TrimSpace(req.Email) == "" {
		writeError(w, http.StatusBadRequest, "E-Mail-Adresse erforderlich")
		return
	}
	email := strings.TrimSpace(req.Email)
	if s.emailLinksAvailable() {
		go func() {
			if user, err := s.store.GetUserByEmail(email); err == nil && user != nil && s.store.IsEmailUnverified(user.ID) {
				s.sendVerificationMail(user)
			}
		}()
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// appLink is the address of this instance for links in mails: BASE_URL, otherwise the address the
// admin is using right now (only for mails an admin triggers, never for anonymous requests).
func (s *Server) appLink(r *http.Request) string {
	if s.cfg.BaseURLSet {
		return strings.TrimRight(s.cfg.BaseURL, "/") + "/"
	}
	return requestOrigin(r) + "/"
}

// notifyAdminsOfRegistration mails every active admin and user manager that someone waits (only with SMTP).
func (s *Server) notifyAdminsOfRegistration(user *domain.User) {
	if _, err := s.smtpSettings(); err != nil {
		return
	}
	users, err := s.store.GetAllUsers()
	if err != nil {
		return
	}
	for _, a := range users {
		if (a.Role != domain.RoleAdmin && a.Role != domain.RoleManager) || !a.IsActive || a.Email == "" {
			continue
		}
		lang := s.userLanguage(a.ID)
		c := mailContent{
			Lang:      lang,
			Preheader: i18n.T(lang, "{name} wartet auf Freigabe", "name", user.DisplayName),
			Greeting:  mailGreeting(lang, time.Now(), a.DisplayName),
			Intro:     i18n.T(lang, "Jemand hat sich bei MindSift registriert und wartet auf deine Freigabe:"),
			Sections:  []mailSection{{Items: []mailItem{{Title: user.DisplayName, Meta: user.Email}}}},
			Outro:     i18n.T(lang, "Freigeben oder ablehnen kannst du in den Administrator-Einstellungen unter „Benutzer & Einladungen“."),
			Footer:    i18n.T(lang, "Du bekommst diese E-Mail als Administrator dieser MindSift-Instanz."),
		}
		if link := s.notifyLink(); link != "" {
			c.Button = &mailButton{Label: i18n.T(lang, "Benutzerverwaltung öffnen"), URL: link}
		}
		if err := s.sendMailContent(a.Email, i18n.T(lang, "MindSift: Neue Registrierung wartet auf Freigabe"), c); err != nil {
			slog.Warn("Notice about a new registration not sent", "admin", a.ID, "error", err)
		}
	}
}

// handleAdminApproveUser: POST /admin/users/{id}/approve – a waiting account becomes active.
func (s *Server) handleAdminApproveUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	user, err := s.store.GetUserByID(userID)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "Benutzer nicht gefunden")
		return
	}
	ok, err := s.store.ApprovePendingRegistration(userID)
	if err != nil {
		writeInternal(w, err)
		return
	}
	if !ok {
		writeError(w, http.StatusConflict, "Dieses Konto wartet nicht auf Freigabe")
		return
	}
	user.IsActive = true
	s.store.ClearEmailVerification(userID) // the admin vouches for the account
	link := s.appLink(r)
	lang := s.userLanguage(user.ID)
	go func() {
		err := s.sendMailContent(user.Email, i18n.T(lang, "MindSift: Dein Konto ist freigeschaltet"), mailContent{
			Lang:      lang,
			Preheader: i18n.T(lang, "Du kannst dich jetzt anmelden"),
			Greeting:  mailGreeting(lang, time.Now(), user.DisplayName),
			Intro:     i18n.T(lang, "Dein MindSift-Konto ist freigeschaltet. Du kannst dich jetzt mit deiner E-Mail-Adresse und deinem Passwort anmelden."),
			Button:    &mailButton{Label: i18n.T(lang, "Zu MindSift"), URL: link},
			Footer:    mailFooterAccount(lang),
		})
		if err != nil {
			slog.Warn("Email about the activated account not sent", "user_id", user.ID, "error", err)
		}
	}()
	writeJSON(w, http.StatusOK, staffUser{User: *user})
}

// handleAdminSendInvite: POST /admin/invites/{id}/send {"email"} – mails the invite link. A single-use
// invite is bound to that address on the way.
func (s *Server) handleAdminSendInvite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !strings.Contains(req.Email, "@") {
		writeError(w, http.StatusBadRequest, "Bitte eine gültige E-Mail-Adresse angeben")
		return
	}
	email := domain.NormalizeEmail(req.Email)
	if _, err := s.smtpSettings(); err != nil {
		writeError(w, http.StatusBadRequest, "Für Einladungen per E-Mail muss ein Mail-Server eingerichtet sein")
		return
	}
	inv, err := s.store.GetUserInviteByID(chi.URLParam(r, "id"))
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	if inv.MaxUses == 1 {
		if inv.Email != "" && !strings.EqualFold(inv.Email, email) {
			writeError(w, http.StatusConflict, tr(w, "Diese Einladung ist an {email} gebunden", "email", inv.Email))
			return
		}
		if inv.Email == "" {
			if err := s.store.BindUserInviteEmail(inv.ID, email); err != nil {
				writeInternal(w, err)
				return
			}
			inv.Email = email
		}
	}

	// The invited person has no language yet: the mail is in the language of the one inviting
	lang := s.requestLanguage(r)
	inviter := s.actorName(lang, auth.GetUserID(r.Context()))
	link := s.appLink(r) + "?invite=" + url.QueryEscape(inv.Code)
	until := inv.ExpiresAt
	if t, err := time.Parse(time.RFC3339, inv.ExpiresAt); err == nil {
		until = i18n.ShortDate(lang, t.Local())
	}
	invites := i18n.T(lang, "{name} lädt dich zu MindSift ein", "name", inviter)
	allowLongWork(w)
	err = s.sendMailContent(email, invites, mailContent{
		Lang:      lang,
		Preheader: invites,
		Greeting:  mailGreeting(lang, time.Now(), ""),
		Intro:     i18n.T(lang, "{name} lädt dich zu MindSift ein – Gedanken abladen, Aufgaben, Notizen und gemeinsame Listen an einem Ort.", "name", inviter),
		Button:    &mailButton{Label: i18n.T(lang, "Konto anlegen"), URL: link},
		Note: i18n.T(lang, "Die Einladung gilt bis {date}.", "date", until) + " " + i18n.T(lang, "Falls der Knopf nicht geht: {link}", "link", link) + "\n" +
			i18n.T(lang, "Einladungscode: {code}", "code", inv.Code),
		Footer: i18n.T(lang, "Du bekommst diese E-Mail, weil dich jemand zu MindSift eingeladen hat."),
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, tr(w, "E-Mail-Versand fehlgeschlagen")+": "+trErr(w, err))
		return
	}
	writeJSON(w, http.StatusOK, inv)
}
