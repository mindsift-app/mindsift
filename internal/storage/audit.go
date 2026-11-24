package storage

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The audit log of the administration: who changed accounts, roles and server settings, and when. One
// row per change, written by the server (admin API, OIDC role sync, the account from ADMIN_USER) and by
// the command line (internal/cli). The running server reads the command line's rows as well
// (AuditEntriesAfter): it ends live connections and lifts the sign-in lock for them
// (api/cli_support.go). Of what people do with their own account only the security-relevant steps are
// recorded (account.password_changed and the other own-account actions below, actor and target the same
// account); their work on their own content and settings is not.
//
// Details are small JSON objects without secrets: a changed password, SMTP password or webhook address
// is recorded as changed, never with its value. No IP addresses: the actor is a signed-in account (or
// the command line), which is what the log is for; the request log has the address for a while if needed.

// Who acted (actor_kind).
const (
	AuditActorUser   = "user"   // a signed-in account (actor_id, actor_name)
	AuditActorCLI    = "cli"    // the command line in the container (mindsift users …)
	AuditActorOIDC   = "oidc"   // the sign-in provider: account created at first sign-in, role from its group
	AuditActorSystem = "system" // the server itself (the account from ADMIN_USER)
)

// Where the change came from (source).
const (
	AuditSourceWeb    = "web"
	AuditSourceCLI    = "cli"
	AuditSourceOIDC   = "oidc"
	AuditSourceSystem = "system"
)

// What a row is about (target_kind).
const (
	AuditTargetUser         = "user"
	AuditTargetSettings     = "settings"
	AuditTargetInvite       = "invite"
	AuditTargetOrganization = "organization"
	AuditTargetBackup       = "backup"
	AuditTargetSpeechModel  = "speech_model" // a model of the Whisper server, target_name its id
)

// Actions: stable keys, the app translates them.
const (
	AuditAccountCreated            = "account.created"
	AuditAccountDeleted            = "account.deleted"
	AuditAccountDisabled           = "account.disabled"
	AuditAccountEnabled            = "account.enabled"
	AuditAccountApproved           = "account.approved"
	AuditAccountRoleChanged        = "account.role_changed"
	AuditAccountUpdated            = "account.updated"
	AuditAccountPasswordReset      = "account.password_reset"
	AuditAccountMFAReset           = "account.mfa_reset"
	AuditAccountRegistered         = "account.registered"          // signed up on the login page, without invite
	AuditAccountUnconfirmedDeleted = "account.unconfirmed_deleted" // address not confirmed in time, deleted by the server
	AuditInviteRedeemed            = "invite.redeemed"
	AuditInviteCreated             = "invite.created"
	AuditInviteRevoked             = "invite.revoked"
	AuditInviteSent                = "invite.sent"
	AuditOrgCreated                = "organization.created"
	AuditOrgRenamed                = "organization.renamed"
	AuditOrgDeleted                = "organization.deleted"
	AuditOrgMemberAdded            = "organization.member_added"
	AuditOrgMemberRemoved          = "organization.member_removed"
	AuditSettingsChanged           = "settings.changed"
	AuditSetupFinished             = "setup.finished"
	AuditBackupCreated             = "backup.created"
	AuditBackupDeleted             = "backup.deleted"
	AuditBackupDownloaded          = "backup.downloaded"
	AuditBackupRestored            = "backup.restored"       // the whole instance from a full backup (in the restored log)
	AuditBackupRestoreFailed       = "backup.restore_failed" // the restored data did not open; the previous data stayed
	AuditBackupTakenOver           = "backup.taken_over"     // the desktop app took an account of a server backup over (details.account)
	AuditSpeechModelDownload       = "speech_model.download" // the admin asked the Whisper server for a model
	AuditSpeechModelDeleted        = "speech_model.deleted"
)

