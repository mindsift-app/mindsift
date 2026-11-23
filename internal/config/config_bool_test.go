package config

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

// boolValues: every spelling a yes/no variable takes, and what it means (nil = not a yes/no value).
var boolValues = map[string]*bool{
	"true": ptr(true), "1": ptr(true), "yes": ptr(true), "on": ptr(true), "TRUE": ptr(true), " Yes ": ptr(true), "On": ptr(true),
	"false": ptr(false), "0": ptr(false), "no": ptr(false), "off": ptr(false), "FALSE": ptr(false), "No": ptr(false), "OFF": ptr(false),
	"maybe": nil, "2": nil, "enabled": nil,
}

func ptr(b bool) *bool { return &b }

// loadWithLog runs Load with key=value and returns the configuration and what it logged.
func loadWithLog(t *testing.T, key, value string) (*Config, string) {
	t.Helper()
	t.Setenv(key, value)
	var out bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&out, nil)))
	defer slog.SetDefault(prev)
	return Load(), out.String()
}

// Every yes/no variable takes true/false, 1/0, yes/no and on/off in any case; any other value leaves the
// default and says so in the log, naming the variable.
func TestBoolVariablesAllSpellings(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("JWT_SECRET", strings.Repeat("k", 40))
	switches := []struct {
		key string
		def bool
		get func(*Config) bool
	}{
		{"ALLOW_REGISTRATION", false, func(c *Config) bool { return c.AllowRegistration }},
		{"DEBUG", false, func(c *Config) bool { return c.Debug }},
		{"MINDSIFT_DEMO", false, func(c *Config) bool { return c.DemoMode }},
		{"SMTP_TLS", true, func(c *Config) bool { return c.SMTPTLS }},
		{"SMTP_SKIP_VERIFY", false, func(c *Config) bool { return c.SMTPSkipVerify }},
		{"SMTP_DISABLED", false, func(c *Config) bool { return c.SMTPDisabled }},
		{"LOGIN_PROTECTION", true, func(c *Config) bool { return !c.DisableLoginProtection }},
		{"API_KEYS_ENABLED", true, func(c *Config) bool { return !c.RESTAPIKeysOff }},
		{"UPDATE_CHECK", true, func(c *Config) bool { return !c.UpdateCheckOff }},
		{"BACKUP_EXCLUDE_SECRETS_KEY", false, func(c *Config) bool { return c.BackupExcludeSecretsKey }},
		{"STT_DISABLED", false, func(c *Config) bool { return c.Speech.Disabled }},
	}
	for _, s := range switches {
		for raw, want := range boolValues {
			cfg, log := loadWithLog(t, s.key, raw)
			expect := s.def
			if want != nil {
				expect = *want
			}
			if got := s.get(cfg); got != expect {
				t.Errorf("%s=%q: got %v, want %v", s.key, raw, got, expect)
			}
			if warned := strings.Contains(log, "variable="+s.key); warned != (want == nil) {
				t.Errorf("%s=%q: warning in the log = %v, want %v: %s", s.key, raw, warned, want == nil, log)
			}
		}
		t.Setenv(s.key, "")
	}

	// Variables whose absence leaves the admin settings in charge: nil when unset or invalid
	optional := []struct {
		key string
		get func(*Config) *bool
	}{
		{"RETENTION_ALLOW_NEVER", func(c *Config) *bool { return c.RetentionAllowNever }},
		{"MCP_ENABLED", func(c *Config) *bool { return c.MCPEnabled }},
		{"PEOPLE_SEARCH", func(c *Config) *bool { return c.PeopleSearch }},
		{"PUBLIC_LINKS", func(c *Config) *bool { return c.PublicLinks }},
		{"CALENDAR_FEEDS", func(c *Config) *bool { return c.CalendarFeeds }},
		{"LINK_PREVIEWS", func(c *Config) *bool { return c.LinkPreviews }},
		{"PUSH_KNOWN_SERVICES_ONLY", func(c *Config) *bool { return c.PushKnownServicesOnly }},
		{"ALLOW_PRIVATE_WEBHOOKS", func(c *Config) *bool { return c.AllowPrivateWebhooks }},
		{"BACKUP_ENABLED", func(c *Config) *bool { return c.BackupEnabled }},
		{"STT_VAD_FILTER", func(c *Config) *bool { return c.Speech.VADFilter }},
		{"STT_CHUNKED", func(c *Config) *bool { return c.Speech.Chunked }},
		{"MEDIA_AUDIO_UPLOADS", func(c *Config) *bool { return c.Media.AudioUploads }},
		{"MEDIA_IMAGES", func(c *Config) *bool { return c.Media.Images }},
		{"MEDIA_EXTERNAL_IMAGES", func(c *Config) *bool { return c.Media.ExternalImages }},
		{"STT_ALLOW_BROWSER", func(c *Config) *bool {
			switch {
			case c.Speech.BrowserAllowed:
				return ptr(true)
			case c.Speech.NoBrowser:
				return ptr(false)
			}
			return nil
		}},
		{"REGISTRATION_VERIFY_EMAIL", func(c *Config) *bool {
			if c.RegistrationVerifyEmail == "" {
				return nil
			}
			return ptr(c.RegistrationVerifyEmail == "true")
		}},
	}
	for _, o := range optional {
		for raw, want := range append2(boolValues, "", nil) {
			cfg, log := loadWithLog(t, o.key, raw)
			got := o.get(cfg)
			if (got == nil) != (want == nil) || (got != nil && *got != *want) {
				t.Errorf("%s=%q: got %v, want %v", o.key, raw, show(got), show(want))
			}
			if warned := strings.Contains(log, "variable="+o.key); warned != (want == nil && raw != "") {
				t.Errorf("%s=%q: warning in the log = %v: %s", o.key, raw, warned, log)
			}
		}
		t.Setenv(o.key, "")
	}
}

