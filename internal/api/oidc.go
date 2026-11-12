package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
	"golang.org/x/oauth2"
)

// Sign-in through an OpenID Connect provider (Authentik, Authelia, Keycloak, Dex, Google …), set up by the
// OIDC_* variables (config.OIDCConfig). Authorization code flow with PKCE (S256), state and nonce:
//
//	POST /auth/oidc/start {return}          → {url, bind}: the app keeps bind and goes to url (the provider)
//	POST /auth/oidc/confirm {return, link…} → {url, bind}, signed in: sign in there again to confirm a sensitive
//	                                          change, or to link the account to the provider (needs the password)
//	GET  /auth/oidc/callback                the provider's answer: the code is exchanged, the ID token checked,
//	                                          the account found, linked or created; the browser goes back into
//	                                          the app with a one-time ticket (?oidc=…) or an error (?oidc_error=…)
//	POST /auth/oidc/exchange {ticket, bind} → {token, user} after a sign-in, {confirmed} after a confirmation
//
// MindSift has no cookies, so the flow is bound to the browser by bind: a random value only the app that
// started the flow knows (localStorage), checked against its hash when the ticket is exchanged. A ticket
// copied out of an address bar or a log, or a callback pushed to someone else's browser (login CSRF), is
// worthless; the session token never appears in a URL. Flows, tickets and confirmations live in memory.
//
// Accounts are tied to the provider's identity (issuer, sub; storage/oidc.go). At the first sign-in a verified
// e-mail address (email_verified) links an existing account with that address, else a new account is created
// (OIDC_AUTO_CREATE) with the name and username the provider gives and no password of its own
// (auth.NoPasswordHash). Locked accounts stay locked. With OIDC_ADMIN_GROUP the provider's groups decide who is
// administrator at every sign-in, the last administrator is never taken back.
//
// A session started here is never asked for a second factor by MindSift, the provider has its own; the
// administration's requirement (mfaRequired) applies to password sign-ins only (sessions.via). Sensitive
// changes (password, address, deleting, API keys, second factors) are confirmed by signing in at the provider
// again (prompt=login, max_age=0; auth_time is checked when the provider sends it): the session then counts as
// confirmed for oidcConfirmTTL. So a stolen session alone can change nothing that needs a confirmation.
//
// Discovery (<issuer>/.well-known/openid-configuration) is done when first needed and kept; a provider that is
// down does not stop the start: the button answers with a message, and discovery is tried again at most every
// oidcRetryAfter. The provider's keys (JWKS) are fetched again when it signs with a new one.

const (
	oidcFlowTTL    = 10 * time.Minute
	oidcTicketTTL  = 2 * time.Minute
	oidcConfirmTTL = 5 * time.Minute
	oidcRetryAfter = 15 * time.Second
	oidcHTTPTime   = 10 * time.Second
	// oidcClockSkew: how far the provider's clock may be off for exp and iat
	oidcClockSkew = time.Minute
	// Anybody can start a sign-in: at most this many wait, and one address holds at most maxOIDCFlowsPerIP
	maxOIDCFlows      = 5000
	maxOIDCFlowsPerIP = 20
	// limitOIDCPerIP: starts and ticket exchanges per address and lock window (loginguard.go)
	limitOIDCPerIP = 60

	oidcPurposeLogin   = "login"
	oidcPurposeConfirm = "confirm"
	oidcPurposeLink    = "link"
)

type oidcFlow struct {
	purpose  string
	state    string
	verifier string
	nonce    string
	bind     string // SHA-256 of the app's value
	returnTo string
	// confirm and link: the signed-in account and its session
	userID    string
	sessionID string
	ip        string
	created   time.Time
}

type oidcTicket struct {
	purpose      string
	userID       string
	sessionID    string
	tokenVersion int
	bind         string
	created      time.Time
}

type oidcConfirmation struct {
	userID string
	until  time.Time
}

type oidcService struct {
	cfg         config.OIDCConfig
	redirectURL string
	client      *http.Client

	// discovery: the provider once found; lastTry/lastErr hold off the next try while it is down
	discoverMu sync.Mutex
	provider   *oidc.Provider
	lastTry    time.Time
	lastErr    error

	mu        sync.Mutex
	flows     map[string]*oidcFlow
	tickets   map[string]*oidcTicket
	confirmed map[string]oidcConfirmation // by session id
}