// Security-relevant steps a person took on their own account (actor = target): what weakens or widens
// access. Everyday work on their own content and settings is not recorded.
const (
	AuditAccountPasswordChanged      = "account.password_changed"       // own password, also through the mail link (details.via)
	AuditAccountTOTPDisabled         = "account.totp_disabled"          // authenticator app removed (details.mfaOff: no second factor left)
	AuditAccountPasskeyRemoved       = "account.passkey_removed"        // details.name, details.mfaOff
	AuditAccountRecoveryCodesRenewed = "account.recovery_codes_renewed" // new recovery codes, the earlier ones stop working
	AuditAccountAPIKeyCreated        = "account.api_key_created"        // details.name, details.scopes; never the key
	AuditAccountAPIKeyDeleted        = "account.api_key_deleted"        // a key or an AI connection (details.kind "oauth")
	AuditAccountAPIKeyUpdated        = "account.api_key_updated"        // renamed or other rights (details.previousName, details.previousScopes)
	AuditAccountSessionEnded         = "account.session_ended"          // one device signed out (details.device: its user agent)
	AuditAccountSessionsRevoked      = "account.sessions_revoked"       // signed out everywhere
)

// AuditKeep: how long a row stays (PruneAudit, hourly).
const AuditKeep = 365 * 24 * time.Hour

// AuditEntry is one row of the audit log.
type AuditEntry struct {
	ID         int64           `json:"id"`
	At         string          `json:"at"` // RFC 3339, UTC
	ActorKind  string          `json:"actorKind"`
	ActorID    string          `json:"actorId,omitempty"`
	ActorName  string          `json:"actorName,omitempty"` // username at that time
	Action     string          `json:"action"`
	TargetKind string          `json:"targetKind,omitempty"`
	TargetID   string          `json:"targetId,omitempty"`
	TargetName string          `json:"targetName,omitempty"` // username, setting area, organization or file name at that time
	Details    json.RawMessage `json:"details,omitempty"`
	Source     string          `json:"source"`
}

// migrateAuditLog is migration 60: the audit log takes the place of cli_events (migration 54); what the
// command line recorded so far moves over.
func (s *Store) migrateAuditLog() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS audit_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			created_at TEXT NOT NULL,
			actor_kind TEXT NOT NULL,
			actor_id TEXT NOT NULL DEFAULT '',
			actor_name TEXT NOT NULL DEFAULT '',
			action TEXT NOT NULL,
			target_kind TEXT NOT NULL DEFAULT '',
			target_id TEXT NOT NULL DEFAULT '',
			target_name TEXT NOT NULL DEFAULT '',
			details TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id) WHERE actor_id != ''`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_id) WHERE target_id != ''`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`),
		// Details of the old rows: "role=admin" (create), "role member -> admin" (role), "…, second factors
		// removed" (new password); the counts of a deletion are left out
		stmt(`INSERT INTO audit_log (created_at, actor_kind, action, target_kind, target_id, target_name, details, source)
			SELECT created_at, 'cli',
				CASE action
					WHEN 'users-create' THEN 'account.created'
					WHEN 'users-delete' THEN 'account.deleted'
					WHEN 'reset-password' THEN 'account.password_reset'
					ELSE 'account.role_changed' END,
				'user', user_id, username,
				CASE
					WHEN action = 'users-create' AND detail LIKE 'role=%' THEN json_object('role', substr(detail, 6))
					WHEN action IN ('make-admin', 'revoke-admin') AND instr(detail, ' -> ') > 0 THEN json_object(
						'from', substr(detail, 6, instr(detail, ' -> ') - 6),
						'to', substr(detail, instr(detail, ' -> ') + 4))
					WHEN action = 'reset-password' AND detail LIKE '%second factors removed%' THEN '{"secondFactorsRemoved":true}'
					ELSE '' END,
				'cli'
			FROM cli_events
			WHERE action IN ('users-create', 'users-delete', 'reset-password', 'make-admin', 'revoke-admin')
			ORDER BY id`),
		stmt(`DROP TABLE IF EXISTS cli_events`),
	)
}

// AuditUserTarget: an account as the target of a row (the server's and the command line's).
func AuditUserTarget(u *domain.User) AuditEntry {
	if u == nil {
		return AuditEntry{TargetKind: AuditTargetUser}
	}
	return AuditEntry{TargetKind: AuditTargetUser, TargetID: u.ID, TargetName: AuditName(u)}
}

// AuditName: how a row names an account, the username, else the display name (accounts from before usernames).
func AuditName(u *domain.User) string {
	if u.Username != "" {
		return u.Username
	}
	return u.DisplayName
}

// RecordAudit adds a row; At is set to now when empty. details is marshalled to JSON (nil: none).
func (s *Store) RecordAudit(e AuditEntry, details any) error {
	if e.At == "" {
		e.At = nowUTC()
	}
	raw := ""
	if details != nil {
		b, err := json.Marshal(details)
		if err != nil {
			return err
		}
		if string(b) != "null" && string(b) != "{}" {
			raw = string(b)
		}
	}
	_, err := s.db.Exec(`INSERT INTO audit_log (created_at, actor_kind, actor_id, actor_name, action, target_kind, target_id, target_name, details, source)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.At, e.ActorKind, e.ActorID, e.ActorName, e.Action, e.TargetKind, e.TargetID, e.TargetName, raw, e.Source)
	return err
}

