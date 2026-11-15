package api

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
)

// fakeProxy answers every proxied request itself and remembers which URLs it was asked for.
func fakeProxy(t *testing.T) (*httptest.Server, func() []string) {
	t.Helper()
	var mu sync.Mutex
	var seen []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.URL.String())
		mu.Unlock()
		_, _ = io.WriteString(w, "über den Proxy")
	}))
	t.Cleanup(ts.Close)
	return ts, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
}

// useProxy stands in for HTTP_PROXY/HTTPS_PROXY=proxyURL with NO_PROXY=noProxy (Go reads the environment
// only once per process, so the test sets what it would find): loopback and noProxy hosts go direct.
func useProxy(t *testing.T, proxyURL string, noProxy ...string) {
	t.Helper()
	oldFor, oldAddrs := proxyForRequest, proxyEnvAddrs
	t.Cleanup(func() { proxyForRequest, proxyEnvAddrs = oldFor, oldAddrs })
	p, _ := url.Parse(proxyURL)
	proxyEnvAddrs = func() map[string]bool { return map[string]bool{proxyAddr(proxyURL): true} }
	proxyForRequest = func(r *http.Request) (*url.URL, error) {
		host := r.URL.Hostname()
		if ip := net.ParseIP(host); host == "localhost" || (ip != nil && ip.IsLoopback()) || slices.Contains(noProxy, host) {
			return nil, nil
		}
		return p, nil
	}
}

// With a proxy set the guarded client goes through it (the proxy may sit in the local network), but only
// for targets whose addresses are allowed: the check happens here, before the proxy sees the request
func TestGuardedClientUsesProxyForAllowedTargets(t *testing.T) {
	proxy, seen := fakeProxy(t)
	useProxy(t, proxy.URL)

	// A public address goes to the proxy (an address, so no DNS is needed in the test)
	resp, err := guardedClient(false).Get("http://93.184.215.14/seite")
	if err != nil {
		t.Fatalf("public target through the proxy: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if string(body) != "über den Proxy" || len(seen()) != 1 || seen()[0] != "http://93.184.215.14/seite" {
		t.Fatalf("proxy not used: %q %v", body, seen())
	}

	// Private and reserved targets never reach the proxy
	for _, target := range []string{"http://10.0.0.5/", "http://192.168.1.10/admin", "http://169.254.169.254/latest/meta-data/", "http://[fd00::1]/"} {
		if _, err := guardedClient(false).Get(target); err == nil || !errors.Is(err, errBlockedTarget) {
			t.Fatalf("%s: want blocked, got %v", target, err)
		}
	}
	// Loopback is not proxied and the dialer refuses it
	if _, err := guardedClient(false).Get("http://127.0.0.1:9/"); err == nil {
		t.Fatal("loopback must stay blocked")
	}
	if n := len(seen()); n != 1 {
		t.Fatalf("blocked targets reached the proxy: %v", seen())
	}

	// With local targets allowed (admin switch) a LAN address goes through the proxy as well
	if resp, err := guardedClient(true).Get("http://192.168.1.10/hook"); err != nil {
		t.Fatalf("allowed LAN target: %v", err)
	} else {
		_ = resp.Body.Close()
	}
	if got := seen(); got[len(got)-1] != "http://192.168.1.10/hook" {
		t.Fatalf("LAN target not proxied: %v", got)
	}
	// Metadata stays blocked even then
	if _, err := guardedClient(true).Get("http://169.254.169.254/"); !errors.Is(err, errBlockedTarget) {
		t.Fatalf("metadata with local targets allowed: %v", err)
	}
}

// A host the proxy is not used for (NO_PROXY) goes direct and is checked by the dialer as before; a name
// that does not resolve here is refused instead of being handed to the proxy
func TestGuardedProxyChecks(t *testing.T) {
	useProxy(t, "http://proxy.intern:3128", "direkt.example.com")
	p, addrs := guardedProxy(false)
	if p == nil || !addrs["proxy.intern:3128"] {
		t.Fatalf("proxy address: %v", addrs)
	}
	req := func(raw string) *http.Request {
		u, _ := url.Parse(raw)
		return (&http.Request{URL: u}).WithContext(t.Context())
	}
	if got, err := p(req("https://direkt.example.com/")); got != nil || err != nil {
		t.Fatalf("NO_PROXY host: %v %v", got, err)
	}
	if got, err := p(req("https://93.184.215.14/")); err != nil || got == nil || got.Host != "proxy.intern:3128" {
		t.Fatalf("public target: %v %v", got, err)
	}
	if _, err := p(req("https://10.1.2.3/")); !errors.Is(err, errBlockedTarget) {
		t.Fatalf("private target: %v", err)
	}
	if _, err := p(req("https://name-die-es-nicht-gibt.invalid/")); err == nil {
		t.Fatal("a name that does not resolve here is refused")
	}
	// Without a proxy in the environment nothing changes
	proxyEnvAddrs = func() map[string]bool { return map[string]bool{} }
	if p, _ := guardedProxy(false); p != nil {
		t.Fatal("without HTTP(S)_PROXY no proxy is used")
	}
}

func TestProxyAddr(t *testing.T) {
	for raw, want := range map[string]string{
		"":                           "",
		"http://proxy:3128":          "proxy:3128",
		"proxy.intern:8080":          "proxy.intern:8080",
		"https://proxy.example.com":  "proxy.example.com:443",
		"http://user:pw@10.0.0.1":    "10.0.0.1:80",
		"socks5://127.0.0.1":         "127.0.0.1:1080",
		"http://[fd00::3]:3128/pfad": "[fd00::3]:3128",
	} {
		if got := proxyAddr(raw); got != want {
			t.Errorf("%q: got %q, want %q", raw, got, want)
		}
	}
}

// countingProxy is a fake proxy on loopback that counts every connection made to it.
func countingProxy(t *testing.T) (*httptest.Server, func() int64) {
	t.Helper()
	var conns atomic.Int64
	ts := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "über den Proxy")
	}))
	ts.Config.ConnState = func(_ net.Conn, s http.ConnState) {
		if s == http.StateNew {
			conns.Add(1)
		}
	}
	ts.Start()
	t.Cleanup(ts.Close)
	return ts, conns.Load
}

