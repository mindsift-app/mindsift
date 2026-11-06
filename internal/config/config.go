package config

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

type Config struct {
	Port         string
	DataDir      string
	DatabasePath string
	JWTSecret    string
	// SecretsKey encrypts hidden values in notes (SECRETS_KEY or $DATA_DIR/secrets.key), 32 bytes
	SecretsKey []byte
	BaseURL    string
	// BaseURLSet: BASE_URL was configured explicitly. Links in mails (password reset) are only built
	// from it, never from the request's Host header.
	BaseURLSet        bool
	AllowRegistration bool
	// RegistrationMode / RegistrationDomains: REGISTRATION_MODE (closed | approval | domain |
	// domain+approval | open) and REGISTRATION_DOMAINS. When set they win over the admin settings,
	// which then cannot change them. ALLOW_REGISTRATION=true counts as REGISTRATION_MODE=open;
	// ALLOW_REGISTRATION=false (the template default) leaves the choice to the admin settings.
	RegistrationMode    string
	RegistrationDomains string
	// RegistrationVerifyEmail: REGISTRATION_VERIFY_EMAIL ("true"/"false", "" = admin settings decide)
	RegistrationVerifyEmail string
	LogLevel                string
	Debug                   bool
	DemoMode                bool
	// DemoResetMinutes: in demo mode the database is reset to the sample data this often (0 = never)
	DemoResetMinutes int
	// TrustedProxies: whose X-Forwarded-For/X-Real-IP is believed ("private", "all", "none" or CIDRs)
	TrustedProxies string
	// OAuthIdleDays: OAUTH_IDLE_DAYS, after this many unused days an OAuth connection (MCP) is
	// removed (0 = never)
	OAuthIdleDays int
	// DisableLoginProtection: LOGIN_PROTECTION=false switches off locking logins after repeated
	// failures (the zero value keeps it on)
	DisableLoginProtection bool

	// Optional SMTP environment variables (can also be overridden/configured in DB system_settings)
	SMTPHost string
	SMTPPort string
	SMTPUser string
	SMTPPass string
	SMTPFrom string
	// SMTPFromName is the sender's display name when SMTP_FROM is a bare address
	SMTPFromName string
	SMTPTLS      bool
	// SMTPSkipVerify accepts self-signed or mismatching certificates (internal mail servers)
	SMTPSkipVerify bool

	// Legal notices (Impressum, Datenschutz): an external URL and/or Markdown text, shown even before login
	Legal LegalTexts

	// RetentionAllowNever: RETENTION_ALLOW_NEVER=true/false fixes whether people may keep finished and
	// deleted things for good; unset (nil) leaves it to the system settings
	RetentionAllowNever *bool
	// MCPEnabled: MCP_ENABLED=true/false fixes whether the MCP endpoint (and OAuth for connectors) is on;
	// unset (nil) leaves it to the system settings
	MCPEnabled *bool
	// DefaultLanguage: DEFAULT_LANGUAGE gives the server's default language until the admin picks one in
	// the system settings (unsupported or unset: German; English in demo mode)
	DefaultLanguage string
	// Speech recognition, configured only by environment (STT_*)
	Speech SpeechConfig

	// Images and audio in notes (MEDIA_*)
	Media MediaConfig

	// NotifyDigestMinutes: notifications (except task alarms) are bundled over this many minutes
	NotifyDigestMinutes int

	// Web push (VAPID_*): keys are generated and stored in the database when not set
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
}

// MediaConfig limits uploads of images and audio recordings in notes. Sizes in MB; QuotaMB 0 = no limit
// per user. The demo uses DemoMaxMB for every file.
type MediaConfig struct {
	MaxImageMB int
	MaxAudioMB int
	QuotaMB    int
	DemoMaxMB  int
}

// SpeechConfig: with STT_URL set, voice input is transcribed by a self-hosted, OpenAI-compatible
// Whisper server (e.g. speaches); otherwise the browser's own speech recognition is used.
type SpeechConfig struct {
	URL            string // base URL, e.g. http://whisper:8000
	Model          string
	APIKey         string
	Disabled       bool // STT_DISABLED=true hides voice input everywhere
	NoBrowser      bool // STT_ALLOW_BROWSER=false forbids the browser's recognition (it sends audio to Google/Microsoft)
	MaxSeconds     int  // recordings stop after this long (enforced in the browser)
	MaxUploadMB    int
	MaxParallel    int // transcriptions running at the same time; more wait in line
	PerUserPerHour int
	TimeoutSeconds int
	VADFilter      bool // ask the Whisper server to skip silence (fewer made-up repetitions); speaches understands it
}

