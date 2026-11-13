package config

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigLogLevelAndDebug(t *testing.T) {
	// Load writes the generated JWT secret into the data directory; keep it out of the repository
	t.Setenv("DATA_DIR", t.TempDir())
	os.Setenv("PORT", "9090")
	defer os.Unsetenv("PORT")

	// 1. Default info
	os.Unsetenv("LOG_LEVEL")
	os.Unsetenv("DEBUG")
	cfg := Load()
	if cfg.SlogLevel() != slog.LevelInfo {
		t.Fatalf("expected LevelInfo, got %v", cfg.SlogLevel())
	}

	// 2. LOG_LEVEL=debug
	os.Setenv("LOG_LEVEL", "debug")
	cfg = Load()
	if cfg.SlogLevel() != slog.LevelDebug {
		t.Fatalf("expected LevelDebug, got %v", cfg.SlogLevel())
	}

	// 3. LOG_LEVEL=warn
	os.Setenv("LOG_LEVEL", "warn")
	cfg = Load()
	if cfg.SlogLevel() != slog.LevelWarn {
		t.Fatalf("expected LevelWarn, got %v", cfg.SlogLevel())
	}

	// 4. LOG_LEVEL=error
	os.Setenv("LOG_LEVEL", "error")
	cfg = Load()
	if cfg.SlogLevel() != slog.LevelError {
		t.Fatalf("expected LevelError, got %v", cfg.SlogLevel())
	}

	// 5. DEBUG=true overrides LOG_LEVEL
	os.Setenv("LOG_LEVEL", "error")
	os.Setenv("DEBUG", "true")
	cfg = Load()
	if cfg.SlogLevel() != slog.LevelDebug {
		t.Fatalf("expected LevelDebug when DEBUG=true, got %v", cfg.SlogLevel())
	}

	// 6. DEBUG=1 overrides LOG_LEVEL
	os.Setenv("DEBUG", "1")
	cfg = Load()
	if cfg.SlogLevel() != slog.LevelDebug {
		t.Fatalf("expected LevelDebug when DEBUG=1, got %v", cfg.SlogLevel())
	}
	os.Unsetenv("DEBUG")
	os.Unsetenv("LOG_LEVEL")
}

// The server's logger is set up from LogLevelFromEnv before Load, whose warnings (no JWT_SECRET) go
// through it: both must agree on the level, and those warnings come in the logger's format.
func TestLogLevelFromEnvBeforeLoad(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	for _, env := range []struct{ level, debug string }{{"", ""}, {"warn", ""}, {"ERROR", ""}, {" debug ", ""}, {"error", "on"}, {"nonsense", "no"}} {
		// A new data directory each time, so the secret is generated (and warned about) again
		t.Setenv("DATA_DIR", t.TempDir())
		t.Setenv("LOG_LEVEL", env.level)
		t.Setenv("DEBUG", env.debug)
		var out bytes.Buffer
		prev := slog.Default()
		slog.SetDefault(slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: LogLevelFromEnv()})))
		cfg := Load()
		slog.SetDefault(prev)
		if got := LogLevelFromEnv(); got != cfg.SlogLevel() {
			t.Errorf("LOG_LEVEL=%q DEBUG=%q: before Load %v, Load %v", env.level, env.debug, got, cfg.SlogLevel())
		}
		if cfg.SlogLevel() <= slog.LevelWarn && !strings.Contains(out.String(), `level=WARN msg="No JWT_SECRET set`) {
			t.Errorf("LOG_LEVEL=%q: the JWT warning is not in the logger's format: %q", env.level, out.String())
		}
	}
}

