package api

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The switches a provider can fix: link previews, push only through known services, webhooks into
// the local network and the backups. The administration shows the environment's value as locked, a
// save does not change what is stored, and the server works with the environment's value.
func TestEnvLocksNetworkAndBackupSettings(t *testing.T) {
	t.Parallel()
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	on, off := true, false
	srv.cfg.LinkPreviews, srv.cfg.PushKnownServicesOnly, srv.cfg.AllowPrivateWebhooks = &off, &on, &off
	srv.cfg.BackupEnabled, srv.cfg.BackupTime, srv.cfg.BackupRetentionDays = &on, "03:15", 9

	body := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String()
	for _, want := range []string{
		`"linkPreviews":false`, `"linkPreviewsConfiguredViaEnv":true`,
		`"pushKnownServicesOnly":true`, `"pushKnownServicesOnlyConfiguredViaEnv":true`,
		`"allowPrivateWebhooks":false`, `"allowPrivateWebhooksConfiguredViaEnv":true`,
		`"backupEnabled":true`, `"backupEnabledConfiguredViaEnv":true`,
		`"backupTime":"03:15"`, `"backupTimeConfiguredViaEnv":true`,
		`"backupRetentionDays":9`, `"backupRetentionDaysConfiguredViaEnv":true`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("admin view, want %s: %s", want, body)
		}
	}
	rec := sessionCall(router, "PUT", "/api/v1/admin/settings", token,
		`{"sharingMode":"organizations","linkPreviews":true,"pushKnownServicesOnly":false,"allowPrivateWebhooks":true,"backupEnabled":false,"backupTime":"22:00","backupRetentionDays":2}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	sys, _ := store.GetSystemSettings()
	if sys.AllowPrivateWebhooks || sys.BackupEnabled || sys.BackupTime != storage.DefaultBackupTime || sys.BackupRetentionDays != storage.DefaultBackupRetentionDays ||
		(sys.PushKnownServicesOnly != nil && *sys.PushKnownServicesOnly) || (sys.LinkPreviews != nil && !*sys.LinkPreviews) {
		t.Fatalf("locked values must stay as stored: %+v", sys)
	}
	if srv.linkPreviewsEnabled() || !srv.pushKnownServicesOnly() || srv.allowPrivateWebhooks() || srv.backupKeepDays() != 9 {
		t.Fatal("the server must work with the environment's values")
	}
	eff := srv.effectiveSettings()
	at := func(hm string) time.Time {
		v, _ := time.ParseInLocation("2006-01-02 15:04", "2026-12-01 "+hm, clock.Location())
		return v
	}
	if !backupDue(eff, "", at("03:16")) || backupDue(eff, "", at("03:14")) {
		t.Fatal("backups must follow BACKUP_ENABLED and BACKUP_TIME")
	}
	// Without the variables the administration decides again
	srv.cfg.LinkPreviews, srv.cfg.PushKnownServicesOnly, srv.cfg.AllowPrivateWebhooks, srv.cfg.BackupEnabled = nil, nil, nil, nil
	srv.cfg.BackupTime, srv.cfg.BackupRetentionDays = "", 0
	sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","allowPrivateWebhooks":true,"backupRetentionDays":2}`, "")
	if !srv.allowPrivateWebhooks() || srv.backupKeepDays() != 2 {
		t.Fatal("unlocked, the administration's values count")
	}
	_ = domain.SystemSettings{}
}

// INSTANCE_NAME is only a default: the instance carries it until the administration sets a name.
func TestInstanceNameFromEnvIsADefault(t *testing.T) {
	t.Parallel()
	store, err := storage.NewStore(t.TempDir()+"/name.db", storage.WithDefaultInstanceName("Familie Müller"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if sys, _ := store.GetSystemSettings(); sys.InstanceName != "Familie Müller" {
		t.Fatalf("default: %q", sys.InstanceName)
	}
	sys, _ := store.GetSystemSettings()
	sys.InstanceName = "Unser Server"
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	if sys, _ := store.GetSystemSettings(); sys.InstanceName != "Unser Server" {
		t.Fatalf("the administration's name: %q", sys.InstanceName)
	}
}
