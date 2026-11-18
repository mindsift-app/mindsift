package storage

import (
	"errors"
	"log/slog"
	"net/url"
	"strconv"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Voice input in the system settings (domain.SpeechSettings): one row per field, the API key of the
// Whisper server sealed with SECRETS_KEY like the SMTP password.

// speechKeySealID binds the stored API key of the Whisper server to its row
const speechKeySealID = "system_settings:speech_api_key"

// Limits of the numbers (the same as for the STT_* variables)
var speechLimits = map[string][2]int{
	"speech_max_seconds":       {5, 3600},
	"speech_max_upload_mb":     {1, 500},
	"speech_max_parallel":      {1, 32},
	"speech_per_user_per_hour": {1, 100000},
	"speech_timeout_seconds":   {5, 3600},
}

var (
	ErrSpeechMode  = i18n.NewError("Ungültiger Modus der Spracherkennung (erlaubt: server, browser, off)")
	ErrSpeechURL   = i18n.NewError("Die Adresse des Whisper-Servers muss mit http:// oder https:// beginnen")
	ErrSpeechModel = i18n.NewError("Ungültiger Modellname (z. B. Systran/faster-whisper-small)")
	ErrSpeechLimit = i18n.NewError("Ein Wert der Spracherkennung liegt außerhalb des erlaubten Bereichs")
)

func (s *Store) readSpeechSetting(sp *domain.SpeechSettings, key, v string) {
	switch key {
	case "speech_mode":
		if ValidSpeechMode(v) {
			sp.Mode = v
		}
	case "speech_allow_browser":
		on := v != "false"
		sp.AllowBrowser = &on
	case "speech_url":
		sp.URL = v
	case "speech_api_key":
		if !strings.HasPrefix(v, SealedPrefix) {
			sp.APIKey = v
			break
		}
		key, err := OpenValue(s.secretsKey, speechKeySealID, v)
		if err != nil {
			slog.Error("The stored API key of the Whisper server cannot be decrypted (SECRETS_KEY or secrets.key changed?): enter it again under Administration → Voice input & AI", "error", err)
			sp.APIKeyUnreadable = true
			break
		}
		sp.APIKey = key
	case "speech_model":
		sp.Model = v
	case "speech_vad_filter":
		on := v != "false"
		sp.VADFilter = &on
	default:
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			*speechNumber(sp, key) = n
		}
	}
	sp.APIKeySet = sp.APIKey != "" || sp.APIKeyUnreadable
}

func speechNumber(sp *domain.SpeechSettings, key string) *int {
	switch key {
	case "speech_max_seconds":
		return &sp.MaxSeconds
	case "speech_max_upload_mb":
		return &sp.MaxUploadMB
	case "speech_max_parallel":
		return &sp.MaxParallel
	case "speech_per_user_per_hour":
		return &sp.PerUserPerHour
	}
	return &sp.TimeoutSeconds
}

func ValidSpeechMode(v string) bool { return v == "" || v == "server" || v == "browser" || v == "off" }

// ValidSpeechModel: owner/name or name of letters, digits and . _ - (as on Hugging Face), at most 200.
func ValidSpeechModel(v string) bool {
	if v == "" {
		return true
	}
	if len(v) > 200 || strings.Count(v, "/") > 1 || strings.HasPrefix(v, "/") || strings.HasSuffix(v, "/") {
		return false
	}
	for _, r := range v {
		if !(r == '/' || r == '.' || r == '_' || r == '-' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z') {
			return false
		}
	}
	return !strings.Contains(v, "..")
}

// ValidateSpeech checks an update of the voice input settings.
func ValidateSpeech(sp *domain.SpeechSettings) error {
	if !ValidSpeechMode(sp.Mode) {
		return ErrSpeechMode
	}
	if u := strings.TrimSpace(sp.URL); u != "" {
		parsed, err := url.Parse(u)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return ErrSpeechURL
		}
	}
	if !ValidSpeechModel(strings.TrimSpace(sp.Model)) {
		return ErrSpeechModel
	}
	for key, lim := range speechLimits {
		if n := *speechNumber(sp, key); n != 0 && (n < lim[0] || n > lim[1]) {
			return ErrSpeechLimit
		}
	}
	return nil
}

func (s *Store) writeSpeechSettings(sp *domain.SpeechSettings) error {
	if err := ValidateSpeech(sp); err != nil {
		return err
	}
	set := func(key, value string) error {
		_, err := s.db.Exec(`INSERT INTO system_settings (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
		return err
	}
	rows := map[string]string{
		"speech_mode":  sp.Mode,
		"speech_url":   strings.TrimRight(strings.TrimSpace(sp.URL), "/"),
		"speech_model": strings.TrimSpace(sp.Model),
	}
	for key := range speechLimits {
		rows[key] = strconv.Itoa(*speechNumber(sp, key))
	}
	if sp.AllowBrowser != nil {
		rows["speech_allow_browser"] = strconv.FormatBool(*sp.AllowBrowser)
	}
	if sp.VADFilter != nil {
		rows["speech_vad_filter"] = strconv.FormatBool(*sp.VADFilter)
	}
	for key, value := range rows {
		if err := set(key, value); err != nil {
			return err
		}
	}
	// The API key: a new one sealed, empty keeps the stored one (also one that no longer opens), or removed
	switch {
	case sp.ClearAPIKey:
		return set("speech_api_key", "")
	case sp.APIKey != "":
		if len(s.secretsKey) == 0 {
			return set("speech_api_key", sp.APIKey) // a store without a key (tests) keeps it as it is
		}
		sealed, err := SealValue(s.secretsKey, speechKeySealID, sp.APIKey)
		if err != nil {
			return errors.Join(errors.New("sealing the API key of the Whisper server"), err)
		}
		return set("speech_api_key", sealed)
	}
	return nil
}
