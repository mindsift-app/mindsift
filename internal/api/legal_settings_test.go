package api

import (
	"net/http"
	"strings"
	"testing"
)

// Imprint and privacy notice from the administration: stored, shown on the login screen and as page,
// checked, recorded in the audit log without their text, and each field fixed by its LEGAL_* variable.
func TestLegalSettings(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	status := func() string { return sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String() }
	put := func(legal string) *http.Response {
		rec := sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","legal":`+legal+`}`, "")
		return rec.Result()
	}
	if res := put(`{"imprintUrl":"https://example.com/impressum","privacyContent":"# Datenschutz\nWir speichern nur, was nötig ist.","customLinkLabel":"Status","customLinkUrl":"https://status.example.com"}`); res.StatusCode != http.StatusOK {
		t.Fatalf("save: %d", res.StatusCode)
	}
	for _, want := range []string{`"imprintUrl":"https://example.com/impressum"`, `"hasPrivacyContent":true`, `"customLinkLabel":"Status"`} {
		if !strings.Contains(status(), want) {
			t.Fatalf("status, want %s: %s", want, status())
		}
	}
	if rec := sessionCall(router, "GET", "/api/v1/legal/privacy", "", "", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Wir speichern nur") {
		t.Fatalf("privacy page: %d %s", rec.Code, rec.Body.String())
	}
	if e := lastAudit(t, store, "settings.changed"); !strings.Contains(string(e.Details), `"key":"legal","changed":true`) || strings.Contains(string(e.Details), "Wir speichern") {
		t.Fatalf("audit without the text: %s", e.Details)
	}
	for _, bad := range []string{`{"imprintUrl":"javascript:alert(1)"}`, `{"customLinkUrl":"https://x.example"}`, `{"customLinkLabel":"X","customLinkUrl":"http://x.example"}`} {
		if res := put(bad); res.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d", bad, res.StatusCode)
		}
	}
	// LEGAL_IMPRINT_URL fixes that field only; what the administration sends for it is not stored
	srv.cfg.Legal.ImprintURL = "https://provider.example/impressum"
	put(`{"imprintUrl":"https://example.com/anders","privacyContent":"Neu"}`)
	body := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String()
	if !strings.Contains(body, `"imprintUrl":"https://provider.example/impressum"`) || !strings.Contains(body, `"configuredViaEnv":["imprintUrl"]`) || !strings.Contains(body, `"privacyContent":"Neu"`) {
		t.Fatalf("env lock: %s", body)
	}
	if sys, _ := store.GetSystemSettings(); sys.Legal.ImprintURL != "https://example.com/impressum" {
		t.Fatalf("the stored link stays: %q", sys.Legal.ImprintURL)
	}
	if !strings.Contains(status(), `"imprintUrl":"https://provider.example/impressum"`) {
		t.Fatalf("status shows the provider's link: %s", status())
	}
}
