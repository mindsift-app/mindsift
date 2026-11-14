package storage

import (
	"path/filepath"
	"strings"
	"testing"
)

func storedSMTPPassRow(t *testing.T, s *Store) string {
	t.Helper()
	var v string
	if err := s.db.QueryRow(`SELECT value FROM system_settings WHERE key = 'smtp_pass'`).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestSealValueRoundTrip(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	sealed, err := SealValue(key, "id-1", "geheim")
	if err != nil || !strings.HasPrefix(sealed, SealedPrefix) || strings.Contains(sealed, "geheim") {
		t.Fatalf("sealed %q (%v)", sealed, err)
	}
	if v, err := OpenValue(key, "id-1", sealed); err != nil || v != "geheim" {
		t.Fatalf("opened %q (%v)", v, err)
	}
	if _, err := OpenValue(key, "id-2", sealed); err == nil {
		t.Fatal("a value must not open under another id")
	}
	if _, err := OpenValue([]byte("fedcba9876543210fedcba9876543210"), "id-1", sealed); err == nil {
		t.Fatal("a value must not open with another key")
	}
	if _, err := SealValue(nil, "id-1", "x"); err == nil {
		t.Fatal("sealing without a key must fail")
	}
}

// The SMTP password is stored encrypted, never in plain text, and reads back as it was
func TestSMTPPassStoredSealed(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	path := filepath.Join(t.TempDir(), "mindsift.db")
	store, err := NewStore(path, WithSecretsKey(key))
	if err != nil {
		t.Fatal(err)
	}
	sys, _ := store.GetSystemSettings()
	sys.SMTPHost, sys.SMTPUser, sys.SMTPPass = "mail.example.com", "alarm@example.com", "Sommer-2026!"
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	if row := storedSMTPPassRow(t, store); !strings.HasPrefix(row, SealedPrefix) || strings.Contains(row, "Sommer") {
		t.Fatalf("the password must be stored encrypted, got %q", row)
	}
	if got, _ := store.GetSystemSettings(); got.SMTPPass != "Sommer-2026!" || got.SMTPPassUnreadable {
		t.Fatalf("read back %q (unreadable %v)", got.SMTPPass, got.SMTPPassUnreadable)
	}
	_ = store.Close()

	// Another key (SECRETS_KEY changed): no password, marked unreadable; saving other settings keeps it
	other, err := NewStore(path, WithSecretsKey([]byte("fedcba9876543210fedcba9876543210")))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	sealed := storedSMTPPassRow(t, other)
	got, _ := other.GetSystemSettings()
	if got.SMTPPass != "" || !got.SMTPPassUnreadable {
		t.Fatalf("an undecryptable password must read as unreadable, got %q (%v)", got.SMTPPass, got.SMTPPassUnreadable)
	}
	got.InstanceName = "Neu"
	if err := other.UpdateSystemSettings(got); err != nil {
		t.Fatal(err)
	}
	if row := storedSMTPPassRow(t, other); row != sealed {
		t.Fatal("saving other settings must keep the undecryptable password as it is")
	}
	// The admin enters it again
	got, _ = other.GetSystemSettings()
	got.SMTPPass = "neu-2026"
	if err := other.UpdateSystemSettings(got); err != nil {
		t.Fatal(err)
	}
	if got, _ := other.GetSystemSettings(); got.SMTPPass != "neu-2026" || got.SMTPPassUnreadable {
		t.Fatalf("after entering it again: %q (unreadable %v)", got.SMTPPass, got.SMTPPassUnreadable)
	}
}

// Migration 43 encrypts a password stored in plain text by older versions
func TestMigrationSealsPlainSMTPPass(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	path := filepath.Join(t.TempDir(), "mindsift.db")
	store, err := NewStore(path, WithSecretsKey(key))
	if err != nil {
		t.Fatal(err)
	}
	// The state before the migration: the password in plain text, step 43 not yet recorded
	if _, err := store.db.Exec(`INSERT INTO system_settings (key, value) VALUES ('smtp_pass', 'klartext')
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`DELETE FROM schema_migrations WHERE id = 43`); err != nil {
		t.Fatal(err)
	}
	_ = store.Close()

	// Without the key the plain value cannot be sealed: the start stops instead of leaving it
	if _, err := NewStore(path); err == nil || !strings.Contains(err.Error(), "Migration 43") {
		t.Fatalf("expected migration 43 to stop without a key, got %v", err)
	}

	store, err = NewStore(path, WithSecretsKey(key))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if row := storedSMTPPassRow(t, store); !strings.HasPrefix(row, SealedPrefix) || strings.Contains(row, "klartext") {
		t.Fatalf("the migration must encrypt the password, got %q", row)
	}
	if got, _ := store.GetSystemSettings(); got.SMTPPass != "klartext" {
		t.Fatalf("read back %q", got.SMTPPass)
	}
}
