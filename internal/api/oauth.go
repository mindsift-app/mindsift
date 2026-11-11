package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// OAuth for the MCP endpoint, so that claude.ai, ChatGPT and other
// clients that cannot send an API key header can connect. MindSift is the authorization server for
// its own MCP endpoint: discovery (RFC 9728, RFC 8414), dynamic client registration (RFC 7591),
// authorization code with PKCE (S256 only, public clients) and rotating refresh tokens. The consent
// page is part of the app (/oauth/authorize), because the login lives in the browser's storage, not
// in a cookie the server could read. A grant is an api_keys entry (storage/oauth.go).
//
// Only with BASE_URL: it is the issuer and the resource, and building them from the Host header
// would let anyone choose them. Off in the demo.

const (
	limitOAuthRegisterPerIP = 20
	oauthMaxRedirectURIs    = 10
)

// Rights offered on the consent page; the narrow "create only" ones stay with ordinary keys.
var oauthOfferedScopes = []string{storage.ScopeTasksRead, storage.ScopeTasksWrite, storage.ScopeListsRead, storage.ScopeListsWrite,
	storage.ScopeNotesRead, storage.ScopeNotesCreate, storage.ScopeNotesWrite, storage.ScopeTriage, storage.ScopeInboxRead,
	storage.ScopeInboxWrite}

// Preselected when the client asks for nothing in particular (claude.ai usually does not)
var oauthDefaultScopes = []string{storage.ScopeTasksRead, storage.ScopeTasksWrite, storage.ScopeListsRead, storage.ScopeListsWrite}

func (s *Server) oauthEnabled() bool { return s.cfg.BaseURLSet && !s.cfg.DemoMode && s.mcpEnabled() }

func (s *Server) oauthIssuer() string { return strings.TrimRight(s.cfg.BaseURL, "/") }

func (s *Server) oauthResource() string { return s.oauthIssuer() + mcpPath }

func (s *Server) oauthResourceMetadataURL() string {
	return s.oauthIssuer() + "/.well-known/oauth-protected-resource"
}

// oauthOnly answers 404 while OAuth is off, as if the endpoint did not exist.
func (s *Server) oauthOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.oauthEnabled() {
			http.NotFound(w, r)
			return
		}
		next(w, r)
	}
}

// writeOAuthError: error body of the OAuth endpoints (RFC 6749 5.2), in English like MCP
func writeOAuthError(w http.ResponseWriter, status int, code, description string) {
	writeJSON(w, status, map[string]string{"error": code, "error_description": i18n.T("en", description)})
}

func (s *Server) handleOAuthProtectedResource(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"resource":                 s.oauthResource(),
		"authorization_servers":    []string{s.oauthIssuer()},
		"scopes_supported":         oauthOfferedScopes,
		"bearer_methods_supported": []string{"header"},
		"resource_name":            "MindSift",
	})
}

func (s *Server) handleOAuthServerMetadata(w http.ResponseWriter, r *http.Request) {
	issuer := s.oauthIssuer()
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                         issuer,
		"authorization_endpoint":                         issuer + "/oauth/authorize",
		"token_endpoint":                                 issuer + "/oauth/token",
		"registration_endpoint":                          issuer + "/oauth/register",
		"revocation_endpoint":                            issuer + "/oauth/revoke",
		"response_types_supported":                       []string{"code"},
		"grant_types_supported":                          []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":               []string{"S256"},
		"token_endpoint_auth_methods_supported":          []string{"none"},
		"revocation_endpoint_auth_methods_supported":     []string{"none"},
		"scopes_supported":                               oauthOfferedScopes,
		"authorization_response_iss_parameter_supported": true,
	})
}

// validRedirectURI: https anywhere, plain http only back to this computer (desktop clients); no
// fragment (RFC 6749 3.1.2).
func validRedirectURI(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Fragment != "" || u.User != nil {
		return false
	}
	switch u.Scheme {
	case "https":
		return true
	case "http":
		h := u.Hostname()
		return h == "localhost" || h == "127.0.0.1" || h == "::1"
	}
	return false
}

