package api

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

const (
	testRPOrigin = "https://notizen.example.org"
	testRPID     = "notizen.example.org"
)

var b64 = base64.RawURLEncoding

// testAuthenticator: a passkey in software, answering like a platform authenticator with user
// verification (packed "none" attestation, ES256).
type testAuthenticator struct {
	t          *testing.T
	key        *ecdsa.PrivateKey
	credID     []byte
	userHandle []byte
	counter    uint32
	// counting: the signature counter goes up with every use (false: always 0, as synced passkeys do)
	counting bool
	// what the browser and authenticator claim
	origin, rpID string
	uv           bool
	backup       bool
}

func newTestAuthenticator(t *testing.T) *testAuthenticator {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	return &testAuthenticator{t: t, key: key, credID: id, origin: testRPOrigin, rpID: testRPID, uv: true, counting: true}
}

func (a *testAuthenticator) flags(extra byte) byte {
	f := byte(0x01) | extra // UP
	if a.uv {
		f |= 0x04
	}
	if a.backup {
		f |= 0x08 | 0x10 // BE, BS
	}
	return f
}

func (a *testAuthenticator) clientData(kind string, options map[string]any) []byte {
	cd, _ := json.Marshal(map[string]any{"type": kind, "challenge": options["challenge"], "origin": a.origin, "crossOrigin": false})
	return cd
}

func (a *testAuthenticator) authData(extra byte, rest []byte) []byte {
	rpHash := sha256.Sum256([]byte(a.rpID))
	out := append(rpHash[:], a.flags(extra))
	out = binary.BigEndian.AppendUint32(out, a.counter)
	return append(out, rest...)
}

// create answers the options of navigator.credentials.create() as the browser's JSON.
func (a *testAuthenticator) create(options map[string]any) json.RawMessage {
	a.t.Helper()
	user, _ := options["user"].(map[string]any)
	handle, err := b64.DecodeString(user["id"].(string))
	if err != nil {
		a.t.Fatalf("user id: %v", err)
	}
	a.userHandle = handle
	pub, err := a.key.PublicKey.ECDH()
	if err != nil {
		a.t.Fatal(err)
	}
	point := pub.Bytes() // 0x04 || x || y
	cose, err := webauthncbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: point[1:33], -3: point[33:65]})
	if err != nil {
		a.t.Fatal(err)
	}
	attested := make([]byte, 16) // AAGUID
	attested = binary.BigEndian.AppendUint16(attested, uint16(len(a.credID)))
	attested = append(attested, a.credID...)
	attested = append(attested, cose...)
	attObj, err := webauthncbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": a.authData(0x40, attested)})
	if err != nil {
		a.t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{
		"id": b64.EncodeToString(a.credID), "rawId": b64.EncodeToString(a.credID), "type": "public-key",
		"authenticatorAttachment": "platform", "clientExtensionResults": map[string]any{},
		"response": map[string]any{
			"clientDataJSON":    b64.EncodeToString(a.clientData("webauthn.create", options)),
			"attestationObject": b64.EncodeToString(attObj),
			"transports":        []string{"internal", "hybrid"},
		},
	})
	return raw
}

// get answers the options of navigator.credentials.get().
func (a *testAuthenticator) get(options map[string]any) json.RawMessage {
	a.t.Helper()
	if a.counting {
		a.counter++
	}
	cd := a.clientData("webauthn.get", options)
	data := a.authData(0, nil)
	cdHash := sha256.Sum256(cd)
	digest := sha256.Sum256(append(append([]byte{}, data...), cdHash[:]...))
	sig, err := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	if err != nil {
		a.t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{
		"id": b64.EncodeToString(a.credID), "rawId": b64.EncodeToString(a.credID), "type": "public-key",
		"authenticatorAttachment": "platform", "clientExtensionResults": map[string]any{},
		"response": map[string]any{
			"clientDataJSON":    b64.EncodeToString(cd),
			"authenticatorData": b64.EncodeToString(data),
			"signature":         b64.EncodeToString(sig),
			"userHandle":        b64.EncodeToString(a.userHandle),
		},
	})
	return raw
}

// newPasskeyEnv: the MFA test server behind https://notizen.example.org.
func newPasskeyEnv(t *testing.T) *mfaEnv {
	t.Helper()
	e := newMFAEnv(t)
	e.srv.cfg.BaseURL = testRPOrigin
	e.srv.cfg.BaseURLSet = true
	e.router = e.srv.Router()
	return e
}

