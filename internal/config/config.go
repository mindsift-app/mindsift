package config

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"slices"
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
	// MetricsToken: Prometheus scrapes /metrics with it as bearer token (METRICS_TOKEN or METRICS_TOKEN_FILE);
	// empty = no /metrics at all
	MetricsToken string
	BaseURL      string
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
	// PeopleSearch: PEOPLE_SEARCH=true/false fixes whether names are suggested when sharing; PublicLinks:
	// PUBLIC_LINKS=true/false fixes whether notes may be shared by public link (false forbids it outright);
	// PublicLinkMaxDays: PUBLIC_LINKS_MAX_DAYS (1–14) fixes how long such a link may live. Unset leaves
	// each to the system settings.
	PeopleSearch      *bool
	PublicLinks       *bool
	PublicLinkMaxDays int
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

	// InitialAdmin: ADMIN_USER / ADMIN_PASSWORD (or ADMIN_PASSWORD_FILE) / ADMIN_EMAIL create the first
	// administrator on the first start, while the database has no account yet (api.CreateInitialAdmin);
	// ignored afterwards
	InitialAdmin InitialAdmin

	// OIDC: sign-in through an OpenID Connect provider (OIDC_*); checked by OIDCConfig.Resolve at the start
	OIDC OIDCConfig
}

// OIDCConfig: OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET (or OIDC_CLIENT_SECRET_FILE) switch the
// sign-in through a provider on (Authentik, Authelia, Keycloak, Dex, Google …). Name is the text on the
// button (OIDC_NAME); members of AdminGroup at the provider (OIDC_ADMIN_GROUP) are administrators.
// AutoCreate (OIDC_AUTO_CREATE, default true) creates accounts at the first sign-in; PasswordLogin
// (OIDC_PASSWORD_LOGIN, default true) false leaves the password only to administrators (emergency access).
// An existing account is never taken over by its address; its owner links it in the settings.
type OIDCConfig struct {
	Issuer           string
	ClientID         string
	ClientSecret     string
	ClientSecretFile string
	Name             string
	AdminGroup       string
	Scopes           []string
	AutoCreate       bool
	PasswordLogin    bool
	// The values of OIDC_AUTO_CREATE and OIDC_PASSWORD_LOGIN as set, so Resolve can refuse what is no boolean
	rawAutoCreate, rawPasswordLogin string
}

// Configured: OIDC_ISSUER is set (whether it can be used is up to Resolve, BASE_URL and the demo).
func (c OIDCConfig) Configured() bool { return c.Issuer != "" }

// DefaultOIDCScopes are asked for when OIDC_SCOPES is not set; "groups" is added with OIDC_ADMIN_GROUP.
var DefaultOIDCScopes = []string{"openid", "email", "profile"}

func loadOIDC() OIDCConfig {
	c := OIDCConfig{
		Issuer:           strings.TrimSpace(os.Getenv("OIDC_ISSUER")),
		ClientID:         strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")),
		ClientSecret:     strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET")),
		ClientSecretFile: strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET_FILE")),
		Name:             strings.TrimSpace(os.Getenv("OIDC_NAME")),
		AdminGroup:       strings.TrimSpace(os.Getenv("OIDC_ADMIN_GROUP")),
		Scopes:           strings.Fields(strings.ReplaceAll(os.Getenv("OIDC_SCOPES"), ",", " ")),
		rawAutoCreate:    strings.TrimSpace(os.Getenv("OIDC_AUTO_CREATE")),
		rawPasswordLogin: strings.TrimSpace(os.Getenv("OIDC_PASSWORD_LOGIN")),
	}
	// Taking over an existing account by its address at the provider is gone; an installation that still
	// sets the variable starts as before, the log says what to do instead
	if strings.TrimSpace(os.Getenv("OIDC_LINK_BY_EMAIL")) != "" {
		slog.Warn("OIDC_LINK_BY_EMAIL was removed and is ignored: a sign-in through the provider never takes over an existing account by its address. " +
			"The owner links the account under Settings → Security; you can remove the variable")
	}
	return c
}

