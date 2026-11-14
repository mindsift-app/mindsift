package storage

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"log/slog"
	"strings"
)

// Values kept encrypted with SECRETS_KEY ($DATA_DIR/secrets.key without it; config.SecretsKey): hidden
// values in notes, authenticator secrets and the tokens of public links (sealed by the API) and the
// SMTP password of the system settings (sealed here), so a copy of the database or a backup alone does
// not reveal them. AES-256-GCM; the id is bound in as additional data, so a ciphertext copied into
// another row does not open.

// SealedPrefix marks a sealed value ("v1:" + base64 of nonce and ciphertext).
const SealedPrefix = "v1:"

// smtpPassSealID binds the stored SMTP password to its row
const smtpPassSealID = "system_settings:smtp_pass"

var errNoSecretsKey = errors.New("no key for encrypted values (SECRETS_KEY or secrets.key)")

// SealValue encrypts value under key, bound to id.
func SealValue(key []byte, id, value string) (string, error) {
	gcm, err := sealAEAD(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(value), []byte(id))
	return SealedPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// OpenValue decrypts what SealValue returned for the same key and id.
func OpenValue(key []byte, id, ciphertext string) (string, error) {
	gcm, err := sealAEAD(key)
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ciphertext, SealedPrefix))
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("malformed ciphertext")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], []byte(id))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func sealAEAD(key []byte) (cipher.AEAD, error) {
	if len(key) == 0 {
		return nil, errNoSecretsKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// StoreOption configures NewStore.
type StoreOption func(*Store)

// WithSecretsKey gives the store the key it seals the SMTP password with (config.SecretsKey). The
// server always passes it; a store without one (tests) keeps a new password as it is.
func WithSecretsKey(key []byte) StoreOption {
	return func(s *Store) { s.secretsKey = key }
}

// storedSMTPPass is the value written to system_settings for the SMTP password.
func (s *Store) storedSMTPPass(pass string) (string, error) {
	if pass == "" || len(s.secretsKey) == 0 {
		return pass, nil
	}
	return SealValue(s.secretsKey, smtpPassSealID, pass)
}

// readSMTPPass opens the stored SMTP password; ok is false when it is sealed and does not open (the key
// changed), and the mail then fails until an admin enters the password again. A value without the
// prefix is one from before migration 43 (or of a store without a key) and is taken as it is.
func (s *Store) readSMTPPass(stored string) (pass string, ok bool) {
	if !strings.HasPrefix(stored, SealedPrefix) {
		return stored, true
	}
	pass, err := OpenValue(s.secretsKey, smtpPassSealID, stored)
	if err != nil {
		slog.Error("The stored SMTP password cannot be decrypted (SECRETS_KEY or secrets.key changed?): no mail is sent with it until an admin enters it again under Administration → E-mail", "error", err)
		return "", false
	}
	return pass, true
}

// migrateSealSMTPPass encrypts an SMTP password stored in plain text (migration 43), so it is no longer
// readable in the database and every backup of it.
func (s *Store) migrateSealSMTPPass() error {
	var v string
	err := s.db.QueryRow(`SELECT value FROM system_settings WHERE key = 'smtp_pass'`).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (v == "" || strings.HasPrefix(v, SealedPrefix))) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(s.secretsKey) == 0 {
		return errNoSecretsKey
	}
	sealed, err := SealValue(s.secretsKey, smtpPassSealID, v)
	if err != nil {
		return err
	}
	defer s.forgetSystemSettings()
	_, err = s.db.Exec(`UPDATE system_settings SET value = ? WHERE key = 'smtp_pass'`, sealed)
	return err
}
