package storage

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

// Two-factor sign-in (api/mfa.go). Per account: one authenticator app (TOTP) whose secret is stored
// encrypted with SECRETS_KEY (the api layer seals and opens it), ten recovery codes of which only a hash
// is kept, each usable once, and the devices that need no code for 30 days. A trusted device is bound to
// the account's token_version: ending all sessions or a new password (own, by reset link or by an admin)
// raises it and so ends the trust on every device; switching the app off removes the rows.

const (
	RecoveryCodeCount = 10
	// TrustedDeviceLifetime: a device trusted at sign-in is asked for no code for this long, then again
	TrustedDeviceLifetime = 30 * 24 * time.Hour
	// maxTrustedDevices: the oldest goes when a person trusts more devices than this
	maxTrustedDevices = 20
)

var (
	ErrTOTPNotFound          = errors.New("Zwei-Faktor-Anmeldung ist nicht eingerichtet")
	ErrTOTPAlreadyActive     = errors.New("Die Zwei-Faktor-Anmeldung ist bereits eingeschaltet")
	ErrTrustedDeviceNotFound = errors.New("Gerät nicht gefunden")
)

func (s *Store) migrateMFA() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS user_totp (
			user_id TEXT PRIMARY KEY,
			secret_sealed TEXT NOT NULL,
			created_at TEXT NOT NULL,
			confirmed_at TEXT NOT NULL DEFAULT '',
			last_step INTEGER NOT NULL DEFAULT 0
		)`),
		stmt(`CREATE TABLE IF NOT EXISTS user_recovery_codes (
			user_id TEXT NOT NULL,
			code_hash TEXT NOT NULL,
			created_at TEXT NOT NULL,
			used_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (user_id, code_hash)
		)`),
		stmt(`CREATE TABLE IF NOT EXISTS trusted_devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			token_hash TEXT NOT NULL,
			token_version INTEGER NOT NULL,
			user_agent TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			last_used_at TEXT NOT NULL DEFAULT ''
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id)`),
	)
}

// UserTOTP: the authenticator app of an account. Confirmed is empty while the setup waits for the
// first code; only a confirmed app is asked for at sign-in.
type UserTOTP struct {
	UserID       string
	SecretSealed string
	CreatedAt    string
	ConfirmedAt  string
	LastStep     int64
}

func (t *UserTOTP) Active() bool { return t != nil && t.ConfirmedAt != "" }

// GetTOTP returns the account's app, also one still waiting for its confirmation; ErrTOTPNotFound if none.
func (s *Store) GetTOTP(userID string) (*UserTOTP, error) {
	t := &UserTOTP{UserID: userID}
	err := s.db.QueryRow(`SELECT secret_sealed, created_at, confirmed_at, last_step FROM user_totp WHERE user_id = ?`, userID).
		Scan(&t.SecretSealed, &t.CreatedAt, &t.ConfirmedAt, &t.LastStep)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrTOTPNotFound
	}
	if err != nil {
		return nil, err
	}
	return t, nil
}

// TOTPActive reports whether the account signs in with a second factor. When the database fails it
// answers yes: a sign-in then fails at the code instead of skipping it.
func (s *Store) TOTPActive(userID string) bool {
	var confirmed string
	err := s.db.QueryRow(`SELECT confirmed_at FROM user_totp WHERE user_id = ?`, userID).Scan(&confirmed)
	if dbFailed(err) {
		return true
	}
	return err == nil && confirmed != ""
}

// StartTOTPSetup stores a new secret waiting for its confirmation (one waiting before is replaced).
// Refused while an app is active: that one is switched off first.
func (s *Store) StartTOTPSetup(userID, secretSealed string, now time.Time) error {
	res, err := s.db.Exec(`INSERT INTO user_totp (user_id, secret_sealed, created_at) VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET secret_sealed = excluded.secret_sealed, created_at = excluded.created_at, last_step = 0
		WHERE user_totp.confirmed_at = ''`, userID, secretSealed, now.UTC().Format(time.RFC3339))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrTOTPAlreadyActive
	}
	return nil
}

// ConfirmTOTP switches the waiting app on with the step of its first code and stores the hashes of new
// recovery codes, all at once. False when there was no waiting app (confirmed in parallel, or none).
func (s *Store) ConfirmTOTP(userID string, step int64, codeHashes []string, now time.Time) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	ts := now.UTC().Format(time.RFC3339)
	res, err := tx.Exec(`UPDATE user_totp SET confirmed_at = ?, last_step = ? WHERE user_id = ? AND confirmed_at = ''`, ts, step, userID)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, nil
	}
	if err := replaceRecoveryCodes(tx, userID, codeHashes, ts); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// UseTOTPStep records the step of an accepted code. False when this or a later step was recorded in the
// meantime (the same code sent twice at once): only one of them counts.
func (s *Store) UseTOTPStep(userID string, step int64) (bool, error) {
	res, err := s.db.Exec(`UPDATE user_totp SET last_step = ? WHERE user_id = ? AND last_step < ?`, step, userID, step)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// DisableTOTP removes the app, the recovery codes and every trusted device of the account. Also for an
// administrator resetting somebody's second factor.
func (s *Store) DisableTOTP(userID string) error {
	return s.execInTx(
		stmt(`DELETE FROM user_totp WHERE user_id = ?`, userID),
		stmt(`DELETE FROM user_recovery_codes WHERE user_id = ?`, userID),
		stmt(`DELETE FROM trusted_devices WHERE user_id = ?`, userID),
	)
}

// --- Recovery codes ---

// recoveryAlphabet: lower case letters and digits without the ones that look alike (0/o, 1/l/i)
const recoveryAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

// NewRecoveryCodes returns RecoveryCodeCount fresh codes as shown ("abcde-fghjk", about 49 bits each).
func NewRecoveryCodes() ([]string, error) {
	codes := make([]string, RecoveryCodeCount)
	buf := make([]byte, 10)
	for i := range codes {
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		var b strings.Builder
		for j, c := range buf {
			if j == 5 {
				b.WriteByte('-')
			}
			// 256 is no multiple of 31: the first letters come a little more often, which costs
			// a fraction of a bit
			b.WriteByte(recoveryAlphabet[int(c)%len(recoveryAlphabet)])
		}
		codes[i] = b.String()
	}
	return codes, nil
}

// NormalizeRecoveryCode: the code as compared, whatever case, spaces or dashes were typed.
func NormalizeRecoveryCode(code string) string {
	return strings.Map(func(r rune) rune {
		if r == '-' || r == ' ' || r == '\u00a0' {
			return -1
		}
		return r
	}, strings.ToLower(strings.TrimSpace(code)))
}

// HashRecoveryCode: SHA-256 over the account and the normalized code. The codes are random enough that
// a slow hash buys nothing; the account in front keeps equal codes of two people apart.
func HashRecoveryCode(userID, code string) string {
	sum := sha256.Sum256([]byte(userID + ":" + NormalizeRecoveryCode(code)))
	return hex.EncodeToString(sum[:])
}

func replaceRecoveryCodes(tx *sql.Tx, userID string, codeHashes []string, ts string) error {
	if _, err := tx.Exec(`DELETE FROM user_recovery_codes WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, h := range codeHashes {
		if _, err := tx.Exec(`INSERT INTO user_recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)`, userID, h, ts); err != nil {
			return err
		}
	}
	return nil
}

