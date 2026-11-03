package api

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTargetIPAllowed(t *testing.T) {
	cases := []struct {
		ip           string
		allowPrivate bool
		want         bool
	}{
		{"127.0.0.1", true, false},
		{"::1", true, false},
		{"169.254.169.254", true, false}, // cloud metadata
		{"0.0.0.0", true, false},
		{"192.168.1.20", false, false},
		{"192.168.1.20", true, true},
		{"10.0.0.5", false, false},
		{"100.101.102.103", true, true}, // Tailscale
		{"fd00::1", false, false},
		{"93.184.216.34", false, true},
		{"::ffff:127.0.0.1", true, false}, // IPv4-mapped loopback
	}
	for _, c := range cases {
		if got := targetIPAllowed(net.ParseIP(c.ip), c.allowPrivate); got != c.want {
			t.Errorf("targetIPAllowed(%s, private=%v) = %v, want %v", c.ip, c.allowPrivate, got, c.want)
		}
	}
}

func TestValidateWebhookURL(t *testing.T) {
	ok := []struct {
		url              string
		discord, private bool
	}{
		{"https://discord.com/api/webhooks/1/abc", true, false},
		{"https://hooks.example.org/x", false, false},
		{"http://192.168.1.20:8123/api/webhook/x", false, true},
		{"", false, false},
	}
	for _, c := range ok {
		if err := validateWebhookURL(c.url, c.discord, c.private); err != nil {
			t.Errorf("%q should be allowed: %v", c.url, err)
		}
	}
	bad := []struct {
		url              string
		discord, private bool
	}{
		{"http://hooks.example.org/x", false, false},
		{"https://evil.example.org/api/webhooks/1", true, false},
		{"https://127.0.0.1/x", false, true},
		{"https://169.254.169.254/latest/meta-data", false, true},
		{"https://192.168.1.20/x", false, false},
		{"file:///etc/passwd", false, true},
		{"gopher://x", false, false},
	}
	for _, c := range bad {
		if err := validateWebhookURL(c.url, c.discord, c.private); err == nil {
			t.Errorf("%q must be rejected", c.url)
		}
	}
}

// A hostname that resolves to localhost (like a test server or a DNS rebinding trick) is refused at
// connection time even though the URL itself looks harmless.
func TestGuardedClientRefusesLoopbackAtDial(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer ts.Close()
	url := strings.Replace(ts.URL, "127.0.0.1", "localhost", 1)
	if _, err := guardedClient(true).Get(url); err == nil || !strings.Contains(err.Error(), "nicht erlaubt") {
		t.Fatalf("loopback must be refused at dial time, got %v", err)
	}
}