// Mode is "server", "browser" or "off". The demo never uses the server, so visitors cannot keep
// its CPU busy.
func (s SpeechConfig) Mode(demo bool) string {
	switch {
	case s.Disabled:
		return "off"
	case s.URL != "" && !demo:
		return "server"
	case s.NoBrowser:
		return "off"
	default:
		return "browser"
	}
}

type LegalTexts struct {
	ImprintURL, ImprintContent     string
	PrivacyURL, PrivacyContent     string
	CustomLinkLabel, CustomLinkURL string
}

// Publicly known JWT secrets (old code default and the placeholders from .env.example, compose and
// README). Signing with one of them would let anyone forge login tokens.
var insecureJWTSecrets = map[string]bool{
	"mindsift-default-selfhosted-jwt-secret-key-2026": true,
	"change_this_to_a_secure_random_key_min_32_chars": true,
	"hier-ein-langer-zufaelliger-wert":                true,
	"changeme":                                        true,
	"secret":                                          true,
}

const jwtSecretFile = "jwt.secret"

// resolveJWTSecret uses JWT_SECRET when it is set to a real value. Otherwise it generates a random
// secret once and keeps it in the data directory, so logins survive restarts without anybody being
// able to forge tokens with a known default.
func resolveJWTSecret(fromEnv, dataDir string) string {
	if v := strings.TrimSpace(fromEnv); v != "" && !insecureJWTSecrets[v] {
		if len(v) < 32 {
			slog.Warn("JWT_SECRET is shorter than 32 characters – please use a longer random value")
		}
		return v
	} else if v != "" {
		slog.Warn("JWT_SECRET is a publicly known placeholder and is ignored")
	}
	path := filepath.Join(dataDir, jwtSecretFile)
	if data, err := os.ReadFile(path); err == nil {
		if s := strings.TrimSpace(string(data)); len(s) >= 32 {
			return s
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand: " + err.Error())
	}
	secret := hex.EncodeToString(buf)
	_ = os.MkdirAll(dataDir, 0o755)
	if err := os.WriteFile(path, []byte(secret+"\n"), 0o600); err != nil {
		slog.Error("Saving the generated JWT secret failed – sign-ins only last until the next restart", "pfad", path, "error", err)
	} else {
		slog.Warn("No JWT_SECRET set: generated a random secret and saved it in the data directory. Better set JWT_SECRET for production.", "pfad", path)
	}
	return secret
}

const secretsKeyFile = "secrets.key"

// resolveSecretsKey: the key for hidden values in notes. SECRETS_KEY (any long random string) keeps it
// out of the data directory, so a copy of the database alone reveals nothing; otherwise a random key is
// generated once and kept in the data directory. Its own key and not one derived from JWT_SECRET, so
// changing JWT_SECRET (signing everyone out) does not lose the values.
func resolveSecretsKey(fromEnv, dataDir string) []byte {
	if v := strings.TrimSpace(fromEnv); v != "" {
		if len(v) < 32 {
			slog.Warn("SECRETS_KEY is shorter than 32 characters – please use a longer random value")
		}
		sum := sha256.Sum256([]byte(v))
		return sum[:]
	}
	path := filepath.Join(dataDir, secretsKeyFile)
	if data, err := os.ReadFile(path); err == nil {
		if key, err := hex.DecodeString(strings.TrimSpace(string(data))); err == nil && len(key) == 32 {
			return key
		}
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic("crypto/rand: " + err.Error())
	}
	_ = os.MkdirAll(dataDir, 0o755)
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key)+"\n"), 0o600); err != nil {
		slog.Error("Saving the generated key for hidden values failed – they cannot be read after a restart", "pfad", path, "error", err)
	}
	return key
}

// legalContent reads Markdown from NAME or, for longer texts, from the file named in NAME_FILE.
func legalContent(name string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	if path := strings.TrimSpace(os.Getenv(name + "_FILE")); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			slog.Warn("Reading the legal text failed", "variable", name+"_FILE", "error", err)
			return ""
		}
		return strings.TrimSpace(string(data))
	}
	return ""
}

// legalURL accepts only http(s) links, so a misconfiguration cannot inject javascript: URLs.
func legalURL(name string) string {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return ""
	}
	if !strings.HasPrefix(v, "https://") && !strings.HasPrefix(v, "http://") {
		slog.Warn("Legal text URL ignored: only http(s) allowed", "variable", name)
		return ""
	}
	return v
}

