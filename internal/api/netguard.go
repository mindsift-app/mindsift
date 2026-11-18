package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Outgoing alarm requests (Discord, custom webhooks) go to user-supplied URLs. Without checks a user
// could make the server call internal services (SSRF): localhost, the Docker network or cloud metadata.

var errBlockedTarget = errors.New("Ziel nicht erlaubt: interne oder reservierte Adresse")

func mustCIDRs(list ...string) []*net.IPNet {
	out := make([]*net.IPNet, 0, len(list))
	for _, c := range list {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			panic(err)
		}
		out = append(out, n)
	}
	return out
}

var (
	// Never reachable: this machine, link-local incl. cloud metadata (169.254.169.254), "this network"
	alwaysBlocked = mustCIDRs("127.0.0.0/8", "::1/128", "169.254.0.0/16", "fe80::/10", "0.0.0.0/8", "::/128")
	// Home/LAN ranges (incl. CGNAT as used by Tailscale), only with the admin switch
	// "Ziele im lokalen Netz erlauben"
	privateRanges = mustCIDRs("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7", "100.64.0.0/10")
)

func targetIPAllowed(ip net.IP, allowPrivate bool) bool {
	if ip == nil || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	for _, n := range alwaysBlocked {
		if n.Contains(ip) {
			return false
		}
	}
	if !allowPrivate {
		for _, n := range privateRanges {
			if n.Contains(ip) {
				return false
			}
		}
	}
	return true
}

// validateWebhookURL checks a URL before it is stored or called. HTTPS is required unless the admin
// allows local targets (LAN services often speak plain HTTP). Discord URLs must point to Discord.
func validateWebhookURL(raw string, discord, allowPrivate bool) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return errors.New("Ungültige URL")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !allowPrivate {
			return errors.New("Nur https-URLs sind erlaubt (http nur mit freigegebenen Zielen im lokalen Netz)")
		}
	default:
		return errors.New("Nur https-URLs sind erlaubt")
	}
	if discord {
		host := strings.ToLower(u.Hostname())
		if u.Scheme != "https" || (host != "discord.com" && host != "discordapp.com") || !strings.HasPrefix(u.Path, "/api/webhooks/") {
			return errors.New("Discord-Webhooks müssen mit https://discord.com/api/webhooks/ beginnen")
		}
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil && !targetIPAllowed(ip, allowPrivate) {
		return errBlockedTarget
	}
	return nil
}

// guardedClient resolves the host itself and only connects to allowed addresses. Checking at dial time
// (not just the URL) also covers DNS tricks and redirects.
//
// With HTTP_PROXY / HTTPS_PROXY (and NO_PROXY) set, requests go through that proxy, which then resolves and
// connects itself. So before a request is handed to it, the target host is resolved here and refused when
// any of its addresses is not allowed (guardedProxy); the connection to the proxy itself is the operator's
// choice and not checked. What is left (Doku/security.md): the proxy may resolve the name differently
// (another DNS view, a record changed in between), and a name this server cannot resolve is refused.
//
// Proxied and direct requests use separate transports: the proxy's address may only be dialled as the proxy
// hop, never as a direct target. Otherwise a target that bypasses the proxy (localhost, NO_PROXY) and names
// the proxy's own host and port, e.g. https://localhost:3128/ with a proxy on localhost:3128, would get past
// the address check.
func guardedClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	newTransport := func(dial func(ctx context.Context, network, addr string) (net.Conn, error)) *http.Transport {
		return &http.Transport{
			DialContext:           dial,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxIdleConns:          10,
		}
	}
	direct := newTransport(func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if targetIPAllowed(ip.IP, allowPrivate) {
				return dialer.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
			}
		}
		return nil, fmt.Errorf("%w (%s)", errBlockedTarget, host)
	})
	var transport http.RoundTripper = direct
	if proxy, proxyAddrs := guardedProxy(allowPrivate); proxy != nil {
		// Only ever dials a proxy from the environment; guardedProxy has checked the target before
		proxied := newTransport(func(ctx context.Context, network, addr string) (net.Conn, error) {
			if !proxyAddrs[addr] {
				return nil, fmt.Errorf("%w (%s)", errBlockedTarget, addr)
			}
			return dialer.DialContext(ctx, network, addr)
		})
		proxied.Proxy = func(req *http.Request) (*url.URL, error) {
			p, err := proxyForRequest(req)
			if err == nil && p == nil {
				err = fmt.Errorf("%w (%s)", errBlockedTarget, req.URL.Host)
			}
			return p, err
		}
		transport = &proxySplitTransport{proxy: proxy, direct: direct, proxied: proxied}
	}
	return &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("zu viele Weiterleitungen")
			}
			// No step down from https to plain http: what was asked for encrypted stays encrypted
			if via[len(via)-1].URL.Scheme == "https" && req.URL.Scheme != "https" {
				return errors.New("Weiterleitung von https auf http abgelehnt")
			}
			return nil
		},
	}
}

