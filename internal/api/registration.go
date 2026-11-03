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
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Registration without an invite (mode and e-mail domains), approval of waiting accounts, and sending
// invite links by mail. See Doku/plans/registrierung-und-login.md.

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
			return false, errors.New("Registrierung nur mit E-Mail-Adressen von " + domainList(p.Domains))
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
			slog.Warn("Bestätigungslink konnte nicht erzeugt werden", "user_id", user.ID, "error", err)
		}
		return
	}
	link := strings.TrimRight(s.cfg.BaseURL, "/") + "/?verifyToken=" + url.QueryEscape(raw)
	err = s.sendMailContent(user.Email, "MindSift: Bitte bestätige deine E-Mail-Adresse", mailContent{
		Preheader: "Ein Klick, dann ist dein Konto bereit",
		Greeting:  mailGreeting(time.Now(), user.DisplayName),
		Intro:     "Du hast dich bei MindSift registriert. Bitte bestätige noch deine E-Mail-Adresse.",
		Button:    &mailButton{Label: "E-Mail-Adresse bestätigen", URL: link},
		Note: "Der Link gilt 48 Stunden. Hast du dich nicht registriert, ignoriere diese E-Mail – das Konto wird dann automatisch gelöscht.\n" +
			"Falls der Knopf nicht geht: " + link,
		Footer: mailFooterAccount,
	})
	if err != nil {
		slog.Warn("Bestätigungs-E-Mail nicht verschickt", "user_id", user.ID, "error", err)
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
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	user, err := s.store.GetUserByID(userID)
	if err != nil || user == nil {
		writeError(w, http.StatusBadRequest, storage.ErrVerificationInvalid.Error())
		return
	}
	if s.store.IsPendingRegistration(userID) {
		go s.notifyAdminsOfRegistration(user)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"verified": true, "pending": true,
			"message": "Deine E-Mail-Adresse ist bestätigt. Ein Administrator schaltet dein Konto noch frei – du bekommst dann eine E-Mail.",
		})
		return
	}
	active := true
	if _, err := s.store.UpdateUser(userID, nil, nil, nil, &active, nil, nil); err != nil {
		writeError(w, http.StatusInternalServerError, "Konto konnte nicht freigeschaltet werden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"verified": true, "pending": false,
		"message": "Deine E-Mail-Adresse ist bestätigt. Du kannst dich jetzt anmelden.",
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
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	return scheme + "://" + host + "/"
}

// notifyAdminsOfRegistration mails every active admin that someone waits (only with SMTP).
func (s *Server) notifyAdminsOfRegistration(user *domain.User) {
	if _, err := s.smtpSettings(); err != nil {
		return
	}
	users, err := s.store.GetAllUsers()
	if err != nil {
		return
	}
	for _, a := range users {
		if a.Role != "admin" || !a.IsActive || a.Email == "" {
			continue
		}
		c := mailContent{
			Preheader: user.DisplayName + " wartet auf Freigabe",
			Greeting:  mailGreeting(time.Now(), a.DisplayName),
			Intro:     "Jemand hat sich bei MindSift registriert und wartet auf deine Freigabe:",
			Sections:  []mailSection{{Items: []mailItem{{Title: user.DisplayName, Meta: user.Email}}}},
			Outro:     "Freigeben oder ablehnen kannst du in den Administrator-Einstellungen unter „Benutzer & Einladungen“.",
			Footer:    "Du bekommst diese E-Mail als Administrator dieser MindSift-Instanz.",
		}
		if link := s.notifyLink(); link != "" {
			c.Button = &mailButton{Label: "Benutzerverwaltung öffnen", URL: link}
		}
		if err := s.sendMailContent(a.Email, "MindSift: Neue Registrierung wartet auf Freigabe", c); err != nil {
			slog.Warn("Hinweis auf neue Registrierung nicht verschickt", "admin", a.ID, "error", err)
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
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusConflict, "Dieses Konto wartet nicht auf Freigabe")
		return
	}
	user.IsActive = true
	s.store.ClearEmailVerification(userID) // the admin vouches for the account
	link := s.appLink(r)
	go func() {
		_ = s.sendMailContent(user.Email, "MindSift: Dein Konto ist freigeschaltet", mailContent{
			Preheader: "Du kannst dich jetzt anmelden",
			Greeting:  mailGreeting(time.Now(), user.DisplayName),
			Intro:     "Dein MindSift-Konto ist freigeschaltet. Du kannst dich jetzt mit deiner E-Mail-Adresse und deinem Passwort anmelden.",
			Button:    &mailButton{Label: "Zu MindSift", URL: link},
			Footer:    mailFooterAccount,
		})
	}()
	writeJSON(w, http.StatusOK, user)
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
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if _, err := s.smtpSettings(); err != nil {
		writeError(w, http.StatusBadRequest, "Für Einladungen per E-Mail muss ein Mail-Server eingerichtet sein")
		return
	}
	inv, err := s.store.GetUserInviteByID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if inv.MaxUses == 1 {
		if inv.Email != "" && !strings.EqualFold(inv.Email, email) {
			writeError(w, http.StatusConflict, "Diese Einladung ist an "+inv.Email+" gebunden")
			return
		}
		if inv.Email == "" {
			if err := s.store.BindUserInviteEmail(inv.ID, email); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			inv.Email = email
		}
	}

	inviter := "Jemand"
	if me, _ := s.store.GetUserByID(auth.GetUserID(r.Context())); me != nil && me.DisplayName != "" {
		inviter = me.DisplayName
	}
	link := s.appLink(r) + "?invite=" + url.QueryEscape(inv.Code)
	until := inv.ExpiresAt
	if t, err := time.Parse(time.RFC3339, inv.ExpiresAt); err == nil {
		until = t.Local().Format("02.01.2006")
	}
	err = s.sendMailContent(email, inviter+" lädt dich zu MindSift ein", mailContent{
		Preheader: inviter + " lädt dich zu MindSift ein",
		Greeting:  "Hallo",
		Intro:     inviter + " lädt dich zu MindSift ein – Gedanken abladen, Aufgaben, Notizen und gemeinsame Listen an einem Ort.",
		Button:    &mailButton{Label: "Konto anlegen", URL: link},
		Note:      "Die Einladung gilt bis " + until + ". Falls der Knopf nicht geht: " + link + "\nEinladungscode: " + inv.Code,
		Footer:    "Du bekommst diese E-Mail, weil dich jemand zu MindSift eingeladen hat.",
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "E-Mail-Versand fehlgeschlagen: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inv)
}
