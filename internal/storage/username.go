package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
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

// usernameWithNumber: base with i appended (i > 0), shortened so it stays within the length limit.
func usernameWithNumber(base string, i int) string {
	if i == 0 {
		return base
	}
	suffix := strconv.Itoa(i)
	return strings.Trim(base[:min(len(base), usernameMaxLen-len(suffix))], "._-") + suffix
}

// usernameTakenErr turns the unique index on users.username refusing a name (another request took it
// between the check and the write) into ErrUsernameTaken; other errors pass unchanged.
func usernameTakenErr(err error) error {
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed: users.username") {
		return ErrUsernameTaken
	}
	return err
}

// uniqueUsername returns base or, when taken, base with the first free number appended (base1, base2 …).
func (s *Store) uniqueUsername(base, exceptUserID string) (string, error) {
	if len(base) < 2 {
		base = "user"
	}
	for i := 0; i < 10000; i++ {
		candidate := usernameWithNumber(base, i)
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
		return usernameTakenErr(err)
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
	if err := rows.Err(); err != nil {
		return err
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

// migrateUniqueUsernames is migration 45: the index on users.username becomes UNIQUE, so two requests at
// the same moment can no longer hand out the same name (the check before the write saw it free for both).
// Names that are already there twice are resolved first: the oldest account keeps its name, each later one
// gets the next free number as a new account would (sandro, sandro1 …), and every change is logged. Names
// are stored in lower case; one that is not (never written by this version) is lowered first, so the index
// sees what the sign-in compares. Accounts without a username stay without one.
func (s *Store) migrateUniqueUsernames() error {
	rows, err := s.db.Query(`SELECT id, username FROM users ORDER BY created_at, id`)
	if err != nil {
		return err
	}
	type row struct{ id, username string }
	var all []row
	taken := map[string]bool{}
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.username); err != nil {
			_ = rows.Close()
			return err
		}
		all = append(all, r)
		taken[strings.ToLower(r.username)] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = rows.Close()

	// One transaction: the reads above are closed, nothing below needs a second connection
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	kept := map[string]bool{}
	for _, r := range all {
		name := strings.ToLower(r.username)
		if name == "" {
			continue
		}
		if kept[name] {
			free := ""
			for i := 1; i < 10000 && free == ""; i++ {
				if c := usernameWithNumber(name, i); !taken[c] {
					free = c
				}
			}
			if free == "" {
				return fmt.Errorf("no free username for account %s", r.id)
			}
			slog.Warn("Username was also held by an older account; renamed", "user_id", r.id, "old_username", r.username, "new_username", free)
			name = free
			taken[name] = true
		} else if name != r.username {
			slog.Info("Username stored in lower case", "user_id", r.id, "old_username", r.username, "new_username", name)
		}
		kept[name] = true
		if name != r.username {
			if _, err := tx.Exec(`UPDATE users SET username = ? WHERE id = ?`, name, r.id); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(`DROP INDEX IF EXISTS idx_users_username`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE UNIQUE INDEX idx_users_username ON users(username) WHERE username != ''`); err != nil {
		return err
	}
	return tx.Commit()
}
