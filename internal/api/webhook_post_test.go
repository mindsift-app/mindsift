package api

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Alarms and bundled notifications go out the same way (postWebhook): the JSON reaches the target, and a
// refusing target gives the same translatable error for both.
func TestPostWebhookAlarmAndDigestAlike(t *testing.T) {
	t.Parallel()
	srv, _, _ := setupTestServer(t)

	status := http.StatusOK
	var got []map[string]any
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p map[string]any
		_ = json.NewDecoder(r.Body).Decode(&p)
		got = append(got, p)
		w.WriteHeader(status)
	}))
	defer target.Close()
	// The guarded client never dials localhost; the test client takes every request to the test target
	srv.webhookHTTPClient = &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, target.Listener.Addr().String())
	}}}
	hook := "https://hooks.example.com/mindsift"

	if err := srv.sendCustomWebhookNotification(hook, "task_due", "Steuer", "", "2026-12-01", "high", nil); err != nil {
		t.Fatalf("alarm: %v", err)
	}
	if err := srv.sendWebhookDigest(hook, "Neu für dich", []notifyItem{{kind: "shared", title: "Plan", text: "Anna hat „Plan“ geteilt"}}); err != nil {
		t.Fatalf("digest: %v", err)
	}
	if len(got) != 2 || got[0]["event"] != "task_due" || got[0]["title"] != "Steuer" || got[1]["event"] != "digest" || got[1]["heading"] != "Neu für dich" {
		t.Fatalf("payloads: %v", got)
	}

	status = http.StatusBadGateway
	for name, send := range map[string]func() error{
		"alarm": func() error {
			return srv.sendCustomWebhookNotification(hook, "task_due", "Steuer", "", "", "", nil)
		},
		"digest": func() error { return srv.sendWebhookDigest(hook, "Neu", nil) },
	} {
		err := send()
		if err == nil {
			t.Fatalf("%s: no error for status 502", name)
		}
		if !clientSafe(err) || i18n.Text("en", err) != "HTTP status 502" || i18n.Text("de", err) != "HTTP-Status 502" {
			t.Errorf("%s: want the translated status, got %q / %q", name, i18n.Text("en", err), i18n.Text("de", err))
		}
	}
}
