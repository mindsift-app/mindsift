package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
	"golang.org/x/crypto/bcrypt"
)

// mfaEnv: a server with its clock in the test's hand and one account with a password.
type mfaEnv struct {
	t      *testing.T
	srv    *Server
	store  *storage.Store
	router http.Handler
	clock  time.Time
	user   *domain.User
	pw     string
}

func newMFAEnv(t *testing.T) *mfaEnv {
	t.Helper()
	srv, store, _ := setupTestServer(t)
	e := &mfaEnv{t: t, srv: srv, store: store, pw: "richtig-1234", clock: time.Date(2026, 11, 12, 9, 0, 10, 0, time.UTC)}
	srv.now = func() time.Time { return e.clock }
	e.router = srv.Router()
	u, err := store.CreateUser("zwei@example.com", mustHash(t, e.pw), "Zwei Faktor", "member")
	if err != nil {
		t.Fatal(err)
	}
	e.user = u
	return e
}

func (e *mfaEnv) call(method, path, token string, body any) (*httptest.ResponseRecorder, map[string]any) {
	e.t.Helper()
	raw := ""
	if body != nil {
		b, _ := json.Marshal(body)
		raw = string(b)
	}
	rec := sessionCall(e.router, method, path, token, raw, "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0")
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func (e *mfaEnv) login(trust ...string) (*httptest.ResponseRecorder, map[string]any) {
	e.t.Helper()
	return e.call("POST", "/api/v1/auth/login", "", map[string]any{"login": "zwei@example.com", "password": e.pw, "trustTokens": trust})
}

// fullLogin signs in with password and, when asked, the code of the given step offset.
func (e *mfaEnv) session() string {
	e.t.Helper()
	rec, res := e.login()
	if rec.Code != http.StatusOK || res["token"] == nil {
		e.t.Fatalf("login: %d %v", rec.Code, res)
	}
	return res["token"].(string)
}

// enable sets the app up through the API and returns its key and the recovery codes.
func (e *mfaEnv) enable(token string) ([]byte, []string) {
	e.t.Helper()
	rec, res := e.call("POST", "/api/v1/auth/mfa/totp/setup", token, map[string]string{"password": e.pw})
	if rec.Code != http.StatusOK {
		e.t.Fatalf("setup: %d %v", rec.Code, res)
	}
	secret, _ := res["secret"].(string)
	if !strings.HasPrefix(res["uri"].(string), "otpauth://totp/") {
		e.t.Fatalf("uri: %v", res["uri"])
	}
	key, err := auth.DecodeTOTPSecret(secret)
	if err != nil {
		e.t.Fatal(err)
	}
	rec, res = e.call("POST", "/api/v1/auth/mfa/totp/confirm", token, map[string]string{"code": e.code(key, 0)})
	if rec.Code != http.StatusOK {
		e.t.Fatalf("confirm: %d %v", rec.Code, res)
	}
	var codes []string
	for _, c := range res["recoveryCodes"].([]any) {
		codes = append(codes, c.(string))
	}
	if len(codes) != storage.RecoveryCodeCount {
		e.t.Fatalf("want %d recovery codes, got %v", storage.RecoveryCodeCount, codes)
	}
	return key, codes
}

func (e *mfaEnv) code(key []byte, offset int64) string {
	return auth.HOTP(key, auth.TOTPStep(e.clock)+offset, auth.TOTPDigits)
}

// tick moves the clock to the next step, so the next code is a fresh one.
func (e *mfaEnv) tick() { e.clock = e.clock.Add(auth.TOTPPeriod * time.Second) }

func (e *mfaEnv) secondStep(mfaToken, code string, trust bool) (*httptest.ResponseRecorder, map[string]any) {
	e.t.Helper()
	return e.call("POST", "/api/v1/auth/login/mfa", "", map[string]any{"mfaToken": mfaToken, "code": code, "trustDevice": trust})
}

func (e *mfaEnv) challenge() string {
	e.t.Helper()
	rec, res := e.login()
	if rec.Code != http.StatusOK || res["mfaRequired"] != true || res["token"] != nil {
		e.t.Fatalf("want a challenge, got %d %v", rec.Code, res)
	}
	return res["mfaToken"].(string)
}

func TestLoginWithoutSecondFactorUnchanged(t *testing.T) {
	e := newMFAEnv(t)
	rec, res := e.login()
	if rec.Code != http.StatusOK || res["token"] == nil || res["mfaRequired"] != nil {
		t.Fatalf("login without app: %d %v", rec.Code, res)
	}
	rec, res = e.call("GET", "/api/v1/auth/mfa", res["token"].(string), nil)
	if rec.Code != http.StatusOK || res["available"] != true || res["totp"].(map[string]any)["enabled"] != false {
		t.Fatalf("status: %d %v", rec.Code, res)
	}
}

func TestTOTPSetupNeedsPasswordAndARightCode(t *testing.T) {
	e := newMFAEnv(t)
	token := e.session()
	if rec, _ := e.call("POST", "/api/v1/auth/mfa/totp/setup", token, map[string]string{"password": "falsch-123"}); rec.Code != http.StatusForbidden {
		t.Fatalf("setup with a wrong password: want 403, got %d", rec.Code)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/mfa/totp/confirm", token, map[string]string{"code": "123456"}); rec.Code != http.StatusConflict {
		t.Fatalf("confirm without setup: want 409, got %d", rec.Code)
	}
	_, res := e.call("POST", "/api/v1/auth/mfa/totp/setup", token, map[string]string{"password": e.pw})
	key, _ := auth.DecodeTOTPSecret(res["secret"].(string))
	if rec, res := e.call("POST", "/api/v1/auth/mfa/totp/confirm", token, map[string]string{"code": e.code(key, 5)}); rec.Code != http.StatusBadRequest || res["code"] != "mfa_invalid" {
		t.Fatalf("confirm with a wrong code: %d %v", rec.Code, res)
	}
	// Not confirmed yet: the login still needs no code
	if rec, res := e.login(); res["token"] == nil {
		t.Fatalf("unconfirmed app must not be asked: %d %v", rec.Code, res)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/mfa/totp/confirm", token, map[string]string{"code": e.code(key, 0)}); rec.Code != http.StatusOK {
		t.Fatalf("confirm: %d", rec.Code)
	}
	if !e.store.TOTPActive(e.user.ID) {
		t.Fatal("app must be active")
	}
	// The secret is stored encrypted, never as typed
	tot, _ := e.store.GetTOTP(e.user.ID)
	if strings.Contains(tot.SecretSealed, res["secret"].(string)) || !strings.HasPrefix(tot.SecretSealed, secretCipherPrefix) {
		t.Fatalf("secret stored in the clear: %q", tot.SecretSealed)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/mfa/totp/setup", token, map[string]string{"password": e.pw}); rec.Code != http.StatusConflict {
		t.Fatalf("second setup while active: want 409, got %d", rec.Code)
	}
	_, res = e.call("GET", "/api/v1/auth/mfa", token, nil)
	if res["totp"].(map[string]any)["enabled"] != true || res["recoveryCodesLeft"].(float64) != 10 {
		t.Fatalf("status after setup: %v", res)
	}
}

func TestLoginWithTOTP(t *testing.T) {
	e := newMFAEnv(t)
	key, _ := e.enable(e.session())
	e.tick()

	mfaToken := e.challenge()
	// The challenge is no session
	if rec, _ := e.call("GET", "/api/v1/auth/me", mfaToken, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("mfaToken as session: want 401, got %d", rec.Code)
	}
	_, res := e.login()
	if methods := res["methods"].([]any); len(methods) != 2 || methods[0] != "totp" || methods[1] != "recovery" {
		t.Fatalf("methods: %v", methods)
	}
	if rec, res := e.secondStep(mfaToken, e.code(key, 3), false); rec.Code != http.StatusUnauthorized || res["code"] != "mfa_invalid" {
		t.Fatalf("wrong code: %d %v", rec.Code, res)
	}
	rec, res := e.secondStep(mfaToken, e.code(key, 0), false)
	if rec.Code != http.StatusOK || res["token"] == nil || res["trustToken"] != nil || res["method"] != "totp" {
		t.Fatalf("right code: %d %v", rec.Code, res)
	}
	if rec, _ := e.call("GET", "/api/v1/auth/me", res["token"].(string), nil); rec.Code != http.StatusOK {
		t.Fatalf("session after the second step: %d", rec.Code)
	}
	// The challenge is used up
	if rec, res := e.secondStep(mfaToken, e.code(key, 1), false); rec.Code != http.StatusUnauthorized || res["code"] != "mfa_expired" {
		t.Fatalf("used challenge: %d %v", rec.Code, res)
	}
	// The same code (same step) a second time is refused, the next step works
	if rec, res := e.secondStep(e.challenge(), e.code(key, 0), false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("replayed code: %d %v", rec.Code, res)
	}
	if rec, res := e.secondStep(e.challenge(), e.code(key, -1), false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("code before the used one: %d %v", rec.Code, res)
	}
	e.tick()
	if rec, res := e.secondStep(e.challenge(), e.code(key, 0), false); rec.Code != http.StatusOK {
		t.Fatalf("next step: %d %v", rec.Code, res)
	}
	// A challenge lives 5 minutes
	old := e.challenge()
	e.clock = e.clock.Add(mfaChallengeTTL + time.Second)
	if rec, res := e.secondStep(old, e.code(key, 0), false); rec.Code != http.StatusUnauthorized || res["code"] != "mfa_expired" {
		t.Fatalf("expired challenge: %d %v", rec.Code, res)
	}
}

func TestRecoveryCodeWorksOnce(t *testing.T) {
	e := newMFAEnv(t)
	_, codes := e.enable(e.session())
	// Typed in capitals and without the dash
	typed := strings.ToUpper(strings.ReplaceAll(codes[3], "-", ""))
	rec, res := e.secondStep(e.challenge(), typed, false)
	if rec.Code != http.StatusOK || res["method"] != "recovery" || res["recoveryCodesLeft"].(float64) != 9 {
		t.Fatalf("recovery code: %d %v", rec.Code, res)
	}
	if rec, _ := e.secondStep(e.challenge(), codes[3], false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("used recovery code: want 401, got %d", rec.Code)
	}
	if rec, _ := e.secondStep(e.challenge(), "abcde-fghjk", false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unknown recovery code: want 401, got %d", rec.Code)
	}
	// Another account's codes are no use here
	other, _ := e.store.CreateUser("andere@example.com", mustHash(t, "anderes-123"), "Andere", "member")
	if ok, _ := e.store.UseRecoveryCode(other.ID, codes[4], e.clock); ok {
		t.Fatal("a code must only work for its account")
	}
}

// Wrong codes count like wrong passwords; entering the right password again clears nothing.
func TestWrongCodesLockTheLogin(t *testing.T) {
	e := newMFAEnv(t)
	key, _ := e.enable(e.session())
	e.tick()
	for i := 0; i < 2; i++ {
		if rec, _ := e.secondStep(e.challenge(), e.code(key, 4), false); rec.Code != http.StatusUnauthorized {
			t.Fatalf("wrong code %d: %d", i, rec.Code)
		}
	}
	mfaToken := e.challenge() // the right password again
	if rec, _ := e.secondStep(mfaToken, e.code(key, 4), false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("third wrong code: %d", rec.Code)
	}
	if rec, _ := e.secondStep(mfaToken, e.code(key, 0), false); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("after three wrong codes the right one must wait: got %d", rec.Code)
	}
	if rec, _ := e.login(); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("after three wrong codes the password must wait too: got %d", rec.Code)
	}
}

