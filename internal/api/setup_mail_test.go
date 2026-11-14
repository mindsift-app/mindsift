package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// adminFromEnvironment: a fresh server whose admin came from ADMIN_USER without ADMIN_EMAIL, signed in,
// with the mails it sends captured (no mail server is set unless a test stores one).
func adminFromEnvironment(t *testing.T) (*Server, *storage.Store, http.Handler, string, func() []sentNote) {
	t.Helper()
	captureLog(t)
	store, dbPath := freshStore(t)
	srv, err := startWith(t, store, dbPath, config.InitialAdmin{User: "admin", Password: initialAdminPassword}, false)
	if err != nil {
		t.Fatalf("CreateInitialAdmin: %v", err)
	}
	var mu sync.Mutex
	var sent []sentNote
	srv.notifyEmailHook = func(to, subject, text, html string) error {
		mu.Lock()
		defer mu.Unlock()
		sent = append(sent, sentNote{channel: "email", to: to, subject: subject, text: text, html: html})
		return nil
	}
	mails := func() []sentNote {
		mu.Lock()
		defer mu.Unlock()
		return append([]sentNote(nil), sent...)
	}
	router := srv.Router()
	return srv, store, router, loginToken(t, router, "admin", initialAdminPassword), mails
}

var confirmLink = regexp.MustCompile(`confirmEmail=([0-9a-f]+)`)

