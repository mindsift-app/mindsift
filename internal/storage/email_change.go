package storage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A new login address is taken only once its owner clicks the link mailed to it, so nobody can send mail
// from this instance to a stranger or lose the account to a typo. Mail alarms go to the login address too.
// Until then the old address stays in use and the new one waits here (one per person; kind is always
// "account" since alarms lost their own address, migration 35). Without a
// mail server the link never goes out and the address keeps waiting. Only the token's hash is stored.

const (
	EmailChangeAccount = "account"

	emailChangeTTL      = 48 * time.Hour
	emailChangeCooldown = 2 * time.Minute // no second mail for the same address within this time
)

var (
	ErrEmailChangeInvalid = errors.New("Der Bestätigungslink ist ungültig oder abgelaufen. Bitte gib die neue Adresse in den Einstellungen noch einmal ein.")
	ErrEmailTaken         = errors.New("E-Mail-Adresse existiert bereits")
)

func (s *Store) migrateEmailChanges() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS email_changes (
			user_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			email TEXT NOT NULL,
			token_hash TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			PRIMARY KEY (user_id, kind)
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_email_changes_token ON email_changes(token_hash)`),
	)
}

// migrateAlarmToLoginAddress: mail alarms had an address of their own, which stayed behind when the login
// address changed. They go to the login address now; addresses kept for them and waiting ones are dropped.
func (s *Store) migrateAlarmToLoginAddress() error {
	return s.execInTx(
		stmt(`DELETE FROM email_changes WHERE kind = 'alarm'`),
		stmt(`UPDATE users SET alarm_email = ''`),
	)
}

// PendingEmailChange is an address waiting for its confirmation.
type PendingEmailChange struct {
	Email     string
	CreatedAt time.Time
}

// RequestEmailChange records the new address of this kind (replacing an earlier one) and returns a
// fresh raw token for the link. ErrResetTooSoon when the same address got a link within the cooldown;
// the address still waits then.
func (s *Store) RequestEmailChange(userID, kind, email string) (string, error) {
	email = domain.NormalizeEmail(email)
	now := time.Now().UTC()
	var oldEmail, created string
	err := s.db.QueryRow(`SELECT email, created_at FROM email_changes WHERE user_id = ? AND kind = ?`, userID, kind).Scan(&oldEmail, &created)
	if err == nil && oldEmail == email {
		if t, perr := time.Parse(time.RFC3339, created); perr == nil && now.Sub(t) < emailChangeCooldown {
			return "", ErrResetTooSoon
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	raw := hex.EncodeToString(buf)
	_, err = s.db.Exec(`INSERT INTO email_changes (user_id, kind, email, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, kind) DO UPDATE SET email = excluded.email, token_hash = excluded.token_hash,
			created_at = excluded.created_at, expires_at = excluded.expires_at`,
		userID, kind, email, hashResetToken(raw), now.Format(time.RFC3339), now.Add(emailChangeTTL).Format(time.RFC3339))
	return raw, err
}

// PendingEmailChanges returns the waiting addresses of a person by kind.
func (s *Store) PendingEmailChanges(userID string) map[string]PendingEmailChange {
	out := map[string]PendingEmailChange{}
	rows, err := s.db.Query(`SELECT kind, email, created_at FROM email_changes WHERE user_id = ?`, userID)
	if dbFailed(err) {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var kind, email, created string
		if !dbFailed(rows.Scan(&kind, &email, &created)) {
			t, _ := time.Parse(time.RFC3339, created)
			out[kind] = PendingEmailChange{Email: email, CreatedAt: t}
		}
	}
	logDBErr(rows.Err())
	return out
}

// CancelEmailChange drops the waiting address of this kind (its link stops working).
func (s *Store) CancelEmailChange(userID, kind string) error {
	_, err := s.db.Exec(`DELETE FROM email_changes WHERE user_id = ? AND kind = ?`, userID, kind)
	return err
}

// ConfirmEmailChange takes the address of the link as the account's login address (if still free).
// Returns the person as before the change and the kind.
func (s *Store) ConfirmEmailChange(raw string) (*domain.User, string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, "", ErrEmailChangeInvalid
	}
	var userID, kind, email, expires string
	if err := s.db.QueryRow(`SELECT user_id, kind, email, expires_at FROM email_changes WHERE token_hash = ?`, hashResetToken(raw)).
		Scan(&userID, &kind, &email, &expires); err != nil {
		return nil, "", ErrEmailChangeInvalid
	}
	if exp, err := time.Parse(time.RFC3339, expires); err != nil || time.Now().UTC().After(exp) {
		return nil, "", ErrEmailChangeInvalid
	}
	before, err := s.GetUserByID(userID)
	if err != nil || before == nil {
		return nil, "", ErrEmailChangeInvalid
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, "", err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM email_changes WHERE user_id = ? AND kind = ? AND token_hash = ?`, userID, kind, hashResetToken(raw))
	if err != nil {
		return nil, "", err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, "", ErrEmailChangeInvalid // used in parallel
	}
	if kind != EmailChangeAccount {
		return nil, "", ErrEmailChangeInvalid
	}
	var taken int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE LOWER(email) = ? AND id != ?`, email, userID).Scan(&taken); err != nil {
		return nil, "", err
	}
	if taken > 0 {
		return nil, "", ErrEmailTaken
	}
	if _, err = tx.Exec(`UPDATE users SET email = ? WHERE id = ?`, email, userID); err != nil {
		return nil, "", emailTakenErr(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, "", err
	}
	return before, kind, nil
}
