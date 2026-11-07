package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func setRegistration(t *testing.T, store *storage.Store, mode, domains string) {
	t.Helper()
	sys, _ := store.GetSystemSettings()
	sys.RegistrationMode, sys.RegistrationDomains = mode, domains
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
}

func register(srv *Server, email, invite string) (int, map[string]interface{}) {
	body := `{"email":"` + email + `","password":"password123","displayName":"` + strings.Split(email, "@")[0] + `","inviteCode":"` + invite + `"}`
	rec := sessionCall(srv.Router(), "POST", "/api/v1/auth/register", "", body, "")
	var out map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestRegistrationModes(t *testing.T) {
	srv, store, _ := setupTestServer(t)

	setRegistration(t, store, storage.RegistrationClosed, "")
	if code, _ := register(srv, "a@example.com", ""); code != http.StatusForbidden {
		t.Fatalf("closed: want 403, got %d", code)
	}

	setRegistration(t, store, storage.RegistrationOpen, "")
	if code, out := register(srv, "b@example.com", ""); code != http.StatusCreated || out["token"] == nil {
		t.Fatalf("open: want 201 with token, got %d %v", code, out)
	}

	setRegistration(t, store, storage.RegistrationDomain, "firma.de, @familie.de")
	if code, _ := register(srv, "c@fremd.de", ""); code != http.StatusForbidden {
		t.Fatalf("domain: foreign address must be refused, got %d", code)
	}
	if code, _ := register(srv, "c@Familie.DE", ""); code != http.StatusCreated {
		t.Fatalf("domain: listed domain (any case) must be active at once, got %d", code)
	}

	setRegistration(t, store, storage.RegistrationDomainApproval, "firma.de")
	if code, _ := register(srv, "d@firma.de", ""); code != http.StatusCreated {
		t.Fatalf("domain+approval: listed domain active at once, got %d", code)
	}
	if code, out := register(srv, "e@fremd.de", ""); code != http.StatusAccepted || out["pending"] != true || out["token"] != nil {
		t.Fatalf("domain+approval: others wait without session, got %d %v", code, out)
	}

	// An invite skips mode and domain check
	setRegistration(t, store, storage.RegistrationClosed, "")
	inv, _ := store.CreateUserInvite("", "", nil, 7, 1)
	if code, _ := register(srv, "f@fremd.de", inv.Code); code != http.StatusCreated {
		t.Fatalf("invite must work in closed mode, got %d", code)
	}
}

func TestApprovalFlow(t *testing.T) {
	srv, store, adminToken := setupTestServer(t)
	router := srv.Router()
	setRegistration(t, store, storage.RegistrationApproval, "")

	if code, _ := register(srv, "neu@example.com", ""); code != http.StatusAccepted {
		t.Fatalf("approval: want 202, got %d", code)
	}
	login := func() *http.Response {
		rec := sessionCall(router, "POST", "/api/v1/auth/login", "", `{"login":"neu@example.com","password":"password123"}`, "")
		return rec.Result()
	}
	res := login()
	var errBody map[string]string
	_ = json.NewDecoder(res.Body).Decode(&errBody)
	if res.StatusCode != http.StatusForbidden || !strings.Contains(errBody["error"], "Freigabe") {
		t.Fatalf("login before approval: want 403 mentioning Freigabe, got %d %v", res.StatusCode, errBody)
	}

	// The admin sees the account as waiting and approves it
	var users []domain.User
	_ = json.Unmarshal(sessionCall(router, "GET", "/api/v1/admin/users", adminToken, "", "").Body.Bytes(), &users)
	var waiting *domain.User
	for i := range users {
		if users[i].Email == "neu@example.com" {
			waiting = &users[i]
		}
	}
	if waiting == nil || !waiting.PendingApproval || waiting.IsActive {
		t.Fatalf("admin list must show the waiting account, got %+v", waiting)
	}
	_, memberToken := newTestUser(t, store, "member@example.com")
	if rec := sessionCall(router, "POST", "/api/v1/admin/users/"+waiting.ID+"/approve", memberToken, "", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("members must not approve, got %d", rec.Code)
	}
	if rec := sessionCall(router, "POST", "/api/v1/admin/users/"+waiting.ID+"/approve", adminToken, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", rec.Code, rec.Body.String())
	}
	if res := login(); res.StatusCode != http.StatusOK {
		t.Fatalf("login after approval: want 200, got %d", res.StatusCode)
	}
	if rec := sessionCall(router, "POST", "/api/v1/admin/users/"+waiting.ID+"/approve", adminToken, "", ""); rec.Code != http.StatusConflict {
		t.Fatalf("approving twice: want 409, got %d", rec.Code)
	}
}

func TestInviteLinkForSeveralPeople(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	if _, err := store.CreateUserInvite("", "x@example.com", nil, 7, 3); err == nil {
		t.Fatal("a link for several people must not be bound to one address")
	}
	inv, err := store.CreateUserInvite("", "", nil, 7, 2)
	if err != nil {
		t.Fatal(err)
	}
	for _, email := range []string{"eins@example.com", "zwei@example.com"} {
		if code, out := register(srv, email, inv.Code); code != http.StatusCreated {
			t.Fatalf("%s: want 201, got %d %v", email, code, out)
		}
	}
	if code, out := register(srv, "drei@example.com", inv.Code); code != http.StatusForbidden || !strings.Contains(out["error"].(string), "ausgeschöpft") {
		t.Fatalf("third use: want 403 'ausgeschöpft', got %d %v", code, out)
	}
	invites, _ := store.GetUserInvites()
	if len(invites) != 1 || invites[0].UseCount != 2 || invites[0].MaxUses != 2 {
		t.Fatalf("use count wrong: %+v", invites)
	}
}

func TestRegistrationFixedByEnvironment(t *testing.T) {
	srv, store, adminToken := setupTestServer(t)
	router := srv.Router()
	srv.cfg.RegistrationMode = storage.RegistrationClosed

	// The admin form shows the fixed value as locked and cannot change it
	rec := sessionCall(router, "PUT", "/api/v1/admin/settings", adminToken, `{"registrationMode":"open","allowRegistration":true,"instanceName":"MindSift"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("save settings: %d %s", rec.Code, rec.Body.String())
	}
	var sys domain.SystemSettings
	_ = json.Unmarshal(sessionCall(router, "GET", "/api/v1/admin/settings", adminToken, "", "").Body.Bytes(), &sys)
	if sys.RegistrationMode != storage.RegistrationClosed || !sys.RegistrationConfiguredViaEnv {
		t.Fatalf("environment must win and be marked, got %+v", sys)
	}
	if code, _ := register(srv, "x@example.com", ""); code != http.StatusForbidden {
		t.Fatalf("registration must stay closed, got %d", code)
	}
	if stored, _ := store.GetSystemSettings(); stored.RegistrationMode == storage.RegistrationOpen {
		t.Fatalf("the locked value must not be overwritten in the database")
	}
}

// verificationServer: mails can go out (SMTP + BASE_URL); returns the captured mails
func verificationServer(t *testing.T) (*Server, *storage.Store, string, func() []sentNote) {
	t.Helper()
	srv, store, adminToken := setupTestServer(t)
	srv.cfg.BaseURL, srv.cfg.BaseURLSet = "https://mindsift.example", true
	sys, _ := store.GetSystemSettings()
	sys.SMTPHost, sys.RegistrationVerifyEmail = "smtp.example.com", true
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
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
	return srv, store, adminToken, mails
}

// waitMail waits for a mail to `to` (mails go out in the background)
func waitMail(t *testing.T, mails func() []sentNote, to string) sentNote {
	t.Helper()
	for i := 0; i < 100; i++ {
		for _, m := range mails() {
			if m.to == to {
				return m
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no mail to %s, got %+v", to, mails())
	return sentNote{}
}

func TestEmailVerification(t *testing.T) {
	srv, store, _, mails := verificationServer(t)
	router := srv.Router()
	setRegistration(t, store, storage.RegistrationOpen, "")
	sys, _ := store.GetSystemSettings()
	sys.RegistrationVerifyEmail = true
	_ = store.UpdateSystemSettings(sys)

	code, out := register(srv, "neu@example.com", "")
	if code != http.StatusAccepted || out["verify"] != true || out["token"] != nil {
		t.Fatalf("register: want 202 with verify and no session, got %d %v", code, out)
	}
	mail := waitMail(t, mails, "neu@example.com")
	m := regexp.MustCompile(`verifyToken=([0-9a-f]{64})`).FindStringSubmatch(mail.text)
	if m == nil || !strings.HasPrefix(mail.text[strings.Index(mail.text, "https://"):], "https://mindsift.example/") {
		t.Fatalf("mail must carry a link built from BASE_URL: %s", mail.text)
	}
	login := func() int {
		return sessionCall(router, "POST", "/api/v1/auth/login", "", `{"login":"neu@example.com","password":"password123"}`, "").Code
	}
	if c := login(); c != http.StatusForbidden {
		t.Fatalf("login before confirming: want 403, got %d", c)
	}
	if rec := sessionCall(router, "POST", "/api/v1/auth/verify-email", "", `{"token":"`+strings.Repeat("0", 64)+`"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("wrong token: want 400, got %d", rec.Code)
	}
	rec := sessionCall(router, "POST", "/api/v1/auth/verify-email", "", `{"token":"`+m[1]+`"}`, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"pending":false`) {
		t.Fatalf("verify: %d %s", rec.Code, rec.Body.String())
	}
	if c := login(); c != http.StatusOK {
		t.Fatalf("login after confirming: want 200, got %d", c)
	}
	if rec := sessionCall(router, "POST", "/api/v1/auth/verify-email", "", `{"token":"`+m[1]+`"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("a link works only once, got %d", rec.Code)
	}

	// Invites need no confirmation
	inv, _ := store.CreateUserInvite("", "", nil, 7, 1)
	if code, out := register(srv, "eingeladen@example.com", inv.Code); code != http.StatusCreated || out["token"] == nil {
		t.Fatalf("invite: want 201 with session, got %d %v", code, out)
	}
}

func TestEmailVerificationBeforeApproval(t *testing.T) {
	srv, store, _, mails := verificationServer(t)
	router := srv.Router()
	setRegistration(t, store, storage.RegistrationApproval, "")
	sys, _ := store.GetSystemSettings()
	sys.RegistrationVerifyEmail = true
	_ = store.UpdateSystemSettings(sys)
	admin, err := store.GetFirstUser()
	if err != nil || admin == nil || admin.Role != "admin" {
		t.Fatalf("test server needs its admin, got %+v %v", admin, err)
	}
	adminEmail := admin.Email

	if code, _ := register(srv, "wartet@example.com", ""); code != http.StatusAccepted {
		t.Fatalf("register: want 202, got %d", code)
	}
	mail := waitMail(t, mails, "wartet@example.com")
	time.Sleep(100 * time.Millisecond)
	for _, m := range mails() {
		if m.to != "wartet@example.com" {
			t.Fatalf("admins must not hear about it before the address is confirmed, got mail to %s", m.to)
		}
	}
	token := regexp.MustCompile(`verifyToken=([0-9a-f]{64})`).FindStringSubmatch(mail.text)[1]
	rec := sessionCall(router, "POST", "/api/v1/auth/verify-email", "", `{"token":"`+token+`"}`, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"pending":true`) {
		t.Fatalf("verify: %d %s", rec.Code, rec.Body.String())
	}
	if m := waitMail(t, mails, adminEmail); !strings.Contains(m.subject, "Freigabe") {
		t.Fatalf("admin mail after confirming expected, got %q", m.subject)
	}
	if c := sessionCall(router, "POST", "/api/v1/auth/login", "", `{"login":"wartet@example.com","password":"password123"}`, "").Code; c != http.StatusForbidden {
		t.Fatalf("still waiting for approval: want 403, got %d", c)
	}
}

// An invite bound to an address takes the same address copied with invisible marks (from a messenger);
// another address is refused with a hint which one the code belongs to.
func TestRegisterInviteEmailWithInvisibleCharacters(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	setRegistration(t, store, storage.RegistrationClosed, "")
	other, _ := store.CreateUserInvite("", "anna.beispiel@example.com", nil, 7, 1)
	if code, out := register(srv, "bert@example.com", other.Code); code != http.StatusForbidden || !strings.Contains(out["error"].(string), "an***@example.com") {
		t.Fatalf("other address: want 403 naming an***@example.com, got %d %v", code, out)
	}
	inv, _ := store.CreateUserInvite("", "\u200eLara21@Gmail.com", nil, 7, 1)
	if inv.Email != "lara21@gmail.com" {
		t.Fatalf("invite address not cleaned: %q", inv.Email)
	}
	code, out := register(srv, "lara21@gmail.com\u200b", inv.Code)
	if code != http.StatusCreated {
		t.Fatalf("same address with invisible marks: want 201, got %d %v", code, out)
	}
	if u, _ := store.GetUserByLogin("\u200elara21@gmail.com"); u == nil || u.Email != "lara21@gmail.com" {
		t.Fatalf("account address stored clean and found: %+v", u)
	}
}