func options(t *testing.T, res map[string]any) map[string]any {
	t.Helper()
	o, ok := res["options"].(map[string]any)
	if !ok {
		t.Fatalf("no options: %v", res)
	}
	return o
}

// addPasskey registers a passkey of the authenticator with the password (and the confirmation, when the
// account already has a second factor) and returns the answer.
func (e *mfaEnv) addPasskey(token string, a *testAuthenticator, confirm map[string]any) (int, map[string]any) {
	e.t.Helper()
	body := map[string]any{"password": e.pw}
	for k, v := range confirm {
		body[k] = v
	}
	rec, res := e.call("POST", "/api/v1/auth/mfa/passkeys/register/options", token, body)
	if rec.Code != http.StatusOK {
		return rec.Code, res
	}
	opts := options(e.t, res)
	sel, _ := opts["authenticatorSelection"].(map[string]any)
	if sel["residentKey"] != "required" || sel["userVerification"] != "required" {
		e.t.Fatalf("passkeys must be discoverable and verify the user: %v", sel)
	}
	if rp, _ := opts["rp"].(map[string]any); rp["id"] != testRPID {
		e.t.Fatalf("rp: %v", opts["rp"])
	}
	rec, res = e.call("POST", "/api/v1/auth/mfa/passkeys", token, map[string]any{"token": res["token"], "name": "  Laptop   Firefox ", "credential": a.create(opts)})
	return rec.Code, res
}

// passkeyConfirm: a confirmation of a sensitive change with the authenticator.
func (e *mfaEnv) passkeyConfirm(token string, a *testAuthenticator) map[string]any {
	e.t.Helper()
	rec, res := e.call("POST", "/api/v1/auth/mfa/passkeys/challenge", token, nil)
	if rec.Code != http.StatusOK {
		e.t.Fatalf("challenge: %d %v", rec.Code, res)
	}
	return map[string]any{"passkeyToken": res["passkeyToken"], "passkey": a.get(options(e.t, res))}
}

// passwordless signs in with the authenticator alone.
func (e *mfaEnv) passwordless(a *testAuthenticator) (*int, map[string]any) {
	e.t.Helper()
	rec, res := e.call("POST", "/api/v1/auth/login/passkey/options", "", nil)
	if rec.Code != http.StatusOK {
		e.t.Fatalf("login options: %d %v", rec.Code, res)
	}
	opts := options(e.t, res)
	if opts["userVerification"] != "required" || opts["allowCredentials"] != nil || opts["rpId"] != testRPID {
		e.t.Fatalf("login options: %v", opts)
	}
	rec, res = e.call("POST", "/api/v1/auth/login/passkey", "", map[string]any{"token": res["token"], "credential": a.get(opts)})
	return &rec.Code, res
}

func TestPasskeysNeedAnHTTPSBaseURL(t *testing.T) {
	cases := []struct {
		base   string
		set    bool
		demo   bool
		reason string
	}{
		{"http://localhost:8080", false, false, "no_base_url"},
		{"http://notizen.example.org", true, false, "not_https"},
		{"https://192.168.1.20", true, false, "ip_address"},
		{testRPOrigin, true, true, "demo"},
		{"http://localhost:18622", true, false, ""},
		{"https://Notizen.Example.org:443/", true, false, ""},
	}
	for _, c := range cases {
		e := newMFAEnv(t)
		e.srv.cfg.BaseURL, e.srv.cfg.BaseURLSet, e.srv.cfg.DemoMode = c.base, c.set, c.demo
		e.router = e.srv.Router()
		if _, _, reason := e.srv.passkeyRP(); reason != c.reason {
			t.Errorf("%s: reason %q, want %q", c.base, reason, c.reason)
		}
		_, status := e.call("GET", "/api/v1/auth/status", "", nil)
		if status["passkeys"] != (c.reason == "") {
			t.Errorf("%s: status passkeys = %v", c.base, status["passkeys"])
		}
		rec, res := e.call("POST", "/api/v1/auth/login/passkey/options", "", nil)
		if c.reason != "" && (rec.Code != http.StatusNotFound || res["code"] != "passkeys_off") {
			t.Errorf("%s: login options while off: %d %v", c.base, rec.Code, res)
		}
		if c.reason == "" && rec.Code != http.StatusOK {
			t.Errorf("%s: login options: %d %v", c.base, rec.Code, res)
		}
		if c.demo {
			continue
		}
		_, res = e.call("GET", "/api/v1/auth/mfa", e.session(), nil)
		if res["passkeysOff"] != c.reason {
			t.Errorf("%s: mfa status passkeysOff = %v", c.base, res["passkeysOff"])
		}
	}
	// The origin as browsers write it: no default port, no path
	e := newMFAEnv(t)
	e.srv.cfg.BaseURL, e.srv.cfg.BaseURLSet = "https://Notizen.Example.org:443/app/", true
	if rpID, origin, _ := e.srv.passkeyRP(); rpID != testRPID || origin != testRPOrigin {
		t.Errorf("rp %q origin %q", rpID, origin)
	}
}

