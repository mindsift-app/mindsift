package api

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

// fakeIssuer is an OpenID Connect provider in the test: discovery, JWKS, authorization (the person signing in
// is person), token endpoint with PKCE and client secret, userinfo. tweak changes the next ID token, signWith
// signs it with a key the JWKS does not have.
type fakeIssuer struct {
	t   *testing.T
	srv *httptest.Server
	now func() time.Time

	mu            sync.Mutex
	key           *rsa.PrivateKey
	kid           string
	codes         map[string]*fakeCode
	access        map[string]map[string]any
	discoveryDown bool
	person        map[string]any // claims of the person who signs in (sub, email, …)
	userinfoOnly  map[string]any // claims the provider puts only into userinfo
	tweak         func(c jwt.MapClaims)
	signWith      *rsa.PrivateKey
}

type fakeCode struct {
	claims    jwt.MapClaims
	challenge string
	redirect  string
}

const (
	fakeClientID = "mindsift"
	fakeSecret   = "geheimes-client-secret"
)

func newFakeIssuer(t *testing.T, now func() time.Time) *fakeIssuer {
	t.Helper()
	f := &fakeIssuer{t: t, now: now, codes: map[string]*fakeCode{}, access: map[string]map[string]any{}}
	f.rotate()
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", f.discovery)
	mux.HandleFunc("/keys", f.keys)
	mux.HandleFunc("/token", f.token)
	mux.HandleFunc("/userinfo", f.userinfo)
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

// rotate gives the provider a new signing key (and kid); the JWKS has only the new one.
func (f *fakeIssuer) rotate() {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		f.t.Fatal(err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.key = key
	f.kid = base64.RawURLEncoding.EncodeToString(key.N.Bytes()[:8])
}

func (f *fakeIssuer) discovery(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	down := f.discoveryDown
	f.mu.Unlock()
	if down {
		http.Error(w, "down", http.StatusBadGateway)
		return
	}
	base := f.srv.URL
	_ = json.NewEncoder(w).Encode(map[string]any{
		"issuer":                                base,
		"authorization_endpoint":                base + "/authorize",
		"token_endpoint":                        base + "/token",
		"jwks_uri":                              base + "/keys",
		"userinfo_endpoint":                     base + "/userinfo",
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
	})
}

func (f *fakeIssuer) keys(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	pub := f.key.PublicKey
	_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
		"kty": "RSA", "use": "sig", "alg": "RS256", "kid": f.kid,
		"n": base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
	}}})
}

