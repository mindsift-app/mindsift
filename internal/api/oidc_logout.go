package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// OpenID Connect Back-Channel Logout 1.0: when the person signs out at the provider (or an administrator ends
// the session there), the provider tells MindSift server to server and the MindSift sessions started through
// that provider session end too. Signing out of MindSift keeps the provider session (no RP-initiated logout).
//
//	POST /auth/oidc/backchannel-logout (form: logout_token) → 200, or 400 for a token that fails the checks
//
// No session and no CSRF token: the logout token is the proof. It is a JWT signed with the provider's keys (the
// JWKS the sign-in already uses), with iss = OIDC_ISSUER, our client id in aud, a recent iat, the back-channel
// logout event, sub and/or sid, a jti and no nonce (so an ID token cannot pass as one). A jti is accepted once.
//
// With sid (the provider's session, kept with the MindSift session at the sign-in, sessions.oidc_sid) exactly
// the sessions of that provider session end; with sub as well only those of the account tied to (iss, sub).
// With sub alone every session of that account started through the provider ends. Sessions started with a
// password or a passkey stay: the provider did not start them, and a password sign-in is also the way in for
// administrators while the provider is down. Ended sessions get 401 from then on; the account's live connections
// are closed, so open tabs notice at once (the other devices reconnect with their still valid sessions).
//
// Configure at the provider: back-channel logout URL <BASE_URL>/api/v1/auth/oidc/backchannel-logout and, where
// offered, "session required" (so the token carries sid). OIDC_BACKCHANNEL_LOGOUT=false turns the endpoint off.

const (
	// oidcLogoutEvent is the member of the events claim that makes a JWT a logout token
	oidcLogoutEvent = "http://schemas.openid.net/event/backchannel-logout"
	// oidcLogoutMaxAge: how old a logout token may be (iat); providers send it right away
	oidcLogoutMaxAge = 10 * time.Minute
	// maxOIDCLogoutJTIs bounds the replay memory; the oldest entries go first when it is full
	maxOIDCLogoutJTIs = 10000
	// limitOIDCLogoutFailures: refused logout tokens per address and lock window (loginguard.go); valid ones are
	// not counted, so a provider ending many sessions at once is never held up
	limitOIDCLogoutFailures = 30
	maxOIDCLogoutTokenSize  = 16 << 10
)

// oidcLogoutPath is where the provider sends logout tokens (below BASE_URL).
const oidcLogoutPath = "/api/v1/auth/oidc/backchannel-logout"

// oidcLogout: the checked content of a logout token.
type oidcLogout struct {
	subject, sid, jti string
	until             time.Time // the jti is remembered until then
}

// rememberLogoutJTI records the jti of an accepted logout token; false when it was seen before (replay).
func (o *oidcService) rememberLogoutJTI(jti string, until, now time.Time) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	for k, v := range o.logoutJTIs {
		if !now.Before(v) {
			delete(o.logoutJTIs, k)
		}
	}
	if _, seen := o.logoutJTIs[jti]; seen {
		return false
	}
	if len(o.logoutJTIs) >= maxOIDCLogoutJTIs {
		oldest := ""
		for k, v := range o.logoutJTIs {
			if oldest == "" || v.Before(o.logoutJTIs[oldest]) {
				oldest = k
			}
		}
		delete(o.logoutJTIs, oldest)
	}
	o.logoutJTIs[jti] = until
	return true
}

// verifyLogoutToken checks a logout token as the specification asks (section 2.6); the jti is not recorded yet.
func (s *Server) verifyLogoutToken(ctx context.Context, raw string) (*oidcLogout, error) {
	now := s.now()
	p, err := s.oidc.discover(now)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errOIDCUnreachable, err)
	}
	ctx, cancel := context.WithTimeout(oidc.ClientContext(ctx, s.oidc.client), oidcHTTPTime)
	defer cancel()
	// Signature, iss and aud; exp is optional in logout tokens and checked below
	t, err := p.Verifier(&oidc.Config{ClientID: s.oidc.cfg.ClientID, SkipExpiryCheck: true}).Verify(ctx, raw)
	if err != nil {
		return nil, err
	}
	var claims map[string]any
	if err := t.Claims(&claims); err != nil {
		return nil, err
	}
	if _, ok := claims["nonce"]; ok {
		return nil, errors.New("a logout token must not carry a nonce")
	}
	events, _ := claims["events"].(map[string]any)
	if ev, ok := events[oidcLogoutEvent].(map[string]any); !ok || len(ev) != 0 {
		return nil, errors.New("the events claim lacks the back-channel logout event")
	}
	if t.IssuedAt.IsZero() || t.IssuedAt.After(now.Add(oidcClockSkew)) || now.Sub(t.IssuedAt) > oidcLogoutMaxAge+oidcClockSkew {
		return nil, fmt.Errorf("the logout token's iat %v is missing, in the future or too old", t.IssuedAt)
	}
	if !t.Expiry.IsZero() && !now.Before(t.Expiry.Add(oidcClockSkew)) {
		return nil, fmt.Errorf("the logout token expired at %v", t.Expiry)
	}
	l := &oidcLogout{subject: t.Subject, until: t.IssuedAt.Add(oidcLogoutMaxAge + 2*oidcClockSkew)}
	l.sid, _ = claims["sid"].(string)
	l.jti, _ = claims["jti"].(string)
	if l.subject == "" && l.sid == "" {
		return nil, errors.New("the logout token has neither sub nor sid")
	}
	if l.jti == "" {
		return nil, errors.New("the logout token has no jti")
	}
	if len(l.jti) > 255 || len(l.sid) > 255 || len(l.subject) > 255 {
		return nil, errors.New("a claim of the logout token is too long")
	}
	return l, nil
}

