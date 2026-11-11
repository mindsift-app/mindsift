package storage

import (
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

// A profile picture is what the profile can set: an uploaded picture, cropped in the browser and stored
// inline as a small data URL, or an emoji. No addresses of other servers: those would learn who looks at
// the picture (IP, time, browser of everybody who sees the person), and the page could not load them
// anyway (Content-Security-Policy). Anything else is refused, and removed from older accounts.

// MaxAvatarBytes: a cropped picture (256 px, WebP or JPEG) needs a small part of this
const MaxAvatarBytes = 300 * 1024

var (
	ErrInvalidAvatar = errors.New("Als Profilbild geht nur ein hochgeladenes Bild (höchstens 300 KB) oder ein Emoji")
	avatarDataURL    = regexp.MustCompile(`^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$`)
)

// ValidAvatar: empty (initials), an emoji, or an inline PNG/JPEG/WebP picture of at most MaxAvatarBytes.
func ValidAvatar(v string) bool {
	if v == "" {
		return true
	}
	if strings.HasPrefix(v, "data:") {
		return len(v) <= MaxAvatarBytes && avatarDataURL.MatchString(v)
	}
	return utf8.RuneCountInString(v) <= 8 && !strings.ContainsAny(v, ":/.<>\"'\\ ")
}

// migrateAvatars removes profile pictures the profile could no longer set (links to other servers).
func (s *Store) migrateAvatars() error {
	rows, err := s.db.Query(`SELECT id, avatar_url FROM users WHERE avatar_url != ''`)
	if err != nil {
		return err
	}
	var drop []string
	for rows.Next() {
		var id, v string
		if err := rows.Scan(&id, &v); err != nil {
			_ = rows.Close()
			return err
		}
		if !ValidAvatar(v) {
			drop = append(drop, id)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = rows.Close()
	stmts := make([]sqlStmt, len(drop))
	for i, id := range drop {
		stmts[i] = stmt(`UPDATE users SET avatar_url = '' WHERE id = ?`, id)
	}
	return s.execInTx(stmts...)
}