// authorize is the browser at the provider: the person signs in, the provider sends it back with a code.
func (f *fakeIssuer) authorize(authURL string) string {
	f.t.Helper()
	u, err := url.Parse(authURL)
	if err != nil || !strings.HasPrefix(authURL, f.srv.URL+"/authorize") {
		f.t.Fatalf("authorization URL %q", authURL)
	}
	q := u.Query()
	if q.Get("response_type") != "code" || q.Get("client_id") != fakeClientID || q.Get("code_challenge_method") != "S256" ||
		q.Get("code_challenge") == "" || q.Get("state") == "" || q.Get("nonce") == "" || !strings.Contains(q.Get("scope"), "openid") {
		f.t.Fatalf("authorization request lacks something: %v", q)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	claims := jwt.MapClaims{"nonce": q.Get("nonce")}
	for k, v := range f.person {
		claims[k] = v
	}
	code := "code-" + randomHex(f.t)
	f.codes[code] = &fakeCode{claims: claims, challenge: q.Get("code_challenge"), redirect: q.Get("redirect_uri")}
	back, _ := url.Parse(q.Get("redirect_uri"))
	bq := back.Query()
	bq.Set("code", code)
	bq.Set("state", q.Get("state"))
	back.RawQuery = bq.Encode()
	return back.String()
}

func (f *fakeIssuer) token(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	id, secret, ok := r.BasicAuth()
	if !ok {
		id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	if id != fakeClientID || secret != fakeSecret {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
		return
	}
	f.mu.Lock()
	c := f.codes[r.PostForm.Get("code")]
	delete(f.codes, r.PostForm.Get("code"))
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if c == nil || c.redirect != r.PostForm.Get("redirect_uri") || base64.RawURLEncoding.EncodeToString(sum[:]) != c.challenge {
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	now := f.now()
	claims := jwt.MapClaims{"iss": f.srv.URL, "aud": fakeClientID, "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix()}
	for k, v := range c.claims {
		claims[k] = v
	}
	if f.tweak != nil {
		f.tweak(claims)
	}
	access := "at-" + randomHex(f.t)
	info := map[string]any{"sub": claims["sub"]}
	for k, v := range f.userinfoOnly {
		info[k] = v
	}
	f.access[access] = info
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = f.kid
	key := f.key
	if f.signWith != nil {
		key = f.signWith
	}
	f.mu.Unlock()
	signed, err := tok.SignedString(key)
	if err != nil {
		f.t.Fatal(err)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"access_token": access, "token_type": "Bearer", "expires_in": 300, "id_token": signed})
}

func (f *fakeIssuer) userinfo(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	info, ok := f.access[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
	f.mu.Unlock()
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(info)
}

func randomHex(t *testing.T) string {
	t.Helper()
	s, err := randomToken(12)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// oidcEnv: a server with the provider sign-in on, its clock in the test's hand, the fake provider, and the
// first administrator (test@mindsift.local, password "mindsift").
type oidcEnv struct {
	t      *testing.T
	srv    *Server
	store  *storage.Store
	router http.Handler
	clock  time.Time
	idp    *fakeIssuer
	admin  *domain.User
}

func newOIDCEnv(t *testing.T, change func(c *config.OIDCConfig)) *oidcEnv {
	t.Helper()
	e := &oidcEnv{t: t, clock: time.Date(2026, 11, 12, 9, 0, 10, 0, time.UTC)}
	now := func() time.Time { return e.clock }
	e.idp = newFakeIssuer(t, now)
	dbPath := filepath.Join(t.TempDir(), "oidc.db")
	store, err := storage.NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if e.admin, err = store.EnsureDefaultUser(); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		Port: "8080", DatabasePath: dbPath, JWTSecret: "test-jwt-secret-key", SecretsKey: []byte("test-secrets-key-32-bytes-long!!"),
		BaseURL: "https://mindsift.test", BaseURLSet: true,
	}
	e.srv = NewServer(cfg, store, ws.NewHub(), nil)
	t.Cleanup(e.srv.Close)
	e.srv.now = now
	oc := config.OIDCConfig{Issuer: e.idp.srv.URL, ClientID: fakeClientID, ClientSecret: fakeSecret, Name: "Testanbieter"}
	if change != nil {
		change(&oc)
	}
	if err := oc.Resolve(); err != nil {
		t.Fatal(err)
	}
	// Set after NewServer, so no discovery runs in the background while the test sets the clock
	cfg.OIDC = oc
	e.srv.oidc, _ = newOIDCService(cfg)
	e.store = store
	e.router = e.srv.Router()
	e.idp.person = map[string]any{"sub": "abc-123", "email": "erika@example.com", "email_verified": true, "name": "Erika Mustermann", "preferred_username": "erika"}
	return e
}

func (e *oidcEnv) call(method, path, token string, body any) (*httptest.ResponseRecorder, map[string]any) {
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

// begin starts a flow (path /auth/oidc/start or /auth/oidc/confirm) and returns the provider's address and bind.
func (e *oidcEnv) begin(path, token string, body any) (string, string) {
	e.t.Helper()
	rec, res := e.call("POST", path, token, body)
	if rec.Code != http.StatusOK {
		e.t.Fatalf("%s: %d %v", path, rec.Code, res)
	}
	return res["url"].(string), res["bind"].(string)
}

// back sends the browser from the provider to the callback and returns where MindSift sends it then.
func (e *oidcEnv) back(callback string) url.Values {
	e.t.Helper()
	if !strings.HasPrefix(callback, "https://mindsift.test/api/v1/auth/oidc/callback?") {
		e.t.Fatalf("redirect URI %q", callback)
	}
	req := httptest.NewRequest("GET", strings.TrimPrefix(callback, "https://mindsift.test"), nil)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		e.t.Fatalf("callback: %d %s", rec.Code, rec.Body.String())
	}
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil || loc.Host != "mindsift.test" {
		e.t.Fatalf("callback went to %q", rec.Header().Get("Location"))
	}
	return loc.Query()
}

// signIn: the whole sign-in through the provider. Returns the session token, or "" and the error code.
func (e *oidcEnv) signIn() (string, string) {
	e.t.Helper()
	authURL, bind := e.begin("/api/v1/auth/oidc/start", "", map[string]string{"return": "/"})
	q := e.back(e.idp.authorize(authURL))
	if code := q.Get("oidc_error"); code != "" {
		return "", code
	}
	rec, res := e.call("POST", "/api/v1/auth/oidc/exchange", "", map[string]string{"ticket": q.Get("oidc"), "bind": bind})
	if rec.Code != http.StatusOK {
		e.t.Fatalf("exchange: %d %v", rec.Code, res)
	}
	return res["token"].(string), ""
}

func (e *oidcEnv) mustSignIn() string {
	e.t.Helper()
	token, code := e.signIn()
	if token == "" {
		e.t.Fatalf("sign-in refused: %s", code)
	}
	return token
}

func (e *oidcEnv) me(token string) map[string]any {
	e.t.Helper()
	rec, res := e.call("GET", "/api/v1/auth/me", token, nil)
	if rec.Code != http.StatusOK {
		e.t.Fatalf("me: %d %v", rec.Code, res)
	}
	return res
}

func (e *oidcEnv) userOf(token string) map[string]any {
	return e.me(token)["user"].(map[string]any)
}

func TestOIDCFirstSignInCreatesAccount(t *testing.T) {
	e := newOIDCEnv(t, nil)
	before, _ := e.store.CountUsers()
	token := e.mustSignIn()
	user := e.userOf(token)
	if user["email"] != "erika@example.com" || user["displayName"] != "Erika Mustermann" || user["username"] != "erika" ||
		user["role"] != domain.RoleMember || user["noPassword"] != true || user["oidc"] != true {
		t.Fatalf("new account: %v", user)
	}
	u, _ := e.store.GetUserByID(user["id"].(string))
	if auth.HasPassword(u.PasswordHash) || auth.CheckPassword("", u.PasswordHash) {
		t.Fatal("an account from the provider must have no usable password")
	}
	// The password form does not open it, not even with an empty or guessed password
	if rec, _ := e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "erika", "password": "irgendwas"}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("password sign-in of an account without password: %d", rec.Code)
	}
	// The second sign-in lands in the same account
	again := e.mustSignIn()
	if e.userOf(again)["id"] != user["id"] {
		t.Fatal("second sign-in made another account")
	}
	if after, _ := e.store.CountUsers(); after != before+1 {
		t.Fatalf("accounts: %d before, %d after", before, after)
	}
	// The session knows how it started
	sessions, _ := e.store.ListSessions(user["id"].(string), "")
	for _, s := range sessions {
		if v := e.store.SessionVia(s.ID); v != storage.SessionViaOIDC {
			t.Fatalf("session via %q", v)
		}
	}
	// Unique usernames: a second person with the same preferred_username gets another one
	e.idp.person = map[string]any{"sub": "xyz-9", "email": "erika2@example.com", "email_verified": true, "preferred_username": "Erika"}
	other := e.userOf(e.mustSignIn())
	if other["username"] == "erika" || !strings.HasPrefix(other["username"].(string), "erika") || other["displayName"] != "Erika" {
		t.Fatalf("second person: %v", other)
	}
}

func TestOIDCTicketIsBoundAndUsedOnce(t *testing.T) {
	e := newOIDCEnv(t, nil)
	authURL, bind := e.begin("/api/v1/auth/oidc/start", "", map[string]string{"return": "/oauth/authorize?client_id=x&state=y"})
	callback := e.idp.authorize(authURL)
	req := httptest.NewRequest("GET", strings.TrimPrefix(callback, "https://mindsift.test"), nil)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if loc.Path != "/oauth/authorize" || loc.Query().Get("client_id") != "x" || loc.Query().Get("oidc") == "" {
		t.Fatalf("back to %v", loc)
	}
	if rec.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("the ticket must not leave as referrer")
	}
	ticket := loc.Query().Get("oidc")
	// Another browser (without the value) gets nothing, and the ticket is gone after that
	if rec, res := e.call("POST", "/api/v1/auth/oidc/exchange", "", map[string]string{"ticket": ticket, "bind": "falsch"}); rec.Code != http.StatusUnauthorized || res["code"] != "oidc_expired" {
		t.Fatalf("wrong bind: %d %v", rec.Code, res)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/oidc/exchange", "", map[string]string{"ticket": ticket, "bind": bind}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("ticket after a wrong try: %d", rec.Code)
	}
	// The callback again (state used up) goes nowhere
	if q := e.back(callback); q.Get("oidc_error") != "expired" {
		t.Fatalf("reused state: %v", q)
	}
	// A right ticket works once, and only within its time
	authURL, bind = e.begin("/api/v1/auth/oidc/start", "", nil)
	q := e.back(e.idp.authorize(authURL))
	if rec, _ := e.call("POST", "/api/v1/auth/oidc/exchange", "", map[string]string{"ticket": q.Get("oidc"), "bind": bind}); rec.Code != http.StatusOK {
		t.Fatalf("exchange: %d", rec.Code)
	}
	if rec, _ := e.call("POST", "/api/v1/auth/oidc/exchange", "", map[string]string{"ticket": q.Get("oidc"), "bind": bind}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("second exchange: %d", rec.Code)
	}
	authURL, bind = e.begin("/api/v1/auth/oidc/start", "", nil)
	q = e.back(e.idp.authorize(authURL))
	e.clock = e.clock.Add(oidcTicketTTL + time.Second)
	if rec, _ := e.call("POST", "/api/v1/auth/oidc/exchange", "", map[string]string{"ticket": q.Get("oidc"), "bind": bind}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired ticket: %d", rec.Code)
	}
	// A flow that waited too long at the provider
	authURL, _ = e.begin("/api/v1/auth/oidc/start", "", nil)
	callback = e.idp.authorize(authURL)
	e.clock = e.clock.Add(oidcFlowTTL + time.Second)
	if q := e.back(callback); q.Get("oidc_error") != "expired" {
		t.Fatalf("expired flow: %v", q)
	}
}

func TestOIDCReturnPathStaysOnTheSite(t *testing.T) {
	for in, want := range map[string]string{
		"":                                  "/",
		"/":                                 "/",
		"/oauth/authorize?client_id=a&x=1":  "/oauth/authorize?client_id=a&x=1",
		"/?oidc=alt&note=n1":                "/?note=n1",
		"https://evil.example/":             "/",
		"//evil.example/":                   "/",
		"/\\evil.example":                   "/",
		"/api/v1/auth/oidc/start":           "/",
		"javascript:alert(1)":               "/",
		"/p/token#frag":                     "/p/token",
		"/x\nLocation: https://evil.test/a": "/",
	} {
		if got := oidcReturnPath(in); got != want {
			t.Errorf("oidcReturnPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestOIDCNeverLinksByAddressByDefault(t *testing.T) {
	e := newOIDCEnv(t, nil)
	existing, err := e.store.CreateUser("erika@example.com", mustHash(t, "eigenes-Passwort"), "Erika", domain.RoleMember)
	if err != nil {
		t.Fatal(err)
	}
	// Verified and the same address: still a new account, without the address (it belongs to Erika's account)
	user := e.userOf(e.mustSignIn())
	if user["id"] == existing.ID || user["email"] != "" {
		t.Fatalf("new account without address expected: %v", user)
	}
	if id, _ := e.store.OIDCIdentityUser(e.idp.srv.URL, "abc-123"); id != user["id"] {
		t.Fatal("the new account must rest on the identity")
	}
	// The next sign-in finds it by sub
	if e.userOf(e.mustSignIn())["id"] != user["id"] {
		t.Fatal("the identity must find its account again")
	}
	// Erika's own password keeps working
	if rec, _ := e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "erika@example.com", "password": "eigenes-Passwort"}); rec.Code != http.StatusOK {
		t.Fatalf("password of the existing account: %d", rec.Code)
	}
}

func TestOIDCLinksByVerifiedAddressWhenSwitchedOn(t *testing.T) {
	e := newOIDCEnv(t, nil)
	e.srv.oidc.cfg.LinkByEmail = true
	existing, _ := e.store.CreateUser("erika@example.com", mustHash(t, "eigenes-Passwort"), "Erika", domain.RoleMember)
	// Not verified: no link, a new account without the address instead
	e.idp.person["email_verified"] = false
	other := e.userOf(e.mustSignIn())
	if other["id"] == existing.ID || other["email"] != "" {
		t.Fatalf("an unverified address must not link: %v", other)
	}
	// A second identity with the verified address (some providers send the flag as text) links
	e.idp.person["sub"] = "zweite-id"
	e.idp.person["email_verified"] = "true"
	user := e.userOf(e.mustSignIn())
	if user["id"] != existing.ID || user["noPassword"] == true || user["oidc"] != true {
		t.Fatalf("linked account: %v", user)
	}
	// The address changes at the provider: the link stays by sub
	e.idp.person["email"] = "erika.neu@example.com"
	if e.userOf(e.mustSignIn())["id"] != existing.ID {
		t.Fatal("the link must follow sub, not the address")
	}
}

func TestOIDCNewAccountAddresses(t *testing.T) {
	e := newOIDCEnv(t, nil)
	// Not verified and free: the account has no login address yet, the address waits for its link
	e.idp.person = map[string]any{"sub": "unbestaetigt", "name": "Uwe", "email": "uwe@example.com", "email_verified": false}
	uwe := e.userOf(e.mustSignIn())
	if uwe["email"] != "" {
		t.Fatalf("an unverified address must not be the login address: %v", uwe)
	}
	if pending := e.store.PendingEmailChanges(uwe["id"].(string))[storage.EmailChangeAccount].Email; pending != "uwe@example.com" {
		t.Fatalf("the address should wait for confirmation, got %q", pending)
	}
	// No address at all, twice: two accounts without address
	for _, sub := range []string{"ohne-mail-1", "ohne-mail-2"} {
		e.idp.person = map[string]any{"sub": sub, "name": "Ohne Mail"}
		if u := e.userOf(e.mustSignIn()); u["email"] != "" {
			t.Fatalf("no address: %v", u)
		}
	}
	// Without automatic accounts nobody new gets in
	e.srv.oidc.cfg.AutoCreate = false
	e.idp.person = map[string]any{"sub": "neu", "name": "Neu", "email": "neu@example.com", "email_verified": true}
	if token, code := e.signIn(); token != "" || code != "no_account" {
		t.Fatalf("unknown person: %q %q", token, code)
	}
}

func TestOIDCRefusesBadTokens(t *testing.T) {
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	cases := map[string]func(e *oidcEnv){
		"signature": func(e *oidcEnv) { e.idp.signWith = other },
		"iss":       func(e *oidcEnv) { e.idp.tweak = func(c jwt.MapClaims) { c["iss"] = "https://andere.example" } },
		"aud":       func(e *oidcEnv) { e.idp.tweak = func(c jwt.MapClaims) { c["aud"] = "jemand-anders" } },
		"azp": func(e *oidcEnv) {
			e.idp.tweak = func(c jwt.MapClaims) { c["aud"] = []string{fakeClientID, "andere-app"}; c["azp"] = "andere-app" }
		},
		"azp missing with two audiences": func(e *oidcEnv) {
			e.idp.tweak = func(c jwt.MapClaims) { c["aud"] = []string{fakeClientID, "andere-app"} }
		},
		"nonce": func(e *oidcEnv) { e.idp.tweak = func(c jwt.MapClaims) { c["nonce"] = "fremd" } },
		"expired": func(e *oidcEnv) {
			e.idp.tweak = func(c jwt.MapClaims) { c["exp"] = e.clock.Add(-2 * time.Minute).Unix() }
		},
		"iat in the future": func(e *oidcEnv) {
			e.idp.tweak = func(c jwt.MapClaims) { c["iat"] = e.clock.Add(10 * time.Minute).Unix() }
		},
		"iat too old": func(e *oidcEnv) { e.idp.tweak = func(c jwt.MapClaims) { c["iat"] = e.clock.Add(-time.Hour).Unix() } },
		"userinfo of someone else": func(e *oidcEnv) {
			e.idp.tweak = func(c jwt.MapClaims) {}
			e.idp.userinfoOnly = map[string]any{"sub": "jemand-anders"}
		},
	}
	for name, spoil := range cases {
		t.Run(name, func(t *testing.T) {
			e := newOIDCEnv(t, nil)
			spoil(e)
			before, _ := e.store.CountUsers()
			if token, code := e.signIn(); token != "" || code != "failed" {
				t.Fatalf("%s: %q %q", name, token, code)
			}
			if after, _ := e.store.CountUsers(); after != before {
				t.Fatal("a refused token created an account")
			}
		})
	}
	// Small clock differences are fine
	e := newOIDCEnv(t, nil)
	e.idp.tweak = func(c jwt.MapClaims) {
		c["exp"] = e.clock.Add(-30 * time.Second).Unix()
		c["iat"] = e.clock.Add(30 * time.Second).Unix()
	}
	e.mustSignIn()
}

func TestOIDCFollowsKeyRotationAndUserinfo(t *testing.T) {
	e := newOIDCEnv(t, func(c *config.OIDCConfig) { c.AdminGroup = "mindsift-admins" })
	e.mustSignIn()
	e.idp.rotate()
	// Like Authelia: the ID token says little, userinfo the rest
	e.idp.person = map[string]any{"sub": "abc-123"}
	e.idp.userinfoOnly = map[string]any{"email": "erika@example.com", "email_verified": true, "groups": []string{"mindsift-admins"}}
	user := e.userOf(e.mustSignIn())
	if user["role"] != domain.RoleAdmin {
		t.Fatalf("after rotation, with groups from userinfo: %v", user)
	}
}

func TestOIDCAdminGroup(t *testing.T) {
	e := newOIDCEnv(t, func(c *config.OIDCConfig) { c.AdminGroup = "/mindsift-admins" })
	if !strings.Contains(strings.Join(e.srv.oidc.cfg.Scopes, " "), "groups") {
		t.Fatalf("scopes without groups: %v", e.srv.oidc.cfg.Scopes)
	}
	// Keycloak sends full paths
	e.idp.person["groups"] = []string{"/mindsift-admins", "andere"}
	token := e.mustSignIn()
	if role := e.userOf(token)["role"]; role != domain.RoleAdmin {
		t.Fatalf("in the group: %v", role)
	}
	id := e.userOf(token)["id"].(string)
	// Out of the group: member again (the first admin is still there)
	e.idp.person["groups"] = []string{"andere"}
	if role := e.userOf(e.mustSignIn())["role"]; role != domain.RoleMember {
		t.Fatalf("out of the group: %v", role)
	}
	// No groups claim at all: nothing changes
	e.idp.person["groups"] = []string{"mindsift-admins"}
	e.mustSignIn()
	delete(e.idp.person, "groups")
	if role := e.userOf(e.mustSignIn())["role"]; role != domain.RoleAdmin {
		t.Fatalf("without groups claim: %v", role)
	}
	// The last administrator stays one
	member := domain.RoleMember
	if _, err := e.store.UpdateUser(e.admin.ID, nil, nil, &member, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	e.idp.person["groups"] = []string{}
	e.mustSignIn()
	if u, _ := e.store.GetUserByID(id); u.Role != domain.RoleAdmin {
		t.Fatalf("last admin taken back: %v", u.Role)
	}
}

func TestOIDCLockedAccountsStayLocked(t *testing.T) {
	e := newOIDCEnv(t, nil)
	token := e.mustSignIn()
	id := e.userOf(token)["id"].(string)
	off := false
	if _, err := e.store.UpdateUser(id, nil, nil, nil, &off, nil, nil); err != nil {
		t.Fatal(err)
	}
	if token, code := e.signIn(); token != "" || code != "disabled" {
		t.Fatalf("disabled account: %q %q", token, code)
	}
	// Waiting for approval: linked by its verified address (OIDC_LINK_BY_EMAIL), but not let in
	e.srv.oidc.cfg.LinkByEmail = true
	pending, _ := e.store.CreateInactiveUser("wartet@example.com", mustHash(t, "irgendein-Passwort"), "Wartet", domain.RoleMember)
	if err := e.store.AddPendingRegistration(pending.ID); err != nil {
		t.Fatal(err)
	}
	e.idp.person = map[string]any{"sub": "wartet", "email": "wartet@example.com", "email_verified": true}
	if _, code := e.signIn(); code != "pending" {
		t.Fatalf("pending account: %q", code)
	}
}

func TestOIDCCancelledAndProviderDown(t *testing.T) {
	e := newOIDCEnv(t, nil)
	authURL, _ := e.begin("/api/v1/auth/oidc/start", "", nil)
	u, _ := url.Parse(authURL)
	if q := e.back("https://mindsift.test/api/v1/auth/oidc/callback?error=access_denied&state=" + u.Query().Get("state")); q.Get("oidc_error") != "cancelled" {
		t.Fatalf("cancelled: %v", q)
	}
	// Discovery fails: the button answers with a message, a later try works
	e2 := newOIDCEnv(t, nil)
	e2.idp.discoveryDown = true
	if rec, res := e2.call("POST", "/api/v1/auth/oidc/start", "", nil); rec.Code != http.StatusServiceUnavailable || res["code"] != "oidc_unavailable" ||
		!strings.Contains(res["error"].(string), "Testanbieter") {
		t.Fatalf("provider down: %d %v", rec.Code, res)
	}
	e2.idp.discoveryDown = false
	e2.clock = e2.clock.Add(oidcRetryAfter + time.Second)
	e2.mustSignIn()
}

func TestPasswordLoginOff(t *testing.T) {
	e := newOIDCEnv(t, nil)
	e.srv.oidc.cfg.PasswordLogin = false
	if _, err := e.store.CreateUser("mitglied@example.com", mustHash(t, "Mitglied-1234"), "Mitglied", domain.RoleMember); err != nil {
		t.Fatal(err)
	}
	_, status := e.call("GET", "/api/v1/auth/status", "", nil)
	if status["passwordLogin"] != false || status["oidc"].(map[string]any)["enabled"] != true || status["oidc"].(map[string]any)["name"] != "Testanbieter" {
		t.Fatalf("status: %v", status)
	}
	if rec, res := e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "mitglied@example.com", "password": "Mitglied-1234"}); rec.Code != http.StatusForbidden || res["code"] != "password_login_off" {
		t.Fatalf("member with password: %d %v", rec.Code, res)
	}
	// A wrong password says nothing else than before
	if rec, _ := e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "mitglied@example.com", "password": "falsch-falsch"}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", rec.Code)
	}
	// The administrator's emergency access
	if rec, res := e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "test@mindsift.local", "password": "mindsift"}); rec.Code != http.StatusOK || res["token"] == nil {
		t.Fatalf("admin emergency access: %d %v", rec.Code, res)
	}
	if rec, res := e.call("POST", "/api/v1/auth/register", "", map[string]string{"email": "neu@example.com", "password": "Neu-12345678"}); rec.Code != http.StatusForbidden || res["code"] != "password_login_off" {
		t.Fatalf("register: %d %v", rec.Code, res)
	}
	// Nor can a member set a password for later
	token := e.mustSignIn()
	if rec, res := e.call("PATCH", "/api/v1/auth/settings", token, map[string]string{"password": "Neues-Passwort-1"}); rec.Code != http.StatusForbidden || res["code"] != "password_login_off" {
		t.Fatalf("set password: %d %v", rec.Code, res)
	}
	// With the password login on, everybody signs in as before
	e.srv.oidc.cfg.PasswordLogin = true
	if rec, _ := e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "mitglied@example.com", "password": "Mitglied-1234"}); rec.Code != http.StatusOK {
		t.Fatalf("password login on: %d", rec.Code)
	}
}

