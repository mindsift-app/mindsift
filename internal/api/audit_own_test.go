package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// ownAudit: the newest row with this action, made by the account on itself from the web.
func ownAudit(t *testing.T, store *storage.Store, action string, u *domain.User) storage.AuditEntry {
	t.Helper()
	e := lastAudit(t, store, action)
	if e.ActorKind != storage.AuditActorUser || e.Source != storage.AuditSourceWeb || e.ActorID != u.ID ||
		e.TargetKind != storage.AuditTargetUser || e.TargetID != u.ID || e.TargetName != e.ActorName || e.ActorName == "" {
		t.Fatalf("%s: actor and target must be the own account: %+v", action, e)
	}
	return e
}

// noSecretsIn fails when a row of the log holds one of the secrets.
func noSecretsIn(t *testing.T, store *storage.Store, secrets ...string) {
	t.Helper()
	all, _ := store.AuditEntries(storage.AuditFilter{Limit: 500})
	for _, e := range all {
		for _, s := range secrets {
			if s != "" && strings.Contains(string(e.Details), s) {
				t.Fatalf("secret %q in the log: %s %s", s, e.Action, e.Details)
			}
		}
	}
}

// A new own password, in the settings or through the mail link, and signing out devices
func TestAuditOwnPasswordAndSessions(t *testing.T) {
	t.Parallel()
	e := newMFAEnv(t)
	token := e.session()
	other := e.session()

	if rec, res := e.call("POST", "/api/v1/auth/password", token, map[string]string{"currentPassword": e.pw, "password": "ganz-neues-Passwort-7"}); rec.Code != http.StatusOK {
		t.Fatalf("change password: %d %v", rec.Code, res)
	}
	if a := ownAudit(t, e.store, storage.AuditAccountPasswordChanged, e.user); len(a.Details) != 0 {
		t.Fatalf("password changed: no details, got %s", a.Details)
	}
	e.pw = "ganz-neues-Passwort-7"
	if rec, _ := e.call("GET", "/api/v1/auth/me", other, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("the other session ends with the new password: %d", rec.Code)
	}

	raw, err := e.store.CreatePasswordResetToken(e.user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/reset-password", "", map[string]string{"token": raw, "password": "per-Mail-gesetzt-8"}); rec.Code != http.StatusOK {
		t.Fatalf("reset by mail: %d", rec.Code)
	}
	if a := ownAudit(t, e.store, storage.AuditAccountPasswordChanged, e.user); string(a.Details) != `{"via":"emailLink"}` {
		t.Fatalf("password through the mail link: %s", a.Details)
	}
	e.pw = "per-Mail-gesetzt-8"

	// One device signed out: the log names the device, never its address
	laptop, phone := e.session(), e.session()
	list, err := e.store.ListSessions(e.user.ID, "")
	if err != nil || len(list) < 2 {
		t.Fatalf("sessions: %v %v", list, err)
	}
	if rec, res := e.call("DELETE", "/api/v1/auth/sessions/"+list[0].ID, laptop, nil); rec.Code != http.StatusOK {
		t.Fatalf("end session: %d %v", rec.Code, res)
	}
	a := ownAudit(t, e.store, storage.AuditAccountSessionEnded, e.user)
	if !strings.Contains(string(a.Details), "Firefox") || (list[0].IP != "" && strings.Contains(string(a.Details), list[0].IP)) {
		t.Fatalf("session ended: %s", a.Details)
	}
	// An unknown session records nothing
	before, _ := e.store.LastAuditID()
	if rec, _ := e.call("DELETE", "/api/v1/auth/sessions/sess_unbekannt", phone, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown session: %d", rec.Code)
	}
	if after, _ := e.store.LastAuditID(); after != before {
		t.Fatal("ending an unknown session is not recorded")
	}

	if rec, res := e.call("POST", "/api/v1/auth/revoke-all", phone, nil); rec.Code != http.StatusOK {
		t.Fatalf("sign out everywhere: %d %v", rec.Code, res)
	}
	ownAudit(t, e.store, storage.AuditAccountSessionsRevoked, e.user)

	noSecretsIn(t, e.store, "ganz-neues-Passwort-7", "per-Mail-gesetzt-8", "richtig-1234", raw)
}

