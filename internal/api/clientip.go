package api

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
)

// Client IP behind a reverse proxy. The proxy connects to MindSift and passes the visitor's address in
// X-Forwarded-For / X-Real-IP. Those headers are only believed when the connection comes from a trusted
// proxy (TRUSTED_PROXIES), otherwise anyone reaching the port directly could claim any address and dodge
// the login protection.
//   private (default)  loopback and private networks (Docker, LAN, CGNAT/Tailscale)
//   all                always believe the headers (old behaviour, switches the check off)
//   none               never believe them
//   CIDR list          e.g. "private,203.0.113.0/24"; Cloudflare and other external proxies go here

type clientIPKey struct{}

type clientIPInfo struct {
	ip string
	// viaProxyWithoutHeader: the connection came from a trusted proxy that did not say who the
	// visitor is, so all visitors look the same. Per-IP limits must not apply then.
	viaProxyWithoutHeader bool
	// fromProxy: the connection came from a trusted proxy, so its X-Forwarded-* headers count
	fromProxy bool
}

type proxyTrust struct {
	all      bool
	networks []*net.IPNet
}

var privateProxyNets = mustCIDRs("127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7", "100.64.0.0/10")

func parseProxyTrust(spec string) proxyTrust {
	spec = strings.ToLower(strings.TrimSpace(spec))
	if spec == "" {
		spec = "private"
	}
	var t proxyTrust
	for _, part := range strings.Split(spec, ",") {
		switch part = strings.TrimSpace(part); part {
		case "", "none":
		case "all", "*":
			t.all = true
		case "private":
			t.networks = append(t.networks, privateProxyNets...)
		default:
			if !strings.Contains(part, "/") {
				if strings.Contains(part, ":") {
					part += "/128"
				} else {
					part += "/32"
				}
			}
			if _, n, err := net.ParseCIDR(part); err == nil {
				t.networks = append(t.networks, n)
			} else {
				slog.Warn("TRUSTED_PROXIES: entry ignored", "entry", part)
			}
		}
	}
	return t
}

func (t proxyTrust) trusts(ip net.IP) bool {
	if t.all {
		return true
	}
	for _, n := range t.networks {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func peerIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

// resolveClientIP returns the visitor's address for a request coming from peer.
func (t proxyTrust) resolveClientIP(peer string, h http.Header) clientIPInfo {
	peerAddr := net.ParseIP(peer)
	if peerAddr == nil || !t.trusts(peerAddr) {
		return clientIPInfo{ip: peer}
	}
	info := t.clientBehindProxy(peer, peerAddr, h)
	info.fromProxy = true
	return info
}

func (t proxyTrust) clientBehindProxy(peer string, peerAddr net.IP, h http.Header) clientIPInfo {
	// X-Forwarded-For: client, proxy1, proxy2 – the visitor is the right-most address that is not one of
	// our proxies (everything left of it could be made up by the visitor)
	if xff := h.Get("X-Forwarded-For"); xff != "" {
		var chain []net.IP
		for _, part := range strings.Split(xff, ",") {
			if ip := net.ParseIP(strings.TrimSpace(part)); ip != nil {
				chain = append(chain, ip)
			}
		}
		if len(chain) > 0 {
			if t.all {
				return clientIPInfo{ip: chain[0].String()} // former behaviour: first address counts
			}
			for i := len(chain) - 1; i >= 0; i-- {
				if !t.trusts(chain[i]) {
					return clientIPInfo{ip: chain[i].String()}
				}
			}
			return clientIPInfo{ip: chain[0].String()} // only proxies in the chain: the visitor is in our network
		}
	}
	for _, name := range []string{"X-Real-IP", "True-Client-IP", "CF-Connecting-IP"} {
		if ip := net.ParseIP(strings.TrimSpace(h.Get(name))); ip != nil {
			return clientIPInfo{ip: ip.String()}
		}
	}
	return clientIPInfo{ip: peer, viaProxyWithoutHeader: !peerAddr.IsLoopback()}
}

var warnProxyHeaderOnce sync.Once

// clientIPMiddleware replaces chi's RealIP: r.RemoteAddr becomes the visitor's address.
func (s *Server) clientIPMiddleware(next http.Handler) http.Handler {
	trust := parseProxyTrust(s.cfg.TrustedProxies)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := trust.resolveClientIP(peerIP(r.RemoteAddr), r.Header)
		if info.viaProxyWithoutHeader {
			warnProxyHeaderOnce.Do(func() {
				slog.Warn("Reverse proxy passes no client IP (X-Forwarded-For/X-Real-IP missing); per-IP sign-in locks are off for these requests", "proxy", info.ip)
			})
		}
		r.RemoteAddr = info.ip
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientIPKey{}, info)))
	})
}

func clientIPFrom(r *http.Request) clientIPInfo {
	if info, ok := r.Context().Value(clientIPKey{}).(clientIPInfo); ok {
		return info
	}
	return clientIPInfo{ip: peerIP(r.RemoteAddr)}
}

// hostPattern: what a host name or address with port may look like in a link
var hostPattern = regexp.MustCompile(`^[A-Za-z0-9.\-:\[\]]+$`)

// requestOrigin is the address the visitor used ("https://notes.example.com"), for links and page
// metadata when BASE_URL is not set. X-Forwarded-Proto and -Host only count from a trusted proxy; a host
// that does not look like one gives "".
func requestOrigin(r *http.Request) string {
	fromProxy := clientIPFrom(r).fromProxy
	scheme := "http"
	if r.TLS != nil || (fromProxy && r.Header.Get("X-Forwarded-Proto") == "https") {
		scheme = "https"
	}
	host := r.Host
	if fwd := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); fromProxy && fwd != "" {
		host = fwd
	}
	if !hostPattern.MatchString(host) {
		return ""
	}
	return scheme + "://" + host
}
