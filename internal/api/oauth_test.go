package api

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

const oauthTestRedirect = "https://claude.ai/api/mcp/auth_callback"

// oauthDo sends one request and returns status, headers and the decoded JSON body.
func oauthDo(t *testing.T, router http.Handler, method, path, bearer, contentType, body string) (int, http.Header, map[string]interface{}) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var out map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, rec.Header(), out
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// The whole connection as claude.ai makes it: discovery, registration, consent, code, MCP, refresh.
func TestOAuthFlowForMCP(t *testing.T) {
	srv, store, session := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, session)
	const jsonType = "application/json"
	const formType = "application/x-www-form-urlencoded"

	// Without BASE_URL there is no OAuth at all
	if code, _, _ := oauthDo(t, router, http.MethodGet, "/.well-known/oauth-protected-resource", "", "", ""); code != http.StatusNotFound {
		t.Fatalf("OAuth must be off without BASE_URL, got %d", code)
	}
	if _, h, _ := oauthDo(t, router, http.MethodPost, mcpPath, "", jsonType, `{}`); h.Get("WWW-Authenticate") != "" {
		t.Fatalf("no OAuth hint without BASE_URL, got %q", h.Get("WWW-Authenticate"))
	}

	srv.cfg.BaseURL = "https://ms.example/"
	srv.cfg.BaseURLSet = true
	router = srv.Router()

	code, h, _ := oauthDo(t, router, http.MethodPost, mcpPath, "", jsonType, `{}`)
	if code != http.StatusUnauthorized || !strings.Contains(h.Get("WWW-Authenticate"), `resource_metadata="https://ms.example/.well-known/oauth-protected-resource"`) {
		t.Fatalf("MCP without token should point to the metadata: %d %q", code, h.Get("WWW-Authenticate"))
	}
	_, _, meta := oauthDo(t, router, http.MethodGet, "/.well-known/oauth-protected-resource/api/v1/mcp", "", "", "")
	if meta["resource"] != "https://ms.example/api/v1/mcp" {
		t.Fatalf("resource metadata: %v", meta)
	}
	_, _, meta = oauthDo(t, router, http.MethodGet, "/.well-known/oauth-authorization-server", "", "", "")
	if meta["issuer"] != "https://ms.example" || meta["token_endpoint"] != "https://ms.example/oauth/token" {
		t.Fatalf("server metadata: %v", meta)
	}

	// Registration: only https or loopback
	if code, _, _ := oauthDo(t, router, http.MethodPost, "/oauth/register", "", jsonType, `{"client_name":"X","redirect_uris":["http://evil.example/cb"]}`); code != http.StatusBadRequest {
		t.Fatalf("plain http redirect must be refused, got %d", code)
	}
	code, _, reg := oauthDo(t, router, http.MethodPost, "/oauth/register", "", jsonType, `{"client_name":"Claude","redirect_uris":["`+oauthTestRedirect+`"],"token_endpoint_auth_method":"client_secret_post"}`)
	if code != http.StatusCreated || reg["token_endpoint_auth_method"] != "none" {
		t.Fatalf("register: %d %v", code, reg)
	}
	clientID := reg["client_id"].(string)

	verifier := strings.Repeat("v", 50)
	params := func(redirect, challenge string) url.Values {
		return url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {redirect},
			"code_challenge": {challenge}, "code_challenge_method": {"S256"}, "state": {"st8"}, "resource": {"https://ms.example/api/v1/mcp"}}
	}

	// Consent page info: unknown redirect is an error shown on the page, never a redirect
	if code, _, _ := oauthDo(t, router, http.MethodGet, "/api/v1/oauth/authorize?"+params("https://evil.example/cb", pkceChallenge(verifier)).Encode(), session, "", ""); code != http.StatusBadRequest {
		t.Fatalf("unknown redirect_uri must be refused, got %d", code)
	}
	_, _, info := oauthDo(t, router, http.MethodGet, "/api/v1/oauth/authorize?"+params(oauthTestRedirect, "").Encode(), session, "", "")
	if r, _ := info["redirect"].(string); !strings.Contains(r, "error=invalid_request") {
		t.Fatalf("missing PKCE must go back as invalid_request: %v", info)
	}
	_, _, info = oauthDo(t, router, http.MethodGet, "/api/v1/oauth/authorize?"+params(oauthTestRedirect, pkceChallenge(verifier)).Encode(), session, "", "")
	if info["clientName"] != "Claude" || info["redirectHost"] != "claude.ai" || len(info["scopes"].([]interface{})) != 4 {
		t.Fatalf("consent info: %v", info)
	}
	// API keys cannot agree on anyone's behalf
	key, _ := store.CreateAPIKey(claims.UserID, "Skript", []string{"tasks:read"})
	if code, _, _ := oauthDo(t, router, http.MethodGet, "/api/v1/oauth/authorize?"+params(oauthTestRedirect, pkceChallenge(verifier)).Encode(), key.RawKey, "", ""); code != http.StatusForbidden {
		t.Fatalf("API key must not reach the consent endpoint, got %d", code)
	}

	consent := func(approve bool, scopes string) string {
		t.Helper()
		body := `{"responseType":"code","clientId":"` + clientID + `","redirectUri":"` + oauthTestRedirect + `","codeChallenge":"` +
			pkceChallenge(verifier) + `","codeChallengeMethod":"S256","state":"st8","approve":` + map[bool]string{true: "true", false: "false"}[approve] +
			`,"scopes":` + scopes + `}`
		code, _, out := oauthDo(t, router, http.MethodPost, "/api/v1/oauth/authorize", session, jsonType, body)
		if code != http.StatusOK {
			t.Fatalf("consent: %d %v", code, out)
		}
		return out["redirect"].(string)
	}
	if r := consent(false, `[]`); !strings.Contains(r, "error=access_denied") || !strings.Contains(r, "state=st8") {
		t.Fatalf("refusing should report access_denied with state: %s", r)
	}
	codeOf := func(redirect string) string {
		u, _ := url.Parse(redirect)
		if u.Query().Get("state") != "st8" || u.Query().Get("iss") != "https://ms.example" {
			t.Fatalf("redirect lacks state or iss: %s", redirect)
		}
		return u.Query().Get("code")
	}
	token := func(form url.Values) (int, map[string]interface{}) {
		code, _, out := oauthDo(t, router, http.MethodPost, "/oauth/token", "", formType, form.Encode())
		return code, out
	}
	exchange := func(code, redirect, verifier string) url.Values {
		return url.Values{"grant_type": {"authorization_code"}, "code": {code}, "client_id": {clientID}, "redirect_uri": {redirect}, "code_verifier": {verifier}}
	}

	// A wrong verifier uses the code up
	c1 := codeOf(consent(true, `["tasks:read"]`))
	if code, out := token(exchange(c1, oauthTestRedirect, strings.Repeat("w", 50))); code != http.StatusBadRequest || out["error"] != "invalid_grant" {
		t.Fatalf("wrong verifier: %d %v", code, out)
	}
	if code, _ := token(exchange(c1, oauthTestRedirect, verifier)); code != http.StatusBadRequest {
		t.Fatalf("a code works only once, got %d", code)
	}
	c2 := codeOf(consent(true, `["tasks:read"]`))
	if code, _ := token(exchange(c2, "https://claude.ai/other", verifier)); code != http.StatusBadRequest {
		t.Fatalf("redirect_uri must match the code's, got %d", code)
	}
	c3 := codeOf(consent(true, `["tasks:read"]`))
	code, tok := token(exchange(c3, oauthTestRedirect, verifier))
	if code != http.StatusOK || tok["scope"] != "tasks:read" || tok["token_type"] != "Bearer" {
		t.Fatalf("token: %d %v", code, tok)
	}
	access, refresh := tok["access_token"].(string), tok["refresh_token"].(string)

	// The access token works at MCP with exactly the agreed rights, and nowhere else
	_, res := rpc(t, router, access, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	names := strings.Join(toolNames(res), ",")
	if !strings.Contains(names, "list_tasks") || strings.Contains(names, "complete_task") || strings.Contains(names, "get_list") {
		t.Fatalf("tools for tasks:read: %s", names)
	}
	if code, _, _ := oauthDo(t, router, http.MethodGet, "/api/v1/tasks", access, "", ""); code != http.StatusForbidden {
		t.Fatalf("OAuth token must not reach REST, got %d", code)
	}
	if code, _, _ := oauthDo(t, router, http.MethodPost, "/api/v1/webhooks/ingest", access, jsonType, `{"content":"x"}`); code != http.StatusUnauthorized {
		t.Fatalf("OAuth token must not deliver webhooks, got %d", code)
	}

	// Agent changes carry the connection's name, which is listed among the keys; agreeing again
	// does not add a second entry
	_, res = rpc(t, router, access, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_tasks","arguments":{}}}`)
	if _, isErr := callResult(t, res); isErr {
		t.Fatalf("list_tasks via OAuth: %v", res)
	}
	codeOf(consent(true, `["tasks:read","lists:read"]`))
	keys, _ := store.GetAPIKeys(claims.UserID)
	var grant *domain.APIKey
	for i := range keys {
		if keys[i].Kind == "oauth" {
			if grant != nil {
				t.Fatalf("consenting again must reuse the entry: %v", keys)
			}
			grant = &keys[i]
		}
	}
	if grant == nil || grant.Name != "Claude (OAuth)" || grant.Scopes != "tasks:read,lists:read" || grant.LastUsedAt == "" {
		t.Fatalf("OAuth entry: %+v", grant)
	}

	// Refresh rotates; the old refresh token used again ends the whole connection
	code, tok2 := token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {clientID}})
	if code != http.StatusOK || tok2["scope"] != "tasks:read lists:read" {
		t.Fatalf("refresh: %d %v", code, tok2)
	}
	access2 := tok2["access_token"].(string)
	if code, _ := rpc(t, router, access2, `{"jsonrpc":"2.0","id":3,"method":"tools/list"}`); code != http.StatusOK {
		t.Fatalf("refreshed access token: %d", code)
	}
	if code, _ := token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {clientID}}); code != http.StatusBadRequest {
		t.Fatalf("reused refresh token must fail, got %d", code)
	}
	if code, _ := rpc(t, router, access2, `{"jsonrpc":"2.0","id":4,"method":"tools/list"}`); code != http.StatusUnauthorized {
		t.Fatalf("reuse must end every token of the connection, got %d", code)
	}

	// Removing the entry in the settings ends a fresh connection right away
	c4 := codeOf(consent(true, `["tasks:read"]`))
	_, tok3 := token(exchange(c4, oauthTestRedirect, verifier))
	access3 := tok3["access_token"].(string)
	if code, _, _ := oauthDo(t, router, http.MethodDelete, "/api/v1/keys/"+grant.ID, session, "", ""); code != http.StatusOK {
		t.Fatalf("delete entry: %d", code)
	}
	if code, _ := rpc(t, router, access3, `{"jsonrpc":"2.0","id":5,"method":"tools/list"}`); code != http.StatusUnauthorized {
		t.Fatalf("revoked connection must stop working, got %d", code)
	}

	// The demo has no OAuth
	srv.cfg.DemoMode = true
	if code, _, _ := oauthDo(t, srv.Router(), http.MethodPost, "/oauth/register", "", jsonType, `{"redirect_uris":["`+oauthTestRedirect+`"]}`); code != http.StatusNotFound {
		t.Fatalf("OAuth must be off in the demo, got %d", code)
	}
}