// legalCustomLink accepts only https links for the custom footer link.
func legalCustomLink(labelVar, urlVar string) (string, string) {
	u := strings.TrimSpace(os.Getenv(urlVar))
	if u == "" {
		return "", ""
	}
	if !strings.HasPrefix(u, "https://") {
		slog.Warn("Custom link URL ignored: only https allowed", "variable", urlVar, "url", u)
		return "", ""
	}
	label := strings.TrimSpace(os.Getenv(labelVar))
	return label, u
}

func Load() *Config {
	port := getEnv("PORT", "8080")
	dataDir := getEnv("DATA_DIR", "./data")
	dbURL := getEnv("DATABASE_URL", "")

	dbPath := filepath.Join(dataDir, "mindsift.db")
	if strings.HasPrefix(dbURL, "sqlite://") {
		dbPath = strings.TrimPrefix(dbURL, "sqlite://")
	} else if dbURL != "" && !strings.HasPrefix(dbURL, "postgres") {
		dbPath = dbURL
	}

	jwtSecret := resolveJWTSecret(os.Getenv("JWT_SECRET"), filepath.Dir(dbPath))
	baseURL := getEnv("BASE_URL", "http://localhost:"+port)
	allowReg := strings.ToLower(getEnv("ALLOW_REGISTRATION", "false")) == "true"

	debugVal := strings.ToLower(getEnv("DEBUG", "false"))
	debug := debugVal == "true" || debugVal == "1" || debugVal == "yes" || debugVal == "on"

	logLevel := strings.ToLower(getEnv("LOG_LEVEL", "info"))
	if debug {
		logLevel = "debug"
	}

	demoVal := strings.ToLower(getEnv("MINDA_DEMO", getEnv("MINDSIFT_DEMO", getEnv("DEMO_MODE", "false"))))
	demoMode := demoVal == "true" || demoVal == "1" || demoVal == "yes" || demoVal == "on"

	smtpHost := getEnv("SMTP_HOST", "")
	smtpPort := getEnv("SMTP_PORT", "587")
	smtpUser := getEnv("SMTP_USER", "")
	smtpPass := getEnv("SMTP_PASS", "")
	smtpFrom := getEnv("SMTP_FROM", "")
	smtpTLS := strings.ToLower(getEnv("SMTP_TLS", "true")) != "false"
	smtpSkipVerify := strings.ToLower(getEnv("SMTP_SKIP_VERIFY", "false")) == "true"

	return &Config{
		Port:                    port,
		DataDir:                 dataDir,
		DatabasePath:            dbPath,
		JWTSecret:               jwtSecret,
		SecretsKey:              resolveSecretsKey(os.Getenv("SECRETS_KEY"), filepath.Dir(dbPath)),
		BaseURL:                 baseURL,
		BaseURLSet:              strings.TrimSpace(os.Getenv("BASE_URL")) != "",
		AllowRegistration:       allowReg,
		RegistrationMode:        registrationMode(allowReg),
		RegistrationDomains:     strings.TrimSpace(os.Getenv("REGISTRATION_DOMAINS")),
		RegistrationVerifyEmail: boolEnvOrEmpty("REGISTRATION_VERIFY_EMAIL"),
		LogLevel:                logLevel,
		Debug:                   debug,
		DemoMode:                demoMode,
		DemoResetMinutes:        demoResetMinutes(),
		TrustedProxies:          getEnv("TRUSTED_PROXIES", "private"),
		RetentionAllowNever:     envBoolPtr("RETENTION_ALLOW_NEVER"),
		MCPEnabled:              envBoolPtr("MCP_ENABLED"),
		DefaultLanguage:         defaultLanguage(demoMode),
		DisableLoginProtection:  strings.ToLower(getEnv("LOGIN_PROTECTION", "true")) == "false",
		OAuthIdleDays:           envInt("OAUTH_IDLE_DAYS", 90, 0, 36500),
		SMTPHost:                smtpHost,
		SMTPPort:                smtpPort,
		SMTPUser:                smtpUser,
		SMTPPass:                smtpPass,
		SMTPFrom:                smtpFrom,
		SMTPFromName:            getEnv("SMTP_FROM_NAME", "MindSift"),
		SMTPTLS:                 smtpTLS,
		SMTPSkipVerify:          smtpSkipVerify,
		Speech: SpeechConfig{
			URL:            strings.TrimRight(getEnv("STT_URL", ""), "/"),
			Model:          getEnv("STT_MODEL", "deepdml/faster-whisper-large-v3-turbo-ct2"),
			APIKey:         getEnv("STT_API_KEY", ""),
			Disabled:       strings.ToLower(getEnv("STT_DISABLED", "false")) == "true",
			NoBrowser:      strings.ToLower(getEnv("STT_ALLOW_BROWSER", "true")) == "false",
			MaxSeconds:     envInt("STT_MAX_SECONDS", 600, 5, 3600),
			MaxUploadMB:    envInt("STT_MAX_UPLOAD_MB", 25, 1, 500),
			MaxParallel:    envInt("STT_MAX_PARALLEL", 1, 1, 32),
			PerUserPerHour: envInt("STT_PER_USER_PER_HOUR", 60, 1, 100000),
			TimeoutSeconds: envInt("STT_TIMEOUT_SECONDS", 120, 5, 3600),
			VADFilter:      strings.ToLower(getEnv("STT_VAD_FILTER", "true")) != "false",
		},
		NotifyDigestMinutes: envInt("NOTIFY_DIGEST_MINUTES", 5, 1, 1440),
		VAPIDPublicKey:      strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY")),
		VAPIDPrivateKey:     strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY")),
		VAPIDSubject:        strings.TrimSpace(os.Getenv("VAPID_SUBJECT")),
		Media: MediaConfig{
			MaxImageMB: envInt("MEDIA_MAX_IMAGE_MB", 15, 1, 1000),
			MaxAudioMB: envInt("MEDIA_MAX_AUDIO_MB", 50, 1, 2000),
			QuotaMB:    envInt("MEDIA_QUOTA_MB", 0, 0, 10000000),
			DemoMaxMB:  envInt("MEDIA_DEMO_MAX_MB", 3, 1, 100),
		},
		Legal: func() LegalTexts {
			customLabel, customURL := legalCustomLink("LEGAL_CUSTOM_LINK_LABEL", "LEGAL_CUSTOM_LINK_URL")
			return LegalTexts{
				ImprintURL:      legalURL("LEGAL_IMPRINT_URL"),
				ImprintContent:  legalContent("LEGAL_IMPRINT_CONTENT"),
				PrivacyURL:      legalURL("LEGAL_PRIVACY_URL"),
				PrivacyContent:  legalContent("LEGAL_PRIVACY_CONTENT"),
				CustomLinkLabel: customLabel,
				CustomLinkURL:   customURL,
			}
		}(),
	}
}

