package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

type auditPage struct {
	Entries    []storage.AuditEntry `json:"entries"`
	NextBefore int64                `json:"nextBefore"`
}

func getAudit(t *testing.T, srv *Server, token, query string) auditPage {
	t.Helper()
	rec := sessionCall(srv.Router(), "GET", "/api/v1/admin/audit"+query, token, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /admin/audit%s: %d %s", query, rec.Code, rec.Body.String())
	}
	var p auditPage
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// lastAudit: the newest row with this action, or fails.
func lastAudit(t *testing.T, store *storage.Store, action string) storage.AuditEntry {
	t.Helper()
	got, err := store.AuditEntries(storage.AuditFilter{Action: action, Limit: 1})
	if err != nil || len(got) == 0 {
		t.Fatalf("no audit row %s (%v)", action, err)
	}
	return got[0]
}

func TestAuditAccountActions(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	admin, _ := store.GetFirstUser()
	call := func(method, path, body string, want int) []byte {
		t.Helper()
		rec := sessionCall(router, method, path, token, body, "")
		if rec.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, rec.Code, rec.Body.String())
		}
		return rec.Body.Bytes()
	}

	const password = "ein-langes-Passwort-42"
	var created struct{ ID, Username string }
	_ = json.Unmarshal(call("POST", "/api/v1/admin/users", `{"email":"anna@example.com","password":"`+password+`","displayName":"Anna","role":"member"}`, http.StatusCreated), &created)
	e := lastAudit(t, store, storage.AuditAccountCreated)
	if e.ActorID != admin.ID || e.ActorKind != storage.AuditActorUser || e.Source != storage.AuditSourceWeb ||
		e.TargetID != created.ID || e.TargetName != created.Username || string(e.Details) != `{"role":"member"}` {
		t.Fatalf("created: %+v %s", e, e.Details)
	}

	call("PATCH", "/api/v1/admin/users/"+created.ID, `{"role":"admin"}`, http.StatusOK)
	if e := lastAudit(t, store, storage.AuditAccountRoleChanged); string(e.Details) != `{"from":"member","to":"admin"}` {
		t.Fatalf("role: %s", e.Details)
	}
	call("PATCH", "/api/v1/admin/users/"+created.ID, `{"isActive":false}`, http.StatusOK)
	lastAudit(t, store, storage.AuditAccountDisabled)
	call("PATCH", "/api/v1/admin/users/"+created.ID, `{"isActive":true}`, http.StatusOK)
	lastAudit(t, store, storage.AuditAccountEnabled)

	// Name and address with old and new value, the webhook (a secret address) only as changed
	call("PATCH", "/api/v1/admin/users/"+created.ID, `{"email":"anna.neu@example.com","discordWebhookUrl":"https://discord.com/api/webhooks/1/geheim-token"}`, http.StatusOK)
	e = lastAudit(t, store, storage.AuditAccountUpdated)
	if !strings.Contains(string(e.Details), `{"key":"email","from":"anna@example.com","to":"anna.neu@example.com"}`) ||
		!strings.Contains(string(e.Details), `{"key":"discordWebhookUrl","changed":true}`) || strings.Contains(string(e.Details), "geheim") {
		t.Fatalf("updated: %s", e.Details)
	}
	// Saving the same values records nothing
	before, _ := store.LastAuditID()
	call("PATCH", "/api/v1/admin/users/"+created.ID, `{"role":"admin","isActive":true,"email":"anna.neu@example.com"}`, http.StatusOK)
	if after, _ := store.LastAuditID(); after != before {
		t.Fatal("an update without changes is not recorded")
	}

	call("PUT", "/api/v1/admin/users/"+created.ID+"/password", `{"password":"ein-anderes-Passwort-43"}`, http.StatusOK)
	if e := lastAudit(t, store, storage.AuditAccountPasswordReset); e.TargetID != created.ID || len(e.Details) != 0 {
		t.Fatalf("password reset: %+v %s", e, e.Details)
	}
	call("POST", "/api/v1/admin/users/"+created.ID+"/mfa/reset", ``, http.StatusOK)
	lastAudit(t, store, storage.AuditAccountMFAReset)

	// A registration waiting for approval
	pending, _ := store.CreateInactiveUser("wartet@example.com", "x", "Wartet", domain.RoleMember)
	if err := store.AddPendingRegistration(pending.ID); err != nil {
		t.Fatal(err)
	}
	call("POST", "/api/v1/admin/users/"+pending.ID+"/approve", ``, http.StatusOK)
	if e := lastAudit(t, store, storage.AuditAccountApproved); e.TargetID != pending.ID {
		t.Fatalf("approved: %+v", e)
	}

	call("DELETE", "/api/v1/admin/users/"+created.ID, ``, http.StatusOK)
	if e := lastAudit(t, store, storage.AuditAccountDeleted); e.TargetID != created.ID || e.TargetName != created.Username {
		t.Fatalf("deleted: %+v", e)
	}

	// No password anywhere in the log
	all, _ := store.AuditEntries(storage.AuditFilter{Limit: 500})
	for _, e := range all {
		if strings.Contains(string(e.Details), "Passwort") || strings.Contains(strings.ToLower(string(e.Details)), "password\":\"") {
			t.Fatalf("secret in the log: %s %s", e.Action, e.Details)
		}
	}
	// The account filter finds the rows about the deleted account by its id
	p := getAudit(t, srv, token, "?user="+created.ID)
	if len(p.Entries) < 7 {
		t.Fatalf("rows about the account: %d", len(p.Entries))
	}
	for _, e := range p.Entries {
		if e.TargetID != created.ID && e.ActorID != created.ID {
			t.Fatalf("other row in the account filter: %+v", e)
		}
	}
}