func TestJWTSecretNeverUsesAKnownDefault(t *testing.T) {
	dir := t.TempDir()
	for _, env := range []string{"", "mindsift-default-selfhosted-jwt-secret-key-2026", "change_this_to_a_secure_random_key_min_32_chars"} {
		got := resolveJWTSecret(env, dir)
		if got == env || len(got) < 32 {
			t.Fatalf("env %q: insecure secret %q", env, got)
		}
	}
	// The generated secret is stable across restarts
	first := resolveJWTSecret("", dir)
	if again := resolveJWTSecret("", dir); again != first {
		t.Fatalf("generated secret must persist, got %q then %q", first, again)
	}
	info, err := os.Stat(filepath.Join(dir, jwtSecretFile))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("secret file must exist with mode 0600: %v %v", info, err)
	}
	if got := resolveJWTSecret("ein-eigener-sehr-langer-zufaelliger-wert-123456", dir); got != "ein-eigener-sehr-langer-zufaelliger-wert-123456" {
		t.Fatalf("a real JWT_SECRET must win, got %q", got)
	}
}

// captureLog sends slog output to a buffer for the rest of the test.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	before := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(before) })
	return &buf
}

func TestJWTSecretIgnoresPlaceholdersAndShortValues(t *testing.T) {
	cases := []struct{ env, warning string }{
		// The README example: 28 characters and a placeholder
		{"put-a-long-random-value-here", "publicly known example value"},
		{"change_this_to_a_secure_random_key_min_32_chars", "publicly known example value"},
		{"  hier-einen-langen-geheimen-zufallswert-eintragen  ", "publicly known example value"},
		{"my-own-but-short-secret-1234567", "shorter than 32 characters"}, // 31 characters
		{"kurz", "shorter than 32 characters"},
	}
	for _, c := range cases {
		dir := t.TempDir()
		stored := resolveJWTSecret("", dir)
		log := captureLog(t)
		got := resolveJWTSecret(c.env, dir)
		if got != stored {
			t.Fatalf("env %q: expected the secret from %s, got another value", c.env, jwtSecretFile)
		}
		out := log.String()
		if !strings.Contains(out, c.warning) || !strings.Contains(out, "sign in again") || !strings.Contains(out, "openssl rand -hex 32") {
			t.Errorf("env %q: missing or unclear warning: %s", c.env, out)
		}
		if strings.Contains(out, strings.TrimSpace(c.env)) || strings.Contains(out, stored) {
			t.Errorf("env %q: the log must not contain a secret: %s", c.env, out)
		}
	}

	// Without a stored secret one is generated and kept for the next start
	dir := t.TempDir()
	log := captureLog(t)
	first := resolveJWTSecret("kurz", dir)
	if len(first) < minJWTSecretLength || first == "kurz" {
		t.Fatalf("expected a generated secret, got %q", first)
	}
	if again := resolveJWTSecret("kurz", dir); again != first {
		t.Fatal("the generated secret must persist across restarts")
	}
	if strings.Contains(log.String(), first) {
		t.Errorf("the generated secret must not be logged: %s", log.String())
	}
}

func TestJWTSecretUsesLongOwnValue(t *testing.T) {
	dir := t.TempDir()
	log := captureLog(t)
	own := "0123456789abcdef0123456789abcdef" // exactly 32 characters
	if got := resolveJWTSecret(own, dir); got != own {
		t.Fatalf("a JWT_SECRET of 32 characters must be used, got %q", got)
	}
	if log.Len() != 0 {
		t.Errorf("an accepted JWT_SECRET needs no log line: %s", log.String())
	}
	if _, err := os.Stat(filepath.Join(dir, jwtSecretFile)); !os.IsNotExist(err) {
		t.Errorf("no secret file may be written when JWT_SECRET is used: %v", err)
	}
}

