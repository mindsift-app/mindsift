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
