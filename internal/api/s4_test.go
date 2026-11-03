package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

func TestDemoSendsNothingAndKeepsAccounts(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "demo.db")
	store, err := storage.NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatal(err)
	}
	srv := NewServer(&config.Config{DatabasePath: dbPath, JWTSecret: "demo-secret", DemoMode: true}, store, ws.NewHub(), nil)
	t.Cleanup(srv.Close)
	router := srv.Router()
	token := sessionLogin(t, router, "admin", "admin", "visitor-1")
	_ = sessionLogin(t, router, "admin", "admin", "visitor-2")

	if err := srv.sendCustomWebhookNotification("https://example.com/hook", "x", "x", "", "", ""); err != errDemoOutgoing {
		t.Fatalf("webhook sender must refuse in demo, got %v", err)
	}
	if err := srv.sendDiscordNotification("de", "https://discord.com/api/webhooks/1/x", "x", "", "", ""); err != errDemoOutgoing {
		t.Fatalf("discord sender must refuse in demo, got %v", err)
	}
	if err := srv.sendMailContent("a@example.com", "x", mailContent{Intro: "x"}); err != errDemoOutgoing {
		t.Fatalf("mail sender must refuse in demo, got %v", err)
	}
	blocked := []struct{ method, path, body string }{
		{"POST", "/api/v1/auth/alarms/test", `{"channel":"webhook","target":"https://example.com/hook"}`},
		{"PUT", "/api/v1/admin/settings", `{"allowPrivateWebhooks":true}`},
		{"POST", "/api/v1/admin/smtp/test", `{"toEmail":"a@example.com"}`},
		{"POST", "/api/v1/admin/backups", ``},
		{"POST", "/api/v1/auth/revoke-all", ``},
		{"DELETE", "/api/v1/user/account", `{"password":"admin"}`},
		{"DELETE", "/api/v1/admin/users/" + storage.DemoUserID, ``},
		{"PATCH", "/api/v1/auth/settings", `{"password":"neuesPasswort1","currentPassword":"admin"}`},
	}
	for _, b := range blocked {
		rec := sessionCall(router, b.method, b.path, token, b.body, "")
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "Demo") {
			t.Fatalf("%s %s: want 403 demo notice, got %d %s", b.method, b.path, rec.Code, rec.Body.String())
		}
	}
	// Harmless profile changes still work
	if rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", token, `{"displayName":"Besucher"}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("display name in demo: %d", rec.Code)
	}
	// Visitors only see their own device, not the others' addresses
	var list []storage.Session
	_ = json.Unmarshal(sessionCall(router, "GET", "/api/v1/auth/sessions", token, "", "").Body.Bytes(), &list)
	if len(list) != 1 || !list[0].Current {
		t.Fatalf("demo session list must only show the own device, got %+v", list)
	}
}

func TestSMTPPasswordNeverReturned(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	rec := sessionCall(router, "PUT", "/api/v1/admin/settings", token,
		`{"sharingMode":"organizations","smtpHost":"mail.example.com","smtpUser":"bot","smtpPass":"geheim123"}`, "")
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "geheim123") || !strings.Contains(rec.Body.String(), `"smtpPassSet":true`) {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if body := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String(); strings.Contains(body, "geheim123") {
		t.Fatalf("GET leaks the password: %s", body)
	}
	// Saving again with the empty field keeps it
	sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","smtpHost":"mail.example.com","smtpUser":"bot","smtpPass":""}`, "")
	if sys, _ := store.GetSystemSettings(); sys.SMTPPass != "geheim123" {
		t.Fatalf("empty field must keep the password, got %q", sys.SMTPPass)
	}
	// Without SMTP user the password is dropped
	sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","smtpHost":"mail.example.com","smtpUser":"","smtpPass":""}`, "")
	if sys, _ := store.GetSystemSettings(); sys.SMTPPass != "" {
		t.Fatalf("password without user must be cleared, got %q", sys.SMTPPass)
	}
}

func TestDeletedAccountLosesServerBackups(t *testing.T) {
	srv, store, token := setupTestServer(t)
	root := srv.backupRoot()
	gone, _ := newTestUser(t, store, "gone@example.com")
	stays, _ := newTestUser(t, store, "stays@example.com")
	for _, id := range []string{gone.ID, stays.ID} {
		dir := storage.UserBackupDir(root, id)
		_ = os.MkdirAll(dir, 0o755)
		_ = os.WriteFile(filepath.Join(dir, "backup.zip"), []byte("x"), 0o600)
	}
	if rec := sessionCall(srv.Router(), "DELETE", "/api/v1/admin/users/"+gone.ID, token, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("delete user: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(storage.UserBackupDir(root, gone.ID)); !os.IsNotExist(err) {
		t.Fatalf("backups of the deleted account must be gone: %v", err)
	}
	for _, odd := range []string{"", ".", "/", "..", "../users"} {
		srv.removeUserBackups(odd)
	}
	if _, err := os.Stat(filepath.Join(storage.UserBackupDir(root, stays.ID), "backup.zip")); err != nil {
		t.Fatalf("other accounts' backups must stay: %v", err)
	}
}