func TestOIDCSessionIsNotAskedForRequiredMFA(t *testing.T) {
	e := newOIDCEnv(t, nil)
	sys, _ := e.store.GetSystemSettings()
	all := storage.MFARequiredAll
	sys.MFARequired = &all
	if err := e.store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	token := e.mustSignIn()
	if me := e.me(token); me["mfaSetupRequired"] != false {
		t.Fatalf("OIDC session asked to set up a second factor: %v", me["mfaSetupRequired"])
	}
	if rec, _ := e.call("GET", "/api/v1/stats", token, nil); rec.Code != http.StatusOK {
		t.Fatalf("OIDC session blocked: %d", rec.Code)
	}
	// A password session of the same kind of account is held at the setup
	if _, err := e.store.CreateUser("mitglied@example.com", mustHash(t, "Mitglied-1234"), "Mitglied", domain.RoleMember); err != nil {
		t.Fatal(err)
	}
	_, res := e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "mitglied@example.com", "password": "Mitglied-1234"})
	pw := res["token"].(string)
	if rec, res := e.call("GET", "/api/v1/stats", pw, nil); rec.Code != http.StatusForbidden || res["code"] != "mfa_setup_required" {
		t.Fatalf("password session: %d %v", rec.Code, res)
	}
}

// confirm runs the provider confirmation for the session and returns the error code ("" when confirmed).
func (e *oidcEnv) confirm(token string, body map[string]any) string {
	e.t.Helper()
	authURL, bind := e.begin("/api/v1/auth/oidc/confirm", token, body)
	u, _ := url.Parse(authURL)
	if u.Query().Get("prompt") != "login" || u.Query().Get("max_age") != "0" {
		e.t.Fatalf("confirmation must ask for a new sign-in: %v", u.Query())
	}
	q := e.back(e.idp.authorize(authURL))
	if code := q.Get("oidc_error"); code != "" {
		return code
	}
	rec, res := e.call("POST", "/api/v1/auth/oidc/exchange", token, map[string]string{"ticket": q.Get("oidc"), "bind": bind})
	if rec.Code != http.StatusOK || res["confirmed"] != true {
		e.t.Fatalf("exchange of the confirmation: %d %v", rec.Code, res)
	}
	return ""
}