// newOIDCService: the sign-in through the provider when the variables set it up and it can be used; reason says
// why not otherwise ("demo", "no_base_url"; "" when the variables are not set at all).
func newOIDCService(cfg *config.Config) (*oidcService, string) {
	switch {
	case !cfg.OIDC.Configured():
		return nil, ""
	case cfg.DemoMode:
		return nil, "demo"
	case !cfg.BaseURLSet:
		return nil, "no_base_url"
	}
	return &oidcService{
		cfg:         cfg.OIDC,
		redirectURL: strings.TrimRight(cfg.BaseURL, "/") + "/api/v1/auth/oidc/callback",
		client:      &http.Client{Timeout: oidcHTTPTime},
		flows:       map[string]*oidcFlow{},
		tickets:     map[string]*oidcTicket{},
		confirmed:   map[string]oidcConfirmation{},
	}, ""
}

// logOIDCSetup says at the start whether the provider sign-in is on, and why not when its variables are set.
func (s *Server) logOIDCSetup(reason string) {
	switch reason {
	case "demo":
		slog.Warn("OIDC_* is set but the sign-in through a provider is off in demo mode")
	case "no_base_url":
		slog.Warn("OIDC_* is set but BASE_URL is not: the provider needs the address it sends people back to (<BASE_URL>/api/v1/auth/oidc/callback). The sign-in through the provider stays off, passwords keep working")
	}
	if s.oidc == nil {
		return
	}
	slog.Info("Sign-in through an OIDC provider is on", "name", s.oidc.cfg.Name, "issuer", s.oidc.cfg.Issuer,
		"redirect_uri", s.oidc.redirectURL, "auto_create", s.oidc.cfg.AutoCreate, "password_login", s.oidc.cfg.PasswordLogin,
		"link_by_email", s.oidc.cfg.LinkByEmail, "admin_group", s.oidc.cfg.AdminGroup)
	go func() {
		if _, err := s.oidc.discover(time.Now()); err == nil {
			slog.Info("OIDC provider found", "issuer", s.oidc.cfg.Issuer)
		}
	}()
}

// discover returns the provider, asking its discovery document when it is not known yet.
func (o *oidcService) discover(now time.Time) (*oidc.Provider, error) {
	o.discoverMu.Lock()
	defer o.discoverMu.Unlock()
	if o.provider != nil {
		return o.provider, nil
	}
	if since := now.Sub(o.lastTry); !o.lastTry.IsZero() && since >= 0 && since < oidcRetryAfter {
		return nil, o.lastErr
	}
	o.lastTry = now
	ctx, cancel := context.WithTimeout(oidc.ClientContext(context.Background(), o.client), oidcHTTPTime)
	defer cancel()
	p, err := oidc.NewProvider(ctx, o.cfg.Issuer)
	if err != nil {
		o.lastErr = err
		slog.Warn("OIDC provider not reachable or its discovery document is wrong; the sign-in button answers with a message until it is (tried again on the next click)",
			"issuer", o.cfg.Issuer, "error", err)
		return nil, err
	}
	o.provider, o.lastErr = p, nil
	return p, nil
}

func (o *oidcService) oauth2Config(p *oidc.Provider) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     o.cfg.ClientID,
		ClientSecret: o.cfg.ClientSecret,
		Endpoint:     p.Endpoint(),
		RedirectURL:  o.redirectURL,
		Scopes:       o.cfg.Scopes,
	}
}