// handleOAuthRegister: POST /oauth/register (RFC 7591). Every client is public and authenticates
// with PKCE only, so a requested client secret method is answered with "none".
func (s *Server) handleOAuthRegister(w http.ResponseWriter, r *http.Request) {
	if wait := s.loginGuard.throttle("oauth-register", clientIPFrom(r), limitOAuthRegisterPerIP); wait > 0 {
		writeThrottled(w, wait)
		return
	}
	var req struct {
		ClientName   string   `json:"client_name"`
		RedirectURIs []string `json:"redirect_uris"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "Ungültiges JSON")
		return
	}
	if len(req.RedirectURIs) == 0 || len(req.RedirectURIs) > oauthMaxRedirectURIs {
		writeOAuthError(w, http.StatusBadRequest, "invalid_redirect_uri", "redirect_uris fehlt oder enthält zu viele Einträge")
		return
	}
	for _, u := range req.RedirectURIs {
		if !validRedirectURI(u) {
			writeOAuthError(w, http.StatusBadRequest, "invalid_redirect_uri", "Nur https oder http://localhost erlaubt: "+u)
			return
		}
	}
	client, err := s.store.CreateOAuthClient(req.ClientName, req.RedirectURIs, time.Now())
	if err != nil {
		writeOAuthError(w, http.StatusInternalServerError, "server_error", clientMessage(err))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"client_id":                  client.ID,
		"client_id_issued_at":        time.Now().Unix(),
		"client_name":                client.Name,
		"redirect_uris":              client.RedirectURIs,
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
	})
}

// oauthAuthorizeParams: the query of /oauth/authorize, handed on by the consent page
type oauthAuthorizeParams struct {
	ResponseType        string `json:"responseType"`
	ClientID            string `json:"clientId"`
	RedirectURI         string `json:"redirectUri"`
	CodeChallenge       string `json:"codeChallenge"`
	CodeChallengeMethod string `json:"codeChallengeMethod"`
	State               string `json:"state"`
	Scope               string `json:"scope"`
	Resource            string `json:"resource"`
}

func oauthParamsFromQuery(q url.Values) oauthAuthorizeParams {
	return oauthAuthorizeParams{
		ResponseType:        q.Get("response_type"),
		ClientID:            q.Get("client_id"),
		RedirectURI:         q.Get("redirect_uri"),
		CodeChallenge:       q.Get("code_challenge"),
		CodeChallengeMethod: q.Get("code_challenge_method"),
		State:               q.Get("state"),
		Scope:               q.Get("scope"),
		Resource:            q.Get("resource"),
	}
}

var errOAuthNoRedirect = errors.New("Die Anwendung oder ihre Rücksprungadresse ist MindSift nicht bekannt. Bitte starte die Verbindung in der Anwendung neu.")

// checkAuthorize validates an authorization request. Without a known client and redirect URI there is
// nowhere safe to send the person back (err); every other problem goes back to the client as
// errRedirect (RFC 6749 4.1.2.1).
func (s *Server) checkAuthorize(p oauthAuthorizeParams) (client *storage.OAuthClient, errRedirect string, err error) {
	client, err = s.store.GetOAuthClient(p.ClientID)
	if err != nil {
		return nil, "", errOAuthNoRedirect
	}
	known := false
	for _, u := range client.RedirectURIs {
		known = known || u == p.RedirectURI
	}
	if !known {
		return nil, "", errOAuthNoRedirect
	}
	switch {
	case p.ResponseType != "code":
		return client, s.oauthRedirect(p, url.Values{"error": {"unsupported_response_type"}}), nil
	case p.CodeChallenge == "" || p.CodeChallengeMethod != "S256":
		return client, s.oauthRedirect(p, url.Values{"error": {"invalid_request"}, "error_description": {i18n.T("en", "PKCE (S256) ist erforderlich")}}), nil
	case p.Resource != "" && strings.TrimRight(p.Resource, "/") != s.oauthResource() && strings.TrimRight(p.Resource, "/") != s.oauthIssuer():
		return client, s.oauthRedirect(p, url.Values{"error": {"invalid_target"}}), nil
	}
	return client, "", nil
}

// oauthRedirect: the client's redirect URI with the answer, its state and the issuer (RFC 9207)
func (s *Server) oauthRedirect(p oauthAuthorizeParams, values url.Values) string {
	u, _ := url.Parse(p.RedirectURI)
	q := u.Query()
	for k, v := range values {
		q[k] = v
	}
	if p.State != "" {
		q.Set("state", p.State)
	}
	q.Set("iss", s.oauthIssuer())
	u.RawQuery = q.Encode()
	return u.String()
}

// oauthScopes keeps the offered rights out of a list, in display order.
func oauthScopes(requested []string) []string {
	want := map[string]bool{}
	for _, sc := range requested {
		want[strings.TrimSpace(sc)] = true
	}
	out := []string{}
	for _, sc := range oauthOfferedScopes {
		if want[sc] {
			out = append(out, sc)
		}
	}
	return out
}

// knownOAuthHosts: where the AI services MindSift is usually connected to send people back, and the
// person's own computer (local agents). Anybody may register a client (RFC 7591, needed by claude.ai and
// ChatGPT) under any name, so the consent page warns when the way back leads somewhere else.
var knownOAuthHosts = []string{"claude.ai", "claude.com", "anthropic.com", "chatgpt.com", "openai.com", "localhost", "127.0.0.1", "::1"}

func knownRedirectHost(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	for _, known := range knownOAuthHosts {
		if host == known || strings.HasSuffix(host, "."+known) {
			return true
		}
	}
	return false
}

func redirectHost(raw string) string {
	if u, err := url.Parse(raw); err == nil {
		return u.Host
	}
	return raw
}

// handleOAuthAuthorizeInfo: GET /api/v1/oauth/authorize?<query of /oauth/authorize> – what the consent
// page shows. Only for a login (API keys are not allowed here, see keyRoutes).
func (s *Server) handleOAuthAuthorizeInfo(w http.ResponseWriter, r *http.Request) {
	p := oauthParamsFromQuery(r.URL.Query())
	client, errRedirect, err := s.checkAuthorize(p)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errRedirect != "" {
		writeJSON(w, http.StatusOK, map[string]string{"redirect": errRedirect})
		return
	}
	scopes := oauthScopes(strings.Fields(p.Scope))
	if len(scopes) == 0 {
		scopes = oauthDefaultScopes
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"clientName":    client.Name,
		"redirectHost":  redirectHost(p.RedirectURI),
		"knownHost":     knownRedirectHost(p.RedirectURI),
		"scopes":        scopes,
		"offeredScopes": oauthOfferedScopes,
	})
}

// handleOAuthAuthorize: POST /api/v1/oauth/authorize – the person allows (with the chosen rights) or
// refuses; the answer is the URL the consent page sends the browser to.
func (s *Server) handleOAuthAuthorize(w http.ResponseWriter, r *http.Request) {
	var req struct {
		oauthAuthorizeParams
		Approve bool     `json:"approve"`
		Scopes  []string `json:"scopes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	p := req.oauthAuthorizeParams
	client, errRedirect, err := s.checkAuthorize(p)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errRedirect != "" {
		writeJSON(w, http.StatusOK, map[string]string{"redirect": errRedirect})
		return
	}
	if !req.Approve {
		writeJSON(w, http.StatusOK, map[string]string{"redirect": s.oauthRedirect(p, url.Values{"error": {"access_denied"}})})
		return
	}
	scopes := oauthScopes(req.Scopes)
	if len(scopes) == 0 {
		writeError(w, http.StatusBadRequest, "Wähle mindestens ein Recht aus.")
		return
	}
	code, err := s.store.GrantOAuth(auth.GetUserID(r.Context()), client, scopes, p.RedirectURI, p.CodeChallenge, time.Now())
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"redirect": s.oauthRedirect(p, url.Values{"code": {code}})})
}