// A challenge takes at most mfaMaxAttempts wrong codes, then the password is asked again.
func TestChallengeEndsAfterTooManyCodes(t *testing.T) {
	e := newMFAEnv(t)
	e.srv.loginGuard.enabled = false
	key, _ := e.enable(e.session())
	e.tick()
	mfaToken := e.challenge()
	for i := 0; i < mfaMaxAttempts; i++ {
		e.secondStep(mfaToken, e.code(key, 4), false)
	}
	if rec, res := e.secondStep(mfaToken, e.code(key, 0), false); rec.Code != http.StatusUnauthorized || res["code"] != "mfa_expired" {
		t.Fatalf("challenge after %d wrong codes: %d %v", mfaMaxAttempts, rec.Code, res)
	}
}

func TestTrustedDevice(t *testing.T) {
	e := newMFAEnv(t)
	key, _ := e.enable(e.session())
	e.tick()
	rec, res := e.secondStep(e.challenge(), e.code(key, 0), true)
	trust, _ := res["trustToken"].(string)
	if rec.Code != http.StatusOK || trust == "" || res["trustedDeviceId"] == nil {
		t.Fatalf("trust: %d %v", rec.Code, res)
	}
	token := res["token"].(string)
	// Next sign-in on this device: no code
	rec, res = e.login("fremd.token", trust)
	if rec.Code != http.StatusOK || res["token"] == nil {
		t.Fatalf("trusted device must sign in without code: %d %v", rec.Code, res)
	}
	// Only for this account
	other, _ := e.store.CreateUser("andere@example.com", mustHash(t, "anderes-123"), "Andere", "member")
	if e.store.TrustedDeviceValid(other.ID, other.TokenVersion, trust, e.clock) {
		t.Fatal("trust must be bound to its account")
	}
	_, res = e.call("GET", "/api/v1/auth/mfa", token, nil)
	if devices := res["trustedDevices"].([]any); len(devices) != 1 || !strings.Contains(devices[0].(map[string]any)["userAgent"].(string), "Firefox") {
		t.Fatalf("trusted devices: %v", res["trustedDevices"])
	}
	// 30 days later the code is asked again
	e.clock = e.clock.Add(storage.TrustedDeviceLifetime + time.Minute)
	if _, res := e.login(trust); res["mfaRequired"] != true {
		t.Fatalf("expired trust must ask for the code: %v", res)
	}
}

