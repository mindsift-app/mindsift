package storage

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Passkeys (WebAuthn, api/passkeys.go). One row per passkey of an account: the credential's id and public
// key, the authenticator's signature counter and backup flags, a name the person chose. Nothing secret is
// stored: the private key never leaves the authenticator. A passkey is a second factor after the password
// and signs in without a password on its own; with an authenticator app or not, an account with a passkey
// counts as one with two-factor sign-in (MFAActive), so its recovery codes and trusted devices stay until
// its last method is gone.

const (
	// maxPasskeys: more passkeys per account are refused
	maxPasskeys = 20
	// PasskeyNameMax: the longest name of a passkey, in characters
	PasskeyNameMax = 60
)

var (
	ErrPasskeyNotFound  = errors.New("Passkey nicht gefunden")
	ErrPasskeyExists    = errors.New("Dieser Passkey ist bereits eingerichtet")
	ErrTooManyPasskeys  = errors.New("Es sind höchstens 20 Passkeys pro Konto möglich")
	ErrPasskeyNameEmpty = errors.New("Bitte gib dem Passkey einen Namen")
)

func (s *Store) migratePasskeys() error {
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS user_passkeys (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			credential_id TEXT NOT NULL UNIQUE,
			public_key BLOB NOT NULL,
			attestation_type TEXT NOT NULL DEFAULT '',
			aaguid BLOB,
			transports TEXT NOT NULL DEFAULT '',
			attachment TEXT NOT NULL DEFAULT '',
			sign_count INTEGER NOT NULL DEFAULT 0,
			backup_eligible INTEGER NOT NULL DEFAULT 0,
			backup_state INTEGER NOT NULL DEFAULT 0,
			name TEXT NOT NULL,
			created_at TEXT NOT NULL,
			last_used_at TEXT NOT NULL DEFAULT ''
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys(user_id)`),
	)
}

// Passkey: one passkey of an account. The fields without JSON name are for the WebAuthn check only.
type Passkey struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt"`
	// Synced: the authenticator keeps the passkey in a backup (password manager, iCloud, Google account)
	Synced bool `json:"synced"`

	UserID          string   `json:"-"`
	CredentialID    []byte   `json:"-"`
	PublicKey       []byte   `json:"-"`
	AttestationType string   `json:"-"`
	AAGUID          []byte   `json:"-"`
	Transports      []string `json:"-"`
	Attachment      string   `json:"-"`
	SignCount       uint32   `json:"-"`
	BackupEligible  bool     `json:"-"`
}

// CleanPasskeyName trims the name and cuts it to PasskeyNameMax characters.
func CleanPasskeyName(name string) string {
	name = strings.Join(strings.Fields(name), " ")
	if r := []rune(name); len(r) > PasskeyNameMax {
		name = strings.TrimSpace(string(r[:PasskeyNameMax]))
	}
	return name
}

func credentialKey(id []byte) string { return base64.RawURLEncoding.EncodeToString(id) }

const passkeyColumns = `id, user_id, credential_id, public_key, attestation_type, aaguid, transports, attachment,
	sign_count, backup_eligible, backup_state, name, created_at, last_used_at`

func scanPasskey(row interface{ Scan(...any) error }) (*Passkey, error) {
	var p Passkey
	var credID, transports string
	var signCount int64
	if err := row.Scan(&p.ID, &p.UserID, &credID, &p.PublicKey, &p.AttestationType, &p.AAGUID, &transports, &p.Attachment,
		&signCount, &p.BackupEligible, &p.Synced, &p.Name, &p.CreatedAt, &p.LastUsedAt); err != nil {
		return nil, err
	}
	id, err := base64.RawURLEncoding.DecodeString(credID)
	if err != nil {
		return nil, err
	}
	p.CredentialID = id
	p.SignCount = uint32(signCount)
	if transports != "" {
		p.Transports = strings.Split(transports, ",")
	}
	return &p, nil
}

// AddPasskey stores a new passkey of the account. codeHashes, when given, become the account's recovery
// codes in the same step: the first passkey of an account without an app switches two-factor sign-in on.
func (s *Store) AddPasskey(p *Passkey, codeHashes []string, now time.Time) error {
	p.Name = CleanPasskeyName(p.Name)
	if p.Name == "" {
		return ErrPasskeyNameEmpty
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var n int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM user_passkeys WHERE user_id = ?`, p.UserID).Scan(&n); err != nil {
		return err
	}
	if n >= maxPasskeys {
		return ErrTooManyPasskeys
	}
	var taken int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM user_passkeys WHERE credential_id = ?`, credentialKey(p.CredentialID)).Scan(&taken); err != nil {
		return err
	}
	if taken > 0 {
		return ErrPasskeyExists
	}
	ts := now.UTC().Format(time.RFC3339)
	p.ID = domain.NewID("psk")
	p.CreatedAt = ts
	if _, err := tx.Exec(`INSERT INTO user_passkeys (`+passkeyColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
		p.ID, p.UserID, credentialKey(p.CredentialID), p.PublicKey, p.AttestationType, p.AAGUID, strings.Join(p.Transports, ","), p.Attachment,
		int64(p.SignCount), p.BackupEligible, p.Synced, p.Name, ts); err != nil {
		return err
	}
	if codeHashes != nil {
		if err := replaceRecoveryCodes(tx, p.UserID, codeHashes, ts); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListPasskeys returns the account's passkeys, oldest first.
func (s *Store) ListPasskeys(userID string) ([]Passkey, error) {
	rows, err := s.db.Query(`SELECT `+passkeyColumns+` FROM user_passkeys WHERE user_id = ? ORDER BY created_at, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Passkey{}
	for rows.Next() {
		p, err := scanPasskey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// PasskeyByCredentialID finds the passkey an authenticator answered with; ErrPasskeyNotFound if none.
func (s *Store) PasskeyByCredentialID(credentialID []byte) (*Passkey, error) {
	p, err := scanPasskey(s.db.QueryRow(`SELECT `+passkeyColumns+` FROM user_passkeys WHERE credential_id = ?`, credentialKey(credentialID)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPasskeyNotFound
	}
	return p, err
}

// HasPasskeys reports whether the account has a passkey; yes when the database fails (as TOTPActive).
func (s *Store) HasPasskeys(userID string) bool {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM user_passkeys WHERE user_id = ?`, userID).Scan(&n)
	if dbFailed(err) {
		return true
	}
	return n > 0
}

// MFAActive reports whether the account signs in with a second factor: an authenticator app or a passkey.
// When the database fails it answers yes, so a sign-in fails at the second step instead of skipping it.
func (s *Store) MFAActive(userID string) bool {
	return s.TOTPActive(userID) || s.HasPasskeys(userID)
}

// MFAUserIDs: the accounts with a second factor (the administration's user list).
func (s *Store) MFAUserIDs() map[string]bool {
	out := map[string]bool{}
	rows, err := s.db.Query(`SELECT user_id FROM user_totp WHERE confirmed_at != '' UNION SELECT user_id FROM user_passkeys`)
	if dbFailed(err) {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if !dbFailed(rows.Scan(&id)) {
			out[id] = true
		}
	}
	logDBErr(rows.Err())
	return out
}

// UsePasskey records a sign-in with the passkey: its new signature counter, backup state and the time.
// False when the stored counter is not below the new one any more (a second answer at the same time, or a
// copied authenticator): counters that are not 0 only go up.
func (s *Store) UsePasskey(id string, signCount uint32, synced bool, now time.Time) (bool, error) {
	res, err := s.db.Exec(`UPDATE user_passkeys SET sign_count = ?, backup_state = ?, last_used_at = ?
		WHERE id = ? AND (sign_count < ? OR (sign_count = 0 AND ? = 0))`,
		int64(signCount), synced, now.UTC().Format(time.RFC3339), id, int64(signCount), int64(signCount))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// RenamePasskey gives a passkey of the account a new name.
func (s *Store) RenamePasskey(userID, id, name string) error {
	name = CleanPasskeyName(name)
	if name == "" {
		return ErrPasskeyNameEmpty
	}
	res, err := s.db.Exec(`UPDATE user_passkeys SET name = ? WHERE id = ? AND user_id = ?`, name, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrPasskeyNotFound
	}
	return nil
}

// RemovePasskey removes a passkey of the account. When it was the last second factor (no other passkey,
// no app), the recovery codes and trusted devices go with it and mfaOff is true.
func (s *Store) RemovePasskey(userID, id string) (mfaOff bool, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM user_passkeys WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, ErrPasskeyNotFound
	}
	if mfaOff, err = dropFactorlessExtras(tx, userID); err != nil {
		return false, err
	}
	return mfaOff, tx.Commit()
}

// dropFactorlessExtras removes the recovery codes and trusted devices of an account that has no second
// factor left (no confirmed app, no passkey); true when that was the case.
func dropFactorlessExtras(tx *sql.Tx, userID string) (bool, error) {
	var left int
	err := tx.QueryRow(`SELECT (SELECT COUNT(*) FROM user_passkeys WHERE user_id = ?) +
		(SELECT COUNT(*) FROM user_totp WHERE user_id = ? AND confirmed_at != '')`, userID, userID).Scan(&left)
	if err != nil || left > 0 {
		return false, err
	}
	if _, err := tx.Exec(`DELETE FROM user_recovery_codes WHERE user_id = ?`, userID); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`DELETE FROM trusted_devices WHERE user_id = ?`, userID); err != nil {
		return false, err
	}
	return true, nil
}
