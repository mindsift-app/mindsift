package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/config"
)

// The first backup does not wait for the scheduler's next tick: finishing the wizard with backups on and a
// time already reached writes it at once, so the administration's list is not empty when it is opened.
func TestDesktopSetupWritesTheFirstBackupAtOnce(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)

	dir := filepath.Join(t.TempDir(), "Sicherungen")
	body, _ := json.Marshal(map[string]any{"backupEnabled": true, "backupTime": "00:00", "backupDir": dir})
	if rec := postJSON(t, router, "/api/v1/admin/setup", token, string(body)); rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		var listed []struct{ Name string }
		_ = json.Unmarshal(getWith(t, router, "/api/v1/admin/backups", token).Body.Bytes(), &listed)
		if len(listed) == 1 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("no backup listed after the wizard (the scheduler's tick is a minute away): %v", listed)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func desktopToken(t *testing.T, router http.Handler) string {
	t.Helper()
	var res struct{ Token string }
	rec := desktopSession(t, router, desktopTestOrigin)
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil || res.Token == "" {
		t.Fatalf("desktop session: %d %s", rec.Code, rec.Body.String())
	}
	return res.Token
}

func putJSONWith(t *testing.T, router http.Handler, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// The desktop app's wizard: language, time zone, name, backups with their folder and the help notes are
// stored; address, mail, registration and sharing are not asked and stay off whatever the request says.
// Backups, their list and restore use the chosen folder; a restart does not ask again.
func TestDesktopSetupWizard(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)

	var me struct {
		SetupPending bool `json:"setupPending"`
	}
	_ = json.Unmarshal(getWith(t, router, "/api/v1/auth/me", token).Body.Bytes(), &me)
	if !me.SetupPending {
		t.Fatal("/auth/me: setupPending false on the first start")
	}

	dir := filepath.Join(t.TempDir(), "Sicherungen")
	body, _ := json.Marshal(map[string]any{
		"instanceName": "Privat", "defaultLanguage": "en", "timeZone": "", "createSampleData": true,
		"backupEnabled": true, "backupTime": "21:15", "backupRetentionDays": 14, "backupDir": dir,
		// Not asked in the app; must not take effect
		"sharingMode": "open", "allowRegistration": true, "email": "a@example.com",
		"smtp": map[string]any{"smtpHost": "mail.example.com", "smtpFrom": "a@example.com"},
	})
	if rec := postJSON(t, router, "/api/v1/admin/setup", token, string(body)); rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	sys, _ := store.GetSystemSettings()
	if sys.InstanceName != "Privat" || sys.DefaultLanguage != "en" || !sys.BackupEnabled || sys.BackupTime != "21:15" || sys.BackupRetentionDays != 14 {
		t.Errorf("settings: name %q lang %q backups %v %q %d", sys.InstanceName, sys.DefaultLanguage, sys.BackupEnabled, sys.BackupTime, sys.BackupRetentionDays)
	}
	if sys.SharingMode != "private" || sys.AllowRegistration || sys.SMTPHost != "" {
		t.Errorf("server settings changed: sharing %q registration %v smtp %q", sys.SharingMode, sys.AllowRegistration, sys.SMTPHost)
	}
	users, _ := store.GetAllUsers()
	if users[0].Email != "" || len(store.PendingEmailChanges(users[0].ID)) != 0 {
		t.Errorf("address taken: %q %v", users[0].Email, store.PendingEmailChanges(users[0].ID))
	}
	// The backups go into MindSift's own subfolder of the chosen folder, named after the instance's folder
	root := filepath.Join(dir, "MindSift-Backups", filepath.Base(filepath.Dir(dbPath)))
	if store.SetupPending() || store.BackupDir() != dir || srv.backupRoot() != root {
		t.Errorf("pending %v, backup folder %q / %q, want %q", store.SetupPending(), store.BackupDir(), srv.backupRoot(), root)
	}
	if rec := postJSON(t, router, "/api/v1/admin/setup", token, `{}`); rec.Code != http.StatusConflict {
		t.Errorf("second setup: %d, want 409", rec.Code)
	}

	// A backup by hand lands in the chosen folder and is listed and restorable from there
	if rec := postJSON(t, router, "/api/v1/admin/backups", token, `{}`); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body.String())
	}
	// The setup starts a first backup in the background: besides the one by hand there may be that one too,
	// depending on whether it is done yet (two in the same second get the next free second, never one name)
	if files, _ := filepath.Glob(filepath.Join(root, "system", "mindsift-full-*")); len(files) < 1 || len(files) > 2 {
		t.Errorf("system snapshots in the chosen folder: %v", files)
	}
	if files, _ := filepath.Glob(filepath.Join(filepath.Dir(dbPath), "backups", "system", "mindsift-*")); len(files) != 0 {
		t.Errorf("snapshots in the default folder: %v", files)
	}
	var mine []struct{ Name string }
	_ = json.Unmarshal(getWith(t, router, "/api/v1/backups", token).Body.Bytes(), &mine)
	// as above: the one by hand, and the first one of the setup when it is done already
	if len(mine) < 1 || len(mine) > 2 {
		t.Fatalf("own backups listed: %v", mine)
	}
	if rec := postJSON(t, router, "/api/v1/backups/"+mine[0].Name+"/restore?preview=1&sections=notes", token, `{}`); rec.Code != http.StatusOK {
		t.Errorf("restore preview from the chosen folder: %d %s", rec.Code, rec.Body.String())
	}

	// Restart: no wizard again, the folder stays
	srv2 := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	if store.SetupPending() || srv2.backupRoot() != root {
		t.Errorf("after a restart: pending %v, folder %q", store.SetupPending(), srv2.backupRoot())
	}
}