func randomToken(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func bindHash(bind string) string {
	sum := sha256.Sum256([]byte(bind))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// addFlow keeps a new flow; old ones go, and the oldest of the address (or of all) when too many wait.
func (o *oidcService) addFlow(f *oidcFlow, now time.Time) {
	o.mu.Lock()
	defer o.mu.Unlock()
	sameIP := 0
	for k, v := range o.flows {
		if now.Sub(v.created) >= oidcFlowTTL {
			delete(o.flows, k)
		} else if v.ip == f.ip {
			sameIP++
		}
	}
	dropOldest := func(ip string) {
		oldest := ""
		for k, v := range o.flows {
			if (ip == "" || v.ip == ip) && (oldest == "" || v.created.Before(o.flows[oldest].created)) {
				oldest = k
			}
		}
		delete(o.flows, oldest)
	}
	if sameIP >= maxOIDCFlowsPerIP {
		dropOldest(f.ip)
	}
	if len(o.flows) >= maxOIDCFlows {
		dropOldest("")
	}
	f.created = now
	o.flows[f.state] = f
}

// takeFlow removes the flow and returns it while it is valid: every answer of the provider uses it up.
func (o *oidcService) takeFlow(state string, now time.Time) (*oidcFlow, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	f, ok := o.flows[state]
	delete(o.flows, state)
	if !ok || now.Sub(f.created) >= oidcFlowTTL {
		return nil, false
	}
	return f, true
}

func (o *oidcService) addTicket(t *oidcTicket, now time.Time) (string, error) {
	id, err := randomToken(32)
	if err != nil {
		return "", err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	for k, v := range o.tickets {
		if now.Sub(v.created) >= oidcTicketTTL {
			delete(o.tickets, k)
		}
	}
	t.created = now
	o.tickets[id] = t
	return id, nil
}

// takeTicket removes the ticket and returns it while it is valid and bind is the value its flow was started
// with. A wrong bind uses the ticket up as well.
func (o *oidcService) takeTicket(id, bind string, now time.Time) (*oidcTicket, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	t, ok := o.tickets[id]
	delete(o.tickets, id)
	if !ok || now.Sub(t.created) >= oidcTicketTTL || bind == "" ||
		subtle.ConstantTimeCompare([]byte(bindHash(bind)), []byte(t.bind)) != 1 {
		return nil, false
	}
	return t, true
}

func (o *oidcService) confirm(sessionID, userID string, now time.Time) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for k, v := range o.confirmed {
		if !now.Before(v.until) {
			delete(o.confirmed, k)
		}
	}
	o.confirmed[sessionID] = oidcConfirmation{userID: userID, until: now.Add(oidcConfirmTTL)}
}

func (o *oidcService) confirmedFor(sessionID, userID string, now time.Time) bool {
	if sessionID == "" {
		return false
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	c, ok := o.confirmed[sessionID]
	return ok && c.userID == userID && now.Before(c.until)
}

// --- What other parts ask ---

// oidcOnly: the routes of the provider sign-in answer 404 while it is off.
func (s *Server) oidcOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.oidc == nil {
			writeError(w, http.StatusNotFound, "Die Anmeldung über einen Anbieter (OIDC) ist auf diesem Server nicht eingerichtet")
			return
		}
		next(w, r)
	}
}

// passwordLoginOn: everybody may sign in with a password (or a passkey without password), register and
// reset a forgotten password. Off only with a provider and OIDC_PASSWORD_LOGIN=false.
func (s *Server) passwordLoginOn() bool {
	return s.oidc == nil || s.oidc.cfg.PasswordLogin
}

// passwordLoginFor: this account may sign in with its password; with the password login off only
// administrators may (emergency access while the provider is down).
func (s *Server) passwordLoginFor(user *domain.User) bool {
	return s.passwordLoginOn() || (user != nil && user.Role == domain.RoleAdmin)
}

// oidcName: the provider's name on the button and in messages.
func (s *Server) oidcName() string {
	if s.oidc == nil {
		return ""
	}
	return s.oidc.cfg.Name
}

// oidcLinked: the account signs in through the provider.
func (s *Server) oidcLinked(user *domain.User) bool {
	return s.oidc != nil && s.store.HasOIDCIdentity(user.ID, s.oidc.cfg.Issuer)
}

// oidcConfirmed: the request's session signed in at the provider again a moment ago (confirm flow).
func (s *Server) oidcConfirmed(r *http.Request, user *domain.User) bool {
	return s.oidc != nil && s.oidc.confirmedFor(sessionIDFrom(r), user.ID, s.now())
}

// sessionViaOIDC: the request's session was started through the provider.
func (s *Server) sessionViaOIDC(r *http.Request) bool {
	return s.oidc != nil && s.store.SessionVia(sessionIDFrom(r)) == storage.SessionViaOIDC
}

// writeOIDCConfirmRequired: the change needs a new sign-in at the provider (the app offers it).
func (s *Server) writeOIDCConfirmRequired(w http.ResponseWriter) {
	writeErrorCode(w, http.StatusForbidden, "oidc_confirm_required",
		tr(w, "Bitte bestätige die Änderung mit einer erneuten Anmeldung bei {name}", "name", s.oidcName()))
}

// oidcStatusForAdmin: what the administration shows (read only).
func (s *Server) oidcStatusForAdmin() *domain.OIDCStatus {
	c := s.cfg.OIDC
	if !c.Configured() {
		return &domain.OIDCStatus{Configured: false, PasswordLogin: true}
	}
	st := &domain.OIDCStatus{
		Configured:    true,
		Name:          c.Name,
		Issuer:        c.Issuer,
		ClientID:      c.ClientID,
		Scopes:        strings.Join(c.Scopes, " "),
		AdminGroup:    c.AdminGroup,
		AutoCreate:    c.AutoCreate,
		PasswordLogin: s.passwordLoginOn(),
		LinkedUsers:   s.store.CountOIDCIdentities(c.Issuer),
	}
	if s.oidc == nil {
		_, st.Reason = newOIDCService(s.cfg)
		return st
	}
	st.Enabled = true
	st.RedirectURL = s.oidc.redirectURL
	_, err := s.oidc.discover(s.now())
	reachable := err == nil
	st.Reachable = &reachable
	if err != nil {
		st.Error = err.Error()
	}
	return st
}

// --- Handlers ---

// oidcReturnPath: where the app wants to go back to, an own path such as "/" or "/oauth/authorize?…"; anything
// else (another site, an API path) becomes "/".
func oidcReturnPath(raw string) string {
	if raw == "" || len(raw) > 4096 || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.ContainsAny(raw, "\\\r\n\t") {
		return "/"
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil || strings.HasPrefix(u.Path, "/api/") {
		return "/"
	}
	q := u.Query()
	q.Del("oidc")
	q.Del("oidc_error")
	u.RawQuery = q.Encode()
	u.Fragment = ""
	return u.String()
}

// oidcBack sends the browser back into the app: to returnTo with the ticket (oidc=…) or an error (oidc_error=…).
func (s *Server) oidcBack(w http.ResponseWriter, r *http.Request, returnTo, key, value string) {
	u, err := url.Parse(oidcReturnPath(returnTo))
	if err != nil {
		u = &url.URL{Path: "/"}
	}
	q := u.Query()
	q.Set(key, value)
	u.RawQuery = q.Encode()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, strings.TrimRight(s.cfg.BaseURL, "/")+u.String(), http.StatusSeeOther)
}

// startOIDCFlow keeps a new flow and answers {url, bind}: the provider's address and the value the app keeps.
func (s *Server) startOIDCFlow(w http.ResponseWriter, r *http.Request, f *oidcFlow) {
	p, err := s.oidc.discover(s.now())
	if err != nil {
		writeErrorCode(w, http.StatusServiceUnavailable, "oidc_unavailable",
			tr(w, "{name} ist gerade nicht erreichbar. Bitte versuche es später noch einmal.", "name", s.oidcName()))
		return
	}
	var bind string
	for _, v := range []*string{&f.state, &f.nonce, &bind} {
		if *v, err = randomToken(32); err != nil {
			writeInternal(w, err)
			return
		}
	}
	f.verifier = oauth2.GenerateVerifier()
	f.bind = bindHash(bind)
	f.ip = clientIPFrom(r).ip
	opts := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(f.verifier), oidc.Nonce(f.nonce)}
	if f.purpose != oidcPurposeLogin {
		// The person signs in there again, not just passes a session that is still open
		opts = append(opts, oauth2.SetAuthURLParam("prompt", "login"), oauth2.SetAuthURLParam("max_age", "0"))
	}
	s.oidc.addFlow(f, s.now())
	writeJSON(w, http.StatusOK, map[string]any{
		"url":       s.oidc.oauth2Config(p).AuthCodeURL(f.state, opts...),
		"bind":      bind,
		"expiresIn": int(oidcFlowTTL.Seconds()),
	})
}