func TestOIDCSensitiveChangesNeedTheProvider(t *testing.T) {
	e := newOIDCEnv(t, nil)
	token := e.mustSignIn()
	// A stolen session alone: no API key, no new address, no deleting
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/v1/keys"},
		{"PATCH", "/api/v1/auth/settings"},
		{"DELETE", "/api/v1/user/account"},
	} {
		body := map[string]any{}
		if c.path == "/api/v1/auth/settings" {
			body["email"] = "dieb@example.com"
		}
		if rec, res := e.call(c.method, c.path, token, body); rec.Code != http.StatusForbidden || res["code"] != "oidc_confirm_required" {
			t.Fatalf("%s %s: %d %v", c.method, c.path, rec.Code, res)
		}
	}
	// Signed in at the provider as somebody else: not confirmed
	person := e.idp.person
	e.idp.person = map[string]any{"sub": "jemand-anders", "email": "anders@example.com", "email_verified": true}
	if code := e.confirm(token, map[string]any{"return": "/"}); code != "wrong_account" {
		t.Fatalf("other account: %q", code)
	}
	e.idp.person = person
	// The provider did not ask again (auth_time from before the confirmation began)
	e.idp.tweak = func(c jwt.MapClaims) { c["auth_time"] = e.clock.Add(-time.Hour).Unix() }
	if code := e.confirm(token, map[string]any{"return": "/"}); code != "not_fresh" {
		t.Fatalf("old auth_time: %q", code)
	}
	e.idp.tweak = func(c jwt.MapClaims) { c["auth_time"] = e.clock.Unix() }
	// The confirmation counts only for the session that asked: another session cannot use the ticket
	second := e.mustSignIn()
	authURL, bind := e.begin("/api/v1/auth/oidc/confirm", token, map[string]any{})
	q := e.back(e.idp.authorize(authURL))
	if rec, _ := e.call("POST", "/api/v1/auth/oidc/exchange", second, map[string]string{"ticket": q.Get("oidc"), "bind": bind}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("ticket of another session: %d", rec.Code)
	}
	if code := e.confirm(token, map[string]any{"return": "/"}); code != "" {
		t.Fatalf("confirmation: %q", code)
	}
	if rec, res := e.call("POST", "/api/v1/keys", token, map[string]any{"name": "Agent"}); rec.Code != http.StatusCreated {
		t.Fatalf("API key after the confirmation: %d %v", rec.Code, res)
	}
	if rec, _ := e.call("POST", "/api/v1/keys", second, map[string]any{"name": "Agent"}); rec.Code != http.StatusForbidden {
		t.Fatalf("the other session is not confirmed: %d", rec.Code)
	}
	// A few minutes later it has to be confirmed again
	e.clock = e.clock.Add(oidcConfirmTTL + time.Second)
	if rec, res := e.call("DELETE", "/api/v1/user/account", token, map[string]any{}); rec.Code != http.StatusForbidden || res["code"] != "oidc_confirm_required" {
		t.Fatalf("after the window: %d %v", rec.Code, res)
	}
	if code := e.confirm(token, map[string]any{"return": "/"}); code != "" {
		t.Fatal(code)
	}
	if rec, res := e.call("DELETE", "/api/v1/user/account", token, map[string]any{}); rec.Code != http.StatusOK {
		t.Fatalf("delete after confirmation: %d %v", rec.Code, res)
	}
}

