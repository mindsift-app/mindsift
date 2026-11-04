package storage

import (
	"database/sql"
	"errors"
	"regexp"
	"strconv"
	"strings"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Usernames are for signing in: lower case letters, digits, dot, dash and underscore, 2 to 32 characters,
// unique. They start out from the display name (spaces and other characters become dots) and can be
// changed later by the person or an admin; shares, tasks and notes refer to the user id, not the name.

var (
	ErrInvalidUsername = i18n.NewError("Der Benutzername darf nur Kleinbuchstaben, Ziffern, Punkt, Bindestrich und Unterstrich enthalten (2 bis 32 Zeichen)")
	ErrUsernameTaken   = i18n.NewError("Dieser Benutzername ist schon vergeben")
)

const usernameMaxLen = 32

var (
	usernamePattern  = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$`)
	usernameNotAllow = regexp.MustCompile(`[^a-z0-9._-]+`)
	usernameDots     = regexp.MustCompile(`[._-]*\.[._-]*`)
)

var umlauts = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss", "é", "e", "è", "e", "ê", "e", "á", "a", "à", "a", "â", "a", "ó", "o", "ò", "o", "ô", "o", "í", "i", "ì", "i", "ú", "u", "ù", "u", "ñ", "n", "ç", "c")

// UsernameFromName turns a display name (or a login typed like one) into a username: "Sandro Dach" ->
// "sandro.dach". The result can be empty (a name of only symbols); uniqueness is up to the caller.
func UsernameFromName(name string) string {
	u := umlauts.Replace(strings.ToLower(strings.TrimSpace(name)))
	u = usernameNotAllow.ReplaceAllString(u, ".")
	u = usernameDots.ReplaceAllString(u, ".")
	u = strings.Trim(u, "._-")
	if len(u) > usernameMaxLen {
		u = strings.Trim(u[:usernameMaxLen], "._-")
	}
	return u
}

// ValidUsername reports whether u may be used as it is (already lower case and trimmed).
func ValidUsername(u string) bool {
	return usernamePattern.MatchString(u)
}

func (s *Store) usernameTaken(u, exceptUserID string) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE LOWER(username) = ? AND id != ?`, u, exceptUserID).Scan(&n)
	return n > 0, err
}

// uniqueUsername returns base or, when taken, base with the first free number appended (base1, base2 …).
func (s *Store) uniqueUsername(base, exceptUserID string) (string, error) {
	if len(base) < 2 {
		base = "user"
	}
	for i := 0; i < 10000; i++ {
		candidate := base
		if i > 0 {
			suffix := strconv.Itoa(i)
			candidate = strings.Trim(base[:min(len(base), usernameMaxLen-len(suffix))], "._-") + suffix
		}
		taken, err := s.usernameTaken(candidate, exceptUserID)
		if err != nil {
			return "", err
		}
		if !taken {
			return candidate, nil
		}
	}
	return "", errors.New("no free username")
}

// SetUsername changes a person's username after checking the rules and that nobody else has it.
func (s *Store) SetUsername(userID, username string) error {
	u := strings.ToLower(strings.TrimSpace(username))
	if !ValidUsername(u) {
		return ErrInvalidUsername
	}
	taken, err := s.usernameTaken(u, userID)
	if err != nil {
		return err
	}
	if taken {
		return ErrUsernameTaken
	}
	res, err := s.db.Exec(`UPDATE users SET username = ? WHERE id = ?`, u, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// migrateUsernames is migration 20: everybody signs in with their display name as before, now as a real
// username ("Sandro Dach" -> "sandro.dach"); a second person with the same name gets a number. Signing in
// with the display name itself ends with this step. Accounts whose name gives no username keep theirs.
func (s *Store) migrateUsernames() error {
	rows, err := s.db.Query(`SELECT id, display_name, username FROM users ORDER BY created_at, id`)
	if err != nil {
		return err
	}
	type row struct{ id, name, username string }
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.name, &r.username); err != nil {
			_ = rows.Close()
			return err
		}
		all = append(all, r)
	}
	_ = rows.Close()
	// Clear first, so the new names do not collide with old ones that are about to change
	if _, err := s.db.Exec(`UPDATE users SET username = ''`); err != nil {
		return err
	}
	for _, r := range all {
		base := UsernameFromName(r.name)
		if len(base) < 2 {
			base = UsernameFromName(r.username)
		}
		u, err := s.uniqueUsername(base, r.id)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(`UPDATE users SET username = ? WHERE id = ?`, u, r.id); err != nil {
			return err
		}
	}
	return nil
}
