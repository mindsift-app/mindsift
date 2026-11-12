package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The setup wizard's questions about mail: the administrator's address (after an admin from ADMIN_USER
// without ADMIN_EMAIL), the mail server when the environment sets none, and a closing summary that says
// what is still open (no mail server, no BASE_URL) and where the backups go. The address is confirmed
// the usual way (email_change.go): it waits until its owner clicks the link mailed to it.

var (
	errSetupSMTPHost = errors.New("Bitte den SMTP-Server angeben oder den Mailserver überspringen")
	errSetupSMTPPort = errors.New("Der SMTP-Port muss eine Zahl von 1 bis 65535 sein")
)

// setupSMTP: the mail server as the wizard asks it, with the field names of the admin settings.
type setupSMTP struct {
	Host       string `json:"smtpHost"`
	Port       string `json:"smtpPort"`
	User       string `json:"smtpUser"`
	Pass       string `json:"smtpPass"`
	From       string `json:"smtpFrom"`
	FromName   string `json:"smtpFromName"`
	TLS        bool   `json:"smtpTls"`
	SkipVerify bool   `json:"smtpSkipVerify"`
}

func (c setupSMTP) check() error {
	if strings.TrimSpace(c.Host) == "" {
		return errSetupSMTPHost
	}
	if port := strings.TrimSpace(c.Port); port != "" {
		if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
			return errSetupSMTPPort
		}
	}
	return nil
}

// settings is the mail server to send with, defaults filled in.
func (c setupSMTP) settings() smtpSettings {
	return smtpSettings{
		Host: strings.TrimSpace(c.Host), Port: strings.TrimSpace(c.Port),
		User: strings.TrimSpace(c.User), Pass: c.Pass, From: strings.TrimSpace(c.From),
		FromName: strings.TrimSpace(c.FromName),
		TLS:      c.TLS, SkipVerify: c.SkipVerify,
	}.withDefaults()
}

// store writes the mail server into the admin settings (the caller saves them).
func (c setupSMTP) store(sys *domain.SystemSettings) {
	sys.SMTPHost = strings.TrimSpace(c.Host)
	sys.SMTPPort = strings.TrimSpace(c.Port)
	if sys.SMTPPort == "" {
		sys.SMTPPort = "587"
	}
	sys.SMTPUser = strings.TrimSpace(c.User)
	sys.SMTPPass = c.Pass
	sys.SMTPFrom = strings.TrimSpace(c.From)
	sys.SMTPFromName = strings.TrimSpace(c.FromName)
	sys.SMTPTLS = c.TLS
	sys.SMTPSkipVerify = c.SkipVerify
}

// setupInfo: what the wizard tells beside its questions. Public while the server has no account (the
// first-boot wizard, whoever fills it becomes the admin), afterwards only for admins (GET /admin/setup/status).
type setupInfo struct {
	// A mail server is set: by SMTP_HOST (SMTPViaEnv) or in the admin settings
	SMTPConfigured bool   `json:"smtpConfigured"`
	SMTPViaEnv     bool   `json:"smtpViaEnv"`
	SMTPHost       string `json:"smtpHost,omitempty"` // admins only
	// BASE_URL is set: without it mails carry no links (password reset, address confirmation)
	BaseURLSet bool `json:"baseUrlSet"`
	// Mails with links can go out now (mail server and BASE_URL)
	EmailLinks bool `json:"emailLinks"`
	// Where the daily backups are written (on the server, i.e. inside the container)
	BackupDir string `json:"backupDir"`
}

func (s *Server) setupInfo(forAdmin bool) setupInfo {
	cfg, err := s.smtpSettings()
	info := setupInfo{
		SMTPConfigured: err == nil,
		SMTPViaEnv:     s.smtpViaEnv(),
		BaseURLSet:     s.cfg.BaseURLSet,
		EmailLinks:     s.emailLinksAvailable(),
		BackupDir:      s.backupRoot(),
	}
	if forAdmin && err == nil {
		info.SMTPHost = cfg.Host
	}
	return info
}

// handleSetupStatus: GET /admin/setup/status – mail server, BASE_URL and backup folder for the wizard's
// summary.
func (s *Server) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.setupInfo(true))
}

// checkSetupEmail: the address the wizard asks of an admin without one – a bare address nobody uses yet.
func (s *Server) checkSetupEmail(raw string) (string, int, error) {
	email := domain.NormalizeEmail(raw)
	if !validEmail(email) {
		return "", http.StatusBadRequest, errors.New("Ungültige E-Mail-Adresse")
	}
	if s.store.EmailInUse(email) {
		return "", http.StatusConflict, storage.ErrEmailTaken
	}
	return email, 0, nil
}

// sendWaitingEmailLink mails the link of the person's waiting login address once mails with links can go
// out (the mail server set up after the address was given in the wizard). The caller knows they could not
// before, so no link went out yet: the address is recorded afresh, past the cooldown against repeated mails.
func (s *Server) sendWaitingEmailLink(userID string) {
	pending, waiting := s.store.PendingEmailChanges(userID)[storage.EmailChangeAccount]
	if !waiting {
		return
	}
	user, err := s.store.GetUserByID(userID)
	if err != nil || user == nil {
		return
	}
	if err := s.store.CancelEmailChange(userID, storage.EmailChangeAccount); err != nil {
		logFailed("Renewing the waiting address", err, "user_id", userID)
		return
	}
	s.requestEmailChange(user, storage.EmailChangeAccount, pending.Email)
}