// append2: m with one more entry, m itself unchanged.
func append2(m map[string]*bool, k string, v *bool) map[string]*bool {
	out := make(map[string]*bool, len(m)+1)
	for key, val := range m {
		out[key] = val
	}
	out[k] = v
	return out
}

func show(b *bool) string {
	if b == nil {
		return "unset"
	}
	if *b {
		return "true"
	}
	return "false"
}

// The earlier names of the demo switch take the same spellings
func TestDemoModeOldNamesAllSpellings(t *testing.T) {
	for _, name := range []string{"MINDA_DEMO", "DEMO_MODE"} {
		for raw, want := range boolValues {
			t.Setenv(name, raw)
			if got := DemoModeFromEnv(); got != (want != nil && *want) {
				t.Errorf("%s=%q: demo = %v", name, raw, got)
			}
		}
		t.Setenv(name, "")
	}
}

// The logger is set up before Load with the same reading of DEBUG
func TestLogLevelFromEnvDebugSpellings(t *testing.T) {
	t.Setenv("LOG_LEVEL", "error")
	for raw, want := range boolValues {
		t.Setenv("DEBUG", raw)
		expect := slog.LevelError
		if want != nil && *want {
			expect = slog.LevelDebug
		}
		if got := LogLevelFromEnv(); got != expect {
			t.Errorf("DEBUG=%q: level %v, want %v", raw, got, expect)
		}
	}
}

// DEMO_RESET_MINUTES and PUBLIC_LINKS_MAX_DAYS are whole numbers; anything else keeps the default with a warning
func TestNumberVariables(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("JWT_SECRET", strings.Repeat("k", 40))
	for raw, want := range map[string]int{"": 20, "0": 0, "5": 5, " 30 ": 30, "-1": 20, "soon": 20} {
		cfg, log := loadWithLog(t, "DEMO_RESET_MINUTES", raw)
		if cfg.DemoResetMinutes != want {
			t.Errorf("DEMO_RESET_MINUTES=%q: %d, want %d", raw, cfg.DemoResetMinutes, want)
		}
		if warned := strings.Contains(log, "variable=DEMO_RESET_MINUTES"); warned != (raw == "-1" || raw == "soon") {
			t.Errorf("DEMO_RESET_MINUTES=%q: warning = %v", raw, warned)
		}
	}
	for raw, want := range map[string]int{"": 0, "0": 0, "1": 1, "14": 14, "30": MaxPublicLinkDays, "-3": 0, "week": 0} {
		cfg, log := loadWithLog(t, "PUBLIC_LINKS_MAX_DAYS", raw)
		if cfg.PublicLinkMaxDays != want {
			t.Errorf("PUBLIC_LINKS_MAX_DAYS=%q: %d, want %d", raw, cfg.PublicLinkMaxDays, want)
		}
		if warned := strings.Contains(log, "variable=PUBLIC_LINKS_MAX_DAYS"); warned != (raw == "-3" || raw == "week") {
			t.Errorf("PUBLIC_LINKS_MAX_DAYS=%q: warning = %v", raw, warned)
		}
	}
}
