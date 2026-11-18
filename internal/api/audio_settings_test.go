package api

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// audioUpload sends a WebM file like the app does; recording marks it as made in the app.
func audioUpload(t *testing.T, router http.Handler, token, docID string, size int, recording bool) *httptest.ResponseRecorder {
	t.Helper()
	data := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, make([]byte, size-4)...)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if recording {
		_ = mw.WriteField("source", "recording")
	}
	h := map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="sprachnotiz.webm"`},
		"Content-Type":        {"audio/webm"},
	}
	fw, _ := mw.CreatePart(h)
	_, _ = fw.Write(data)
	_ = mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/documents/"+docID+"/media", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// Audio settings: defaults (recordings at 32 kbit/s, uploads up to 7 MB), chosen by the admin, refused
// when invalid, fixed by MEDIA_AUDIO_*; the upload limit applies to files from the device only.
func TestAudioSettings(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Media.MaxAudioMB = 50
	router := srv.Router()
	status := func() string { return sessionCall(router, "GET", "/api/v1/auth/status", "", "", "").Body.String() }
	put := func(body string) *httptest.ResponseRecorder {
		return sessionCall(router, "PUT", "/api/v1/admin/settings", token, `{"sharingMode":"organizations",`+body+`}`, "")
	}
	if want := `"audio":{"compression":"recordings","bitrate":32,"uploadMaxMB":7}`; !strings.Contains(status(), want) {
		t.Fatalf("default: %s", status())
	}
	if body := sessionCall(router, "GET", "/api/v1/admin/settings", token, "", "").Body.String(); !strings.Contains(body, `"audioUploadMaxMB":7`) || !strings.Contains(body, `"audioMaxMB":50`) {
		t.Fatalf("admin default: %s", body)
	}

	if rec := put(`"audioCompression":"off","audioBitrate":64,"audioUploadMaxMB":20,"imageQuality":"off"`); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if want := `"audio":{"compression":"off","bitrate":64,"uploadMaxMB":20}`; !strings.Contains(status(), want) || !strings.Contains(status(), `"imageQuality":"off"`) {
		t.Fatalf("after save: %s", status())
	}
	if e := lastAudit(t, store, storage.AuditSettingsChanged); !strings.Contains(string(e.Details), `{"key":"audioBitrate","from":32,"to":64}`) {
		t.Fatalf("audit: %s", e.Details)
	}
	// Saved without the fields: kept
	put(`"instanceName":"Neu"`)
	if sys, _ := store.GetSystemSettings(); sys.AudioCompression != "off" || sys.AudioBitrate != 64 || sys.AudioUploadMaxMB != 20 {
		t.Fatalf("kept: %+v", sys)
	}
	for _, bad := range []string{`"audioCompression":"all"`, `"audioBitrate":4`, `"audioBitrate":500`, `"audioUploadMaxMB":51`, `"audioUploadMaxMB":-1`} {
		if rec := put(bad); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d", bad, rec.Code)
		}
	}

	// The environment wins and locks; what the admin sends is not stored
	srv.cfg.Media.AudioCompression, srv.cfg.Media.AudioBitrate, srv.cfg.Media.AudioUploadMaxMB = "recordings", 24, 1
	rec := put(`"audioCompression":"off","audioBitrate":96,"audioUploadMaxMB":30`)
	body := rec.Body.String()
	for _, want := range []string{`"audioCompression":"recordings"`, `"audioCompressionConfiguredViaEnv":true`, `"audioBitrate":24`, `"audioBitrateConfiguredViaEnv":true`, `"audioUploadMaxMB":1`, `"audioUploadMaxMBConfiguredViaEnv":true`} {
		if rec.Code != http.StatusOK || !strings.Contains(body, want) {
			t.Fatalf("env locks, want %s: %d %s", want, rec.Code, body)
		}
	}
	if sys, _ := store.GetSystemSettings(); sys.AudioCompression != "off" || sys.AudioBitrate != 64 || sys.AudioUploadMaxMB != 20 {
		t.Fatalf("stored values must stay while the env fixes them: %+v", sys)
	}

	// Upload limit (1 MB from the env): a file from the device above it is refused, a recording is not
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, _ := store.CreateDocument(claims.UserID, "", "Audio", "🎙️", "", nil, nil, false)
	if rec := audioUpload(t, router, token, doc.ID, 1<<20+10, false); rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "1 MB") {
		t.Fatalf("uploaded file above the limit: %d %s", rec.Code, rec.Body.String())
	}
	if rec := audioUpload(t, router, token, doc.ID, 1<<20-10, false); rec.Code != http.StatusCreated {
		t.Fatalf("uploaded file within the limit: %d %s", rec.Code, rec.Body.String())
	}
	if rec := audioUpload(t, router, token, doc.ID, 1<<20+10, true); rec.Code != http.StatusCreated {
		t.Fatalf("recording above the upload limit: %d %s", rec.Code, rec.Body.String())
	}
	// Never above MEDIA_MAX_AUDIO_MB
	srv.cfg.Media.AudioUploadMaxMB, srv.cfg.Media.MaxAudioMB = 0, 10
	if !strings.Contains(status(), `"uploadMaxMB":10`) {
		t.Fatalf("capped by MEDIA_MAX_AUDIO_MB: %s", status())
	}
}
