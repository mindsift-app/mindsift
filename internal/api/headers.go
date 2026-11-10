package api

import (
	"net/http"
	"strings"
)

// securityHeaders protects the browser side (FLAW-29):
//   - Content-Security-Policy: scripts only from MindSift itself, so injected markup cannot run code;
//     styles may be inline (custom themes, style attributes); images also from https (avatar URLs);
//     connections only to this server, including its WebSocket.
//   - frame-ancestors 'none' / X-Frame-Options: no embedding in other sites (clickjacking).
//   - nosniff, a same-origin referrer and a permissions policy that only allows the microphone
//     (speech input) for MindSift itself.
//   - Strict-Transport-Security when the visitor came over https (directly, via a trusted proxy, or
//     BASE_URL is https): browsers then never try plain http for a year. Without includeSubDomains, so
//     other services under the same domain are not affected.
func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy(r.Host))
		h.Set("X-Frame-Options", "DENY")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()")
		if s.overHTTPS(r) {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func contentSecurityPolicy(host string) string {
	connect := "'self'"
	// Older Safari versions do not count ws:/wss: as 'self'
	if host != "" && !strings.ContainsAny(host, " ;'\"") {
		connect += " wss://" + host + " ws://" + host
	}
	return strings.Join([]string{
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		"connect-src " + connect,
		"worker-src 'self'",
		"manifest-src 'self'",
		"media-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	}, "; ")
}

// overHTTPS: the visitor's connection is encrypted up to us or up to our reverse proxy.
func (s *Server) overHTTPS(r *http.Request) bool {
	return r.TLS != nil ||
		(clientIPFrom(r).fromProxy && r.Header.Get("X-Forwarded-Proto") == "https") ||
		(s.cfg.BaseURLSet && strings.HasPrefix(strings.ToLower(s.cfg.BaseURL), "https://"))
}