// AuditFilter narrows AuditEntries.
type AuditFilter struct {
	Action   string // exact key ("account.role_changed") or a category with a dot at the end ("account.")
	UserID   string // rows the account did or that concern it
	BeforeID int64  // paging: rows older than this id (0: from the newest)
	Limit    int    // 1–500, default 50
}

const auditColumns = `id, created_at, actor_kind, actor_id, actor_name, action, target_kind, target_id, target_name, details, source`

// AuditEntries returns rows newest first.
func (s *Store) AuditEntries(f AuditFilter) ([]AuditEntry, error) {
	var where []string
	var args []any
	if a := strings.TrimSpace(f.Action); a != "" {
		if strings.HasSuffix(a, ".") {
			where = append(where, `substr(action, 1, ?) = ?`)
			args = append(args, len(a), a)
		} else {
			where = append(where, `action = ?`)
			args = append(args, a)
		}
	}
	if f.UserID != "" {
		where = append(where, `(actor_id = ? OR (target_kind = 'user' AND target_id = ?))`)
		args = append(args, f.UserID, f.UserID)
	}
	if f.BeforeID > 0 {
		where = append(where, `id < ?`)
		args = append(args, f.BeforeID)
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	limit = min(limit, 500)
	q := `SELECT ` + auditColumns + ` FROM audit_log`
	if len(where) > 0 {
		q += ` WHERE ` + strings.Join(where, ` AND `)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	return s.queryAudit(q, args...)
}

// LastAuditID: the newest row (0 without any), where the server starts following the command line.
func (s *Store) LastAuditID() (int64, error) {
	var id sql.NullInt64
	err := s.db.QueryRow(`SELECT MAX(id) FROM audit_log`).Scan(&id)
	return id.Int64, err
}

// AuditEntriesAfter returns the rows of one source newer than id, oldest first, at most 100.
func (s *Store) AuditEntriesAfter(id int64, source string) ([]AuditEntry, error) {
	return s.queryAudit(`SELECT `+auditColumns+` FROM audit_log WHERE id > ? AND source = ? ORDER BY id LIMIT 100`, id, source)
}

func (s *Store) queryAudit(q string, args ...any) ([]AuditEntry, error) {
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var details string
		if err := rows.Scan(&e.ID, &e.At, &e.ActorKind, &e.ActorID, &e.ActorName, &e.Action, &e.TargetKind, &e.TargetID, &e.TargetName, &details, &e.Source); err != nil {
			return nil, err
		}
		if details != "" && json.Valid([]byte(details)) {
			e.Details = json.RawMessage(details)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// PruneAudit removes rows older than AuditKeep and returns how many went.
func (s *Store) PruneAudit(now time.Time) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM audit_log WHERE created_at < ?`, now.Add(-AuditKeep).UTC().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