// Without a mail server the address the admin gives in the wizard waits; the login address stays empty
// (no address is taken unconfirmed) and no mail goes out.
func TestFinishSetupKeepsEmailWaitingWithoutMailServer(t *testing.T) {
	_, store, router, token, mails := adminFromEnvironment(t)
	rec := postJSON(t, router, "/api/v1/admin/setup", token, `{"instanceName":"Zuhause","email":" Chef@Example.com "}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		PendingEmail     string `json:"pendingEmail"`
		ConfirmationSent bool   `json:"confirmationSent"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.PendingEmail != "chef@example.com" || res.ConfirmationSent {
		t.Fatalf("answer: %s", rec.Body.String())
	}
	u, _ := store.GetUserByLogin("admin")
	if u.Email != "" {
		t.Fatalf("address taken without confirmation: %q", u.Email)
	}
	if p := store.PendingEmailChanges(u.ID)[storage.EmailChangeAccount]; p.Email != "chef@example.com" {
		t.Fatalf("address not waiting: %+v", p)
	}
	if len(mails()) != 0 {
		t.Fatalf("mail without mail server: %+v", mails())
	}
}

// With the mail server from the wizard and BASE_URL the confirmation link goes out at once and takes
// the address only when clicked.
func TestFinishSetupStoresMailServerAndMailsTheLink(t *testing.T) {
	srv, store, router, token, mails := adminFromEnvironment(t)
	srv.cfg.BaseURL, srv.cfg.BaseURLSet = "https://mindsift.example", true

	body := `{"instanceName":"Zuhause","email":"chef@example.com","smtp":{"smtpHost":"mail.example.com","smtpPort":"465","smtpUser":"chef","smtpPass":"geheim","smtpFrom":"mindsift@example.com","smtpFromName":"Zuhause","smtpTls":true,"smtpSkipVerify":false}}`
	rec := postJSON(t, router, "/api/v1/admin/setup", token, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"confirmationSent":true`) {
		t.Errorf("answer: %s", rec.Body.String())
	}
	sys, _ := store.GetSystemSettings()
	if sys.SMTPHost != "mail.example.com" || sys.SMTPPort != "465" || sys.SMTPUser != "chef" || sys.SMTPPass != "geheim" ||
		sys.SMTPFrom != "mindsift@example.com" || sys.SMTPFromName != "Zuhause" || !sys.SMTPTLS {
		t.Fatalf("mail server not stored: %+v", sys)
	}

	mail := waitMail(t, mails, "chef@example.com")
	m := confirmLink.FindStringSubmatch(mail.text)
	if m == nil || !strings.Contains(mail.text, "https://mindsift.example/?confirmEmail=") {
		t.Fatalf("no confirmation link in: %s", mail.text)
	}
	u, _ := store.GetUserByLogin("admin")
	if u.Email != "" {
		t.Fatalf("address taken before the click: %q", u.Email)
	}
	if rec := postJSON(t, router, "/api/v1/auth/confirm-email", "", `{"token":"`+m[1]+`"}`); rec.Code != http.StatusOK {
		t.Fatalf("confirm: %d %s", rec.Code, rec.Body.String())
	}
	if u, _ = store.GetUserByLogin("admin"); u.Email != "chef@example.com" {
		t.Fatalf("address after the click: %q", u.Email)
	}
}

// A wrong address, one in use and a mail server without host are refused before anything is stored;
// the setup stays open.
func TestFinishSetupRefusesBadEmailAndMailServer(t *testing.T) {
	srv, store, router, token, _ := adminFromEnvironment(t)
	userWithPassword(t, srv, store, "taken@example.com", "irgendwas-langes", "member")
	for body, want := range map[string]int{
		`{"email":"kein-at"}`:                                               http.StatusBadRequest,
		`{"email":"Chef <chef@example.com>"}`:                               http.StatusBadRequest,
		`{"email":"TAKEN@example.com"}`:                                     http.StatusConflict,
		`{"smtp":{"smtpHost":"  ","smtpPort":"587"}}`:                       http.StatusBadRequest,
		`{"smtp":{"smtpHost":"mail.example.com","smtpPort":"70000"}}`:       http.StatusBadRequest,
		`{"smtp":{"smtpHost":"mail.example.com","smtpPort":"fünfhundert"}}`: http.StatusBadRequest,
	} {
		if rec := postJSON(t, router, "/api/v1/admin/setup", token, body); rec.Code != want {
			t.Errorf("%s: %d %s, want %d", body, rec.Code, rec.Body.String(), want)
		}
	}
	if !store.SetupPending() {
		t.Fatal("setup finished by a refused request")
	}
	if sys, _ := store.GetSystemSettings(); sys.SMTPHost != "" {
		t.Fatalf("mail server stored by a refused request: %q", sys.SMTPHost)
	}
}

// An admin who has an address (ADMIN_EMAIL) keeps it: the wizard's field changes nothing.
func TestFinishSetupIgnoresEmailWhenTheAccountHasOne(t *testing.T) {
	captureLog(t)
	store, dbPath := freshStore(t)
	srv, err := startWith(t, store, dbPath, config.InitialAdmin{User: "admin", Password: initialAdminPassword, Email: "admin@example.com"}, false)
	if err != nil {
		t.Fatal(err)
	}
	router := srv.Router()
	token := loginToken(t, router, "admin", initialAdminPassword)
	if rec := postJSON(t, router, "/api/v1/admin/setup", token, `{"email":"other@example.com"}`); rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	u, _ := store.GetUserByLogin("admin")
	if u.Email != "admin@example.com" || len(store.PendingEmailChanges(u.ID)) != 0 {
		t.Fatalf("address changed: %q, waiting %+v", u.Email, store.PendingEmailChanges(u.ID))
	}
}

// The status for the summary: only for admins, with the mail server, BASE_URL and the backup folder.
func TestSetupStatus(t *testing.T) {
	srv, store, router, token, _ := adminFromEnvironment(t)
	_, memberToken := userWithPassword(t, srv, store, "anna@example.com", "irgendwas-langes", "member")
	if rec := getWith(t, router, "/api/v1/admin/setup/status", memberToken); rec.Code != http.StatusForbidden {
		t.Fatalf("member: %d, want 403", rec.Code)
	}
	status := func() setupInfo {
		rec := getWith(t, router, "/api/v1/admin/setup/status", token)
		if rec.Code != http.StatusOK {
			t.Fatalf("status: %d %s", rec.Code, rec.Body.String())
		}
		var info setupInfo
		_ = json.Unmarshal(rec.Body.Bytes(), &info)
		return info
	}
	t.Setenv("TZ", "")
	clock.UseInTest(t, time.UTC)
	info := status()
	if info.SMTPConfigured || info.SMTPViaEnv || info.BaseURLSet || info.EmailLinks || !strings.HasSuffix(info.BackupDir, "backups") {
		t.Fatalf("fresh server: %+v", info)
	}
	if info.ServerTime == nil || info.ServerTime.Zone != "UTC" || info.ServerTime.Fallback != "UTC" || info.ServerTime.Source != clock.SourceSetting {
		t.Fatalf("server time: %+v", info.ServerTime)
	}

	srv.cfg.SMTPHost, srv.cfg.BaseURL, srv.cfg.BaseURLSet = "smtp.env.example", "https://mindsift.example", true
	if info = status(); !info.SMTPConfigured || !info.SMTPViaEnv || info.SMTPHost != "smtp.env.example" || !info.BaseURLSet || !info.EmailLinks {
		t.Fatalf("with SMTP_HOST and BASE_URL: %+v", info)
	}
}

// The public status tells the first-boot wizard about mail server and BASE_URL only while there is no
// account, and never the mail server's host.
func TestAuthStatusSetupInfoOnlyBeforeTheFirstAccount(t *testing.T) {
	t.Setenv("TZ", "Asia/Tokyo")
	clock.UseInTest(t, time.UTC)
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
	srv.cfg.SMTPHost = "smtp.env.example"
	router := srv.Router()
	authStatus := func() map[string]any {
		rec := getWith(t, router, "/api/v1/auth/status", "")
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	setup, ok := authStatus()["setup"].(map[string]any)
	if !ok || setup["smtpViaEnv"] != true || setup["smtpConfigured"] != true || setup["baseUrlSet"] != false {
		t.Fatalf("setup info: %+v", authStatus())
	}
	// The summary names the zone the backups follow when the wizard leaves it unset
	if zone, _ := setup["serverTime"].(map[string]any); zone == nil || zone["fallback"] != "Asia/Tokyo" || zone["zone"] != "UTC" {
		t.Fatalf("server time in the setup info: %+v", setup["serverTime"])
	}
	if _, leaked := setup["smtpHost"]; leaked {
		t.Fatalf("host in the public status: %+v", setup)
	}
	if rec := postJSON(t, router, "/api/v1/auth/setup", "", withSetupCode(srv, `{"email":"owner@example.com","password":"secretpassword"}`)); rec.Code != http.StatusCreated {
		t.Fatalf("setup: %d %s", rec.Code, rec.Body.String())
	}
	if _, still := authStatus()["setup"]; still {
		t.Fatal("setup info after the first account")
	}
}

// The first-boot wizard stores the mail server it was given.
func TestFirstBootSetupStoresMailServer(t *testing.T) {
	store, dbPath := freshStore(t)
	srv, _ := startWith(t, store, dbPath, config.InitialAdmin{}, false)
	body := `{"email":"owner@example.com","password":"secretpassword","smtp":{"smtpHost":"mail.example.com","smtpPort":"","smtpTls":true}}`
	if rec := postJSON(t, srv.Router(), "/api/v1/auth/setup", "", withSetupCode(srv, body)); rec.Code != http.StatusCreated {
		t.Fatalf("setup: %d %s", rec.Code, rec.Body.String())
	}
	sys, _ := store.GetSystemSettings()
	if sys.SMTPHost != "mail.example.com" || sys.SMTPPort != "587" || !sys.SMTPTLS {
		t.Fatalf("mail server: host %q port %q tls %v", sys.SMTPHost, sys.SMTPPort, sys.SMTPTLS)
	}
}

// The SMTP test tries a mail server given in the request without storing it; without one it uses the
// configured server, which a fresh instance does not have.
func TestSMTPTestWithUnsavedMailServer(t *testing.T) {
	_, store, router, token, mails := adminFromEnvironment(t)
	if rec := postJSON(t, router, "/api/v1/admin/smtp/test", token, `{"toEmail":"chef@example.com"}`); rec.Code != http.StatusBadGateway {
		t.Fatalf("without a mail server: %d %s", rec.Code, rec.Body.String())
	}
	if rec := postJSON(t, router, "/api/v1/admin/smtp/test", token, `{"toEmail":"chef@example.com","smtp":{"smtpHost":""}}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty host: %d %s", rec.Code, rec.Body.String())
	}
	rec := postJSON(t, router, "/api/v1/admin/smtp/test", token, `{"toEmail":"chef@example.com","smtp":{"smtpHost":"mail.example.com","smtpPort":"587","smtpTls":true}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("with a mail server: %d %s", rec.Code, rec.Body.String())
	}
	if got := mails(); len(got) != 1 || got[0].to != "chef@example.com" {
		t.Fatalf("test mail: %+v", got)
	}
	if sys, _ := store.GetSystemSettings(); sys.SMTPHost != "" {
		t.Fatalf("the test stored the mail server: %q", sys.SMTPHost)
	}
}

// Set up later in the administration, the mail server sends the link of the address the admin gave in the
// wizard.
func TestMailServerSetUpLaterSendsTheWaitingLink(t *testing.T) {
	srv, _, router, token, mails := adminFromEnvironment(t)
	srv.cfg.BaseURL, srv.cfg.BaseURLSet = "https://mindsift.example", true
	if rec := postJSON(t, router, "/api/v1/admin/setup", token, `{"email":"chef@example.com"}`); rec.Code != http.StatusOK {
		t.Fatalf("finish setup: %d %s", rec.Code, rec.Body.String())
	}
	if len(mails()) != 0 {
		t.Fatalf("mail without mail server: %+v", mails())
	}
	rec := getWith(t, router, "/api/v1/admin/settings", token)
	var settings map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &settings)
	settings["smtpHost"] = "mail.example.com"
	if rec := sendWith(t, router, http.MethodPut, "/api/v1/admin/settings", token, settings); rec.Code != http.StatusOK {
		t.Fatalf("save settings: %d %s", rec.Code, rec.Body.String())
	}
	if m := confirmLink.FindStringSubmatch(waitMail(t, mails, "chef@example.com").text); m == nil {
		t.Fatal("no confirmation link after setting up the mail server")
	}
}
