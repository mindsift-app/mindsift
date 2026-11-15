package api

import (
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// logoutToken signs a logout token the way the fake provider would: iss, aud, iat, jti, the event, sub and
// sid. change edits the claims before signing; key signs it instead of the provider's key when set.
func (e *oidcEnv) logoutToken(sub, sid string, change func(c jwt.MapClaims), key *rsa.PrivateKey) string {
	e.t.Helper()
	e.clockMu.Lock()
	now := e.clock
	e.clockMu.Unlock()
	claims := jwt.MapClaims{
		"iss":    e.idp.srv.URL,
		"aud":    fakeClientID,
		"iat":    now.Unix(),
		"exp":    now.Add(2 * time.Minute).Unix(),
		"jti":    "jti-" + randomHex(e.t),
		"events": map[string]any{oidcLogoutEvent: map[string]any{}},
	}
	if sub != "" {
		claims["sub"] = sub
	}
	if sid != "" {
		claims["sid"] = sid
	}
	if change != nil {
		change(claims)
	}
	e.idp.mu.Lock()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = e.idp.kid
	tok.Header["typ"] = "logout+jwt"
	if key == nil {
		key = e.idp.key
	}
	e.idp.mu.Unlock()
	signed, err := tok.SignedString(key)
	if err != nil {
		e.t.Fatal(err)
	}
	return signed
}

// backchannelLogout posts the token the way the provider does (form, no session).
func (e *oidcEnv) backchannelLogout(token string) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest("POST", "/api/v1/auth/oidc/backchannel-logout", strings.NewReader(url.Values{"logout_token": {token}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "198.51.100.7:4711"
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

// signedIn: the session token still works.
func (e *oidcEnv) signedIn(token string) bool {
	e.t.Helper()
	rec, _ := e.call("GET", "/api/v1/auth/me", token, nil)
	switch rec.Code {
	case http.StatusOK:
		return true
	case http.StatusUnauthorized:
		return false
	}
	e.t.Fatalf("me: %d %s", rec.Code, rec.Body.String())
	return false
}

// passwordSession starts a session of the account as a password sign-in would.
func (e *oidcEnv) passwordSession(userID string) string {
	e.t.Helper()
	u, err := e.store.GetUserByID(userID)
	if err != nil || u == nil {
		e.t.Fatalf("user %s: %v", userID, err)
	}
	sid, err := e.store.CreateSession(u.ID, "go-test", "192.0.2.1", storage.SessionViaPassword)
	if err != nil {
		e.t.Fatal(err)
	}
	token, err := auth.GenerateToken(e.srv.cfg.JWTSecret, u.ID, u.Email, u.DisplayName, u.TokenVersion, sid)
	if err != nil {
		e.t.Fatal(err)
	}
	return token
}

// Two sign-ins through two provider sessions and a password session of the same account.
func backchannelSetup(t *testing.T) (e *oidcEnv, first, second, password string) {
	t.Helper()
	e = newOIDCEnv(t, nil)
	e.idp.person["sid"] = "provider-session-1"
	first = e.mustSignIn()
	e.idp.person["sid"] = "provider-session-2"
	second = e.mustSignIn()
	password = e.passwordSession(e.userOf(first)["id"].(string))
	return e, first, second, password
}

func TestOIDCBackchannelLogoutBySID(t *testing.T) {
	e, first, second, password := backchannelSetup(t)
	rec := e.backchannelLogout(e.logoutToken("abc-123", "provider-session-1", nil, nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("logout: %d %q %s", rec.Code, rec.Header().Get("Cache-Control"), rec.Body.String())
	}
	if e.signedIn(first) {
		t.Fatal("the session of the provider session that signed out must end")
	}
	if !e.signedIn(second) || !e.signedIn(password) {
		t.Fatal("other sessions of the account must stay")
	}
	// sid alone works as well
	if rec := e.backchannelLogout(e.logoutToken("", "provider-session-2", nil, nil)); rec.Code != http.StatusOK {
		t.Fatalf("logout by sid only: %d", rec.Code)
	}
	if e.signedIn(second) || !e.signedIn(password) {
		t.Fatal("sid only must end exactly that provider session")
	}
}

func TestOIDCBackchannelLogoutBySubjectKeepsPasswordSessions(t *testing.T) {
	e, first, second, password := backchannelSetup(t)
	// Another person's provider sign-in stays untouched
	e.idp.person = map[string]any{"sub": "other-7", "email": "max@example.com", "email_verified": true, "name": "Max", "sid": "provider-session-9"}
	other := e.mustSignIn()
	if rec := e.backchannelLogout(e.logoutToken("abc-123", "", nil, nil)); rec.Code != http.StatusOK {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body.String())
	}
	if e.signedIn(first) || e.signedIn(second) {
		t.Fatal("sub only must end every provider session of the account")
	}
	if !e.signedIn(password) {
		t.Fatal("a password session is not the provider's to end")
	}
	if !e.signedIn(other) {
		t.Fatal("another account's session ended")
	}
	// sub and sid of different accounts: nothing ends
	if rec := e.backchannelLogout(e.logoutToken("abc-123", "provider-session-9", nil, nil)); rec.Code != http.StatusOK || !e.signedIn(other) {
		t.Fatalf("sid of another account: %d", rec.Code)
	}
}

func TestOIDCBackchannelLogoutUnknownIsOK(t *testing.T) {
	e, first, second, password := backchannelSetup(t)
	for _, tok := range []string{
		e.logoutToken("abc-123", "no-such-session", nil, nil),
		e.logoutToken("", "no-such-session", nil, nil),
		e.logoutToken("unknown-subject", "", nil, nil),
	} {
		if rec := e.backchannelLogout(tok); rec.Code != http.StatusOK {
			t.Fatalf("unknown session: %d %s", rec.Code, rec.Body.String())
		}
	}
	if !e.signedIn(first) || !e.signedIn(second) || !e.signedIn(password) {
		t.Fatal("nothing may end for an unknown session")
	}
}

func TestOIDCBackchannelLogoutRefusesBadTokens(t *testing.T) {
	e, first, second, password := backchannelSetup(t)
	stranger, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	set := func(k string, v any) func(jwt.MapClaims) { return func(c jwt.MapClaims) { c[k] = v } }
	drop := func(k string) func(jwt.MapClaims) { return func(c jwt.MapClaims) { delete(c, k) } }
	now := e.clock
	cases := []struct {
		name  string
		token string
	}{
		{"not a JWT", "kein-token"},
		{"empty", ""},
		{"foreign key", e.logoutToken("abc-123", "provider-session-1", nil, stranger)},
		{"wrong issuer", e.logoutToken("abc-123", "provider-session-1", set("iss", "https://evil.example"), nil)},
		{"wrong audience", e.logoutToken("abc-123", "provider-session-1", set("aud", "another-client"), nil)},
		{"no iat", e.logoutToken("abc-123", "provider-session-1", drop("iat"), nil)},
		{"iat too old", e.logoutToken("abc-123", "provider-session-1", set("iat", now.Add(-time.Hour).Unix()), nil)},
		{"iat in the future", e.logoutToken("abc-123", "provider-session-1", set("iat", now.Add(time.Hour).Unix()), nil)},
		{"expired", e.logoutToken("abc-123", "provider-session-1", set("exp", now.Add(-5*time.Minute).Unix()), nil)},
		{"nonce", e.logoutToken("abc-123", "provider-session-1", set("nonce", "n-1"), nil)},
		{"no events", e.logoutToken("abc-123", "provider-session-1", drop("events"), nil)},
		{"other event", e.logoutToken("abc-123", "provider-session-1", set("events", map[string]any{"http://example.com/other": map[string]any{}}), nil)},
		{"event not empty", e.logoutToken("abc-123", "provider-session-1", set("events", map[string]any{oidcLogoutEvent: map[string]any{"x": 1}}), nil)},
		{"neither sub nor sid", e.logoutToken("", "", nil, nil)},
		{"no jti", e.logoutToken("abc-123", "provider-session-1", drop("jti"), nil)},
	}
	for _, c := range cases {
		rec := e.backchannelLogout(c.token)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Header().Get("Cache-Control"), "no-store") {
			t.Errorf("%s: %d %s", c.name, rec.Code, rec.Body.String())
		}
	}
	if !e.signedIn(first) || !e.signedIn(second) || !e.signedIn(password) {
		t.Fatal("a refused token ended a session")
	}
	// The same token twice: the second one is a replay
	tok := e.logoutToken("abc-123", "provider-session-1", nil, nil)
	if rec := e.backchannelLogout(tok); rec.Code != http.StatusOK || e.signedIn(first) {
		t.Fatalf("first use: %d", rec.Code)
	}
	if rec := e.backchannelLogout(tok); rec.Code != http.StatusBadRequest {
		t.Fatalf("replay: %d", rec.Code)
	}
	// An ID token is no logout token (nonce, no event)
	if rec := e.backchannelLogout(e.logoutToken("abc-123", "provider-session-2", func(c jwt.MapClaims) {
		delete(c, "events")
		c["nonce"] = "n-2"
	}, nil)); rec.Code != http.StatusBadRequest || !e.signedIn(second) {
		t.Fatalf("ID token as logout token: %d", rec.Code)
	}
}

func TestOIDCBackchannelLogoutLocksAddressAfterRefusals(t *testing.T) {
	e, first, _, _ := backchannelSetup(t)
	for range limitOIDCLogoutFailures {
		e.backchannelLogout("kein-token")
	}
	if rec := e.backchannelLogout(e.logoutToken("abc-123", "provider-session-1", nil, nil)); rec.Code != http.StatusTooManyRequests || !e.signedIn(first) {
		t.Fatalf("after %d refusals: %d", limitOIDCLogoutFailures, rec.Code)
	}
}

func TestOIDCBackchannelLogoutCanBeTurnedOff(t *testing.T) {
	e := newOIDCEnv(t, nil)
	// As OIDC_BACKCHANNEL_LOGOUT=false leaves it (Resolve sets the switch from the variable)
	e.srv.oidc.cfg.BackchannelLogout = false
	e.idp.person["sid"] = "provider-session-1"
	token := e.mustSignIn()
	if rec := e.backchannelLogout(e.logoutToken("abc-123", "provider-session-1", nil, nil)); rec.Code != http.StatusNotFound || !e.signedIn(token) {
		t.Fatalf("switched off: %d", rec.Code)
	}
	if e.srv.oidcLogoutURL() != "" || e.srv.oidcStatusForAdmin().LogoutURL != "" {
		t.Fatal("no logout URL while it is off")
	}
}

// The administration shows the back-channel logout URL next to the redirect URI
func TestOIDCAdminStatusShowsLogoutURL(t *testing.T) {
	e := newOIDCEnv(t, nil)
	st := e.srv.oidcStatusForAdmin()
	if want := strings.TrimRight(e.srv.cfg.BaseURL, "/") + oidcLogoutPath; st.LogoutURL != want {
		t.Fatalf("logout URL %q, want %q", st.LogoutURL, want)
	}
}
