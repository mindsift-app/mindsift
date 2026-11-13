package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The wizard's backup question: switched on, the time and retention land in the system settings, and the
// scheduler (which reads them every minute) runs at that time without a restart.
func TestFirstBootSetupSwitchesOnBackups(t *testing.T) {
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
	router := srv.Router()

	rec := postJSON(t, router, "/api/v1/auth/setup", "", `{"email":"owner@example.com","password":"secretpassword","backupEnabled":true,"backupTime":"02:30","backupRetentionDays":7}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup: %d %s", rec.Code, rec.Body.String())
	}
	sys, _ := store.GetSystemSettings()
	if !sys.BackupEnabled || sys.BackupTime != "02:30" || sys.BackupRetentionDays != 7 {
		t.Fatalf("backup settings not applied: enabled=%v time=%q days=%d", sys.BackupEnabled, sys.BackupTime, sys.BackupRetentionDays)
	}

	// What the scheduler decides with these settings, in the server's time zone (TZ)
	day := func(h, m int) time.Time { return time.Date(2026, 11, 11, h, m, 0, 0, clock.Location()) }
	if backupDue(sys, "", day(2, 29)) {
		t.Error("due before the chosen time")
	}
	if !backupDue(sys, "", day(2, 30)) || !backupDue(sys, "2026-11-10", day(23, 59)) {
		t.Error("not due at or after the chosen time")
	}
	if backupDue(sys, "2026-11-11", day(4, 0)) {
		t.Error("due twice on one day")
	}
	sys.BackupEnabled = false
	if backupDue(sys, "", day(4, 0)) || backupDue(nil, "", day(4, 0)) {
		t.Error("due while switched off")
	}
}

// Switched off, nothing runs; left out (an older client), the stored defaults stay: off, 03:00, 3 days.
func TestFirstBootSetupWithoutBackups(t *testing.T) {
	for name, body := range map[string]string{
		"off":     `{"email":"owner@example.com","password":"secretpassword","backupEnabled":false,"backupTime":"04:15","backupRetentionDays":10}`,
		"omitted": `{"email":"owner@example.com","password":"secretpassword"}`,
	} {
		t.Run(name, func(t *testing.T) {
			store, dbPath := freshStore(t)
			srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
			if rec := postJSON(t, srv.Router(), "/api/v1/auth/setup", "", body); rec.Code != http.StatusCreated {
				t.Fatalf("setup: %d %s", rec.Code, rec.Body.String())
			}
			sys, _ := store.GetSystemSettings()
			if sys.BackupEnabled || backupDue(sys, "", time.Date(2026, 11, 11, 23, 0, 0, 0, clock.Location())) {
				t.Fatal("backups switched on")
			}
			if name == "omitted" && (sys.BackupTime != storage.DefaultBackupTime || sys.BackupRetentionDays != storage.DefaultBackupRetentionDays) {
				t.Fatalf("defaults changed: %q, %d", sys.BackupTime, sys.BackupRetentionDays)
			}
			if name == "off" && (sys.BackupTime != "04:15" || sys.BackupRetentionDays != 10) {
				t.Fatalf("time and retention not kept for later: %q, %d", sys.BackupTime, sys.BackupRetentionDays)
			}
		})
	}
}

var badBackupChoices = []struct{ name, json, want string }{
	{"hour 25", `"backupTime":"25:00"`, "Invalid backup time"},
	{"no leading zero", `"backupTime":"3:00"`, "Invalid backup time"},
	{"no time", `"backupTime":"morgens"`, "Invalid backup time"},
	{"zero days", `"backupRetentionDays":0`, "Invalid backup retention"},
	{"negative", `"backupRetentionDays":-1`, "Invalid backup retention"},
	{"over a year", `"backupRetentionDays":366`, "Invalid backup retention"},
}

// A time other than HH:MM or a retention outside 1 to 365 days is refused before the admin is created.
func TestFirstBootSetupRefusesBadBackupValues(t *testing.T) {
	for _, c := range badBackupChoices {
		t.Run(c.name, func(t *testing.T) {
			store, dbPath := freshStore(t)
			srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
			req := `{"email":"owner@example.com","password":"secretpassword","backupEnabled":true,` + c.json + `}`
			rec := postJSONLang(t, srv.Router(), "/api/v1/auth/setup", "", req, "en")
			if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), c.want) {
				t.Fatalf("%s: %d %s, want 400 %q", c.json, rec.Code, rec.Body.String(), c.want)
			}
			if n, _ := store.CountUsers(); n != 0 {
				t.Fatalf("%d accounts created", n)
			}
			if sys, _ := store.GetSystemSettings(); sys.BackupEnabled {
				t.Fatal("backups switched on")
			}
		})
	}
	// In German, the language of the wizard's default
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
	rec := postJSONLang(t, srv.Router(), "/api/v1/auth/setup", "", `{"email":"owner@example.com","password":"secretpassword","backupTime":"24:00"}`, "de")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Ungültige Uhrzeit für die Backups") {
		t.Fatalf("German message: %d %s", rec.Code, rec.Body.String())
	}
}

// The rest of the setup after an admin from ADMIN_USER asks the same question with the same checks.
func TestFinishSetupBackups(t *testing.T) {
	captureLog(t)
	store, dbPath := freshStore(t)
	srv, err := startWith(t, store, dbPath, config.InitialAdmin{User: "admin", Password: initialAdminPassword}, false)
	if err != nil {
		t.Fatalf("CreateInitialAdmin: %v", err)
	}
	router := srv.Router()
	token := loginToken(t, router, "admin", initialAdminPassword)

	for _, c := range badBackupChoices {
		rec := postJSONLang(t, router, "/api/v1/admin/setup", token, `{"backupEnabled":true,`+c.json+`}`, "en")
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), c.want) {
			t.Fatalf("%s: %d %s, want 400 %q", c.json, rec.Code, rec.Body.String(), c.want)
		}
	}
	if !store.SetupPending() {
		t.Fatal("a refused request finished the setup")
	}
	if sys, _ := store.GetSystemSettings(); sys.BackupEnabled {
		t.Fatal("a refused request switched on backups")
	}

	rec := postJSON(t, router, "/api/v1/admin/setup", token, `{"sharingMode":"private","backupEnabled":true,"backupTime":"23:45","backupRetentionDays":14}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	sys, _ := store.GetSystemSettings()
	if !sys.BackupEnabled || sys.BackupTime != "23:45" || sys.BackupRetentionDays != 14 {
		t.Fatalf("backup settings not applied: enabled=%v time=%q days=%d", sys.BackupEnabled, sys.BackupTime, sys.BackupRetentionDays)
	}
	if backupDue(sys, "", time.Date(2026, 11, 11, 23, 44, 0, 0, clock.Location())) || !backupDue(sys, "", time.Date(2026, 11, 11, 23, 45, 0, 0, clock.Location())) {
		t.Fatal("not scheduled at 23:45")
	}
	if store.SetupPending() {
		t.Fatal("setup still pending")
	}
}

// postJSONLang is postJSON with the browser's language, which the error answers follow.
func postJSONLang(t *testing.T, router http.Handler, path, token, body, lang string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Language", lang)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}
