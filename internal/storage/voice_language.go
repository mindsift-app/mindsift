package storage

import "errors"

// Everyone picks the language their voice input is recognized in: "" follows the app language, "auto"
// lets Whisper detect it per recording, or one of Whisper's languages, also ones the app is not
// translated into. The browser's recognition cannot detect languages, it uses the app language for
// "auto" (lib/useVoiceInput.ts).

var ErrInvalidVoiceLanguage = errors.New("Diese Sprache kennt die Spracherkennung nicht")

// WhisperLanguages: the languages Whisper recognizes (same list in frontend/src/lib/voiceLanguages.ts).
var WhisperLanguages = map[string]bool{
	"af": true, "am": true, "ar": true, "as": true, "az": true, "ba": true, "be": true, "bg": true, "bn": true,
	"bo": true, "br": true, "bs": true, "ca": true, "cs": true, "cy": true, "da": true, "de": true, "el": true,
	"en": true, "es": true, "et": true, "eu": true, "fa": true, "fi": true, "fo": true, "fr": true, "gl": true,
	"gu": true, "ha": true, "haw": true, "he": true, "hi": true, "hr": true, "ht": true, "hu": true, "hy": true,
	"id": true, "is": true, "it": true, "ja": true, "jw": true, "ka": true, "kk": true, "km": true, "kn": true,
	"ko": true, "la": true, "lb": true, "ln": true, "lo": true, "lt": true, "lv": true, "mg": true, "mi": true,
	"mk": true, "ml": true, "mn": true, "mr": true, "ms": true, "mt": true, "my": true, "ne": true, "nl": true,
	"nn": true, "no": true, "oc": true, "pa": true, "pl": true, "ps": true, "pt": true, "ro": true, "ru": true,
	"sa": true, "sd": true, "si": true, "sk": true, "sl": true, "sn": true, "so": true, "sq": true, "sr": true,
	"su": true, "sv": true, "sw": true, "ta": true, "te": true, "tg": true, "th": true, "tk": true, "tl": true,
	"tr": true, "tt": true, "uk": true, "ur": true, "uz": true, "vi": true, "yi": true, "yo": true, "yue": true,
	"zh": true,
}

func (s *Store) migrateVoiceLanguage() error {
	return s.addColumnIfMissing("users", "voice_language", "TEXT NOT NULL DEFAULT ''")
}

// VoiceLanguage returns the user's choice: "", "auto", "app" or a Whisper language code.
func (s *Store) VoiceLanguage(userID string) string {
	var v string
	logDBErr(s.db.QueryRow(`SELECT voice_language FROM users WHERE id = ?`, userID).Scan(&v))
	return v
}

func (s *Store) SetVoiceLanguage(userID, v string) error {
	if v != "" && v != "auto" && v != "app" && !WhisperLanguages[v] {
		return ErrInvalidVoiceLanguage
	}
	_, err := s.db.Exec(`UPDATE users SET voice_language = ? WHERE id = ?`, v, userID)
	return err
}
