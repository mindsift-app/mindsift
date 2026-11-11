package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// New login and alarm addresses wait for the click on a link mailed to them (storage/email_change.go).
// Without a mail server the link cannot go out and the address keeps waiting; the old one stays in use.

// validEmail: a bare address ("anna@example.com"), no display name, no list.
func validEmail(email string) bool {
	addr, err := mail.ParseAddress(email)
	return err == nil && addr.Address == email && strings.Contains(email, "@")
}

// requestEmailChange records the new address and mails it the link (when mails with links can go out).
func (s *Server) requestEmailChange(user *domain.User, kind, email string) {
	raw, err := s.store.RequestEmailChange(user.ID, kind, email)
	if err != nil {
		if !errors.Is(err, storage.ErrResetTooSoon) {
			slog.Warn("Recording the new e-mail address failed", "user_id", user.ID, "kind", kind, "error", err)
		}
		return
	}
	if !s.emailLinksAvailable() {
		return
	}
	link := strings.TrimRight(s.cfg.BaseURL, "/") + "/?confirmEmail=" + url.QueryEscape(raw)
	lang := s.userLanguage(user.ID)
	intro := i18n.T(lang, "Du möchtest diese Adresse als Anmelde-Adresse deines MindSift-Kontos verwenden. Bitte bestätige sie – bis dahin bleibt die bisherige Adresse gültig.")
	if kind == storage.EmailChangeAlarm {
		intro = i18n.T(lang, "Du möchtest an diese Adresse Alarme und Zusammenfassungen von MindSift bekommen. Bitte bestätige sie – bis dahin gehen sie an die bisherige Adresse.")
	}
	go func() {
		err := s.sendMailContent(email, i18n.T(lang, "MindSift: Bitte bestätige deine neue E-Mail-Adresse"), mailContent{
			Lang:      lang,
			Preheader: i18n.T(lang, "Ein Klick, dann gilt die neue Adresse"),
			Greeting:  mailGreeting(lang, time.Now(), user.DisplayName),
			Intro:     intro,
			Button:    &mailButton{Label: i18n.T(lang, "E-Mail-Adresse bestätigen"), URL: link},
			Note: i18n.T(lang, "Der Link gilt 48 Stunden. Hast du das nicht veranlasst, ignoriere diese E-Mail – dann ändert sich nichts.") + "\n" +
				i18n.T(lang, "Falls der Knopf nicht geht: {link}", "link", link),
			Footer: mailFooterAccount(lang),
		})
		if err != nil {
			slog.Warn("Confirmation email for a new address not sent", "user_id", user.ID, "kind", kind, "error", err)
		}
	}()
}

// handleConfirmEmailChange: POST /auth/confirm-email {"token"} – the link from the mail, signed in or not.
func (s *Server) handleConfirmEmailChange(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, storage.ErrEmailChangeInvalid.Error())
		return
	}
	before, kind, err := s.store.ConfirmEmailChange(req.Token)
	switch {
	case errors.Is(err, storage.ErrEmailTaken):
		writeError(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		writeError(w, http.StatusBadRequest, storage.ErrEmailChangeInvalid.Error())
		return
	}
	if kind == storage.EmailChangeAccount {
		after, _ := s.store.GetUserByID(before.ID)
		if after != nil {
			// The previous address learns about it, so a takeover does not go unnoticed
			s.notifyAccountChange(before, false, true, after.Email)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"confirmed": true, "kind": kind,
			"message": tr(w, "Deine neue E-Mail-Adresse ist bestätigt. Du meldest dich ab jetzt mit ihr an."),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"confirmed": true, "kind": kind,
		"message": tr(w, "Deine neue Alarm-Adresse ist bestätigt. Alarme gehen ab jetzt dorthin."),
	})
}

func emailChangeKind(r *http.Request) (string, bool) {
	kind := chi.URLParam(r, "kind")
	return kind, kind == storage.EmailChangeAccount || kind == storage.EmailChangeAlarm
}

// handleCancelEmailChange: DELETE /user/email-change/{kind} – keep the current address.
func (s *Server) handleCancelEmailChange(w http.ResponseWriter, r *http.Request) {
	kind, ok := emailChangeKind(r)
	if !ok {
		writeError(w, http.StatusNotFound, "Nicht gefunden")
		return
	}
	if err := s.store.CancelEmailChange(auth.GetUserID(r.Context()), kind); err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"cancelled": true})
}

// handleResendEmailChange: POST /user/email-change/{kind}/resend – a new link for the waiting address
// (at most every 2 minutes).
func (s *Server) handleResendEmailChange(w http.ResponseWriter, r *http.Request) {
	kind, ok := emailChangeKind(r)
	if !ok {
		writeError(w, http.StatusNotFound, "Nicht gefunden")
		return
	}
	userID := auth.GetUserID(r.Context())
	pending, waiting := s.store.PendingEmailChanges(userID)[kind]
	user, err := s.store.GetUserByID(userID)
	if !waiting || err != nil || user == nil {
		writeError(w, http.StatusNotFound, "Nicht gefunden")
		return
	}
	if !s.emailLinksAvailable() {
		writeError(w, http.StatusServiceUnavailable, "Auf diesem Server ist kein E-Mail-Versand eingerichtet – die Adresse kann nicht bestätigt werden.")
		return
	}
	s.requestEmailChange(user, kind, pending.Email)
	writeJSON(w, http.StatusOK, map[string]bool{"sent": true})
}
