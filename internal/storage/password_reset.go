package storage

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"
)

// Password reset: the user gets a random link token by mail. Only its SHA-256 hash is stored, so a
// leaked database does not contain usable links. A token works once and for one hour; a new password
// also ends all sessions (token_version).

const (
	resetTokenTTL      = time.Hour
	resetTokenCooldown = 2 * time.Minute // no new mail for the same account within this time
)

var (
	ErrResetTokenInvalid = errors.New("Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.")
	ErrResetTooSoon      = errors.New("reset requested again too soon")
)

func (s *Store) migratePasswordReset() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
		token_hash TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		created_at TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		used_at TEXT NOT NULL DEFAULT ''
	)`)
	return err
}

func hashResetToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// CreatePasswordResetToken returns a new raw token for the user, or ErrResetTooSoon while the last
// one is younger than the cooldown.
func (s *Store) CreatePasswordResetToken(userID string) (string, error) {
	now := time.Now().UTC()
	var last sql.NullString
	if err := s.db.QueryRow(`SELECT MAX(created_at) FROM password_reset_tokens WHERE user_id = ?`, userID).Scan(&last); err != nil {
		return "", err
	}
	if last.Valid {
		if t, err := time.Parse(time.RFC3339, last.String); err == nil && now.Sub(t) < resetTokenCooldown {
			return "", ErrResetTooSoon
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	raw := hex.EncodeToString(buf)
	// Expired and used tokens are of no use any more
	s.execLogged(`DELETE FROM password_reset_tokens WHERE expires_at < ? OR used_at != ''`, now.Format(time.RFC3339))
	_, err := s.db.Exec(`INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		hashResetToken(raw), userID, now.Format(time.RFC3339), now.Add(resetTokenTTL).Format(time.RFC3339))
	return raw, err
}

// ResetPasswordWithToken sets a new password hash if the token is valid and returns the user ID.
// All other open tokens of the user become invalid as well.
func (s *Store) ResetPasswordWithToken(raw, passwordHash string) (string, error) {
	var userID, expires, used string
	var active bool
	err := s.db.QueryRow(`SELECT t.user_id, t.expires_at, t.used_at, u.is_active FROM password_reset_tokens t
		JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`, hashResetToken(raw)).Scan(&userID, &expires, &used, &active)
	if err != nil {
		return "", ErrResetTokenInvalid
	}
	exp, perr := time.Parse(time.RFC3339, expires)
	if used != "" || !active || perr != nil || time.Now().UTC().After(exp) {
		return "", ErrResetTokenInvalid
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.db.Exec(`UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at = ''`, now, hashResetToken(raw))
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return "", ErrResetTokenInvalid // used in parallel
	}
	// New password and the end of every other open link belong together
	return userID, s.execInTx(
		stmt(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at = ''`, now, userID),
		stmt(`UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?`, passwordHash, userID),
	)
}