// proxySplitTransport sends each request (and so each redirect step) either through the proxy, once
// guardedProxy has checked the target, or straight through the fully guarded direct transport.
type proxySplitTransport struct {
	proxy           func(*http.Request) (*url.URL, error)
	direct, proxied *http.Transport
}

func (t *proxySplitTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	p, err := t.proxy(req)
	if err != nil {
		if req.Body != nil {
			_ = req.Body.Close()
		}
		return nil, err
	}
	if p == nil {
		return t.direct.RoundTrip(req)
	}
	return t.proxied.RoundTrip(req)
}

func (t *proxySplitTransport) CloseIdleConnections() {
	t.direct.CloseIdleConnections()
	t.proxied.CloseIdleConnections()
}

// proxyForRequest: the proxy for a request from HTTP_PROXY, HTTPS_PROXY and NO_PROXY (or their lower-case
// forms), as Go's default transport and so OIDC's client use them; read once per process. A variable for tests.
var proxyForRequest = http.ProxyFromEnvironment

// proxyEnvAddrs: host:port of the proxies in HTTP_PROXY and HTTPS_PROXY. A variable for tests.
var proxyEnvAddrs = func() map[string]bool {
	addrs := map[string]bool{}
	for _, name := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"} {
		if addr := proxyAddr(os.Getenv(name)); addr != "" {
			addrs[addr] = true
		}
	}
	return addrs
}

// guardedProxy returns guardedClient's proxy decision plus the proxies' host:port, which only the transport
// for proxied requests may dial. The function answers nil (no proxy) when none applies to the request (NO_PROXY,
// loopback), and refuses a target whose addresses are not all allowed before the proxy would see it.
func guardedProxy(allowPrivate bool) (func(*http.Request) (*url.URL, error), map[string]bool) {
	addrs := proxyEnvAddrs()
	if len(addrs) == 0 {
		return nil, addrs
	}
	return func(req *http.Request) (*url.URL, error) {
		p, err := proxyForRequest(req)
		if err != nil || p == nil {
			return nil, err
		}
		if err := checkTargetHost(req.Context(), req.URL.Hostname(), allowPrivate); err != nil {
			return nil, err
		}
		return p, nil
	}, addrs
}

// proxyAddr: host:port of a proxy URL as the transport dials it (scheme-less values count as http://, as in
// Go's ProxyFromEnvironment), "" when unset or unusable.
func proxyAddr(raw string) string {
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	port := u.Port()
	if port == "" {
		switch u.Scheme {
		case "https":
			port = "443"
		case "socks5", "socks5h":
			port = "1080"
		default:
			port = "80"
		}
	}
	return net.JoinHostPort(u.Hostname(), port)
}

// checkTargetHost resolves host (or takes the address it is) and refuses it unless every address is allowed:
// through a proxy, which address gets used is the proxy's choice. A name that does not resolve is refused.
func checkTargetHost(ctx context.Context, host string, allowPrivate bool) error {
	if ip := net.ParseIP(host); ip != nil {
		if !targetIPAllowed(ip, allowPrivate) {
			return fmt.Errorf("%w (%s)", errBlockedTarget, host)
		}
		return nil
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return err
	}
	if len(ips) == 0 {
		return fmt.Errorf("%w (%s)", errBlockedTarget, host)
	}
	for _, ip := range ips {
		if !targetIPAllowed(ip.IP, allowPrivate) {
			return fmt.Errorf("%w (%s)", errBlockedTarget, host)
		}
	}
	return nil
}

func (s *Server) allowPrivateWebhooks() bool {
	sys := s.effectiveSettings()
	return sys != nil && sys.AllowPrivateWebhooks
}
