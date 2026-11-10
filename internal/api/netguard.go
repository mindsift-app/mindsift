package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
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
// (not just the URL) also covers DNS tricks and redirects; proxies from the environment are not used.
func guardedClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
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
		},
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		MaxIdleConns:          10,
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

func (s *Server) allowPrivateWebhooks() bool {
	sys, _ := s.store.GetSystemSettings()
	return sys != nil && sys.AllowPrivateWebhooks
}