// handleOIDCStart: POST /auth/oidc/start {return} → {url, bind}. The sign-in itself (public).
func (s *Server) handleOIDCStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Return string `json:"return"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req)
	if wait := s.loginGuard.throttle("oidc", clientIPFrom(r), limitOIDCPerIP); wait > 0 {
		writeThrottled(w, wait)
		return
	}
	if count, _ := s.store.CountUsers(); count == 0 {
		writeError(w, http.StatusForbidden, "Bitte richte MindSift zuerst ein")
		return
	}
	s.startOIDCFlow(w, r, &oidcFlow{purpose: oidcPurposeLogin, returnTo: oidcReturnPath(req.Return)})
}

// handleOIDCConfirm: POST /auth/oidc/confirm {return, link, password, code | passkeyToken + passkey} → {url,
// bind}, signed in. Without link: sign in at the provider again to confirm a sensitive change (the account must
// be linked). With link: tie the account to the provider; that needs the password (and second factor) first, or
// a stolen session could tie the thief's account at the provider to it for good.
func (s *Server) handleOIDCConfirm(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Return   string `json:"return"`
		Link     bool   `json:"link"`
		Password string `json:"password"`
		secondFactor
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&req)
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	sid := sessionIDFrom(r)
	if sid == "" || actorFrom(r.Context()) != nil {
		writeError(w, http.StatusForbidden, "Nur in einer angemeldeten Sitzung möglich")
		return
	}
	linked := s.oidcLinked(user)
	purpose := oidcPurposeConfirm
	if req.Link {
		if linked {
			writeErrorFrom(w, http.StatusConflict, storage.ErrOIDCAlreadyLinked)
			return
		}
		if !s.confirmWithSecondFactor(w, r, user, req.Password, req.secondFactor) {
			return
		}
		purpose = oidcPurposeLink
	} else if !linked {
		writeError(w, http.StatusConflict, "Dein Konto ist nicht mit dem Anbieter verknüpft")
		return
	}
	s.startOIDCFlow(w, r, &oidcFlow{purpose: purpose, returnTo: oidcReturnPath(req.Return), userID: user.ID, sessionID: sid})
}

// oidcIdentity: what the provider says about the person, from the checked ID token and its userinfo.
type oidcIdentity struct {
	issuer, subject string
	email           string
	emailVerified   bool
	name, username  string
	groups          []string
	hasGroups       bool
	authTime        time.Time
}

// errOIDCUnreachable: the provider could not be asked (as opposed to an answer that was refused).
var errOIDCUnreachable = errors.New("provider unreachable")

// oidcVerify exchanges the code and checks the ID token completely: signature (keys of the provider's JWKS),
// iss, aud, azp when there are several audiences, exp and iat with oidcClockSkew, the nonce of the flow and the
// access token's hash. The userinfo endpoint adds claims the token leaves out (Authelia, Keycloak); its sub
// must be the token's.
func (s *Server) oidcVerify(ctx context.Context, f *oidcFlow, code string) (*oidcIdentity, error) {
	now := s.now()
	p, err := s.oidc.discover(now)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errOIDCUnreachable, err)
	}
	ctx, cancel := context.WithTimeout(oidc.ClientContext(ctx, s.oidc.client), oidcHTTPTime)
	defer cancel()
	token, err := s.oidc.oauth2Config(p).Exchange(ctx, code, oauth2.VerifierOption(f.verifier))
	if err != nil {
		var re *oauth2.RetrieveError
		if !errors.As(err, &re) {
			return nil, fmt.Errorf("%w: %v", errOIDCUnreachable, err)
		}
		return nil, fmt.Errorf("token exchange refused: %v", err)
	}
	rawID, _ := token.Extra("id_token").(string)
	if rawID == "" {
		return nil, errors.New("the token answer has no id_token")
	}
	clientID := s.oidc.cfg.ClientID
	idt, err := p.Verifier(&oidc.Config{ClientID: clientID, Now: func() time.Time { return now.Add(-oidcClockSkew) }}).Verify(ctx, rawID)
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(idt.Nonce), []byte(f.nonce)) != 1 {
		return nil, errors.New("the ID token's nonce is not the one of this sign-in")
	}
	if idt.Subject == "" {
		return nil, errors.New("the ID token has no sub")
	}
	if idt.IssuedAt.IsZero() || idt.IssuedAt.After(now.Add(oidcClockSkew)) || now.Sub(idt.IssuedAt) > oidcFlowTTL+oidcClockSkew {
		return nil, fmt.Errorf("the ID token's iat %v is missing, in the future or too old", idt.IssuedAt)
	}
	if idt.AccessTokenHash != "" {
		if err := idt.VerifyAccessToken(token.AccessToken); err != nil {
			return nil, err
		}
	}
	claims := map[string]any{}
	if err := idt.Claims(&claims); err != nil {
		return nil, err
	}
	azp, _ := claims["azp"].(string)
	if (len(idt.Audience) > 1 || azp != "") && azp != clientID {
		return nil, fmt.Errorf("the ID token's azp %q is not this client", azp)
	}
	if p.UserInfoEndpoint() != "" {
		info, err := p.UserInfo(ctx, oauth2.StaticTokenSource(token))
		if err != nil {
			slog.Warn("OIDC userinfo not read; using the ID token's claims only", "error", err)
		} else if info.Subject != idt.Subject {
			return nil, errors.New("userinfo is about another sub than the ID token")
		} else {
			extra := map[string]any{}
			if err := info.Claims(&extra); err == nil {
				for k, v := range extra {
					if _, ok := claims[k]; !ok {
						claims[k] = v
					}
				}
			}
		}
	}
	id := &oidcIdentity{issuer: s.oidc.cfg.Issuer, subject: idt.Subject}
	id.email, _ = claims["email"].(string)
	switch v := claims["email_verified"].(type) {
	case bool:
		id.emailVerified = v
	case string:
		id.emailVerified = strings.EqualFold(v, "true")
	}
	id.name, _ = claims["name"].(string)
	id.username, _ = claims["preferred_username"].(string)
	switch g := claims["groups"].(type) {
	case []any:
		id.hasGroups = true
		for _, v := range g {
			if name, ok := v.(string); ok {
				id.groups = append(id.groups, name)
			}
		}
	case string:
		id.hasGroups = true
		id.groups = strings.Fields(strings.ReplaceAll(g, ",", " "))
	}
	if at, ok := claims["auth_time"].(float64); ok && at > 0 {
		id.authTime = time.Unix(int64(at), 0)
	}
	return id, nil
}

// handleOIDCCallback: GET /auth/oidc/callback?code=…&state=… (or ?error=…), the provider sends the browser here.
func (s *Server) handleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f, ok := s.oidc.takeFlow(q.Get("state"), s.now())
	if !ok {
		slog.Warn("OIDC sign-in: unknown or expired state", "remote_addr", r.RemoteAddr)
		s.oidcBack(w, r, "/", "oidc_error", "expired")
		return
	}
	if e := q.Get("error"); e != "" {
		code := "failed"
		if e == "access_denied" {
			code = "cancelled"
		}
		if len(e) > 64 {
			e = e[:64]
		}
		slog.Info("OIDC sign-in ended at the provider", "error", e, "purpose", f.purpose, "remote_addr", r.RemoteAddr)
		s.oidcBack(w, r, f.returnTo, "oidc_error", code)
		return
	}
	id, err := s.oidcVerify(r.Context(), f, q.Get("code"))
	if err != nil {
		code := "failed"
		if errors.Is(err, errOIDCUnreachable) {
			code = "unavailable"
		}
		slog.Warn("OIDC sign-in refused: the provider's answer did not pass the checks", "purpose", f.purpose, "error", err, "remote_addr", r.RemoteAddr)
		s.oidcBack(w, r, f.returnTo, "oidc_error", code)
		return
	}
	ticket := &oidcTicket{purpose: f.purpose, bind: f.bind, sessionID: f.sessionID}
	switch f.purpose {
	case oidcPurposeLogin:
		user, code := s.oidcSignIn(r, id)
		if user == nil {
			s.oidcBack(w, r, f.returnTo, "oidc_error", code)
			return
		}
		ticket.userID, ticket.tokenVersion = user.ID, user.TokenVersion
	default:
		if code := s.oidcConfirmIdentity(f, id); code != "" {
			s.oidcBack(w, r, f.returnTo, "oidc_error", code)
			return
		}
		ticket.userID = f.userID
	}
	tid, err := s.oidc.addTicket(ticket, s.now())
	if err != nil {
		slog.Error("Creating the OIDC ticket failed", "error", err)
		s.oidcBack(w, r, f.returnTo, "oidc_error", "failed")
		return
	}
	s.oidcBack(w, r, f.returnTo, "oidc", tid)
}

// oidcConfirmIdentity checks the new sign-in of a confirm or link flow; an error code for the app, "" when right.
// Confirm: the identity must be the one the account is linked to and, when the provider says when the person
// signed in, that must be after the flow began. Link: the identity must not belong to another account.
func (s *Server) oidcConfirmIdentity(f *oidcFlow, id *oidcIdentity) string {
	owner, err := s.store.OIDCIdentityUser(id.issuer, id.subject)
	if err != nil {
		logFailed("Looking up the OIDC identity", err)
		return "failed"
	}
	if f.purpose == oidcPurposeLink {
		err := s.store.LinkOIDCIdentity(id.issuer, id.subject, f.userID, id.email, s.now())
		switch {
		case errors.Is(err, storage.ErrOIDCIdentityTaken):
			slog.Warn("OIDC link refused: the identity belongs to another account", "user_id", f.userID, "owner", owner)
			return "linked_elsewhere"
		case errors.Is(err, storage.ErrOIDCAlreadyLinked):
			return "already_linked"
		case err != nil:
			logFailed("Linking the OIDC identity", err, "user_id", f.userID)
			return "failed"
		}
		slog.Info("Account linked to the OIDC provider", "user_id", f.userID)
		if user, err := s.store.GetUserByID(f.userID); err == nil && user != nil {
			s.notifyOIDCLinked(user)
		}
		return ""
	}
	if owner != f.userID {
		slog.Warn("OIDC confirmation refused: signed in at the provider as somebody else", "user_id", f.userID)
		return "wrong_account"
	}
	if !id.authTime.IsZero() && id.authTime.Before(f.created.Add(-oidcClockSkew)) {
		slog.Warn("OIDC confirmation refused: the provider did not ask for the sign-in again", "user_id", f.userID, "auth_time", id.authTime)
		return "not_fresh"
	}
	return ""
}

// oidcSignIn finds, links or creates the account of the identity and sees that it may sign in. Returns the
// account, or nil and the error code for the app.
func (s *Server) oidcSignIn(r *http.Request, id *oidcIdentity) (*domain.User, string) {
	now := s.now()
	name := s.oidcName()
	if count, _ := s.store.CountUsers(); count == 0 {
		return nil, "setup"
	}
	userID, err := s.store.OIDCIdentityUser(id.issuer, id.subject)
	if err != nil {
		logFailed("Looking up the OIDC identity", err)
		return nil, "failed"
	}
	var user *domain.User
	if userID != "" {
		if user, _ = s.store.GetUserByID(userID); user == nil {
			logFailed("Removing the OIDC identity of a deleted account", s.store.UnlinkOIDCIdentity(id.issuer, id.subject))
		}
	}
	address := domain.NormalizeEmail(id.email)
	if user == nil && s.oidc.cfg.LinkByEmail && id.emailVerified && address != "" {
		// Only with OIDC_LINK_BY_EMAIL: the provider vouches for the address, the account with it is taken over
		if existing, err := s.store.UserByEmailExactly(address); err == nil && existing != nil {
			if err := s.store.LinkOIDCIdentity(id.issuer, id.subject, existing.ID, address, now); err != nil {
				slog.Warn("OIDC sign-in refused: the account with this address is linked to another identity at the provider", "user_id", existing.ID, "error", err)
				return nil, "email_in_use"
			}
			slog.Info("Account linked to the OIDC provider by its verified e-mail address (OIDC_LINK_BY_EMAIL)", "user_id", existing.ID, "provider", name)
			user = existing
		}
	}
	if user == nil {
		// A new account rests on the identity alone (issuer and subject); an existing account with the same
		// address is never taken over here, its owner links it in the settings
		if !s.oidc.cfg.AutoCreate {
			slog.Warn("OIDC sign-in refused: no account, and OIDC_AUTO_CREATE is off", "remote_addr", r.RemoteAddr)
			return nil, "no_account"
		}
		if user, err = s.createOIDCAccount(r, id, address); err != nil {
			logFailed("Creating the account at the first OIDC sign-in", err)
			return nil, "failed"
		}
	}
	if !user.IsActive {
		code := "disabled"
		switch {
		case s.store.IsEmailUnverified(user.ID):
			code = "unverified"
		case s.store.IsPendingRegistration(user.ID):
			code = "pending"
		}
		slog.Warn("Sign-in refused: user account is not active", "user_id", user.ID, "display_name", user.DisplayName, "reason", code, "via", "oidc", "remote_addr", r.RemoteAddr)
		return nil, code
	}
	s.syncOIDCAdmin(user, id)
	s.store.TouchOIDCIdentity(id.issuer, id.subject, now)
	return user, ""
}

// createOIDCAccount creates the account of a first sign-in: username from preferred_username (made unique by
// the store), display name from name, no password of its own. The address the provider sent: verified and
// free, it is the login address; not verified, it waits for its confirmation link like a changed address;
// taken by another account, or none at all, the account has no address (it can add one in the settings).
func (s *Server) createOIDCAccount(r *http.Request, id *oidcIdentity, address string) (*domain.User, error) {
	hash, err := auth.NoPasswordHash()
	if err != nil {
		return nil, err
	}
	free := address != "" && !s.store.EmailInUse(address)
	login := ""
	if free && id.emailVerified {
		login = address
	}
	local := strings.Split(address, "@")[0]
	display := strings.TrimSpace(id.name)
	if display == "" {
		display = strings.TrimSpace(id.username)
	}
	if display == "" {
		display = local
	}
	if display == "" {
		display = s.oidcName()
	}
	if r := []rune(display); len(r) > 100 {
		display = string(r[:100])
	}
	username := storage.UsernameFromName(id.username)
	if len(username) < 2 {
		username = storage.UsernameFromName(display)
	}
	if len(username) < 2 {
		username = storage.UsernameFromName(local)
	}
	if len(username) < 2 {
		username = "user"
	}
	user, err := s.store.CreateUserWithUsername(login, username, hash, display, domain.RoleMember)
	if err != nil {
		return nil, err
	}
	if err := s.store.LinkOIDCIdentity(id.issuer, id.subject, user.ID, address, s.now()); err != nil {
		logFailed("Removing the account that could not be linked", s.store.DeleteUser(user.ID), "user_id", user.ID)
		return nil, err
	}
	logFailed("Setting the language", s.store.SetLanguage(user.ID, s.requestLanguage(r)), "user_id", user.ID)
	if free && login == "" {
		s.requestEmailChange(user, storage.EmailChangeAccount, address)
	}
	addressState := "none"
	switch {
	case login != "":
		addressState = "verified"
	case free:
		addressState = "waiting for confirmation"
	}
	slog.Info("Account created at the first sign-in through OIDC", "user_id", user.ID, "username", user.Username, "provider", s.oidcName(), "address", addressState)
	return user, nil
}

// syncOIDCAdmin: with OIDC_ADMIN_GROUP members of that group at the provider are administrators and the
// others are not, set at every sign-in; the last administrator stays one. Without a groups claim nothing changes.
func (s *Server) syncOIDCAdmin(user *domain.User, id *oidcIdentity) {
	group := strings.TrimPrefix(s.oidc.cfg.AdminGroup, "/")
	if group == "" {
		return
	}
	if !id.hasGroups {
		slog.Warn("OIDC_ADMIN_GROUP is set but the provider sent no groups claim; the role stays as it is (scope groups, or a groups mapper at the provider)", "user_id", user.ID)
		return
	}
	// Keycloak sends the full path of a group ("/admins") when asked to
	in := slices.ContainsFunc(id.groups, func(g string) bool { return strings.TrimPrefix(g, "/") == group })
	isAdmin := user.Role == domain.RoleAdmin
	if in == isAdmin || (!in && !isAdmin) {
		return
	}
	changed, err := s.store.SetAdminByGroup(user.ID, in)
	if err != nil {
		logFailed("Setting the role from the provider's group", err, "user_id", user.ID)
		return
	}
	switch {
	case changed && in:
		user.Role = domain.RoleAdmin
		slog.Info("Became administrator: member of the provider's admin group", "user_id", user.ID, "group", group)
	case changed:
		user.Role = domain.RoleMember
		slog.Info("No longer administrator: not in the provider's admin group", "user_id", user.ID, "group", group)
	default:
		slog.Warn("Stays administrator although not in the provider's admin group: the last administrator is never taken back", "user_id", user.ID, "group", group)
	}
}

// handleOIDCExchange: POST /auth/oidc/exchange {ticket, bind}. After a sign-in → {token, user}; after a
// confirmation or a link → {confirmed, linked, expiresIn}, only for the session that asked for it.
func (s *Server) handleOIDCExchange(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Ticket string `json:"ticket"`
		Bind   string `json:"bind"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	if wait := s.loginGuard.throttle("oidc", clientIPFrom(r), limitOIDCPerIP); wait > 0 {
		writeThrottled(w, wait)
		return
	}
	expired := func() {
		writeErrorCode(w, http.StatusUnauthorized, "oidc_expired", "Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.")
	}
	t, ok := s.oidc.takeTicket(req.Ticket, req.Bind, s.now())
	if !ok {
		slog.Warn("OIDC ticket refused: unknown, expired, used or of another browser", "remote_addr", r.RemoteAddr)
		expired()
		return
	}
	user, err := s.store.GetUserByID(t.userID)
	if err != nil || user == nil {
		expired()
		return
	}
	if t.purpose == oidcPurposeLogin {
		if !s.signInAllowed(w, r, user) {
			return
		}
		if user.TokenVersion != t.tokenVersion {
			expired()
			return
		}
		token, err := s.startSession(r, user, storage.SessionViaOIDC)
		if err != nil {
			slog.Error("Creating the sign-in token failed", "user_id", user.ID, "error", err)
			writeError(w, http.StatusInternalServerError, "Token konnte nicht erstellt werden")
			return
		}
		slog.Info("Sign-in successful", "user_id", user.ID, "display_name", user.DisplayName, "role", user.Role, "via", "oidc", "remote_addr", r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
		return
	}
	// A confirmation counts for the session that started it, sent along as usual
	caller, key := s.authenticateToken(bearerToken(r))
	claims, err := auth.ValidateToken(s.cfg.JWTSecret, bearerToken(r))
	if caller == nil || key != nil || err != nil || caller.ID != t.userID || claims.ID != t.sessionID {
		slog.Warn("OIDC confirmation refused: not the session that asked for it", "user_id", t.userID, "remote_addr", r.RemoteAddr)
		expired()
		return
	}
	s.oidc.confirm(t.sessionID, t.userID, s.now())
	slog.Info("Sign-in at the OIDC provider confirmed", "user_id", t.userID, "purpose", t.purpose)
	writeJSON(w, http.StatusOK, map[string]any{
		"confirmed": true,
		"linked":    t.purpose == oidcPurposeLink,
		"expiresIn": int(oidcConfirmTTL.Seconds()),
	})
}

// bearerToken: the session token or key of the request (Authorization: Bearer, else X-API-Key).
func bearerToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.Header.Get("X-API-Key")
}

// notifyOIDCLinked mails the account that it now signs in through the provider as well.
func (s *Server) notifyOIDCLinked(user *domain.User) {
	if _, err := s.smtpSettings(); err != nil || user.Email == "" {
		return
	}
	lang := s.userLanguage(user.ID)
	s.sendAccountNotice(user, lang, i18n.T(lang, "Dein MindSift-Konto wurde mit {name} verknüpft. Du kannst dich jetzt auch dort anmelden.", "name", s.oidcName()))
}