// SlogLevel parses Config.LogLevel into a standard slog.Level.
func (c *Config) SlogLevel() slog.Level {
	switch strings.ToLower(strings.TrimSpace(c.LogLevel)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && strings.TrimSpace(val) != "" {
		return strings.TrimSpace(val)
	}
	return fallback
}

// envInt reads a whole number within [min, max]; anything else falls back to def (with a warning).
func envInt(key string, def, min, max int) int {
	raw := getEnv(key, "")
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		slog.Warn("Invalid value, using the default", "variable", key, "value", raw, "default", def)
		return def
	}
	return n
}

func demoResetMinutes() int {
	n, err := strconv.Atoi(strings.TrimSpace(getEnv("DEMO_RESET_MINUTES", "20")))
	if err != nil || n < 0 {
		return 20
	}
	return n
}

// registrationMode reads REGISTRATION_MODE; unknown values are ignored ("" = admin settings decide).
func registrationMode(allowReg bool) string {
	switch m := strings.ToLower(strings.TrimSpace(os.Getenv("REGISTRATION_MODE"))); m {
	case "closed", "approval", "domain", "domain+approval", "open":
		return m
	case "":
	default:
		slog.Warn("Unknown REGISTRATION_MODE, ignored", "value", m)
	}
	if allowReg {
		return "open"
	}
	return ""
}

// boolEnvOrEmpty: "true" or "false" when the variable is set to a boolean, "" when unset or unknown.
func boolEnvOrEmpty(key string) string {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "true", "1", "yes", "on":
		return "true"
	case "false", "0", "no", "off":
		return "false"
	}
	return ""
}

// envBoolPtr reads true/false; nil when unset or anything else.
func envBoolPtr(key string) *bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "true", "1", "yes":
		v := true
		return &v
	case "false", "0", "no":
		v := false
		return &v
	}
	return nil
}

// defaultLanguage: DEFAULT_LANGUAGE; the demo starts in English unless it says otherwise.
func defaultLanguage(demoMode bool) string {
	if v := i18n.Normalize(os.Getenv("DEFAULT_LANGUAGE")); v != "" || !demoMode {
		return v
	}
	return "en"
}
