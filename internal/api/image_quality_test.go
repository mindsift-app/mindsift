package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// The image quality: default high, chosen by the admin (recorded in the audit log), passed to the app
// with the status, refused when unknown, and fixed by MEDIA_IMAGE_QUALITY.
func TestImageQualitySetting(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	status := func() string { return sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String() }
	if !strings.Contains(status(), `"imageQuality":"high"`) {
		t.Fatalf("default: %s", status())
	}
	if rec := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", ""); !strings.Contains(rec.Body.String(), `"imageQuality":"high"`) {
		t.Fatalf("admin default: %s", rec.Body.String())
	}

	rec := sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","imageQuality":"low"}`, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"imageQuality":"low"`) {
		t.Fatalf("save low: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(status(), `"imageQuality":"low"`) {
		t.Fatalf("status after save: %s", status())
	}
	if e := lastAudit(t, store, storage.AuditSettingsChanged); !strings.Contains(string(e.Details), `{"key":"imageQuality","from":"high","to":"low"}`) {
		t.Fatalf("audit: %s", e.Details)
	}

	// Other settings saved without the field keep it
	sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","instanceName":"Neu"}`, "")
	if sys, _ := store.GetSystemSettings(); sys.ImageQuality != "low" {
		t.Fatalf("kept: %q", sys.ImageQuality)
	}

	if rec := sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","imageQuality":"ultra"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown level: want 400, got %d", rec.Code)
	}

	// The environment wins and locks the form; what the admin sends then is not stored
	srv.cfg.Media.ImageQuality = "medium"
	if !strings.Contains(status(), `"imageQuality":"medium"`) {
		t.Fatalf("env in status: %s", status())
	}
	rec = sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations","imageQuality":"high"}`, "")
	if body := rec.Body.String(); rec.Code != http.StatusOK || !strings.Contains(body, `"imageQuality":"medium"`) || !strings.Contains(body, `"imageQualityConfiguredViaEnv":true`) {
		t.Fatalf("env locks: %d %s", rec.Code, body)
	}
	if sys, _ := store.GetSystemSettings(); sys.ImageQuality != "low" {
		t.Fatalf("stored value must stay while the env fixes it: %q", sys.ImageQuality)
	}
}
