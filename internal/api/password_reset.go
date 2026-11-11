package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// passwordResetAvailable: mails can be sent and links point to a known address (BASE_URL).
func (s *Server) passwordResetAvailable() bool {
	if !s.cfg.BaseURLSet || s.cfg.DemoMode {
		return false
	}
	_, err := s.smtpSettings()
	return err == nil
}

// handleForgotPassword always answers the same, whether the address exists or not, and sends the mail
// in the background so the response time does not tell either.
func (s *Server) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	if !s.passwordResetAvailable() {
		writeError(w, http.StatusServiceUnavailable, "Passwort-Zurücksetzen ist auf diesem Server nicht eingerichtet. Bitte wende dich an die Administration.")
		return
	}
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
	go func() {
		user, err := s.store.GetUserByEmail(email)
		if err != nil || user == nil || !user.IsActive {
			return
		}
		token, err := s.store.CreatePasswordResetToken(user.ID)
		if err != nil {
			if !errors.Is(err, storage.ErrResetTooSoon) {
				slog.Warn("Password reset: creating the token failed", "error", err)
			}
			return
		}
		link := strings.TrimRight(s.cfg.BaseURL, "/") + "/?resetToken=" + url.QueryEscape(token)
		lang := s.userLanguage(user.ID)
		err = s.sendMailContent(user.Email, i18n.T(lang, "MindSift: Passwort zurücksetzen"), mailContent{
			Lang:      lang,
			Preheader: i18n.T(lang, "Lege ein neues Passwort für dein MindSift-Konto fest"),
			Greeting:  mailGreeting(lang, time.Now(), user.DisplayName),
			Intro:     i18n.T(lang, "Für dein MindSift-Konto wurde ein neues Passwort angefordert. Über den Knopf kannst du es innerhalb der nächsten Stunde festlegen."),
			Button:    &mailButton{Label: i18n.T(lang, "Neues Passwort festlegen"), URL: link},
			Note: i18n.T(lang, "Der Link funktioniert nur einmal. Hast du das nicht angefordert, ignoriere diese E-Mail – dein Passwort bleibt unverändert.") + "\n" +
				i18n.T(lang, "Falls der Knopf nicht geht: {link}", "link", link),
			Footer: mailFooterAccount(lang),
		})
		if err != nil {
			slog.Warn("Password reset email not sent", "user_id", user.ID, "error", err)
		}
	}()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil || req.Token == "" {
		writeError(w, http.StatusBadRequest, storage.ErrResetTokenInvalid.Error())
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Passwort konnte nicht gespeichert werden")
		return
	}
	userID, err := s.store.ResetPasswordWithToken(req.Token, hash)
	if err != nil {
		if errors.Is(err, storage.ErrResetTokenInvalid) {
			writeErrorFrom(w, http.StatusBadRequest, err)
			return
		}
		writeError(w, http.StatusInternalServerError, "Passwort konnte nicht gespeichert werden")
		return
	}
	s.loginGuard.unlockAccount(userID)
	s.wsHub.DisconnectUser(userID)
	slog.Info("Password reset by email link", "user_id", userID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