// parseBool reads true/false (also 1/0, yes/no, on/off); unset gives def, anything else ok=false.
func parseBool(raw string, def bool) (value, ok bool) {
	switch strings.ToLower(raw) {
	case "":
		return def, true
	case "true", "1", "yes", "on":
		return true, true
	case "false", "0", "no", "off":
		return false, true
	}
	return def, false
}

// Resolve checks the OIDC_* variables and fills in what follows from them: the secret from
// OIDC_CLIENT_SECRET_FILE, the switches, the scopes and the button's name. Half a configuration (an issuer
// without client, a client without issuer, no secret), an issuer that is no http(s) address, a switch that
// is no boolean or a password login switched off without a provider is an error: the server does not start,
// so nobody is surprised by a sign-in that does not work. The errors name variables and paths, never the secret.
func (c *OIDCConfig) Resolve() error {
	autoCreate, ok := parseBool(c.rawAutoCreate, true)
	if !ok {
		return fmt.Errorf("OIDC_AUTO_CREATE is %q: set true or false", c.rawAutoCreate)
	}
	passwordLogin, ok := parseBool(c.rawPasswordLogin, true)
	if !ok {
		return fmt.Errorf("OIDC_PASSWORD_LOGIN is %q: set true or false", c.rawPasswordLogin)
	}
	c.AutoCreate, c.PasswordLogin = autoCreate, passwordLogin
	if c.Issuer == "" {
		switch {
		case c.ClientID != "" || c.ClientSecret != "" || c.ClientSecretFile != "":
			return errors.New("OIDC_CLIENT_ID or OIDC_CLIENT_SECRET is set without OIDC_ISSUER: set the issuer address of the provider, or remove the OIDC variables")
		case !passwordLogin:
			return errors.New("OIDC_PASSWORD_LOGIN=false needs a provider (OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET): without one nobody but the administrators could sign in")
		}
		return nil
	}
	u, err := url.Parse(c.Issuer)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("OIDC_ISSUER %q is not an http(s) address such as https://auth.example.com/application/o/mindsift/", c.Issuer)
	}
	if c.ClientID == "" {
		return errors.New("OIDC_ISSUER is set but OIDC_CLIENT_ID is missing")
	}
	if c.ClientSecretFile != "" {
		if c.ClientSecret != "" {
			return errors.New("OIDC_CLIENT_SECRET and OIDC_CLIENT_SECRET_FILE are both set: set only one of them")
		}
		data, err := os.ReadFile(c.ClientSecretFile)
		if err != nil {
			return fmt.Errorf("reading OIDC_CLIENT_SECRET_FILE failed: %w", err)
		}
		c.ClientSecret = strings.TrimSpace(string(data))
		if c.ClientSecret == "" {
			return fmt.Errorf("OIDC_CLIENT_SECRET_FILE %s is empty", c.ClientSecretFile)
		}
	}
	if c.ClientSecret == "" {
		return errors.New("OIDC_ISSUER is set but OIDC_CLIENT_SECRET (or OIDC_CLIENT_SECRET_FILE) is missing")
	}
	if c.Name == "" {
		c.Name = "SSO"
	}
	if len(c.Scopes) == 0 {
		c.Scopes = append([]string{}, DefaultOIDCScopes...)
		if c.AdminGroup != "" {
			c.Scopes = append(c.Scopes, "groups")
		}
	} else if !slices.Contains(c.Scopes, "openid") {
		c.Scopes = append([]string{"openid"}, c.Scopes...)
	}
	return nil
}

// InitialAdmin is the first administrator given by the environment. Password is kept exactly as set
// (spaces count, as in the setup wizard) and never logged. PasswordFile (ADMIN_PASSWORD_FILE, e.g. a
// Docker secret, so the password is not in the container's environment) is read only when the account is
// created (ResolvePassword).
type InitialAdmin struct {
	User         string
	Password     string
	PasswordFile string
	Email        string
}

