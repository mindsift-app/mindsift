package api

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The command line (internal/cli, `mindsift users …`) changes accounts in the database while the server
// may be running on it. Everything a request checks comes from the database on every request (user row,
// token version, session), so a new password, a deleted account or a changed role count at once. What
// the server keeps in memory is caught up here: the command line records each change in the audit log
// (source cli), and cliEventInterval later the server ends the live connections (WebSocket, SSE) of the
// account, lifts the lock of the sign-in protection after a new password, mails the owner when the second
// factors were removed, and writes the change to its log. A change made while no server runs is not caught
// up later (the server starts at the newest row), so that mail is not sent then.

// cliEventInterval: how often the server looks for changes made on the command line.
const cliEventInterval = 3 * time.Second

// startCLIEventWatcher follows the audit log from the newest row at start (older changes were made
// before this server ran, so nothing in its memory belongs to them).
func (s *Server) startCLIEventWatcher() {
	last, err := s.store.LastAuditID()
	if err != nil {
		slog.Warn("Reading the changes made on the command line failed", "error", err)
	}
	for s.wait(cliEventInterval) {
		last = s.applyCLIEvents(last)
	}
}

// applyCLIEvents handles the command line's rows after last and returns the newest one handled.
func (s *Server) applyCLIEvents(last int64) int64 {
	events, err := s.store.AuditEntriesAfter(last, storage.AuditSourceCLI)
	if err != nil {
		return last
	}
	for _, e := range events {
		last = e.ID
		slog.Info("Changed on the command line", "action", e.Action, "target", e.TargetName,
			"target_id", e.TargetID, "details", string(e.Details), "by", "cli", "at", e.At)
		if e.TargetKind != storage.AuditTargetUser || e.TargetID == "" {
			continue
		}
		// Signed out (new password, other role) or gone: live connections end, as after the same change
		// in the administration
		s.wsHub.DisconnectUser(e.TargetID)
		s.stats.invalidate(e.TargetID)
		switch e.Action {
		case storage.AuditAccountPasswordReset:
			s.loginGuard.unlockAccount(e.TargetID)
			// --disable-2fa: the owner hears about it as after the reset in the administration. The server
			// sends it, not the command line: it has the mail settings (SMTP password from SECRETS_KEY or
			// SMTP_PASS) and the language and link of the account, and a slow mail server does not hold up
			// the command
			var d struct {
				SecondFactorsRemoved bool `json:"secondFactorsRemoved"`
			}
			if json.Unmarshal(e.Details, &d) == nil && d.SecondFactorsRemoved {
				if u, _ := s.store.GetUserByID(e.TargetID); u != nil {
					s.notifySecurityChange(u, securityChangeReset)
				}
			}
		case storage.AuditAccountDeleted:
			// Counters of others included what the account shared
			s.stats.clear()
		}
	}
	return last
}

// AccountTools are the steps of the administration the command line shares with the admin API, without
// a running server: no hub, no background jobs, only configuration and store.
type AccountTools struct{ s *Server }

// NewAccountTools: cfg needs DatabasePath (the backups lie next to the database).
func NewAccountTools(cfg *config.Config, store *storage.Store) *AccountTools {
	return &AccountTools{s: &Server{cfg: cfg, store: store}}
}

// DeleteAccount deletes the account with its data, as the administration does (handleAdminDeleteUser).
func (t *AccountTools) DeleteAccount(u *domain.User) error {
	return t.s.deleteAccount(u.ID, u, time.Now())
}

// ValidEmail: the rule of the administration for login addresses (a bare address).
func ValidEmail(email string) bool { return validEmail(email) }