func TestAuditInvitesOrganizationsSettings(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	call := func(method, path, body string, want int) []byte {
		t.Helper()
		rec := sessionCall(router, method, path, token, body, "")
		if rec.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, rec.Code, rec.Body.String())
		}
		return rec.Body.Bytes()
	}

	var inv domain.UserInvite
	_ = json.Unmarshal(call("POST", "/api/v1/admin/invites", `{"email":"gast@example.com","validDays":7,"maxUses":1}`, http.StatusCreated), &inv)
	e := lastAudit(t, store, storage.AuditInviteCreated)
	if e.TargetID != inv.ID || e.TargetName != "gast@example.com" || strings.Contains(string(e.Details), inv.Code) {
		t.Fatalf("invite created (never with its code): %+v %s", e, e.Details)
	}
	call("DELETE", "/api/v1/admin/invites/"+inv.ID, ``, http.StatusOK)
	if e := lastAudit(t, store, storage.AuditInviteRevoked); e.TargetID != inv.ID {
		t.Fatalf("invite revoked: %+v", e)
	}

	var org domain.Organization
	_ = json.Unmarshal(call("POST", "/api/v1/admin/organizations", `{"name":"Familie"}`, http.StatusCreated), &org)
	if e := lastAudit(t, store, storage.AuditOrgCreated); e.TargetID != org.ID || e.TargetName != "Familie" {
		t.Fatalf("org created: %+v", e)
	}
	call("PUT", "/api/v1/admin/organizations/"+org.ID, `{"name":"Familie Dach"}`, http.StatusOK)
	if e := lastAudit(t, store, storage.AuditOrgRenamed); string(e.Details) != `{"from":"Familie","to":"Familie Dach"}` {
		t.Fatalf("org renamed: %s", e.Details)
	}
	bert, _ := newTestUser(t, store, "bert@example.com")
	call("POST", "/api/v1/admin/organizations/"+org.ID+"/members", `{"userId":"`+bert.ID+`"}`, http.StatusOK)
	if e := lastAudit(t, store, storage.AuditOrgMemberAdded); e.TargetID != bert.ID || !strings.Contains(string(e.Details), `"organization":"Familie Dach"`) {
		t.Fatalf("member added: %+v %s", e, e.Details)
	}
	call("DELETE", "/api/v1/admin/organizations/"+org.ID+"/members/"+bert.ID, ``, http.StatusOK)
	lastAudit(t, store, storage.AuditOrgMemberRemoved)
	call("DELETE", "/api/v1/admin/organizations/"+org.ID, ``, http.StatusOK)
	if e := lastAudit(t, store, storage.AuditOrgDeleted); e.TargetName != "Familie Dach" {
		t.Fatalf("org deleted: %+v", e)
	}

	// Settings: each changed key with old and new value, the SMTP password only as changed
	settings := func() map[string]any {
		var m map[string]any
		_ = json.Unmarshal(call("GET", "/api/v1/admin/settings", ``, http.StatusOK), &m)
		return m
	}
	m := settings()
	m["instanceName"] = "Unser Server"
	m["smtpHost"] = "mail.example.com"
	m["smtpUser"] = "mindsift"
	m["smtpPass"] = "streng-geheim-123"
	body, _ := json.Marshal(m)
	call("PUT", "/api/v1/admin/settings", string(body), http.StatusOK)
	e = lastAudit(t, store, storage.AuditSettingsChanged)
	d := string(e.Details)
	if e.TargetKind != storage.AuditTargetSettings || !strings.Contains(d, `{"key":"instanceName","from":"MindSift","to":"Unser Server"}`) ||
		!strings.Contains(d, `{"key":"smtpPass","changed":true}`) || !strings.Contains(d, `"key":"smtpHost"`) || strings.Contains(d, "streng-geheim") {
		t.Fatalf("settings: %s", d)
	}
	// Saving again without a change (the password field stays empty): nothing recorded
	before, _ := store.LastAuditID()
	m = settings()
	body, _ = json.Marshal(m)
	call("PUT", "/api/v1/admin/settings", string(body), http.StatusOK)
	if after, _ := store.LastAuditID(); after != before {
		e := lastAudit(t, store, storage.AuditSettingsChanged)
		t.Fatalf("saving unchanged settings is not recorded: %s", e.Details)
	}

	// Category filter and paging
	p := getAudit(t, srv, token, "?action=organization.&limit=2")
	if len(p.Entries) != 2 || p.NextBefore == 0 || p.Entries[0].Action != storage.AuditOrgDeleted {
		t.Fatalf("first page: %+v", p)
	}
	p2 := getAudit(t, srv, token, "?action=organization.&limit=2&before="+itoa(p.NextBefore))
	p3 := getAudit(t, srv, token, "?action=organization.&limit=2&before="+itoa(p2.NextBefore))
	if len(p2.Entries) != 2 || len(p3.Entries) != 1 || p3.NextBefore != 0 {
		t.Fatalf("paging: %+v / %+v", p2, p3)
	}
}

