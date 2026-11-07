package storage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

// Registration without an invite: who may register (mode), from which e-mail domains, and accounts
// that wait for an admin's approval (they exist with is_active = 0 until approved).

const (
	RegistrationClosed         = "closed"          // only with an invite
	RegistrationApproval       = "approval"        // anyone, active after approval
	RegistrationDomain         = "domain"          // only listed e-mail domains, active at once
	RegistrationDomainApproval = "domain+approval" // listed domains at once, others after approval
	RegistrationOpen           = "open"            // anyone, active at once

	// MaxPendingRegistrations stops a flood of sign-ups while approval is needed
	MaxPendingRegistrations = 50
)

// NormalizeRegistrationMode returns a known mode, "" for anything else.
func NormalizeRegistrationMode(mode string) string {
	switch m := strings.ToLower(strings.TrimSpace(mode)); m {
	case RegistrationClosed, RegistrationApproval, RegistrationDomain, RegistrationDomainApproval, RegistrationOpen:
		return m
	}
	return ""
}

// ParseEmailDomains turns "firma.de, @Familie.de" into ["firma.de", "familie.de"].
func ParseEmailDomains(raw string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' || r == ' ' || r == '\n' }) {
		d := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(part), "@"))
		if d == "" || !strings.Contains(d, ".") || seen[d] {
			continue
		}
		seen[d] = true
		out = append(out, d)
	}
	return out
}

// EmailInDomains: the part after "@" equals one of the domains; "*.firma.de" also allows subdomains.
func EmailInDomains(email string, domains []string) bool {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(email[at+1:]))
	for _, d := range domains {
		if strings.HasPrefix(d, "*.") {
			if base := d[2:]; host == base || strings.HasSuffix(host, "."+base) {
				return true
			}
		} else if host == d {
			return true
		}
	}
	return false
}

func (s *Store) migrateRegistration() error {
	for _, q := range []string{
		`ALTER TABLE user_invites ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE user_invites ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0`,
		`UPDATE user_invites SET use_count = 1 WHERE used_by != '' AND use_count = 0`,
		`CREATE TABLE IF NOT EXISTS pending_registrations (
			user_id TEXT PRIMARY KEY,
			created_at TEXT NOT NULL
		)`,
	} {
		if err := s.execSchemaStatement(q); err != nil {
			return err
		}
	}
	return nil
}

// migrateInviteCleanup records when an invite was used up, so it can be removed 30 days later. Invites
// used up before get the creation time of the account that redeemed them (else their own).
func (s *Store) migrateInviteCleanup() error {
	for _, q := range []string{
		`ALTER TABLE user_invites ADD COLUMN used_up_at TEXT NOT NULL DEFAULT ''`,
		`UPDATE user_invites SET used_up_at = COALESCE((SELECT u.created_at FROM users u WHERE u.id = user_invites.used_by), created_at)
		 WHERE use_count >= max_uses AND used_up_at = ''`,
	} {
		if err := s.execSchemaStatement(q); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) AddPendingRegistration(userID string) error {
	_, err := s.db.Exec(`INSERT OR IGNORE INTO pending_registrations (user_id, created_at) VALUES (?, ?)`,
		userID, time.Now().UTC().Format(time.RFC3339))
	return err
}

func (s *Store) ClearPendingRegistration(userID string) {
	_, _ = s.db.Exec(`DELETE FROM pending_registrations WHERE user_id = ?`, userID)
}

func (s *Store) IsPendingRegistration(userID string) bool {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM pending_registrations WHERE user_id = ?`, userID).Scan(&n)
	return n > 0
}

// PendingRegistrationIDs: accounts that still wait for approval (only existing users).
func (s *Store) PendingRegistrationIDs() map[string]bool {
	out := map[string]bool{}
	rows, err := s.db.Query(`SELECT p.user_id FROM pending_registrations p JOIN users u ON u.id = p.user_id`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			out[id] = true
		}
	}
	return out
}

// ApprovePendingRegistration activates a waiting account; false when it was not waiting.
func (s *Store) ApprovePendingRegistration(userID string) (bool, error) {
	if !s.IsPendingRegistration(userID) {
		return false, nil
	}
	if err := s.execInTx(
		stmt(`UPDATE users SET is_active = 1 WHERE id = ?`, userID),
		stmt(`DELETE FROM pending_registrations WHERE user_id = ?`, userID),
	); err != nil {
		return false, err
	}
	return true, nil
}

// --- E-mail verification ---
// Accounts registered without invite while verification is on stay locked until the link in the
// mail is opened. Only the SHA-256 of the token is stored (like password reset links); unconfirmed
// accounts are deleted after EmailVerificationTTL so the address is free again.

const (
	EmailVerificationTTL      = 48 * time.Hour
	emailVerificationCooldown = 2 * time.Minute // no second mail for the same account within this time
)

var ErrVerificationInvalid = errors.New("Der Bestätigungslink ist ungültig oder abgelaufen. Bitte registriere dich erneut.")

func (s *Store) migrateEmailVerification() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS email_verifications (
			user_id TEXT PRIMARY KEY,
			token_hash TEXT NOT NULL,
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token_hash)`),
	)
}