// ReplaceRecoveryCodes drops all codes of the account, used or not, and stores the new ones.
func (s *Store) ReplaceRecoveryCodes(userID string, codeHashes []string, now time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := replaceRecoveryCodes(tx, userID, codeHashes, now.UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	return tx.Commit()
}

// UseRecoveryCode marks an unused code of the account as used; false when the code is unknown or used.
func (s *Store) UseRecoveryCode(userID, code string, now time.Time) (bool, error) {
	if NormalizeRecoveryCode(code) == "" {
		return false, nil
	}
	res, err := s.db.Exec(`UPDATE user_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at = ''`,
		now.UTC().Format(time.RFC3339), userID, HashRecoveryCode(userID, code))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// RecoveryCodesLeft counts the unused codes of the account.
func (s *Store) RecoveryCodesLeft(userID string) int {
	var n int
	logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM user_recovery_codes WHERE user_id = ? AND used_at = ''`, userID).Scan(&n))
	return n
}

// --- Trusted devices ---

// TrustedDevice: a device that signs in without a code until ExpiresAt.
type TrustedDevice struct {
	ID         string `json:"id"`
	UserAgent  string `json:"userAgent"`
	CreatedAt  string `json:"createdAt"`
	ExpiresAt  string `json:"expiresAt"`
	LastUsedAt string `json:"lastUsedAt"`
}

func hashTrustSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// CreateTrustedDevice trusts a device for TrustedDeviceLifetime and returns its token "<id>.<secret>"
// (only the secret's hash is stored). Expired and no longer valid rows of the account go at the same time.
func (s *Store) CreateTrustedDevice(userID string, tokenVersion int, userAgent string, now time.Time) (token string, device TrustedDevice, err error) {
	idBytes := make([]byte, 9)
	secretBytes := make([]byte, 32)
	if _, err = rand.Read(idBytes); err != nil {
		return "", device, err
	}
	if _, err = rand.Read(secretBytes); err != nil {
		return "", device, err
	}
	id := "tdv_" + hex.EncodeToString(idBytes)
	secret := base64.RawURLEncoding.EncodeToString(secretBytes)
	if len(userAgent) > 300 {
		userAgent = userAgent[:300]
	}
	ts := now.UTC().Format(time.RFC3339)
	device = TrustedDevice{ID: id, UserAgent: userAgent, CreatedAt: ts, ExpiresAt: now.Add(TrustedDeviceLifetime).UTC().Format(time.RFC3339)}
	err = s.execInTx(
		stmt(`DELETE FROM trusted_devices WHERE user_id = ? AND (expires_at < ? OR token_version != ?)`, userID, ts, tokenVersion),
		stmt(`INSERT INTO trusted_devices (id, user_id, token_hash, token_version, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, userID, hashTrustSecret(secret), tokenVersion, userAgent, ts, device.ExpiresAt),
		stmt(`DELETE FROM trusted_devices WHERE user_id = ? AND id NOT IN
			(SELECT id FROM trusted_devices WHERE user_id = ? ORDER BY created_at DESC, id LIMIT ?)`, userID, userID, maxTrustedDevices),
	)
	if err != nil {
		return "", device, err
	}
	return id + "." + secret, device, nil
}

// TrustedDeviceValid reports whether token is a trusted device of the account that has not expired and
// was made under the account's current token_version; a valid one records its use.
func (s *Store) TrustedDeviceValid(userID string, tokenVersion int, token string, now time.Time) bool {
	id, secret, ok := strings.Cut(token, ".")
	if !ok || id == "" || secret == "" {
		return false
	}
	var hash, expires string
	var version int
	err := s.db.QueryRow(`SELECT token_hash, token_version, expires_at FROM trusted_devices WHERE id = ? AND user_id = ?`, id, userID).
		Scan(&hash, &version, &expires)
	if err != nil {
		logDBErr(err)
		return false
	}
	exp, err := time.Parse(time.RFC3339, expires)
	if err != nil || !now.Before(exp) || version != tokenVersion {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(hash), []byte(hashTrustSecret(secret))) != 1 {
		return false
	}
	s.execLogged(`UPDATE trusted_devices SET last_used_at = ? WHERE id = ?`, now.UTC().Format(time.RFC3339), id)
	return true
}

// ListTrustedDevices returns the account's devices still trusted, newest first.
func (s *Store) ListTrustedDevices(userID string, tokenVersion int, now time.Time) ([]TrustedDevice, error) {
	rows, err := s.db.Query(`SELECT id, user_agent, created_at, expires_at, last_used_at FROM trusted_devices
		WHERE user_id = ? AND token_version = ? AND expires_at > ? ORDER BY created_at DESC`, userID, tokenVersion, now.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrustedDevice{}
	for rows.Next() {
		var d TrustedDevice
		if err := rows.Scan(&d.ID, &d.UserAgent, &d.CreatedAt, &d.ExpiresAt, &d.LastUsedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// RemoveTrustedDevice ends the trust of one device of the account.
func (s *Store) RemoveTrustedDevice(userID, id string) error {
	res, err := s.db.Exec(`DELETE FROM trusted_devices WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrTrustedDeviceNotFound
	}
	return nil
}

// RemoveTrustedDevices ends the trust of every device of the account.
func (s *Store) RemoveTrustedDevices(userID string) error {
	_, err := s.db.Exec(`DELETE FROM trusted_devices WHERE user_id = ?`, userID)
	return err
}