// The wizard's language is the instance's and the account's, also where the desktop shell took the system's
// language as DEFAULT_LANGUAGE (German here): the administration, the sign-in status and the account all
// say English afterwards, and a restart with the same system language keeps it.
func TestDesktopSetupLanguageWinsOverTheSystemLanguage(t *testing.T) {
	t.Parallel()
	store, dbPath := freshStore(t)
	german := func(c *config.Config) { c.DefaultLanguage = "de" }
	router := startDesktop(t, store, dbPath, config.DesktopLinux, german).Router()
	token := desktopToken(t, router)
	adminLang := func() string {
		var s struct{ DefaultLanguage string }
		_ = json.Unmarshal(getWith(t, router, "/api/v1/admin/settings", token).Body.Bytes(), &s)
		return s.DefaultLanguage
	}
	if got := adminLang(); got != "de" {
		t.Fatalf("before the wizard: default language %q, want the system's de", got)
	}
	body := `{"instanceName":"Privat","defaultLanguage":"en","timeZone":"","backupEnabled":false}`
	if rec := postJSON(t, router, "/api/v1/admin/setup", token, body); rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	var status struct{ DefaultLanguage string }
	_ = json.Unmarshal(getWith(t, router, "/api/v1/auth/status", "").Body.Bytes(), &status)
	var me struct{ User struct{ Language string } }
	_ = json.Unmarshal(getWith(t, router, "/api/v1/auth/me", token).Body.Bytes(), &me)
	if got := adminLang(); got != "en" || status.DefaultLanguage != "en" || me.User.Language != "en" {
		t.Errorf("after the wizard: admin %q, status %q, account %q, want en", got, status.DefaultLanguage, me.User.Language)
	}

	router = startDesktop(t, store, dbPath, config.DesktopLinux, german).Router()
	if got := adminLang(); got != "en" {
		t.Errorf("after a restart: default language %q, want en", got)
	}
}

