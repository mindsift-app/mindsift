package storage

import (
	"encoding/json"
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
	logDBErr(s.db.QueryRow(`SELECT language FROM users WHERE id = ?`, userID).Scan(&v))
	return v
}

// Languages is Language for several users in one query (users without a choice are left out).
func (s *Store) Languages(userIDs []string) map[string]string {
	out := make(map[string]string, len(userIDs))
	idsJSON, _ := json.Marshal(userIDs)
	rows, err := s.db.Query(`SELECT id, language FROM users WHERE id IN (SELECT value FROM json_each(?)) AND language != ''`, string(idsJSON))
	if dbFailed(err) {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, lang string
		if !dbFailed(rows.Scan(&id, &lang)) {
			out[id] = lang
		}
	}
	logDBErr(rows.Err())
	return out
}

func (s *Store) SetLanguage(userID, lang string) error {
	if lang != "" && !i18n.Valid(lang) {
		return ErrInvalidLanguage
	}
	_, err := s.db.Exec(`UPDATE users SET language = ? WHERE id = ?`, lang, userID)
	return err
}

// MessageLanguage: the language texts the store writes for a person are in (e.g. a task turned into a
// note): their own choice, else the admin's default language, else DEFAULT_LANGUAGE, else German. The
// app writes such texts itself in the same language (messageLanguage in frontend/src/i18n/index.ts, from
// the account's choice and the server's defaultLanguage), so a placeholder reads the same whoever wrote it.
func (s *Store) MessageLanguage(userID string) string { return s.messageLanguageIn(s.db, userID) }

// messageLanguageIn is MessageLanguage read through q (a transaction's connection, see Doku/database.md).
func (s *Store) messageLanguageIn(q docQueryer, userID string) string {
	var own, def string
	logDBErr(rowErr(q.QueryRow(`SELECT language FROM users WHERE id = ?`, userID).Scan(&own)))
	if i18n.Valid(own) {
		return own
	}
	logDBErr(rowErr(q.QueryRow(`SELECT value FROM system_settings WHERE key = 'default_language'`).Scan(&def)))
	for _, v := range []string{def, s.ConfiguredLanguage} {
		if i18n.Valid(v) {
			return v
		}
	}
	return i18n.Fallback
}

// DefaultLanguageSetting: the admin's default language, "" while none was stored.
func (s *Store) DefaultLanguageSetting() string {
	var v string
	logDBErr(s.db.QueryRow(`SELECT value FROM system_settings WHERE key = 'default_language'`).Scan(&v))
	if !i18n.Valid(v) {
		return ""
	}
	return v
}