// trustAgain signs in with a code and trust, and returns the trust token and the session.
func (e *mfaEnv) trustAgain(key []byte) (string, string) {
	e.t.Helper()
	e.tick()
	_, res := e.secondStep(e.challenge(), e.code(key, 0), true)
	trust, _ := res["trustToken"].(string)
	if trust == "" {
		e.t.Fatalf("no trust token: %v", res)
	}
	if _, res := e.login(trust); res["token"] == nil {
		e.t.Fatalf("fresh trust must work: %v", res)
	}
	return trust, res["token"].(string)
}

func TestTrustEndsWithSessionsPasswordAndDisabling(t *testing.T) {
	e := newMFAEnv(t)
	key, codes := e.enable(e.session())

	// Ending all sessions
	trust, token := e.trustAgain(key)
	if rec, _ := e.call("POST", "/api/v1/auth/revoke-all", token, nil); rec.Code != http.StatusOK {
		t.Fatalf("revoke-all: %d", rec.Code)
	}
	if _, res := e.login(trust); res["mfaRequired"] != true {
		t.Fatalf("trust after revoke-all: %v", res)
	}

	// A new own password
	trust, token = e.trustAgain(key)
	e.call("PATCH", "/api/v1/auth/settings", token, map[string]string{"password": "neues-passwort-1", "currentPassword": e.pw})
	e.pw = "neues-passwort-1"
	if _, res := e.login(trust); res["mfaRequired"] != true {
		t.Fatalf("trust after a password change: %v", res)
	}

	// A new password by reset link: the app stays on, the trust ends
	trust, _ = e.trustAgain(key)
	raw, err := e.store.CreatePasswordResetToken(e.user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/reset-password", "", map[string]string{"token": raw, "password": "zurueckgesetzt-1"}); rec.Code != http.StatusOK {
		t.Fatalf("reset: %d", rec.Code)
	}
	e.pw = "zurueckgesetzt-1"
	if !e.store.TOTPActive(e.user.ID) {
		t.Fatal("a password reset must leave the app on")
	}
	if _, res := e.login(trust); res["mfaRequired"] != true {
		t.Fatalf("after a reset the code is still asked: %v", res)
	}

	// Switching the app off: password and code needed
	trust, token = e.trustAgain(key)
	if rec, res := e.call("POST", "/api/v1/auth/mfa/totp/disable", token, map[string]string{"password": e.pw}); rec.Code != http.StatusForbidden || res["code"] != "mfa_required" {
		t.Fatalf("disable without code: %d %v", rec.Code, res)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/mfa/totp/disable", token, map[string]string{"password": "falsch-falsch", "code": codes[0]}); rec.Code != http.StatusForbidden {
		t.Fatalf("disable with a wrong password: %d", rec.Code)
	}
	if rec, res := e.call("POST", "/api/v1/auth/mfa/totp/disable", token, map[string]string{"password": e.pw, "code": codes[0]}); rec.Code != http.StatusOK {
		t.Fatalf("disable with a recovery code: %d %v", rec.Code, res)
	}
	if e.store.TOTPActive(e.user.ID) || e.store.RecoveryCodesLeft(e.user.ID) != 0 || e.store.TrustedDeviceValid(e.user.ID, e.user.TokenVersion+3, trust, e.clock) {
		t.Fatal("disabling must remove app, codes and trusted devices")
	}
	if rec, res := e.login(); res["token"] == nil {
		t.Fatalf("after disabling the password is enough: %d %v", rec.Code, res)
	}
}

