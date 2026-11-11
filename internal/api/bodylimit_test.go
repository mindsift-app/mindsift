package api

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestRequestBodyLimited(t *testing.T) {
	srv, _, token := setupTestServer(t)
	router := srv.Router()
	huge := `{"content":"` + strings.Repeat("x", defaultMaxBody) + `"}`
	if rec := sessionCall(router, "POST", "/api/v1/inbox", token, huge, ""); rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("body over the limit: want 400/413, got %d", rec.Code)
	}
	if rec := sessionCall(router, "POST", "/api/v1/inbox", token, `{"content":"klein"}`, ""); rec.Code >= 300 {
		t.Fatalf("normal body: got %d %s", rec.Code, rec.Body.String())
	}
	if srv.bodyLimitFor("/api/v1/docs/doc_1/sync") != syncMaxBody || srv.bodyLimitFor("/api/v1/import/obsidian") <= defaultMaxBody {
		t.Fatal("sync and import keep their larger limits")
	}
}

func TestWebhookTokenInURLOnlyAPIKey(t *testing.T) {
	srv, _, token := setupTestServer(t)
	rec := sessionCall(srv.Router(), "POST", "/api/v1/webhooks/ingest?token="+token, "", `{"text":"x"}`, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("session token in URL: want 401, got %d", rec.Code)
	}
}

// A mail server that takes longer than the server gives an answer (here 1 s, 30 s in production): the test
// mail, the test alarm and the invite still get their answer instead of a cut connection.
func TestAnswerSurvivesASlowMailServer(t *testing.T) {
	srv, store, ts, owner, token := startRealtimeServer(t)
	sys, _ := store.GetSystemSettings()
	sys.SMTPHost = "smtp.example.com"
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	srv.notifyEmailHook = func(to, subject, text, html string) error {
		time.Sleep(1500 * time.Millisecond)
		return nil
	}
	inv, err := store.CreateUserInvite(owner.ID, "", nil, 7, 1)
	if err != nil {
		t.Fatalf("invite: %v", err)
	}
	for _, c := range []struct {
		name, path string
		body       map[string]string
	}{
		{"test mail", "/api/v1/admin/smtp/test", map[string]string{"toEmail": "anna@example.com"}},
		{"test alarm", "/api/v1/auth/alarms/test", map[string]string{"channel": "email", "target": owner.Email}},
		{"invite", "/api/v1/admin/invites/" + inv.ID + "/send", map[string]string{"email": "anna@example.com"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if resp := doJSON(t, ts, http.MethodPost, c.path, token, c.body); resp.StatusCode != http.StatusOK {
				t.Fatalf("status %d", resp.StatusCode)
			}
		})
	}
}