// CreateEmailVerification returns a new raw token for the account (the previous one stops working),
// or ErrResetTooSoon while the last mail is younger than the cooldown. The expiry of the account stays
// counted from the registration.
func (s *Store) CreateEmailVerification(userID string) (string, error) {
	now := time.Now().UTC()
	var created, expires string
	err := s.db.QueryRow(`SELECT created_at, expires_at FROM email_verifications WHERE user_id = ?`, userID).Scan(&created, &expires)
	if err == nil {
		if t, perr := time.Parse(time.RFC3339, created); perr == nil && now.Sub(t) < emailVerificationCooldown {
			return "", ErrResetTooSoon
		}
	} else {
		expires = now.Add(EmailVerificationTTL).Format(time.RFC3339)
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	raw := hex.EncodeToString(buf)
	_, err = s.db.Exec(`INSERT INTO email_verifications (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`,
		userID, hashResetToken(raw), now.Format(time.RFC3339), expires)
	return raw, err
}

// ConfirmEmailVerification checks the token, ends the verification and returns the account.
func (s *Store) ConfirmEmailVerification(raw string) (string, error) {
	var userID, expires string
	if err := s.db.QueryRow(`SELECT user_id, expires_at FROM email_verifications WHERE token_hash = ?`, hashResetToken(raw)).
		Scan(&userID, &expires); err != nil {
		return "", ErrVerificationInvalid
	}
	if exp, err := time.Parse(time.RFC3339, expires); err != nil || time.Now().UTC().After(exp) {
		return "", ErrVerificationInvalid
	}
	res, err := s.db.Exec(`DELETE FROM email_verifications WHERE user_id = ? AND token_hash = ?`, userID, hashResetToken(raw))
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return "", ErrVerificationInvalid // used in parallel
	}
	return userID, nil
}

func (s *Store) IsEmailUnverified(userID string) bool {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM email_verifications WHERE user_id = ?`, userID).Scan(&n)
	return n > 0
}

func (s *Store) ClearEmailVerification(userID string) {
	_, _ = s.db.Exec(`DELETE FROM email_verifications WHERE user_id = ?`, userID)
}

// UnverifiedEmailIDs: accounts whose address is not confirmed yet.
func (s *Store) UnverifiedEmailIDs() map[string]bool {
	out := map[string]bool{}
	rows, err := s.db.Query(`SELECT user_id FROM email_verifications`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			out[id] = true
		}
	}
	return out
}

// PurgeUnverifiedAccounts deletes accounts whose confirmation link expired unused; returns how many.
func (s *Store) PurgeUnverifiedAccounts(now time.Time) int {
	rows, err := s.db.Query(`SELECT user_id FROM email_verifications WHERE expires_at < ?`, now.UTC().Format(time.RFC3339))
	if err != nil {
		return 0
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	_ = rows.Close()
	n := 0
	for _, id := range ids {
		if err := s.DeleteUser(id); err == nil {
			n++
		}
		s.ClearEmailVerification(id)
		s.ClearPendingRegistration(id)
	}
	return n
}