func TestPasskeysNotInDemo(t *testing.T) {
	srv, _, token := setupTestServer(t)
	srv.cfg.DemoMode = true
	srv.cfg.BaseURL, srv.cfg.BaseURLSet = testRPOrigin, true
	router := srv.Router()
	for _, path := range []string{"/api/v1/auth/mfa/passkeys/register/options", "/api/v1/auth/mfa/passkeys", "/api/v1/auth/mfa/passkeys/challenge", "/api/v1/auth/login/passkey/options"} {
		if rec := sessionCall(router, "POST", path, token, `{"password":"x"}`, ""); rec.Code != http.StatusNotFound {
			t.Errorf("%s in the demo: want 404, got %d", path, rec.Code)
		}
	}
	for _, method := range []string{"PATCH", "DELETE"} {
		if rec := sessionCall(router, method, "/api/v1/auth/mfa/passkeys/psk_1", token, `{"name":"x"}`, ""); rec.Code != http.StatusForbidden {
			t.Errorf("%s passkey in the demo: want 403, got %d", method, rec.Code)
		}
	}
}

func TestPasskeyRegistrationAndPasswordlessLogin(t *testing.T) {
	e := newPasskeyEnv(t)
	token := e.session()
	a := newTestAuthenticator(t)
	if code, res := e.addPasskey(token, a, map[string]any{"password": "falsch-falsch"}); code != http.StatusForbidden {
		t.Fatalf("registration with a wrong password: %d %v", code, res)
	}
	code, res := e.addPasskey(token, a, nil)
	if code != http.StatusCreated {
		t.Fatalf("registration: %d %v", code, res)
	}
	// The first second factor brings the recovery codes
	if codes, _ := res["recoveryCodes"].([]any); len(codes) != storage.RecoveryCodeCount {
		t.Fatalf("first passkey must bring %d recovery codes: %v", storage.RecoveryCodeCount, res)
	}
	pk := res["passkey"].(map[string]any)
	if pk["name"] != "Laptop Firefox" || pk["id"] == "" || pk["lastUsedAt"] != "" {
		t.Fatalf("passkey: %v", pk)
	}
	if string(a.userHandle) != e.user.ID {
		t.Fatalf("user handle %q, want the account id", a.userHandle)
	}
	_, status := e.call("GET", "/api/v1/auth/mfa", token, nil)
	if status["enabled"] != true || len(status["passkeys"].([]any)) != 1 || status["totp"].(map[string]any)["enabled"] != false {
		t.Fatalf("status: %v", status)
	}
	// The same authenticator again is excluded (and refused if it answers anyway)
	rec, res := e.call("POST", "/api/v1/auth/mfa/passkeys/register/options", token, map[string]any{"password": e.pw, "passkeyToken": "x"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("second registration needs the second factor: %d %v", rec.Code, res)
	}
	confirm := e.passkeyConfirm(token, a)
	rec, res = e.call("POST", "/api/v1/auth/mfa/passkeys/register/options", token, map[string]any{"password": e.pw, "passkeyToken": confirm["passkeyToken"], "passkey": confirm["passkey"]})
	if rec.Code != http.StatusOK {
		t.Fatalf("registration options with passkey confirmation: %d %v", rec.Code, res)
	}
	if ex, _ := options(t, res)["excludeCredentials"].([]any); len(ex) != 1 || ex[0].(map[string]any)["id"] != b64.EncodeToString(a.credID) {
		t.Fatalf("excludeCredentials: %v", options(t, res)["excludeCredentials"])
	}
	rec, res = e.call("POST", "/api/v1/auth/mfa/passkeys", token, map[string]any{"token": res["token"], "name": "Nochmal", "credential": a.create(options(t, res))})
	if rec.Code != http.StatusConflict {
		t.Fatalf("the same passkey twice: %d %v", rec.Code, res)
	}

	// Signing in without password
	codeP, res := e.passwordless(a)
	if *codeP != http.StatusOK || res["token"] == nil || res["user"].(map[string]any)["id"] != e.user.ID {
		t.Fatalf("passwordless sign-in: %d %v", *codeP, res)
	}
	if rec, _ := e.call("GET", "/api/v1/auth/me", res["token"].(string), nil); rec.Code != http.StatusOK {
		t.Fatalf("session after the passkey: %d", rec.Code)
	}
	keys, _ := e.store.ListPasskeys(e.user.ID)
	if keys[0].LastUsedAt == "" || keys[0].SignCount != a.counter {
		t.Fatalf("use not recorded: %+v", keys[0])
	}

	// The password alone is not enough any more; the passkey is offered as second step
	_, res = e.login()
	if res["mfaRequired"] != true {
		t.Fatalf("password login of an account with a passkey: %v", res)
	}
	if m := res["methods"].([]any); len(m) != 2 || m[0] != "passkey" || m[1] != "recovery" {
		t.Fatalf("methods: %v", m)
	}

	// Renaming
	id := pk["id"].(string)
	if rec, _ := e.call("PATCH", "/api/v1/auth/mfa/passkeys/"+id, token, map[string]string{"name": "  "}); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty name: %d", rec.Code)
	}
	if rec, _ := e.call("PATCH", "/api/v1/auth/mfa/passkeys/"+id, token, map[string]string{"name": strings.Repeat("ä", 80)}); rec.Code != http.StatusOK {
		t.Fatalf("rename: %d", rec.Code)
	}
	if keys, _ := e.store.ListPasskeys(e.user.ID); len([]rune(keys[0].Name)) != storage.PasskeyNameMax {
		t.Fatalf("name not cut: %q", keys[0].Name)
	}
	other, _ := e.store.CreateUser("andere@example.com", mustHash(t, "anderes-123"), "Andere", "member")
	otherToken := sessionLogin(t, e.router, "andere@example.com", "anderes-123", "")
	if rec, _ := e.call("PATCH", "/api/v1/auth/mfa/passkeys/"+id, otherToken, map[string]string{"name": "Fremd"}); rec.Code != http.StatusNotFound {
		t.Fatalf("renaming another account's passkey: %d", rec.Code)
	}
	if e.store.HasPasskeys(other.ID) {
		t.Fatal("passkeys must belong to their account")
	}

	// Deleting the account removes its passkeys
	if err := e.store.DeleteUser(e.user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.store.PasskeyByCredentialID(a.credID); err == nil {
		t.Fatal("passkeys of a deleted account must go")
	}
}

func TestPasskeyAsSecondFactor(t *testing.T) {
	e := newPasskeyEnv(t)
	a := newTestAuthenticator(t)
	if code, res := e.addPasskey(e.session(), a, nil); code != http.StatusCreated {
		t.Fatalf("registration: %d %v", code, res)
	}
	mfaToken := e.challenge()
	// Without options first there is nothing to answer
	if rec, _ := e.call("POST", "/api/v1/auth/login/mfa/passkey", "", map[string]any{"mfaToken": mfaToken, "credential": a.get(map[string]any{"challenge": "AAAAAAAAAAAAAAAAAAAAAA"})}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("answer without options: %d", rec.Code)
	}
	rec, res := e.call("POST", "/api/v1/auth/login/mfa/passkey/options", "", map[string]any{"mfaToken": mfaToken})
	if rec.Code != http.StatusOK {
		t.Fatalf("options: %d %v", rec.Code, res)
	}
	opts := options(t, res)
	if allow, _ := opts["allowCredentials"].([]any); len(allow) != 1 || opts["userVerification"] != "required" {
		t.Fatalf("second-step options: %v", opts)
	}
	answer := a.get(opts)
	rec, res = e.call("POST", "/api/v1/auth/login/mfa/passkey", "", map[string]any{"mfaToken": mfaToken, "credential": answer, "trustDevice": true})
	if rec.Code != http.StatusOK || res["token"] == nil || res["method"] != "passkey" || res["trustToken"] == nil {
		t.Fatalf("second step with the passkey: %d %v", rec.Code, res)
	}
	trust := res["trustToken"].(string)
	// The same answer again: the challenge is used up
	if rec, res := e.call("POST", "/api/v1/auth/login/mfa/passkey", "", map[string]any{"mfaToken": mfaToken, "credential": answer}); rec.Code != http.StatusUnauthorized || res["code"] != "mfa_expired" {
		t.Fatalf("replayed answer: %d %v", rec.Code, res)
	}
	// The trusted device skips the passkey
	if _, res := e.login(trust); res["token"] == nil {
		t.Fatalf("trusted device: %v", res)
	}
	// A passkey answer to another challenge counts as wrong, the right one afterwards still works
	mfaToken = e.challenge()
	e.call("POST", "/api/v1/auth/login/mfa/passkey/options", "", map[string]any{"mfaToken": mfaToken})
	if rec, res := e.call("POST", "/api/v1/auth/login/mfa/passkey", "", map[string]any{"mfaToken": mfaToken, "credential": a.get(map[string]any{"challenge": "AAAAAAAAAAAAAAAAAAAAAA"})}); rec.Code != http.StatusUnauthorized || res["code"] != "mfa_invalid" {
		t.Fatalf("answer to another challenge: %d %v", rec.Code, res)
	}
	_, res = e.call("POST", "/api/v1/auth/login/mfa/passkey/options", "", map[string]any{"mfaToken": mfaToken})
	if rec, res := e.call("POST", "/api/v1/auth/login/mfa/passkey", "", map[string]any{"mfaToken": mfaToken, "credential": a.get(options(t, res))}); rec.Code != http.StatusOK {
		t.Fatalf("right answer after a wrong one: %d %v", rec.Code, res)
	}
}

func TestPasskeyWrongOriginOrRelyingParty(t *testing.T) {
	e := newPasskeyEnv(t)
	token := e.session()
	// Registration from another site is refused
	evil := newTestAuthenticator(t)
	evil.origin = "https://notizen.example.org.evil.test"
	if code, res := e.addPasskey(token, evil, nil); code != http.StatusBadRequest || res["code"] != "passkey_invalid" {
		t.Fatalf("registration from another origin: %d %v", code, res)
	}
	other := newTestAuthenticator(t)
	other.rpID = "example.org"
	if code, res := e.addPasskey(token, other, nil); code != http.StatusBadRequest {
		t.Fatalf("registration for another relying party: %d %v", code, res)
	}
	noUV := newTestAuthenticator(t)
	noUV.uv = false
	if code, res := e.addPasskey(token, noUV, nil); code != http.StatusBadRequest {
		t.Fatalf("registration without user verification: %d %v", code, res)
	}
	if e.store.HasPasskeys(e.user.ID) {
		t.Fatal("no refused passkey may be stored")
	}

	a := newTestAuthenticator(t)
	if code, res := e.addPasskey(token, a, nil); code != http.StatusCreated {
		t.Fatalf("registration: %d %v", code, res)
	}
	e.srv.loginGuard.enabled = false
	for name, change := range map[string]func(){
		"origin":                  func() { a.origin = "https://phishing.example.net" },
		"relying party":           func() { a.rpID = "phishing.example.net" },
		"no user verification":    func() { a.uv = false },
		"http instead of https":   func() { a.origin = "http://notizen.example.org" },
		"subdomain of the origin": func() { a.origin = "https://login.notizen.example.org" },
	} {
		change()
		if code, res := e.passwordless(a); *code != http.StatusUnauthorized || res["code"] != "passkey_invalid" {
			t.Errorf("passwordless with wrong %s: %d %v", name, *code, res)
		}
		a.origin, a.rpID, a.uv = testRPOrigin, testRPID, true
	}
	if code, res := e.passwordless(a); *code != http.StatusOK {
		t.Fatalf("passwordless with everything right: %d %v", *code, res)
	}
}

func TestPasswordlessChallengeWorksOnce(t *testing.T) {
	e := newPasskeyEnv(t)
	a := newTestAuthenticator(t)
	if code, res := e.addPasskey(e.session(), a, nil); code != http.StatusCreated {
		t.Fatalf("registration: %d %v", code, res)
	}
	_, res := e.call("POST", "/api/v1/auth/login/passkey/options", "", nil)
	ticket, opts := res["token"], options(t, res)
	if rec, _ := e.call("POST", "/api/v1/auth/login/passkey", "", map[string]any{"token": ticket, "credential": a.get(opts)}); rec.Code != http.StatusOK {
		t.Fatalf("first answer: %d", rec.Code)
	}
	if rec, res := e.call("POST", "/api/v1/auth/login/passkey", "", map[string]any{"token": ticket, "credential": a.get(opts)}); rec.Code != http.StatusUnauthorized || res["code"] != "passkey_expired" {
		t.Fatalf("the same challenge again: %d %v", rec.Code, res)
	}
	// A challenge lives 5 minutes
	_, res = e.call("POST", "/api/v1/auth/login/passkey/options", "", nil)
	e.clock = e.clock.Add(passkeyChallengeTTL + time.Second)
	if rec, res := e.call("POST", "/api/v1/auth/login/passkey", "", map[string]any{"token": res["token"], "credential": a.get(options(t, res))}); rec.Code != http.StatusUnauthorized || res["code"] != "passkey_expired" {
		t.Fatalf("expired challenge: %d %v", rec.Code, res)
	}
	// A challenge of the sign-in confirms nothing, and a confirmation signs nobody in
	_, res = e.call("POST", "/api/v1/auth/login/passkey/options", "", nil)
	if e.srv.confirmPasskey(e.user, res["token"].(string), a.get(options(t, res))) {
		t.Fatal("a sign-in challenge must not confirm a change")
	}
	token := e.session2(a)
	rec, res := e.call("POST", "/api/v1/auth/mfa/passkeys/challenge", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm challenge: %d", rec.Code)
	}
	if rec, res := e.call("POST", "/api/v1/auth/login/passkey", "", map[string]any{"token": res["passkeyToken"], "credential": a.get(options(t, res))}); rec.Code != http.StatusUnauthorized || res["code"] != "passkey_expired" {
		t.Fatalf("a confirmation challenge must not sign in: %d %v", rec.Code, res)
	}
}

// session2 signs in without password (the account has a second factor now).
func (e *mfaEnv) session2(a *testAuthenticator) string {
	e.t.Helper()
	code, res := e.passwordless(a)
	if *code != http.StatusOK {
		e.t.Fatalf("passwordless: %d %v", *code, res)
	}
	return res["token"].(string)
}

func TestPasswordlessChecksTheAccount(t *testing.T) {
	e := newPasskeyEnv(t)
	a := newTestAuthenticator(t)
	if code, res := e.addPasskey(e.session(), a, nil); code != http.StatusCreated {
		t.Fatalf("registration: %d %v", code, res)
	}
	inactive := false
	if _, err := e.store.UpdateUser(e.user.ID, nil, nil, nil, &inactive, nil, nil); err != nil {
		t.Fatal(err)
	}
	if code, res := e.passwordless(a); *code != http.StatusForbidden || !strings.Contains(res["error"].(string), "deaktiviert") {
		t.Fatalf("disabled account: %d %v", *code, res)
	}
	active := true
	if _, err := e.store.UpdateUser(e.user.ID, nil, nil, nil, &active, nil, nil); err != nil {
		t.Fatal(err)
	}
	e.session2(a)

	// An unknown passkey says nothing about accounts and counts as failed sign-in
	stranger := newTestAuthenticator(t)
	stranger.userHandle = []byte(e.user.ID)
	for i := 0; i < loginLimitAccountIP; i++ {
		if code, res := e.passwordless(stranger); *code != http.StatusUnauthorized || res["code"] != "passkey_invalid" {
			t.Fatalf("unknown passkey: %d %v", *code, res)
		}
	}
	if code, _ := e.passwordless(stranger); *code != http.StatusTooManyRequests {
		t.Fatalf("unknown passkeys must lock after %d tries: %d", loginLimitAccountIP, *code)
	}
	// The account's own passkey from the same address is not locked by that
	e.session2(a)

	// Wrong answers with the account's passkey lock it like wrong passwords
	for i := 0; i < loginLimitAccountIP; i++ {
		a.origin = "https://phishing.example.net"
		e.passwordless(a)
	}
	a.origin = testRPOrigin
	if code, _ := e.passwordless(a); *code != http.StatusTooManyRequests {
		t.Fatalf("after %d refused answers the passkey must wait: %d", loginLimitAccountIP, *code)
	}
	if rec, _ := e.login(); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("… and the password too: %d", rec.Code)
	}
}