// oauthClientID: public clients send client_id in the form; some use HTTP Basic with an empty secret.
func oauthClientID(r *http.Request) string {
	if id := r.PostForm.Get("client_id"); id != "" {
		return id
	}
	id, _, _ := r.BasicAuth()
	return id
}

// handleOAuthToken: POST /oauth/token (form-encoded) – authorization_code and refresh_token.
func (s *Server) handleOAuthToken(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request", "Ungültige Anfrage")
		return
	}
	clientID := oauthClientID(r)
	var tokens *storage.OAuthTokens
	var err error
	switch r.PostForm.Get("grant_type") {
	case "authorization_code":
		tokens, err = s.store.ExchangeOAuthCode(r.PostForm.Get("code"), clientID, r.PostForm.Get("redirect_uri"),
			r.PostForm.Get("code_verifier"), time.Now())
	case "refresh_token":
		tokens, err = s.store.RefreshOAuth(r.PostForm.Get("refresh_token"), clientID, time.Now())
	default:
		writeOAuthError(w, http.StatusBadRequest, "unsupported_grant_type", "Nur authorization_code und refresh_token")
		return
	}
	if errors.Is(err, storage.ErrOAuthInvalidGrant) {
		writeOAuthError(w, http.StatusBadRequest, "invalid_grant", "Code oder Token ungültig, abgelaufen oder widerrufen")
		return
	}
	if err != nil {
		writeOAuthError(w, http.StatusInternalServerError, "server_error", clientMessage(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token":  tokens.AccessToken,
		"token_type":    "Bearer",
		"expires_in":    tokens.ExpiresIn,
		"refresh_token": tokens.RefreshToken,
		"scope":         strings.Join(tokens.Scopes, " "),
	})
}

// handleOAuthRevoke: POST /oauth/revoke (RFC 7009); answers 200 even for unknown tokens, and 503 when
// the token could not be removed (it still works then, the client should try again).
func (s *Server) handleOAuthRevoke(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request", "Ungültige Anfrage")
		return
	}
	if err := s.store.RevokeOAuthToken(r.PostForm.Get("token"), oauthClientID(r)); err != nil {
		writeOAuthError(w, http.StatusServiceUnavailable, "server_error", clientMessage(err))
		return
	}
	w.WriteHeader(http.StatusOK)
}

// runOAuthCleanup: expired codes and tokens, abandoned registrations and – after OAUTH_IDLE_DAYS –
// connections nobody used.
func (s *Server) runOAuthCleanup(now time.Time) {
	n, err := s.store.PurgeOAuth(now, s.cfg.OAuthIdleDays)
	if err != nil {
		slog.Error("Cleaning up OAuth grants failed", "error", err)
		return
	}
	if n > 0 {
		slog.Info("Unused OAuth grants removed", "count", n, "idle_days", s.cfg.OAuthIdleDays)
	}
}