func TestOIDCLinkNeedsThePassword(t *testing.T) {
	e := newOIDCEnv(t, nil)
	if _, err := e.store.CreateUser("max@example.com", mustHash(t, "Max-Passwort-1"), "Max", domain.RoleMember); err != nil {
		t.Fatal(err)
	}
	_, res := e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "max@example.com", "password": "Max-Passwort-1"})
	token := res["token"].(string)
	// A session alone cannot tie somebody's provider account to it
	if rec, _ := e.call("POST", "/api/v1/auth/oidc/confirm", token, map[string]any{"link": true}); rec.Code != http.StatusForbidden {
		t.Fatalf("link without password: %d", rec.Code)
	}
	// Not linked: nothing to confirm with
	if rec, _ := e.call("POST", "/api/v1/auth/oidc/confirm", token, map[string]any{}); rec.Code != http.StatusConflict {
		t.Fatalf("confirm unlinked: %d", rec.Code)
	}
	// The provider's address differs from the account's: linked by hand
	e.idp.person = map[string]any{"sub": "max-sub", "email": "max.privat@example.com", "email_verified": true}
	if code := e.confirm(token, map[string]any{"link": true, "password": "Max-Passwort-1"}); code != "" {
		t.Fatalf("link: %q", code)
	}
	if e.userOf(token)["oidc"] != true {
		t.Fatal("not linked")
	}
	id := e.userOf(token)["id"]
	if e.userOf(e.mustSignIn())["id"] != id {
		t.Fatal("sign-in after linking went elsewhere")
	}
	// The same provider account cannot be tied to a second MindSift account
	if _, err := e.store.CreateUser("moritz@example.com", mustHash(t, "Moritz-Passwort-1"), "Moritz", domain.RoleMember); err != nil {
		t.Fatal(err)
	}
	_, res = e.call("POST", "/api/v1/auth/login", "", map[string]string{"login": "moritz@example.com", "password": "Moritz-Passwort-1"})
	if code := e.confirm(res["token"].(string), map[string]any{"link": true, "password": "Moritz-Passwort-1"}); code != "linked_elsewhere" {
		t.Fatalf("second link: %q", code)
	}
}

func TestOIDCOffWithoutBaseURLOrInDemo(t *testing.T) {
	oc := config.OIDCConfig{Issuer: "https://idp.example", ClientID: "a", ClientSecret: "b"}
	if err := oc.Resolve(); err != nil {
		t.Fatal(err)
	}
	if o, reason := newOIDCService(&config.Config{OIDC: oc}); o != nil || reason != "no_base_url" {
		t.Fatalf("without BASE_URL: %v %q", o, reason)
	}
	if o, reason := newOIDCService(&config.Config{OIDC: oc, BaseURLSet: true, BaseURL: "https://m.test", DemoMode: true}); o != nil || reason != "demo" {
		t.Fatalf("demo: %v %q", o, reason)
	}
	srv, _, _ := setupTestServer(t)
	rec := sessionCall(srv.Router(), "POST", "/api/v1/auth/oidc/start", "", "{}", "go-test")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("start while off: %d", rec.Code)
	}
	_, status := (&oidcEnv{t: t, router: srv.Router()}).call("GET", "/api/v1/auth/status", "", nil)
	if status["passwordLogin"] != true || status["oidc"].(map[string]any)["enabled"] != false {
		t.Fatalf("status while off: %v", status)
	}
}