func TestPasskeySignCounter(t *testing.T) {
	e := newPasskeyEnv(t)
	a := newTestAuthenticator(t)
	if code, res := e.addPasskey(e.session(), a, nil); code != http.StatusCreated {
		t.Fatalf("registration: %d %v", code, res)
	}
	e.srv.loginGuard.enabled = false
	e.session2(a)
	e.session2(a)
	// A copy of the authenticator with an older counter
	a.counter -= 2
	if code, res := e.passwordless(a); *code != http.StatusUnauthorized {
		t.Fatalf("counter going back: %d %v", *code, res)
	}
	a.counter += 5
	e.session2(a)

	// Passkeys that keep the counter at 0 (synced ones) always work
	synced := newTestAuthenticator(t)
	synced.counting = false
	synced.backup = true
	token := e.session2(a)
	confirm := e.passkeyConfirm(token, a)
	if code, res := e.addPasskey(token, synced, confirm); code != http.StatusCreated || res["passkey"].(map[string]any)["synced"] != true || res["recoveryCodes"] != nil {
		t.Fatalf("second, synced passkey: %d %v", code, res)
	}
	e.session2(synced)
	e.session2(synced)
}

func TestRemovingTheLastSecondFactor(t *testing.T) {
	e := newPasskeyEnv(t)
	token := e.session()
	a := newTestAuthenticator(t)
	_, res := e.addPasskey(token, a, nil)
	id := res["passkey"].(map[string]any)["id"].(string)
	trust, _ := e.passkeyTrust(a)

	// Password and second factor needed
	if rec, res := e.call("DELETE", "/api/v1/auth/mfa/passkeys/"+id, token, map[string]any{"password": e.pw}); rec.Code != http.StatusForbidden || res["code"] != "mfa_required" {
		t.Fatalf("remove without second factor: %d %v", rec.Code, res)
	}
	confirm := e.passkeyConfirm(token, a)
	confirm["password"] = "falsch-falsch"
	if rec, _ := e.call("DELETE", "/api/v1/auth/mfa/passkeys/"+id, token, confirm); rec.Code != http.StatusForbidden {
		t.Fatalf("remove with a wrong password: %d", rec.Code)
	}
	// A confirmation works once
	confirm = e.passkeyConfirm(token, a)
	confirm["password"] = e.pw
	if rec, res := e.call("DELETE", "/api/v1/auth/mfa/passkeys/psk_unknown", token, confirm); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown passkey: %d %v", rec.Code, res)
	}
	rec, res := e.call("DELETE", "/api/v1/auth/mfa/passkeys/"+id, token, confirm)
	if rec.Code != http.StatusOK || res["mfaOff"] != true {
		t.Fatalf("remove the last passkey: %d %v", rec.Code, res)
	}
	if e.store.MFAActive(e.user.ID) || e.store.RecoveryCodesLeft(e.user.ID) != 0 || e.store.TrustedDeviceValid(e.user.ID, e.user.TokenVersion, trust, e.clock) {
		t.Fatal("the last second factor takes recovery codes and trusted devices along")
	}
	if _, res := e.login(); res["token"] == nil {
		t.Fatalf("after the last passkey the password is enough: %v", res)
	}
	if code, _ := e.passwordless(a); *code != http.StatusUnauthorized {
		t.Fatalf("removed passkey must not sign in: %d", *code)
	}
}

