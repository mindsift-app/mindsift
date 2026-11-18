package api

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// fakeImageHost serves bild.png at https://example.com for the guarded client used by copies.
func fakeImageHost(t *testing.T, png []byte) {
	t.Helper()
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(png) }))
	t.Cleanup(ts.Close)
	orig := mediaFetchClient
	t.Cleanup(func() { mediaFetchClient = orig })
	mediaFetchClient = func() *http.Client {
		c := ts.Client()
		tr := c.Transport.(*http.Transport).Clone()
		tr.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, ts.Listener.Addr().String())
		}
		tr.TLSClientConfig.ServerName = "example.com"
		c.Transport = tr
		return c
	}
}

// Image settings and the media quota: defaults, the admin's choice, the switches refusing uploads and
// copies, the download of an external image for the app (nothing stored), and the MEDIA_* variables
// fixing each value.
func TestImageSettingsAndQuota(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Media.QuotaMB = -1 // not set: the administration decides
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, _ := store.CreateDocument(claims.UserID, "", "Bilder", "🖼️", "", nil, nil, false)
	status := func() string { return sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String() }
	put := func(body string) *httptest.ResponseRecorder {
		return sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations",`+body+`}`, "")
	}
	fetch := func(body string) *httptest.ResponseRecorder {
		return sessionCall(router, "POST", "/api/v1/documents/"+doc.ID+"/media/fetch", token, body, "")
	}
	png := tinyPNG(t, 0)
	fakeImageHost(t, png)

	if want := `"images":{"enabled":true,"external":true,"limitMB":15}`; !strings.Contains(status(), want) {
		t.Fatalf("default: %s", status())
	}
	if body := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String(); !strings.Contains(body, `"mediaQuotaMB":0`) || strings.Contains(body, "mediaQuotaMBConfiguredViaEnv") {
		t.Fatalf("admin default quota: %s", body)
	}

	// The app's download: the image comes back as it is, nothing is stored
	rec := fetch(`{"url":"https://example.com/bild.png","download":true}`)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" || !bytes.Equal(rec.Body.Bytes(), png) || rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatalf("download: %d %s", rec.Code, rec.Header())
	}
	if used, _ := store.MediaUsage(claims.UserID); used != 0 {
		t.Fatalf("download stored a file: %d", used)
	}

	// External images off: copies and downloads refused, uploads still work
	if rec := put(`"externalImages":false,"imageLimitMB":20,"mediaQuotaMB":1`); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if want := `"images":{"enabled":true,"external":false,"limitMB":20}`; !strings.Contains(status(), want) {
		t.Fatalf("after save: %s", status())
	}
	if e := lastAudit(t, store, storage.AuditSettingsChanged); !strings.Contains(string(e.Details), `{"key":"mediaQuotaMB","from":0,"to":1}`) {
		t.Fatalf("audit: %s", e.Details)
	}
	if rec := fetch(`{"url":"https://example.com/bild.png","download":true}`); rec.Code != http.StatusForbidden {
		t.Fatalf("download while external images are off: %d", rec.Code)
	}
	if rec := mediaUpload(t, router, token, doc.ID, png, "image/png"); rec.Code != http.StatusCreated {
		t.Fatalf("upload while only external images are off: %d %s", rec.Code, rec.Body.String())
	}

	// The quota from the administration (1 MB) holds
	if rec := mediaUpload(t, router, token, doc.ID, tinyPNG(t, 1<<20), "image/png"); rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "1 MB") {
		t.Fatalf("quota: %d %s", rec.Code, rec.Body.String())
	}

	// Images off: no upload, no copy; audio still goes in
	put(`"images":false,"mediaQuotaMB":0`)
	if !strings.Contains(status(), `"images":{"enabled":false,"external":false`) {
		t.Fatalf("images off: %s", status())
	}
	if rec := mediaUpload(t, router, token, doc.ID, png, "image/png"); rec.Code != http.StatusForbidden {
		t.Fatalf("upload while images are off: %d", rec.Code)
	}
	if rec := fetch(`{"url":"https://example.com/bild.png"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("copy while images are off: %d", rec.Code)
	}
	if rec := audioUpload(t, router, token, doc.ID, 1000, true); rec.Code != http.StatusCreated {
		t.Fatalf("audio while images are off: %d %s", rec.Code, rec.Body.String())
	}
	// The stored choice for external images stays visible while images are off
	if body := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String(); !strings.Contains(body, `"externalImages":false`) || !strings.Contains(body, `"images":false`) {
		t.Fatalf("admin view while images are off: %s", body)
	}

	for _, bad := range []string{`"imageLimitMB":1001`, `"imageLimitMB":-1`, `"mediaQuotaMB":-1`} {
		if rec := put(bad); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d", bad, rec.Code)
		}
	}

	// The environment wins and locks; the stored values stay
	srv.cfg.Media.Images, srv.cfg.Media.ExternalImages, srv.cfg.Media.MaxImageMB, srv.cfg.Media.QuotaMB = boolPtr(true), boolPtr(true), 3, 5
	rec = put(`"images":false,"externalImages":false,"imageLimitMB":9,"mediaQuotaMB":9`)
	body := rec.Body.String()
	for _, want := range []string{`"images":true`, `"imagesConfiguredViaEnv":true`, `"externalImages":true`, `"externalImagesConfiguredViaEnv":true`, `"imageLimitMB":3`, `"imageLimitMBConfiguredViaEnv":true`, `"mediaQuotaMB":5`, `"mediaQuotaMBConfiguredViaEnv":true`} {
		if rec.Code != http.StatusOK || !strings.Contains(body, want) {
			t.Fatalf("env locks, want %s: %d %s", want, rec.Code, body)
		}
	}
	if sys, _ := store.GetSystemSettings(); *sys.Images || *sys.ExternalImages || sys.ImageLimitMB != 20 || *sys.MediaQuotaMB != 0 {
		t.Fatalf("stored values must stay while the env fixes them: %+v", sys)
	}
	if !strings.Contains(status(), `"images":{"enabled":true,"external":true,"limitMB":3}`) {
		t.Fatalf("env in status: %s", status())
	}
	// MEDIA_QUOTA_MB=0 fixes "unlimited"
	srv.cfg.Media.QuotaMB = 0
	if body := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String(); !strings.Contains(body, `"mediaQuotaMB":0`) || !strings.Contains(body, `"mediaQuotaMBConfiguredViaEnv":true`) {
		t.Fatalf("env quota 0: %s", body)
	}
}
