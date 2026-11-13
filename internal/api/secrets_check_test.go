package api

import (
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

// A backup restored without its secrets key: the start finds that the stored values do not open with the
// new key and says so loudly, but carries on.
func TestCheckSecretsKeyWarnsWhenTheKeyDoesNotMatch(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	user, err := store.EnsureDefaultUser()
	if err != nil {
		t.Fatal(err)
	}

	logs := captureLog(t)
	if checked, unreadable := srv.CheckSecretsKey(); checked != 0 || unreadable != 0 {
		t.Fatalf("empty database: checked %d, unreadable %d", checked, unreadable)
	}

	id := storage.NewSecretID()
	sealed, err := srv.sealSecret(id, "10.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CreateSecret(id, "doc-1", user.ID, sealed); err != nil {
		t.Fatal(err)
	}
	totp, err := srv.sealSecret(totpSealID(user.ID), "JBSWY3DPEHPK3PXP")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.StartTOTPSetup(user.ID, totp, time.Now()); err != nil {
		t.Fatal(err)
	}

	// The same key opens everything: no warning
	if checked, unreadable := srv.CheckSecretsKey(); checked != 2 || unreadable != 0 {
		t.Fatalf("matching key: checked %d, unreadable %d", checked, unreadable)
	}
	if strings.Contains(logs.String(), "WARN") {
		t.Fatalf("matching key logged a warning:\n%s", logs)
	}

	// A new key, as on a new machine without the old secrets.key
	other := NewServer(&config.Config{
		Port: "8080", DatabasePath: srv.cfg.DatabasePath, JWTSecret: srv.cfg.JWTSecret,
		SecretsKey: []byte("another-secrets-key-32-bytes!!!!"), SecretsKeySource: "generated",
	}, store, ws.NewHub(), nil)
	t.Cleanup(other.Close)
	if checked, unreadable := other.CheckSecretsKey(); checked != 2 || unreadable != 2 {
		t.Fatalf("other key: checked %d, unreadable %d", checked, unreadable)
	}
	out := logs.String()
	for _, want := range []string{"DOES NOT MATCH", "secrets.key", "Restoring a whole server", "key=generated", "note_secret=1", "totp=1"} {
		if !strings.Contains(out, want) {
			t.Errorf("warning lacks %q:\n%s", want, out)
		}
	}

	// One value sealed with the new key next to the old ones: a milder warning
	logs.Reset()
	id2 := storage.NewSecretID()
	sealed2, err := other.sealSecret(id2, "new value")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CreateSecret(id2, "doc-1", user.ID, sealed2); err != nil {
		t.Fatal(err)
	}
	if checked, unreadable := other.CheckSecretsKey(); checked != 3 || unreadable != 2 {
		t.Fatalf("mixed: checked %d, unreadable %d", checked, unreadable)
	}
	if out := logs.String(); !strings.Contains(out, "Some stored encrypted values") || strings.Contains(out, "DOES NOT MATCH") {
		t.Errorf("mixed values: unexpected log:\n%s", out)
	}
}