func TestNewRecoveryCodesReplaceTheOld(t *testing.T) {
	e := newMFAEnv(t)
	token := e.session()
	key, old := e.enable(token)
	e.tick()
	rec, res := e.call("POST", "/api/v1/auth/mfa/recovery-codes", token, map[string]string{"password": e.pw, "code": e.code(key, 0)})
	if rec.Code != http.StatusOK || len(res["recoveryCodes"].([]any)) != storage.RecoveryCodeCount {
		t.Fatalf("new codes: %d %v", rec.Code, res)
	}
	if ok, _ := e.store.UseRecoveryCode(e.user.ID, old[0], e.clock); ok {
		t.Fatal("old codes must stop working")
	}
	if ok, _ := e.store.UseRecoveryCode(e.user.ID, res["recoveryCodes"].([]any)[0].(string), e.clock); !ok {
		t.Fatal("new codes must work")
	}
	// The same code again is no confirmation
	if rec, _ := e.call("POST", "/api/v1/auth/mfa/recovery-codes", token, map[string]string{"password": e.pw, "code": e.code(key, 0)}); rec.Code != http.StatusForbidden {
		t.Fatalf("replayed code for new recovery codes: want 403, got %d", rec.Code)
	}
}

func TestRemoveTrustedDevices(t *testing.T) {
	e := newMFAEnv(t)
	key, _ := e.enable(e.session())
	first, token := e.trustAgain(key)
	second, _ := e.trustAgain(key)
	_, res := e.call("GET", "/api/v1/auth/mfa", token, nil)
	devices := res["trustedDevices"].([]any)
	if len(devices) != 2 {
		t.Fatalf("want 2 devices, got %v", devices)
	}
	firstID, _, _ := strings.Cut(first, ".")
	if rec, _ := e.call("DELETE", "/api/v1/auth/mfa/trusted-devices/"+firstID, token, nil); rec.Code != http.StatusOK {
		t.Fatalf("remove one: %d", rec.Code)
	}
	if rec, _ := e.call("DELETE", "/api/v1/auth/mfa/trusted-devices/"+firstID, token, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("remove again: want 404, got %d", rec.Code)
	}
	if _, res := e.login(first); res["mfaRequired"] != true {
		t.Fatal("removed device must be asked again")
	}
	if _, res := e.login(second); res["token"] == nil {
		t.Fatal("the other device stays trusted")
	}
	e.call("DELETE", "/api/v1/auth/mfa/trusted-devices", token, nil)
	if _, res := e.login(second); res["mfaRequired"] != true {
		t.Fatal("after removing all every device is asked")
	}
}