// The log is for server admins: members and user managers get 403
func TestAuditOnlyForServerAdmins(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	member, memberToken := newTestUser(t, store, "member@example.com")
	_ = member
	manager, managerToken := newTestUser(t, store, "manager@example.com")
	role := domain.RoleManager
	if _, err := store.UpdateUser(manager.ID, nil, nil, &role, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	for name, tok := range map[string]string{"member": memberToken, "manager": managerToken} {
		if rec := sessionCall(router, "GET", "/api/v1/admin/audit", tok, "", ""); rec.Code != http.StatusForbidden {
			t.Fatalf("%s: %d", name, rec.Code)
		}
	}
	if rec := sessionCall(router, "GET", "/api/v1/admin/audit", "", "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("without sign-in: %d", rec.Code)
	}
	// What a manager does is recorded with the manager as actor
	rec := sessionCall(router, "POST", "/api/v1/admin/invites", managerToken, `{"validDays":7,"maxUses":3}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("manager invite: %d", rec.Code)
	}
	if e := lastAudit(t, store, storage.AuditInviteCreated); e.ActorID != manager.ID || e.ActorName == "" {
		t.Fatalf("actor: %+v", e)
	}
	if p := getAudit(t, srv, token, ""); len(p.Entries) == 0 {
		t.Fatal("the admin sees the log")
	}
}

// The provider creates the account and sets the role from its group: both are recorded with oidc as actor
func TestAuditOIDCAccountAndRole(t *testing.T) {
	e := newOIDCEnv(t, func(c *config.OIDCConfig) { c.AdminGroup = "mindsift-admins" })
	e.idp.person["groups"] = []string{"mindsift-admins"}
	id := e.userOf(e.mustSignIn())["id"].(string)
	created := lastAudit(t, e.store, storage.AuditAccountCreated)
	if created.TargetID != id || created.ActorKind != storage.AuditActorOIDC || created.Source != storage.AuditSourceOIDC {
		t.Fatalf("created: %+v", created)
	}
	role := lastAudit(t, e.store, storage.AuditAccountRoleChanged)
	if role.TargetID != id || role.ActorKind != storage.AuditActorOIDC ||
		string(role.Details) != `{"from":"member","group":"mindsift-admins","to":"admin"}` {
		t.Fatalf("role: %+v %s", role, role.Details)
	}
	// A sign-in that changes nothing writes nothing
	before, _ := e.store.LastAuditID()
	e.mustSignIn()
	if after, _ := e.store.LastAuditID(); after != before {
		t.Fatal("unchanged role recorded")
	}
}

func TestSettingsChangesSkipsReadOnlyAndSecrets(t *testing.T) {
	on, off := true, false
	before := &domain.SystemSettings{InstanceName: "A", SMTPPass: "alt", SMTPPassSet: true, MCPEnabled: &on, MCPViaEnv: true, AllowRegistration: false, RegistrationMode: "closed"}
	after := &domain.SystemSettings{InstanceName: "A", SMTPPass: "neu", SMTPPassSet: false, MCPEnabled: &off, MCPViaEnv: false, AllowRegistration: true, RegistrationMode: "open"}
	got := settingsChanges(before, after)
	b, _ := json.Marshal(got)
	want := `[{"key":"mcpEnabled","from":true,"to":false},{"key":"registrationMode","from":"closed","to":"open"},{"key":"smtpPass","changed":true}]`
	if string(b) != want {
		t.Fatalf("got  %s\nwant %s", b, want)
	}
}