// The folder in the administration: shown with the default, checked when changed, "" goes back to the
// default; refused are relative paths, the instance's own folder and a folder that cannot be written to.
func TestDesktopBackupLocation(t *testing.T) {
	t.Parallel()
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()
	token := desktopToken(t, router)
	def := filepath.Join(filepath.Dir(dbPath), "backups")

	var loc backupLocation
	_ = json.Unmarshal(getWith(t, router, "/api/v1/admin/backups/location", token).Body.Bytes(), &loc)
	if loc.Dir != def || loc.DefaultDir != def || loc.Custom {
		t.Errorf("location at first: %+v, want the default %q", loc, def)
	}

	dir := filepath.Join(t.TempDir(), "neu", "tief")
	rec := putJSONWith(t, router, "/api/v1/admin/backups/location", token, `{"dir":`+jsonString(dir)+`}`)
	_ = json.Unmarshal(rec.Body.Bytes(), &loc)
	root := filepath.Join(dir, "MindSift-Backups", filepath.Base(filepath.Dir(dbPath)))
	if rec.Code != http.StatusOK || loc.Dir != root || loc.Chosen != dir || !loc.Custom {
		t.Fatalf("set: %d %s", rec.Code, rec.Body.String())
	}
	if info, err := os.Stat(filepath.Join(root, ".mindsift-backups")); err != nil || !info.Mode().IsRegular() {
		t.Errorf("subfolder not created and marked: %v", err)
	}

	// Choosing the shown folder itself does not nest another subfolder in it
	rec = putJSONWith(t, router, "/api/v1/admin/backups/location", token, `{"dir":`+jsonString(root)+`}`)
	_ = json.Unmarshal(rec.Body.Bytes(), &loc)
	if rec.Code != http.StatusOK || loc.Dir != root {
		t.Errorf("the shown folder chosen: %d %s", rec.Code, rec.Body.String())
	}
	rec = putJSONWith(t, router, "/api/v1/admin/backups/location", token, `{"dir":`+jsonString(dir)+`}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("set again: %d %s", rec.Code, rec.Body.String())
	}

	readOnly := filepath.Join(t.TempDir(), "nur-lesen")
	_ = os.Mkdir(readOnly, 0o500)
	bad := []string{"relativ/pfad", filepath.Dir(dbPath)}
	if os.Geteuid() != 0 { // root writes anywhere
		bad = append(bad, readOnly)
	}
	for _, d := range bad {
		if rec := putJSONWith(t, router, "/api/v1/admin/backups/location", token, `{"dir":`+jsonString(d)+`}`); rec.Code != http.StatusBadRequest {
			t.Errorf("%q: %d %s, want 400", d, rec.Code, rec.Body.String())
		}
	}
	if store.BackupDir() != dir {
		t.Errorf("a refused folder changed the setting: %q", store.BackupDir())
	}

	rec = putJSONWith(t, router, "/api/v1/admin/backups/location", token, `{"dir":""}`)
	_ = json.Unmarshal(rec.Body.Bytes(), &loc)
	if rec.Code != http.StatusOK || loc.Dir != def || loc.Custom || store.BackupDir() != "" {
		t.Errorf("back to the default: %d %s", rec.Code, rec.Body.String())
	}
}

// A normal server knows no backup folder setting: the routes do not exist, the wizard's field and a stored
// value are ignored (a web form must not make the server write wherever its process may).
func TestBackupLocationNotOnServer(t *testing.T) {
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{User: "root", Password: initialAdminPassword}, false)
	router := srv.Router()
	token := loginToken(t, router, "root", initialAdminPassword)
	if rec := getWith(t, router, "/api/v1/admin/backups/location", token); rec.Code != http.StatusNotFound {
		t.Errorf("GET location on a server: %d, want 404", rec.Code)
	}
	if rec := putJSONWith(t, router, "/api/v1/admin/backups/location", token, `{"dir":"/tmp"}`); rec.Code != http.StatusNotFound {
		t.Errorf("PUT location on a server: %d, want 404", rec.Code)
	}
	other := t.TempDir()
	if rec := postJSON(t, router, "/api/v1/admin/setup", token, `{"sharingMode":"open","backupDir":`+jsonString(other)+`}`); rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	if store.BackupDir() != "" {
		t.Errorf("server stored a backup folder: %q", store.BackupDir())
	}
	if store.SharingMode() != "open" {
		t.Errorf("server's sharing mode: %q, want open as chosen", store.SharingMode())
	}
	_ = store.SetBackupDir(other)
	if srv.backupRoot() != filepath.Join(filepath.Dir(dbPath), "backups") {
		t.Errorf("server follows a stored backup folder: %q", srv.backupRoot())
	}
}