// Second factors switched off or renewed: the app, recovery codes and passkeys
func TestAuditOwnSecondFactors(t *testing.T) {
	t.Parallel()
	e := newMFAEnv(t)
	token := e.session()
	key, old := e.enable(token)

	e.tick()
	rec, res := e.call("POST", "/api/v1/auth/mfa/recovery-codes", token, map[string]string{"password": e.pw, "code": e.code(key, 0)})
	if rec.Code != http.StatusOK {
		t.Fatalf("new codes: %d %v", rec.Code, res)
	}
	if a := ownAudit(t, e.store, storage.AuditAccountRecoveryCodesRenewed, e.user); len(a.Details) != 0 {
		t.Fatalf("recovery codes: no details, got %s", a.Details)
	}
	codes := res["recoveryCodes"].([]any)

	// A refused confirmation records nothing
	before, _ := e.store.LastAuditID()
	if rec, _ := e.call("POST", "/api/v1/auth/mfa/totp/disable", token, map[string]string{"password": "falsch-falsch", "code": codes[0].(string)}); rec.Code != http.StatusForbidden {
		t.Fatalf("wrong password: %d", rec.Code)
	}
	if after, _ := e.store.LastAuditID(); after != before {
		t.Fatal("a refused switch-off is not recorded")
	}
	if rec, res := e.call("POST", "/api/v1/auth/mfa/totp/disable", token, map[string]string{"password": e.pw, "code": codes[1].(string)}); rec.Code != http.StatusOK {
		t.Fatalf("disable: %d %v", rec.Code, res)
	}
	if a := ownAudit(t, e.store, storage.AuditAccountTOTPDisabled, e.user); string(a.Details) != `{"mfaOff":true}` {
		t.Fatalf("app switched off: %s", a.Details)
	}

	secrets := []string{e.pw}
	for _, c := range append(codes, toAny(old)...) {
		secrets = append(secrets, c.(string))
	}
	noSecretsIn(t, e.store, secrets...)
}

func toAny(s []string) []any {
	out := make([]any, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}

func TestAuditOwnPasskeyRemoved(t *testing.T) {
	t.Parallel()
	e := newPasskeyEnv(t)
	token := e.session()
	a := newTestAuthenticator(t)
	_, res := e.addPasskey(token, a, nil)
	pk := res["passkey"].(map[string]any)
	confirm := e.passkeyConfirm(token, a)
	confirm["password"] = e.pw
	if rec, res := e.call("DELETE", "/api/v1/auth/mfa/passkeys/"+pk["id"].(string), token, confirm); rec.Code != http.StatusOK {
		t.Fatalf("remove passkey: %d %v", rec.Code, res)
	}
	got := ownAudit(t, e.store, storage.AuditAccountPasskeyRemoved, e.user)
	var d map[string]any
	_ = json.Unmarshal(got.Details, &d)
	if d["name"] != pk["name"] || d["name"] == "" || d["mfaOff"] != true || len(d) != 2 {
		t.Fatalf("passkey removed: %s", got.Details)
	}
}

// API keys and AI connections: name and rights, never the key
func TestAuditOwnAPIKeys(t *testing.T) {
	t.Parallel()
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	me, _ := store.GetFirstUser()

	rec := sendWith(t, router, http.MethodPost, "/api/v1/keys", token, map[string]any{"name": "Hausautomation", "scopes": []string{"webhook:task", "tasks:read"}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create key: %d %s", rec.Code, rec.Body)
	}
	var key domain.APIKey
	_ = json.Unmarshal(rec.Body.Bytes(), &key)
	if key.RawKey == "" {
		t.Fatal("no key in the answer")
	}
	a := ownAudit(t, store, storage.AuditAccountAPIKeyCreated, me)
	if string(a.Details) != `{"name":"Hausautomation","scopes":["webhook:task","tasks:read"]}` {
		t.Fatalf("key created: %s", a.Details)
	}

	if rec := sendWith(t, router, http.MethodDelete, "/api/v1/keys/"+key.ID, token, nil); rec.Code != http.StatusOK {
		t.Fatalf("delete key: %d %s", rec.Code, rec.Body)
	}
	if a := ownAudit(t, store, storage.AuditAccountAPIKeyDeleted, me); string(a.Details) != `{"name":"Hausautomation","scopes":["webhook:task","tasks:read"]}` {
		t.Fatalf("key deleted: %s", a.Details)
	}

	// An AI connection is marked as such
	client, err := store.CreateOAuthClient("Claude", []string{"https://claude.ai/api/mcp/auth_callback"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.GrantOAuth(me.ID, client, []string{"notes:read"}, "https://claude.ai/api/mcp/auth_callback", strings.Repeat("a", 43), time.Now()); err != nil {
		t.Fatal(err)
	}
	keys, _ := store.GetAPIKeys(me.ID)
	if len(keys) != 1 {
		t.Fatalf("connections: %v", keys)
	}
	if rec := sendWith(t, router, http.MethodDelete, "/api/v1/keys/"+keys[0].ID, token, nil); rec.Code != http.StatusOK {
		t.Fatalf("delete connection: %d", rec.Code)
	}
	if a := ownAudit(t, store, storage.AuditAccountAPIKeyDeleted, me); string(a.Details) != `{"kind":"oauth","name":"Claude (OAuth)","scopes":["notes:read"]}` {
		t.Fatalf("connection deleted: %s", a.Details)
	}

	// An unknown key: nothing to record
	before, _ := store.LastAuditID()
	sendWith(t, router, http.MethodDelete, "/api/v1/keys/key_unbekannt", token, nil)
	if after, _ := store.LastAuditID(); after != before {
		t.Fatal("deleting an unknown key is not recorded")
	}
	noSecretsIn(t, store, key.RawKey, key.KeyPrefix)
}
