package storage

import "errors"

// Everyone picks how their voice input works: the server's Whisper ("", the default) or the browser's
// recognition ("browser"). The server only offers the choice when it has a Whisper server and the
// browser is allowed (STT_ALLOW_BROWSER); the app applies it (lib/voice.ts).

var ErrInvalidVoiceInput = errors.New("Ungültige Spracheingabe (erlaubt: Whisper-Server oder Browser)")

func (s *Store) migrateVoiceInput() error {
	return s.addColumnIfMissing("users", "voice_input", "TEXT NOT NULL DEFAULT ''")
}

// VoiceInput returns the user's choice: "" or "browser".
func (s *Store) VoiceInput(userID string) string {
	var v string
	logDBErr(s.db.QueryRow(`SELECT voice_input FROM users WHERE id = ?`, userID).Scan(&v))
	return v
}

func (s *Store) SetVoiceInput(userID, v string) error {
	if v != "" && v != "browser" {
		return ErrInvalidVoiceInput
	}
	_, err := s.db.Exec(`UPDATE users SET voice_input = ? WHERE id = ?`, v, userID)
	return err
}