func TestCustomLinkValidation(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())

	// 1. Valid https URL and label
	t.Setenv("LEGAL_CUSTOM_LINK_LABEL", "Unternehmensseite")
	t.Setenv("LEGAL_CUSTOM_LINK_URL", "https://example.com/company")
	cfg := Load()
	if cfg.Legal.CustomLinkLabel != "Unternehmensseite" {
		t.Errorf("expected label 'Unternehmensseite', got %q", cfg.Legal.CustomLinkLabel)
	}
	if cfg.Legal.CustomLinkURL != "https://example.com/company" {
		t.Errorf("expected url 'https://example.com/company', got %q", cfg.Legal.CustomLinkURL)
	}

	// 2. Insecure http URL -> ignored
	t.Setenv("LEGAL_CUSTOM_LINK_LABEL", "Insecure Site")
	t.Setenv("LEGAL_CUSTOM_LINK_URL", "http://insecure.example.com")
	cfg = Load()
	if cfg.Legal.CustomLinkURL != "" || cfg.Legal.CustomLinkLabel != "" {
		t.Errorf("expected empty custom link for http, got url=%q label=%q", cfg.Legal.CustomLinkURL, cfg.Legal.CustomLinkLabel)
	}

	// 3. Invalid scheme (javascript:) -> ignored
	t.Setenv("LEGAL_CUSTOM_LINK_LABEL", "Exploit")
	t.Setenv("LEGAL_CUSTOM_LINK_URL", "javascript:alert(1)")
	cfg = Load()
	if cfg.Legal.CustomLinkURL != "" || cfg.Legal.CustomLinkLabel != "" {
		t.Errorf("expected empty custom link for javascript:, got url=%q label=%q", cfg.Legal.CustomLinkURL, cfg.Legal.CustomLinkLabel)
	}

	// 4. Empty URL -> empty
	t.Setenv("LEGAL_CUSTOM_LINK_LABEL", "Only Label")
	t.Setenv("LEGAL_CUSTOM_LINK_URL", "")
	cfg = Load()
	if cfg.Legal.CustomLinkURL != "" || cfg.Legal.CustomLinkLabel != "" {
		t.Errorf("expected empty custom link when url is empty, got url=%q label=%q", cfg.Legal.CustomLinkURL, cfg.Legal.CustomLinkLabel)
	}
}

// STT_ALLOW_BROWSER=false: without a Whisper server (or in the demo) there is no voice input at all
func TestSpeechModeWithoutBrowser(t *testing.T) {
	cases := []struct {
		cfg  SpeechConfig
		demo bool
		want string
	}{
		{SpeechConfig{URL: "http://whisper:8000"}, false, "server"},
		{SpeechConfig{URL: "http://whisper:8000", NoBrowser: true}, false, "server"},
		{SpeechConfig{}, false, "browser"},
		{SpeechConfig{NoBrowser: true}, false, "off"},
		{SpeechConfig{URL: "http://whisper:8000", NoBrowser: true}, true, "off"},
		{SpeechConfig{URL: "http://whisper:8000", Disabled: true}, false, "off"},
	}
	for _, c := range cases {
		if got := c.cfg.Mode(c.demo); got != c.want {
			t.Errorf("%+v demo=%v: got %q, want %q", c.cfg, c.demo, got, c.want)
		}
	}
}

// MINDSIFT_DEMO switches the demo on; the earlier names MINDA_DEMO and DEMO_MODE still do
func TestDemoModeNames(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	names := []string{"MINDSIFT_DEMO", "MINDA_DEMO", "DEMO_MODE"}
	for _, name := range names {
		t.Setenv(name, "")
	}
	if Load().DemoMode {
		t.Fatal("demo mode must be off by default")
	}
	for _, name := range names {
		t.Setenv(name, "true")
		if !Load().DemoMode {
			t.Errorf("%s=true must switch the demo on", name)
		}
		t.Setenv(name, "")
	}
	// An old .env next to the new compose file: the earlier name counts even when the new one says false
	t.Setenv("MINDSIFT_DEMO", "false")
	t.Setenv("MINDA_DEMO", "true")
	if !Load().DemoMode {
		t.Error("MINDA_DEMO=true must count next to MINDSIFT_DEMO=false")
	}
}

