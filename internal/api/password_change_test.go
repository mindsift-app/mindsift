package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// adminToken signs the test server's admin in (mfaEnv keeps only its own account).
func (e *mfaEnv) adminToken() string {
	e.t.Helper()
	admin, err := e.store.GetFirstUser()
	if err != nil || admin == nil {
		e.t.Fatalf("admin: %v", err)
	}
	tok, err := auth.GenerateToken(testJWTSecret, admin.ID, admin.Email, admin.DisplayName, admin.TokenVersion, testSession(e.t, e.store, admin.ID))
	if err != nil {
		e.t.Fatal(err)
	}
	return tok
}

// adminReset sets a new password for the account through the administration.
func (e *mfaEnv) adminReset(admin, password string, mustChange, revokeKeys bool) map[string]any {
	e.t.Helper()
	rec, res := e.call("PUT", "/api/v1/admin/users/"+e.user.ID+"/password", admin,
		map[string]any{"password": password, "mustChange": mustChange, "revokeKeys": revokeKeys})
	if rec.Code != http.StatusOK {
		e.t.Fatalf("admin reset: %d %v", rec.Code, res)
	}
	e.pw = password
	return res
}

// A reset that asks for it: after signing in with the new password the session reaches nothing but the
// change (API keys keep working); the new password lifts it, and only for this account
func TestAdminResetMustChangePassword(t *testing.T) {
	e := newMFAEnv(t)
	admin := e.adminToken()
	key, err := e.store.CreateAPIKey(e.user.ID, "Skript", []string{storage.ScopeTasksRead})
	if err != nil {
		t.Fatal(err)
	}

	e.adminReset(admin, "vom-admin-1234", true, false)
	if u, _ := e.store.GetUserByID(e.user.ID); !u.MustChangePassword {
		t.Fatal("flag not stored")
	}
	entry := lastAudit(t, e.store, storage.AuditAccountPasswordReset)
	if string(entry.Details) != `{"mustChange":true}` {
		t.Fatalf("audit details: %s", entry.Details)
	}

	token := e.session()
	if rec, res := e.call("GET", "/api/v1/auth/me", token, nil); rec.Code != http.StatusOK || res["passwordChangeRequired"] != true {
		t.Fatalf("me: %d %v", rec.Code, res)
	}
	if rec, res := e.call("GET", "/api/v1/stats", token, nil); rec.Code != http.StatusForbidden || res["code"] != "password_change_required" {
		t.Fatalf("other routes must wait for the new password: %d %v", rec.Code, res)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/mfa/totp/setup", token, map[string]string{"password": e.pw}); rec.Code != http.StatusForbidden {
		t.Fatalf("the password comes before anything else: %d", rec.Code)
	}
	// The API key still delivers: it never signed in with the password
	if code, body := keyRequest(t, e.router, key.RawKey, "GET", "/api/v1/task-lists", ""); code != http.StatusOK {
		t.Fatalf("API key during the change: %d %s", code, body)
	}

	if rec, _ := e.call("POST", ownPasswordPath, token, map[string]string{"currentPassword": "falsch-1234", "password": "mein-eigenes-1234"}); rec.Code != http.StatusForbidden {
		t.Fatalf("wrong current password: %d", rec.Code)
	}
	e.advance(time.Minute)
	if rec, res := e.call("POST", ownPasswordPath, token, map[string]string{"currentPassword": e.pw, "password": e.pw}); rec.Code != http.StatusBadRequest || res["code"] != "password_unchanged" {
		t.Fatalf("the same password again: %d %v", rec.Code, res)
	}
	if rec, _ := e.call("POST", ownPasswordPath, token, map[string]string{"currentPassword": e.pw, "password": "kurz"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("too short: %d", rec.Code)
	}
	rec := sessionCall(e.router, "POST", ownPasswordPath, token, `{"currentPassword":"vom-admin-1234","password":"mein-eigenes-1234"}`, "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0")
	if rec.Code != http.StatusOK {
		t.Fatalf("change: %d %s", rec.Code, rec.Body.String())
	}
	// The session goes on with the fresh token the server sends along
	if fresh := rec.Header().Get("X-Session-Token"); fresh != "" {
		token = fresh
	}
	if rec, res := e.call("GET", "/api/v1/auth/me", token, nil); rec.Code != http.StatusOK || res["passwordChangeRequired"] != false {
		t.Fatalf("me after the change: %d %v", rec.Code, res)
	}
	if rec, _ := e.call("GET", "/api/v1/stats", token, nil); rec.Code != http.StatusOK {
		t.Fatalf("stats after the change: %d", rec.Code)
	}
	if u, _ := e.store.GetUserByID(e.user.ID); u.MustChangePassword || !auth.CheckPassword("mein-eigenes-1234", u.PasswordHash) {
		t.Fatal("the new password is stored and the request is done")
	}
}

// Without the switch nothing is asked for; a later reset without it drops an earlier request
func TestAdminResetWithoutMustChange(t *testing.T) {
	e := newMFAEnv(t)
	admin := e.adminToken()
	e.adminReset(admin, "vom-admin-1234", true, false)
	e.adminReset(admin, "vom-admin-5678", false, false)
	if u, _ := e.store.GetUserByID(e.user.ID); u.MustChangePassword {
		t.Fatal("a reset without the switch drops the request")
	}
	if entry := lastAudit(t, e.store, storage.AuditAccountPasswordReset); len(entry.Details) != 0 {
		t.Fatalf("plain reset has no details: %s", entry.Details)
	}
	token := e.session()
	if rec, _ := e.call("GET", "/api/v1/stats", token, nil); rec.Code != http.StatusOK {
		t.Fatalf("stats: %d", rec.Code)
	}
	// The own change without a request asks for the second factor as usual (none here), and works
	if rec, _ := e.call("POST", ownPasswordPath, token, map[string]string{"currentPassword": e.pw, "password": "mein-eigenes-1234"}); rec.Code != http.StatusOK {
		t.Fatalf("own change: %d", rec.Code)
	}
}

// Revoking with the reset removes the API keys and OAuth grants (MCP) of the account, not those of others
func TestAdminResetRevokesKeys(t *testing.T) {
	e := newMFAEnv(t)
	admin := e.adminToken()
	key, _ := e.store.CreateAPIKey(e.user.ID, "Skript", []string{storage.ScopeTasksRead})
	_, _ = e.store.CreateAPIKey(e.user.ID, "Zweites", nil)
	client, err := e.store.CreateOAuthClient("Claude", []string{"https://claude.ai/api/mcp/auth_callback"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.store.GrantOAuth(e.user.ID, client, []string{storage.ScopeNotesRead}, "https://claude.ai/api/mcp/auth_callback", "challenge", time.Now()); err != nil {
		t.Fatal(err)
	}
	firstAdmin, _ := e.store.GetFirstUser()
	other, _ := e.store.CreateAPIKey(firstAdmin.ID, "Admin-Skript", nil)

	res := e.adminReset(admin, "vom-admin-1234", false, true)
	if res["keysRevoked"] != float64(2) || res["connectionsRevoked"] != float64(1) {
		t.Fatalf("answer: %v", res)
	}
	if keys, _ := e.store.GetAPIKeys(e.user.ID); len(keys) != 0 {
		t.Fatalf("keys left: %+v", keys)
	}
	if code, _ := keyRequest(t, e.router, key.RawKey, "GET", "/api/v1/task-lists", ""); code != http.StatusUnauthorized {
		t.Fatalf("revoked key must be refused: %d", code)
	}
	if keys, _ := e.store.GetAPIKeys(firstAdmin.ID); len(keys) != 1 || keys[0].ID != other.ID {
		t.Fatalf("other accounts keep their keys: %+v", keys)
	}
	entry := lastAudit(t, e.store, storage.AuditAccountPasswordReset)
	var d map[string]any
	_ = json.Unmarshal(entry.Details, &d)
	if d["keysRevoked"] != float64(2) || d["connectionsRevoked"] != float64(1) || d["mustChange"] != nil {
		t.Fatalf("audit details: %s", entry.Details)
	}
}

// The calendar subscription reads the tasks without a sign-in, like a key: a reset that revokes keys
// switches it off (its address answers 404), a plain reset keeps it
func TestAdminResetRevokesCalendarFeed(t *testing.T) {
	e := newMFAEnv(t)
	admin := e.adminToken()
	feedStatus := func(token string) int {
		t.Helper()
		return sessionCall(e.router, "GET", "/calendar/"+token+".ics", "", "", "").Code
	}
	switchOn := func() string {
		t.Helper()
		rec, res := e.call("PUT", "/api/v1/calendar-feed", e.session(), nil)
		token, _ := res["token"].(string)
		if rec.Code != http.StatusOK || token == "" || feedStatus(token) != http.StatusOK {
			t.Fatalf("switch the feed on: %d %v", rec.Code, res)
		}
		return token
	}

	token := switchOn()
	if res := e.adminReset(admin, "vom-admin-1234", false, false); res["calendarFeedRevoked"] != nil {
		t.Fatalf("plain reset: %v", res)
	}
	if code := feedStatus(token); code != http.StatusOK {
		t.Fatalf("a plain reset keeps the feed: %d", code)
	}

	res := e.adminReset(admin, "vom-admin-5678", false, true)
	if res["calendarFeedRevoked"] != true {
		t.Fatalf("answer: %v", res)
	}
	if code := feedStatus(token); code != http.StatusNotFound {
		t.Fatalf("old feed address after revoking: %d, want 404", code)
	}
	var d map[string]any
	_ = json.Unmarshal(lastAudit(t, e.store, storage.AuditAccountPasswordReset).Details, &d)
	if d["calendarFeedRevoked"] != true {
		t.Fatalf("audit details: %v", d)
	}
	// Without a feed the answer says so and the audit row does not mention it
	if res := e.adminReset(admin, "vom-admin-9012", false, true); res["calendarFeedRevoked"] != false {
		t.Fatalf("answer without a feed: %v", res)
	}
	d = nil
	_ = json.Unmarshal(lastAudit(t, e.store, storage.AuditAccountPasswordReset).Details, &d)
	if _, ok := d["calendarFeedRevoked"]; ok {
		t.Fatalf("audit details without a feed: %v", d)
	}
}

// Both required: the new password first, then the second factor; changing the password is reachable
// while the second factor is missing
func TestMustChangePasswordBeforeRequiredMFA(t *testing.T) {
	e := newMFAEnv(t)
	admin := e.adminToken()
	e.adminReset(admin, "vom-admin-1234", true, false)
	e.requireMFA(storage.MFARequiredAll)
	token := e.session()
	if _, res := e.call("GET", "/api/v1/auth/me", token, nil); res["passwordChangeRequired"] != true || res["mfaSetupRequired"] != true {
		t.Fatalf("me: %v", res)
	}
	rec := sessionCall(e.router, "POST", ownPasswordPath, token, `{"currentPassword":"vom-admin-1234","password":"mein-eigenes-1234"}`, "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0")
	if rec.Code != http.StatusOK {
		t.Fatalf("change while the second factor is missing: %d %s", rec.Code, rec.Body.String())
	}
	if fresh := rec.Header().Get("X-Session-Token"); fresh != "" {
		token = fresh
	}
	if rec, res := e.call("GET", "/api/v1/stats", token, nil); rec.Code != http.StatusForbidden || res["code"] != "mfa_setup_required" {
		t.Fatalf("then the second factor: %d %v", rec.Code, res)
	}
}
