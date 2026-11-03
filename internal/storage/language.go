package storage

import (
	"errors"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Everyone picks the language of the app ("" follows the browser, then the server's default language).
// Accounts that existed before languages could be chosen keep German. The server's default language is
// a system setting (default_language) the admin changes; DEFAULT_LANGUAGE only gives its start value.

var ErrInvalidLanguage = errors.New("Diese Sprache gibt es nicht")

func (s *Store) migrateLanguage() error {
	if err := s.addColumnIfMissing("users", "language", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	_, err := s.db.Exec(`UPDATE users SET language = ? WHERE language = ''`, i18n.Fallback)
	return err
}

// Language returns the user's choice: a supported code or "".
func (s *Store) Language(userID string) string {
	var v string
	_ = s.db.QueryRow(`SELECT language FROM users WHERE id = ?`, userID).Scan(&v)
	return v
}

func (s *Store) SetLanguage(userID, lang string) error {
	if lang != "" && !i18n.Valid(lang) {
		return ErrInvalidLanguage
	}
	_, err := s.db.Exec(`UPDATE users SET language = ? WHERE id = ?`, lang, userID)
	return err
}

// MessageLanguage: the language texts the store writes for a person are in (e.g. a task turned into a
// note): their own choice, else the admin's default language, else DEFAULT_LANGUAGE, else German.
func (s *Store) MessageLanguage(userID string) string {
	for _, v := range []string{s.Language(userID), s.DefaultLanguageSetting(), s.ConfiguredLanguage} {
		if i18n.Valid(v) {
			return v
		}
	}
	return i18n.Fallback
}

// DefaultLanguageSetting: the admin's default language, "" while none was stored.
func (s *Store) DefaultLanguageSetting() string {
	var v string
	_ = s.db.QueryRow(`SELECT value FROM system_settings WHERE key = 'default_language'`).Scan(&v)
	if !i18n.Valid(v) {
		return ""
	}
	return v
}
