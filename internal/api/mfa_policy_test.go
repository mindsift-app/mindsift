package api

import (
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// requireMFA sets the administration's switch: who must sign in with a second factor.
func (e *mfaEnv) requireMFA(who string) {
	e.t.Helper()
	cur, err := e.store.GetSystemSettings()
	if err != nil {
		e.t.Fatal(err)
	}
	cur.MFARequired = &who
	if err := e.store.UpdateSystemSettings(cur); err != nil {
		e.t.Fatal(err)
	}
}

// otherSession creates another account with the role and signs it in.
func (e *mfaEnv) otherSession(email, role string) (string, string) {
	e.t.Helper()
	u, err := e.store.CreateUser(email, mustHash(e.t, e.pw), "Andere Person", role)
	if err != nil {
		e.t.Fatal(err)
	}
	rec, res := e.call("POST", "/api/v1/auth/login", "", map[string]any{"login": email, "password": e.pw})
	if rec.Code != http.StatusOK || res["token"] == nil {
		e.t.Fatalf("login %s: %d %v", email, rec.Code, res)
	}
	return u.ID, res["token"].(string)
}

func TestRequiredMFABlocksAllButTheSetup(t *testing.T) {
	e := newMFAEnv(t)
	token := e.session()
	e.requireMFA(storage.MFARequiredAll)

	if rec, res := e.call("GET", "/api/v1/auth/me", token, nil); rec.Code != http.StatusOK || res["mfaSetupRequired"] != true {
		t.Fatalf("me: %d %v", rec.Code, res)
	}
	if rec, res := e.call("GET", "/api/v1/stats", token, nil); rec.Code != http.StatusForbidden || res["code"] != "mfa_setup_required" {
		t.Fatalf("stats before the setup: %d %v", rec.Code, res)
	}
	if rec, _ := e.call("GET", "/api/v1/auth/mfa", token, nil); rec.Code != http.StatusOK {
		t.Fatalf("mfa status before the setup: %d", rec.Code)
	}

	e.enable(token)
	if rec, res := e.call("GET", "/api/v1/stats", token, nil); rec.Code != http.StatusOK {
		t.Fatalf("stats after the setup: %d %v", rec.Code, res)
	}
	if _, res := e.call("GET", "/api/v1/auth/me", token, nil); res["mfaSetupRequired"] != false {
		t.Fatalf("me after the setup: %v", res)
	}
}

func TestRequiredMFAForAdminsLeavesMembers(t *testing.T) {
	e := newMFAEnv(t)
	member := e.session()
	_, admin := e.otherSession("chefin@example.com", "admin")
	e.requireMFA(storage.MFARequiredAdmins)

	if rec, _ := e.call("GET", "/api/v1/stats", member, nil); rec.Code != http.StatusOK {
		t.Fatalf("member: %d", rec.Code)
	}
	if rec, res := e.call("GET", "/api/v1/stats", admin, nil); rec.Code != http.StatusForbidden || res["code"] != "mfa_setup_required" {
		t.Fatalf("admin: %d %v", rec.Code, res)
	}
}

func TestRequiredMFASettingIsValidated(t *testing.T) {
	e := newMFAEnv(t)
	_, admin := e.otherSession("chefin@example.com", "admin")
	if rec, _ := e.call("PUT", "/api/v1/admin/settings", admin, map[string]any{"mfaRequired": "manche"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid value: %d", rec.Code)
	}
}

func TestAdminResetsMFA(t *testing.T) {
	e := newMFAEnv(t)
	e.enable(e.session())
	adminID, admin := e.otherSession("chefin@example.com", "admin")

	if rec, _ := e.call("POST", "/api/v1/admin/users/"+adminID+"/mfa/reset", admin, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("own account: %d", rec.Code)
	}
	if rec, res := e.call("POST", "/api/v1/admin/users/"+e.user.ID+"/mfa/reset", admin, nil); rec.Code != http.StatusOK {
		t.Fatalf("reset: %d %v", rec.Code, res)
	}
	if e.store.MFAActive(e.user.ID) || e.store.RecoveryCodesLeft(e.user.ID) != 0 {
		t.Fatal("second factor still there after the reset")
	}
	if rec, res := e.login(); rec.Code != http.StatusOK || res["token"] == nil {
		t.Fatalf("password alone after the reset: %d %v", rec.Code, res)
	}
}

func TestMemberCannotResetMFA(t *testing.T) {
	e := newMFAEnv(t)
	member := e.session()
	otherID, _ := e.otherSession("andere@example.com", "member")
	if rec, _ := e.call("POST", "/api/v1/admin/users/"+otherID+"/mfa/reset", member, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("member: %d", rec.Code)
	}
}

func TestSensitiveActionsNeedTheSecondFactor(t *testing.T) {
	e := newMFAEnv(t)
	token := e.session()
	key, codes := e.enable(token)
	e.tick()
	_, token = e.trustAgain(key)

	// A new API key: never asks for the second factor itself, so creating one does
	if rec, res := e.call("POST", "/api/v1/keys", token, map[string]any{"name": "Skript"}); rec.Code != http.StatusForbidden || res["code"] != "mfa_required" {
		t.Fatalf("key without the second factor: %d %v", rec.Code, res)
	}
	if rec, res := e.call("POST", "/api/v1/keys", token, map[string]any{"name": "Skript", "code": codes[5]}); rec.Code != http.StatusCreated {
		t.Fatalf("key with a recovery code: %d %v", rec.Code, res)
	}

	// Deleting the own data and account
	if rec, res := e.call("DELETE", "/api/v1/user/data", token, map[string]any{"password": e.pw}); rec.Code != http.StatusForbidden || res["code"] != "mfa_required" {
		t.Fatalf("purge without the second factor: %d %v", rec.Code, res)
	}
	if rec, res := e.call("DELETE", "/api/v1/user/account", token, map[string]any{"password": e.pw, "code": "000000"}); rec.Code != http.StatusForbidden || res["code"] != "mfa_invalid" {
		t.Fatalf("account with a wrong code: %d %v", rec.Code, res)
	}
	e.tick()
	if rec, res := e.call("DELETE", "/api/v1/user/account", token, map[string]any{"password": e.pw, "code": e.code(key, 0)}); rec.Code != http.StatusOK {
		t.Fatalf("account with the app's code: %d %v", rec.Code, res)
	}
}