func TestMFANotInDemo(t *testing.T) {
	srv, _, token := setupTestServer(t)
	srv.cfg.DemoMode = true
	router := srv.Router()
	for _, path := range []string{"/api/v1/auth/mfa/totp/setup", "/api/v1/auth/mfa/totp/confirm", "/api/v1/auth/mfa/totp/disable", "/api/v1/auth/mfa/recovery-codes"} {
		if rec := sessionCall(router, "POST", path, token, `{"password":"x"}`, ""); rec.Code != http.StatusForbidden {
			t.Errorf("%s in the demo: want 403, got %d", path, rec.Code)
		}
	}
	rec := sessionCall(router, "GET", "/api/v1/auth/mfa", token, "", "")
	var res map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if rec.Code != http.StatusOK || res["available"] != false {
		t.Fatalf("status in the demo: %d %v", rec.Code, res)
	}
}

// Hashes of earlier versions (plain bcrypt) sign in and are stored in the newer form afterwards.
func TestLegacyPasswordHashIsUpgradedAtLogin(t *testing.T) {
	e := newMFAEnv(t)
	legacy, _ := bcrypt.GenerateFromPassword([]byte(e.pw), bcrypt.MinCost)
	if err := e.store.SetPasswordHash(e.user.ID, e.user.PasswordHash, string(legacy)); err != nil {
		t.Fatal(err)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "zwei@example.com", "password": "falsch-1234"}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", rec.Code)
	}
	if u, _ := e.store.GetUserByID(e.user.ID); u.PasswordHash != string(legacy) {
		t.Fatal("a failed login must not touch the hash")
	}
	e.session()
	u, _ := e.store.GetUserByID(e.user.ID)
	if auth.PasswordNeedsRehash(u.PasswordHash) || !auth.CheckPassword(e.pw, u.PasswordHash) {
		t.Fatalf("hash not upgraded: %q", u.PasswordHash)
	}
	if u.TokenVersion != e.user.TokenVersion {
		t.Fatal("the upgrade must not end any session")
	}
	e.session()
}

// Passwords longer than bcrypt's 72 bytes count to the last character, wherever they are set.
func TestLongPasswordCountsInFull(t *testing.T) {
	e := newMFAEnv(t)
	token := e.session()
	long := strings.Repeat("satz ", 20) + "Ende-A"
	if rec, res := e.call("PATCH", "/api/v1/auth/settings", token, map[string]string{"password": long, "currentPassword": e.pw}); rec.Code != http.StatusOK {
		t.Fatalf("set long password: %d %v", rec.Code, res)
	}
	e.pw = strings.Repeat("satz ", 20) + "Ende-B"
	if rec, _ := e.login(); rec.Code != http.StatusUnauthorized {
		t.Fatalf("a password differing after byte 72 must fail, got %d", rec.Code)
	}
	e.pw = long
	e.session()
	if rec, _ := e.call("PATCH", "/api/v1/auth/settings", e.session(), map[string]string{"password": strings.Repeat("a", auth.MaxPasswordLength+1), "currentPassword": e.pw}); rec.Code != http.StatusBadRequest {
		t.Fatalf("too long: want 400, got %d", rec.Code)
	}
}