// handleOIDCBackchannelLogout: POST /auth/oidc/backchannel-logout, called by the provider (public).
func (s *Server) handleOIDCBackchannelLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !s.oidc.cfg.BackchannelLogout {
		writeError(w, http.StatusNotFound, "Nicht gefunden")
		return
	}
	ip := clientIPFrom(r)
	lockKey := ""
	if !ip.viaProxyWithoutHeader && ip.ip != "" {
		lockKey = "oidc_logout:" + ip.ip
	}
	if lockKey != "" {
		if wait := s.loginGuard.lockedKey(lockKey); wait > 0 {
			writeThrottled(w, wait)
			return
		}
	}
	refuse := func(reason error) {
		if lockKey != "" {
			s.loginGuard.failKey(lockKey, limitOIDCLogoutFailures)
		}
		slog.Warn("OIDC back-channel logout refused", "error", reason, "remote_addr", r.RemoteAddr)
		writeOAuthError(w, http.StatusBadRequest, "invalid_request", "Ungültige Anfrage")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxOIDCLogoutTokenSize)
	if err := r.ParseForm(); err != nil {
		refuse(err)
		return
	}
	raw := r.PostForm.Get("logout_token")
	if raw == "" {
		refuse(errors.New("no logout_token"))
		return
	}
	l, err := s.verifyLogoutToken(r.Context(), raw)
	if errors.Is(err, errOIDCUnreachable) {
		// Not the token's fault: the provider may send it again later
		slog.Warn("OIDC back-channel logout not handled: the provider is not reachable", "error", err)
		writeErrorCode(w, http.StatusServiceUnavailable, "oidc_unavailable",
			tr(w, "{name} ist gerade nicht erreichbar. Bitte versuche es später noch einmal.", "name", s.oidcName()))
		return
	}
	if err != nil {
		refuse(err)
		return
	}
	if !s.oidc.rememberLogoutJTI(l.jti, l.until, s.now()) {
		refuse(errors.New("the logout token was used before (jti)"))
		return
	}
	userID := ""
	if l.subject != "" {
		if userID, err = s.store.OIDCIdentityUser(s.oidc.cfg.Issuer, l.subject); err != nil {
			logFailed("Looking up the OIDC identity of a back-channel logout", err)
			writeError(w, http.StatusInternalServerError, "Abmelden fehlgeschlagen")
			return
		}
		if userID == "" {
			slog.Info("OIDC back-channel logout: no account is tied to this identity at the provider", "sessions_ended", 0)
			w.WriteHeader(http.StatusOK)
			return
		}
	}
	users, n, err := s.store.RevokeOIDCSessions(userID, l.sid)
	if err != nil {
		logFailed("Ending the sessions of a back-channel logout", err, "user_id", userID)
		writeError(w, http.StatusInternalServerError, "Abmelden fehlgeschlagen")
		return
	}
	for _, id := range users {
		// Live connections are not tied to one session; the account's other devices reconnect on their own
		s.wsHub.DisconnectUser(id)
	}
	if len(users) == 0 {
		slog.Info("OIDC back-channel logout: no active session matched", "user_id", userID, "by_sid", l.sid != "", "sessions_ended", 0)
	} else {
		slog.Info("Signed out by the OIDC provider (back-channel logout)", "user_id", strings.Join(users, ","), "by_sid", l.sid != "", "sessions_ended", n)
	}
	w.WriteHeader(http.StatusOK)
}