// passkeyTrust signs in with password and passkey, trusting the device.
func (e *mfaEnv) passkeyTrust(a *testAuthenticator) (string, string) {
	e.t.Helper()
	mfaToken := e.challenge()
	_, res := e.call("POST", "/api/v1/auth/login/mfa/passkey/options", "", map[string]any{"mfaToken": mfaToken})
	rec, res := e.call("POST", "/api/v1/auth/login/mfa/passkey", "", map[string]any{"mfaToken": mfaToken, "credential": a.get(options(e.t, res)), "trustDevice": true})
	if rec.Code != http.StatusOK || res["trustToken"] == nil {
		e.t.Fatalf("trust: %d %v", rec.Code, res)
	}
	return res["trustToken"].(string), res["token"].(string)
}

// With the app and a passkey, each can go without switching two-factor sign-in off; the recovery codes
// stay those of the first method.
func TestAppAndPasskeyTogether(t *testing.T) {
	e := newPasskeyEnv(t)
	token := e.session()
	key, codes := e.enable(token)
	e.tick()
	a := newTestAuthenticator(t)
	// With the app on, a new passkey needs its code
	if code, res := e.addPasskey(token, a, nil); code != http.StatusForbidden || res["code"] != "mfa_required" {
		t.Fatalf("passkey without the app's code: %d %v", code, res)
	}
	code, res := e.addPasskey(token, a, map[string]any{"code": e.code(key, 0)})
	if code != http.StatusCreated || res["recoveryCodes"] != nil {
		t.Fatalf("passkey with the app's code: %d %v", code, res)
	}
	id := res["passkey"].(map[string]any)["id"].(string)
	_, res = e.login()
	if m := res["methods"].([]any); len(m) != 3 || m[0] != "totp" || m[1] != "passkey" || m[2] != "recovery" {
		t.Fatalf("methods: %v", m)
	}
	trust, _ := e.passkeyTrust(a)

	// Switching the app off with the passkey as confirmation: codes and trusted devices stay
	confirm := e.passkeyConfirm(token, a)
	confirm["password"] = e.pw
	rec, res := e.call("POST", "/api/v1/auth/mfa/totp/disable", token, confirm)
	if rec.Code != http.StatusOK || res["mfaOff"] != false {
		t.Fatalf("app off with a passkey left: %d %v", rec.Code, res)
	}
	if e.store.RecoveryCodesLeft(e.user.ID) != storage.RecoveryCodeCount || !e.store.TrustedDeviceValid(e.user.ID, e.user.TokenVersion, trust, e.clock) {
		t.Fatal("codes and trusted devices must stay while a passkey is left")
	}
	if _, res := e.login(); res["mfaRequired"] != true {
		t.Fatalf("the passkey is still asked: %v", res)
	}

	// Setting the app up again needs the passkey (or a recovery code) and keeps the codes
	if rec, res := e.call("POST", "/api/v1/auth/mfa/totp/setup", token, map[string]any{"password": e.pw}); rec.Code != http.StatusForbidden || res["code"] != "mfa_required" {
		t.Fatalf("app setup without second factor: %d %v", rec.Code, res)
	}
	rec, res = e.call("POST", "/api/v1/auth/mfa/totp/setup", token, map[string]any{"password": e.pw, "code": codes[0]})
	if rec.Code != http.StatusOK {
		t.Fatalf("app setup with a recovery code: %d %v", rec.Code, res)
	}
	key2, _ := auth.DecodeTOTPSecret(res["secret"].(string))
	e.tick()
	rec, res = e.call("POST", "/api/v1/auth/mfa/totp/confirm", token, map[string]string{"code": e.code(key2, 0)})
	if rec.Code != http.StatusOK || len(res["recoveryCodes"].([]any)) != 0 {
		t.Fatalf("app confirmed with a passkey present: %d %v", rec.Code, res)
	}
	if e.store.RecoveryCodesLeft(e.user.ID) != storage.RecoveryCodeCount-1 {
		t.Fatalf("the earlier recovery codes stay: %d", e.store.RecoveryCodesLeft(e.user.ID))
	}

	// New recovery codes with a passkey as confirmation
	confirm = e.passkeyConfirm(token, a)
	confirm["password"] = e.pw
	if rec, res := e.call("POST", "/api/v1/auth/mfa/recovery-codes", token, confirm); rec.Code != http.StatusOK {
		t.Fatalf("new codes with a passkey: %d %v", rec.Code, res)
	}

	// Removing the passkey while the app is on: two-factor sign-in stays
	e.tick()
	rec, res = e.call("DELETE", "/api/v1/auth/mfa/passkeys/"+id, token, map[string]any{"password": e.pw, "code": e.code(key2, 0)})
	if rec.Code != http.StatusOK || res["mfaOff"] != false {
		t.Fatalf("remove the passkey with the app on: %d %v", rec.Code, res)
	}
	if !e.store.MFAActive(e.user.ID) || e.store.RecoveryCodesLeft(e.user.ID) != storage.RecoveryCodeCount {
		t.Fatal("the app keeps two-factor sign-in on")
	}
	if _, res := e.login(); len(res["methods"].([]any)) != 2 {
		t.Fatalf("methods without passkey: %v", res["methods"])
	}
}

// Passkeys switched off later (BASE_URL changed): an account with only passkeys signs in with a
// recovery code, two-factor sign-in stays on.
func TestPasskeysOffLaterKeepsTheSecondFactor(t *testing.T) {
	e := newPasskeyEnv(t)
	a := newTestAuthenticator(t)
	_, res := e.addPasskey(e.session(), a, nil)
	codes := res["recoveryCodes"].([]any)
	e.srv.cfg.BaseURLSet = false
	e.router = e.srv.Router()
	_, res = e.login()
	if res["mfaRequired"] != true {
		t.Fatalf("password alone must not do: %v", res)
	}
	if m := res["methods"].([]any); len(m) != 1 || m[0] != "recovery" {
		t.Fatalf("methods without passkeys: %v", m)
	}
	if rec, res := e.secondStep(res["mfaToken"].(string), codes[0].(string), false); rec.Code != http.StatusOK {
		t.Fatalf("recovery code: %d %v", rec.Code, res)
	}
}