// Finding from the re-test: with HTTPS_PROXY on localhost, a target that bypasses the proxy (loopback,
// NO_PROXY) and names the proxy's own host and port was dialled directly, because the dialer let the
// proxy's address through. The proxy address is only for the proxy hop; as a direct target it is loopback.
func TestGuardedClientRefusesProxyAddressAsDirectTarget(t *testing.T) {
	proxy, conns := countingProxy(t)
	port := proxy.Listener.Addr().(*net.TCPAddr).Port
	targets := []string{
		fmt.Sprintf("https://127.0.0.1:%d/", port),
		fmt.Sprintf("https://localhost:%d/", port),
		fmt.Sprintf("http://localhost:%d/", port),
	}
	for _, proxyURL := range []string{fmt.Sprintf("http://localhost:%d", port), proxy.URL} {
		useProxy(t, proxyURL)
		for _, target := range targets {
			if _, err := guardedClient(false).Get(target); !errors.Is(err, errBlockedTarget) {
				t.Fatalf("proxy %s, target %s: want blocked, got %v", proxyURL, target, err)
			}
			if _, err := guardedClient(true).Get(target); !errors.Is(err, errBlockedTarget) {
				t.Fatalf("proxy %s, target %s with local targets allowed: want blocked, got %v", proxyURL, target, err)
			}
			if _, err := mediaFetchClient().Get(target); !errors.Is(err, errBlockedTarget) {
				t.Fatalf("image copy %s: want blocked, got %v", target, err)
			}
			if _, _, err := fetchLimited(t.Context(), target, 1024, "text/html"); err == nil {
				t.Fatalf("link preview %s: want refused", target)
			}
		}
		// The same with the target host in NO_PROXY: it goes direct and stays blocked
		useProxy(t, proxyURL, "localhost", "127.0.0.1")
		if _, err := guardedClient(false).Get(fmt.Sprintf("https://localhost:%d/", port)); !errors.Is(err, errBlockedTarget) {
			t.Fatalf("NO_PROXY target: want blocked, got %v", err)
		}
	}
	if n := conns(); n != 0 {
		t.Fatalf("%d connection(s) reached the proxy port", n)
	}

	// The proxy's own host and port as a target *through* the proxy (CONNECT localhost:<port>) is refused
	// by the target check before the proxy is contacted
	useProxy(t, proxy.URL)
	p, _ := url.Parse(proxy.URL)
	proxyForRequest = func(*http.Request) (*url.URL, error) { return p, nil }
	for _, target := range targets {
		if _, err := guardedClient(false).Get(target); !errors.Is(err, errBlockedTarget) {
			t.Fatalf("%s through the proxy: want blocked, got %v", target, err)
		}
	}
	if n := conns(); n != 0 {
		t.Fatalf("%d connection(s) reached the proxy port", n)
	}

	// The proxy itself keeps working as the proxy hop for a public target
	resp, err := guardedClient(false).Get("http://93.184.215.14/seite")
	if err != nil {
		t.Fatalf("public target through the loopback proxy: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if string(body) != "über den Proxy" || conns() != 1 {
		t.Fatalf("proxy not used: %q, %d connection(s)", body, conns())
	}
}

// The transport for proxied requests dials nothing but the proxy: should the proxy decision ever differ
// between the check and the dial, the request fails instead of going anywhere else
func TestGuardedClientProxiedTransportDialsOnlyProxy(t *testing.T) {
	proxy, conns := countingProxy(t)
	useProxy(t, proxy.URL)
	tr := guardedClient(false).Transport.(*proxySplitTransport)
	if _, err := tr.proxied.DialContext(t.Context(), "tcp", "127.0.0.1:9"); !errors.Is(err, errBlockedTarget) {
		t.Fatalf("dial to another address: %v", err)
	}
	direct, _ := url.Parse("https://localhost/")
	if _, err := tr.proxied.Proxy(&http.Request{URL: direct}); !errors.Is(err, errBlockedTarget) {
		t.Fatalf("proxied transport without a proxy for the target: %v", err)
	}
	if conns() != 0 {
		t.Fatal("unexpected connection to the proxy")
	}
	// Without a proxy in the environment the client keeps a plain transport
	proxyEnvAddrs = func() map[string]bool { return map[string]bool{} }
	if _, ok := guardedClient(false).Transport.(*http.Transport); !ok {
		t.Fatal("without HTTP(S)_PROXY the direct transport is used")
	}
}