// A Postgres URL is not used as a file path; the SQLite file in DATA_DIR stays
func TestPostgresURLKeepsSQLitePath(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DATA_DIR", dir)
	t.Setenv("DATABASE_URL", "postgres://user:pw@db/mindsift")
	if got, want := Load().DatabasePath, filepath.Join(dir, "mindsift.db"); got != want {
		t.Errorf("database path: got %q, want %q", got, want)
	}
}

// ADMIN_PASSWORD_FILE (Docker secrets): the path comes from the environment, the file is read only by
// ResolvePassword, without the line break at its end; spaces inside and around the password count.
func TestInitialAdminPasswordFile(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	path := filepath.Join(t.TempDir(), "admin_password")
	if err := os.WriteFile(path, []byte(" Kr0k0dil im Keller\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ADMIN_USER", "admin")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("ADMIN_PASSWORD_FILE", " "+path+" ")
	cfg := Load()
	if cfg.InitialAdmin.PasswordFile != path || cfg.InitialAdmin.Password != "" || !cfg.InitialAdmin.Set() {
		t.Fatalf("InitialAdmin = %+v", cfg.InitialAdmin)
	}
	got, err := cfg.InitialAdmin.ResolvePassword()
	if err != nil || got != " Kr0k0dil im Keller" {
		t.Fatalf("ResolvePassword = %q, %v", got, err)
	}
	// Only the file given: Set() still reports the variables as given
	if !(InitialAdmin{PasswordFile: path}).Set() {
		t.Error("Set() ignores ADMIN_PASSWORD_FILE")
	}
	// Without a file, ADMIN_PASSWORD as it is
	if got, err := (InitialAdmin{Password: "geheim  "}).ResolvePassword(); err != nil || got != "geheim  " {
		t.Fatalf("ResolvePassword without file = %q, %v", got, err)
	}
}

// Both variables, a file that cannot be read or one without a password: an error naming the variable and
// the path, never a password.
func TestInitialAdminPasswordFileRefused(t *testing.T) {
	dir := t.TempDir()
	empty := filepath.Join(dir, "empty")
	if err := os.WriteFile(empty, []byte("  \n\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	secret := filepath.Join(dir, "secret")
	if err := os.WriteFile(secret, []byte("Kr0k0dil-im-Keller\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(dir, "missing")
	cases := []struct {
		name  string
		admin InitialAdmin
		want  []string
	}{
		{"both set", InitialAdmin{Password: "anderes-Passwort", PasswordFile: secret}, []string{"ADMIN_PASSWORD and ADMIN_PASSWORD_FILE are both set"}},
		{"missing file", InitialAdmin{PasswordFile: missing}, []string{"reading ADMIN_PASSWORD_FILE failed", missing}},
		{"empty file", InitialAdmin{PasswordFile: empty}, []string{"ADMIN_PASSWORD_FILE", empty, "is empty"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := c.admin.ResolvePassword()
			if err == nil || got != "" {
				t.Fatalf("ResolvePassword = %q, %v; want an error", got, err)
			}
			for _, w := range c.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error %q does not contain %q", err, w)
				}
			}
			if strings.Contains(err.Error(), "Kr0k0dil") || strings.Contains(err.Error(), "anderes-Passwort") {
				t.Errorf("a password is in the error: %q", err)
			}
		})
	}
}

func TestOIDCConfigFromEnvironment(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	secret := filepath.Join(t.TempDir(), "oidc-secret")
	if err := os.WriteFile(secret, []byte("aus-der-datei\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OIDC_ISSUER", "https://auth.example.com/application/o/mindsift/")
	t.Setenv("OIDC_CLIENT_ID", "mindsift")
	t.Setenv("OIDC_CLIENT_SECRET_FILE", secret)
	t.Setenv("OIDC_ADMIN_GROUP", "mindsift-admins")
	t.Setenv("OIDC_PASSWORD_LOGIN", "false")
	c := Load().OIDC
	if err := c.Resolve(); err != nil {
		t.Fatal(err)
	}
	if c.ClientSecret != "aus-der-datei" || c.Name != "SSO" || !c.AutoCreate || c.PasswordLogin ||
		strings.Join(c.Scopes, " ") != "openid email profile groups" {
		t.Fatalf("OIDC = %+v", c)
	}
	t.Setenv("OIDC_SCOPES", "email,profile")
	t.Setenv("OIDC_NAME", "Authentik")
	c = Load().OIDC
	if err := c.Resolve(); err != nil || strings.Join(c.Scopes, " ") != "openid email profile" || c.Name != "Authentik" {
		t.Fatalf("OIDC_SCOPES: %+v %v", c, err)
	}
}

// OIDC_LINK_BY_EMAIL is gone: an installation that still sets it (even to no boolean) starts, the log says so
func TestOIDCLinkByEmailRemoved(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("OIDC_ISSUER", "https://auth.example.com/application/o/mindsift/")
	t.Setenv("OIDC_CLIENT_ID", "mindsift")
	t.Setenv("OIDC_CLIENT_SECRET", "geheim")
	for _, v := range []string{"true", "vielleicht"} {
		t.Setenv("OIDC_LINK_BY_EMAIL", v)
		buf := captureLog(t)
		c := Load().OIDC
		if err := c.Resolve(); err != nil {
			t.Fatalf("OIDC_LINK_BY_EMAIL=%s: %v", v, err)
		}
		if !strings.Contains(buf.String(), "OIDC_LINK_BY_EMAIL was removed") || !strings.Contains(buf.String(), "Settings → Security") {
			t.Fatalf("OIDC_LINK_BY_EMAIL=%s: no warning in the log: %s", v, buf)
		}
	}
	t.Setenv("OIDC_LINK_BY_EMAIL", "")
	buf := captureLog(t)
	Load()
	if strings.Contains(buf.String(), "OIDC_LINK_BY_EMAIL") {
		t.Fatalf("warning without the variable: %s", buf)
	}
}

func TestOIDCConfigRefusesHalfASetup(t *testing.T) {
	secret := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(secret, []byte("Kr0k0dil\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ok := OIDCConfig{Issuer: "https://idp.example", ClientID: "a", ClientSecret: "Kr0k0dil"}
	notBool := ok
	notBool.rawAutoCreate = "vielleicht"
	cases := []struct {
		name string
		c    OIDCConfig
		want string
	}{
		{"client without issuer", OIDCConfig{ClientID: "a", ClientSecret: "b"}, "without OIDC_ISSUER"},
		{"password off without provider", OIDCConfig{rawPasswordLogin: "false"}, "OIDC_PASSWORD_LOGIN=false needs a provider"},
		{"no client id", OIDCConfig{Issuer: "https://idp.example", ClientSecret: "b"}, "OIDC_CLIENT_ID is missing"},
		{"no secret", OIDCConfig{Issuer: "https://idp.example", ClientID: "a"}, "OIDC_CLIENT_SECRET (or OIDC_CLIENT_SECRET_FILE) is missing"},
		{"both secrets", OIDCConfig{Issuer: "https://idp.example", ClientID: "a", ClientSecret: "Kr0k0dil", ClientSecretFile: secret}, "both set"},
		{"missing secret file", OIDCConfig{Issuer: "https://idp.example", ClientID: "a", ClientSecretFile: secret + ".fehlt"}, "reading OIDC_CLIENT_SECRET_FILE failed"},
		{"no http address", OIDCConfig{Issuer: "idp.example", ClientID: "a", ClientSecret: "b"}, "is not an http(s) address"},
		{"no boolean", notBool, "OIDC_AUTO_CREATE"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.c.Resolve()
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("Resolve = %v; want %q", err, tc.want)
			}
			if strings.Contains(err.Error(), "Kr0k0dil") {
				t.Fatalf("the secret is in the error: %v", err)
			}
		})
	}
	// Nothing set: off, password login on
	var none OIDCConfig
	if err := none.Resolve(); err != nil || none.Configured() || !none.PasswordLogin {
		t.Fatalf("unset: %+v %v", none, err)
	}
}