// Set reports whether any of the variables is given.
func (a InitialAdmin) Set() bool {
	return a.User != "" || strings.TrimSpace(a.Password) != "" || a.PasswordFile != "" || a.Email != ""
}

// ResolvePassword gives the password from ADMIN_PASSWORD or, when ADMIN_PASSWORD_FILE is set, from that
// file (without the line break at its end). Both set, or a file that cannot be read or holds nothing, is
// an error; the errors name the path but never the file's content.
func (a InitialAdmin) ResolvePassword() (string, error) {
	if a.PasswordFile == "" {
		return a.Password, nil
	}
	if a.Password != "" {
		return "", errors.New("ADMIN_PASSWORD and ADMIN_PASSWORD_FILE are both set: set only one of them")
	}
	data, err := os.ReadFile(a.PasswordFile)
	if err != nil {
		return "", fmt.Errorf("reading ADMIN_PASSWORD_FILE failed: %w", err)
	}
	password := strings.TrimRight(string(data), "\r\n")
	if strings.TrimSpace(password) == "" {
		return "", fmt.Errorf("ADMIN_PASSWORD_FILE %s is empty", a.PasswordFile)
	}
	return password, nil
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

// Publicly known JWT secrets: the old code default and every example value ever published in
// .env.example, docker-compose.yml, the README, the docs or on the website. Signing with one of them
// would let anyone forge login tokens. Values shorter than minJWTSecretLength are refused anyway; the
// short examples stay listed so the log calls them what they are.
var insecureJWTSecrets = map[string]bool{
	"mindsift-default-selfhosted-jwt-secret-key-2026":  true,
	"change_this_to_a_secure_random_key_min_32_chars":  true,
	"put-a-long-random-value-here":                     true,
	"hier-ein-langer-zufaelliger-wert":                 true,
	"hier-einen-langen-geheimen-zufallswert-eintragen": true,
	"dein-sehr-langer-zufaelliger-geheimer-schluessel": true,
	"dein-geheimer-schluessel":                         true,
	"a-long-random-value":                              true,
	"un-valor-largo-y-aleatorio":                       true,
	"une-valeur-longue-et-aleatoire":                   true,
	"un-valore-lungo-e-casuale":                        true,
	"changeme":                                         true,
	"secret":                                           true,
}

// minJWTSecretLength: shorter JWT_SECRET values are ignored like the placeholders.
const minJWTSecretLength = 32

const jwtSecretFile = "jwt.secret"

// jwtSecretHowTo ends the warnings about an ignored JWT_SECRET.
const jwtSecretHowTo = "To sign with your own secret, set JWT_SECRET to at least 32 random characters (e.g. from: openssl rand -hex 32); to keep the generated one, remove JWT_SECRET."

// resolveJWTSecret uses JWT_SECRET when it is a real value of at least minJWTSecretLength characters.
// Otherwise (unset, a published placeholder or too short) it takes the random secret kept in the data
// directory, generating it on the first start, so logins survive restarts without anybody being able
// to forge tokens with a known or guessable value. The secret itself is never logged.
func resolveJWTSecret(fromEnv, dataDir string) string {
	v := strings.TrimSpace(fromEnv)
	if v != "" && !insecureJWTSecrets[v] && len(v) >= minJWTSecretLength {
		return v
	}
	path := filepath.Join(dataDir, jwtSecretFile)
	switch {
	case insecureJWTSecrets[v]:
		slog.Warn("JWT_SECRET is a publicly known example value and is ignored: sign-ins are signed with the random secret in the data directory instead. "+
			"Sign-ins made with the example value are no longer valid, so everyone has to sign in again once. "+jwtSecretHowTo, "path", path)
	case v != "":
		slog.Warn("JWT_SECRET is shorter than 32 characters and is ignored: sign-ins are signed with the random secret in the data directory instead. "+
			"Sign-ins made with the short value are no longer valid, so everyone has to sign in again once. "+jwtSecretHowTo, "path", path)
	}
	if data, err := os.ReadFile(path); err == nil {
		if s := strings.TrimSpace(string(data)); len(s) >= minJWTSecretLength {
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
		slog.Error("Saving the generated JWT secret failed – sign-ins only last until the next restart", "path", path, "error", err)
	} else if v == "" {
		slog.Warn("No JWT_SECRET set: generated a random secret and saved it in the data directory. Better set JWT_SECRET for production.", "path", path)
	} else {
		slog.Info("Generated a random JWT secret and saved it in the data directory", "path", path)
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
		slog.Error("Saving the generated key for hidden values failed – they cannot be read after a restart", "path", path, "error", err)
	}
	return key
}

// MinMetricsTokenLength: shorter tokens leave /metrics off (it would be guessable).
const MinMetricsTokenLength = 16

// resolveMetricsToken reads METRICS_TOKEN or, for a Docker secret, the file in METRICS_TOKEN_FILE. A token
// that is too short switches /metrics off with a warning instead of opening it.
func resolveMetricsToken() string {
	token := strings.TrimSpace(os.Getenv("METRICS_TOKEN"))
	if path := strings.TrimSpace(os.Getenv("METRICS_TOKEN_FILE")); token == "" && path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			slog.Warn("Reading METRICS_TOKEN_FILE failed, /metrics stays off", "error", err)
			return ""
		}
		token = strings.TrimSpace(string(data))
	}
	if token != "" && len(token) < MinMetricsTokenLength {
		slog.Warn("METRICS_TOKEN is shorter than 16 characters, /metrics stays off", "length", len(token))
		return ""
	}
	return token
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
	} else if strings.HasPrefix(dbURL, "postgres") {
		slog.Warn("DATABASE_URL names a Postgres database, which MindSift does not support – using the SQLite file instead", "path", dbPath)
	} else if dbURL != "" {
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

	// MINDSIFT_DEMO is the name; MINDA_DEMO and DEMO_MODE are earlier names that still switch it on
	demoMode := false
	for _, name := range []string{"MINDSIFT_DEMO", "MINDA_DEMO", "DEMO_MODE"} {
		switch strings.ToLower(getEnv(name, "false")) {
		case "true", "1", "yes", "on":
			demoMode = true
		}
	}

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
		MetricsToken:            resolveMetricsToken(),
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
		PeopleSearch:            envBoolPtr("PEOPLE_SEARCH"),
		PublicLinks:             envBoolPtr("PUBLIC_LINKS"),
		PublicLinkMaxDays:       publicLinkMaxDaysFromEnv(),
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
		InitialAdmin: InitialAdmin{
			User:         strings.TrimSpace(os.Getenv("ADMIN_USER")),
			Password:     os.Getenv("ADMIN_PASSWORD"),
			PasswordFile: strings.TrimSpace(os.Getenv("ADMIN_PASSWORD_FILE")),
			Email:        strings.TrimSpace(os.Getenv("ADMIN_EMAIL")),
		},
		OIDC: loadOIDC(),
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
// publicLinkMaxDaysFromEnv reads PUBLIC_LINKS_MAX_DAYS; outside 1–14 (or unset) it is 0, meaning the
// system settings decide.
func publicLinkMaxDaysFromEnv() int {
	n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("PUBLIC_LINKS_MAX_DAYS")))
	if err != nil || n < 1 {
		return 0
	}
	if n > MaxPublicLinkDays {
		return MaxPublicLinkDays
	}
	return n
}

// MaxPublicLinkDays is the hard limit for public links (storage.MaxPublicLinkDays): there is no link
// that lives for good.
const MaxPublicLinkDays = 14

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
