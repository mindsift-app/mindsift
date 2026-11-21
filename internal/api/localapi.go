package api

import (
	"net"
	"net/http"
	"strings"
)

// The desktop app can make its open instance reachable for programs on the same computer (an AI agent's
// MCP client, a script): it then also listens on 127.0.0.1 (desktop/internal/shell/localapi.go), with the
// server's own router behind LocalAPIOnly. That listener is for API keys and nothing else: the routes an API
// key may call (keyRoutes, the MCP endpoint, the webhook delivery), each request carrying a key and no other
// credential, so a session can neither be started (no /auth/*) nor used there, and the app's pages are not
// served. Rights are then checked as on every server (authMiddleware, apiKeyRouteDenied, the MCP tools).

// LocalAPIOnly guards the desktop app's listener for local programs (see above). Refused:
//   - a Host other than 127.0.0.1 or localhost (a site whose name resolves to 127.0.0.1, DNS rebinding);
//   - any request from a browser page (Origin or Sec-Fetch-Site set): there is no CORS on this listener;
//   - a route an API key cannot call (404, as if it did not exist);
//   - a request without an API key, or with a session token anywhere (401).
func LocalAPIOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !loopbackHost(r.Host) {
			writeError(w, http.StatusMisdirectedRequest, "Nur über 127.0.0.1 oder localhost erreichbar")
			return
		}
		if r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" {
			writeError(w, http.StatusForbidden, "Für Browser nicht erreichbar")
			return
		}
		if !localAPIRoute(r) {
			writeError(w, http.StatusNotFound, "Nicht gefunden")
			return
		}
		if !onlyAPIKeys(r) {
			writeError(w, http.StatusUnauthorized, "Nur mit einem API-Schlüssel erreichbar")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// loopbackHost: the Host header names this computer's loopback address (with or without a port)
func loopbackHost(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	return host == "127.0.0.1" || strings.EqualFold(host, "localhost")
}

// localAPIRoute: what an API key can reach at all; the MCP endpoint with every method (GET and DELETE
// answer as on a server) and the webhook delivery, which checks its key itself
func localAPIRoute(r *http.Request) bool {
	return r.URL.Path == mcpPath ||
		(r.Method == http.MethodPost && r.URL.Path == "/api/v1/webhooks/ingest") ||
		findKeyRoute(r) != nil
}

// onlyAPIKeys: the request carries an API key, and every credential it carries is one (Authorization,
// X-API-Key, and the webhook delivery's ?token=)
func onlyAPIKeys(r *http.Request) bool {
	creds := []string{r.Header.Get("X-API-Key"), r.URL.Query().Get("token")}
	if a := r.Header.Get("Authorization"); a != "" {
		bearer, ok := strings.CutPrefix(a, "Bearer ")
		if !ok {
			return false
		}
		creds = append(creds, bearer)
	}
	found := false
	for _, c := range creds {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if !strings.HasPrefix(c, "mindsift_sec_") {
			return false
		}
		found = true
	}
	return found
}
