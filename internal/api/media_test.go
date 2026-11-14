package api

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func tinyPNG(t *testing.T, extra int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	buf.Write(make([]byte, extra)) // padding behind the image data, still detected as PNG
	return buf.Bytes()
}

func mediaUpload(t *testing.T, router http.Handler, token, docID string, data []byte, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	h := make(map[string][]string)
	h["Content-Disposition"] = []string{`form-data; name="file"; filename="datei"`}
	h["Content-Type"] = []string{contentType}
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

func TestMediaUploadReadAndAccess(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Media.MaxImageMB, srv.cfg.Media.MaxAudioMB = 1, 2
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, _ := store.CreateDocument(claims.UserID, "", "Bilder", "🖼️", "", nil, nil, false)

	img := tinyPNG(t, 0)
	rec := mediaUpload(t, router, token, doc.ID, img, "image/png")
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var up struct{ ID, Kind, Mime, URL string }
	_ = json.Unmarshal(rec.Body.Bytes(), &up)
	if up.Kind != "image" || up.Mime != "image/png" || up.URL != "/api/v1/media/"+up.ID {
		t.Fatalf("unexpected upload answer: %+v", up)
	}

	get := sessionCall(router, "GET", up.URL, token, "", "")
	if get.Code != http.StatusOK || get.Header().Get("Content-Type") != "image/png" || !bytes.Equal(get.Body.Bytes(), img) {
		t.Fatalf("read back: %d %s", get.Code, get.Header().Get("Content-Type"))
	}
	// Someone without access to the note sees nothing and cannot upload
	_, strangerToken := newTestUser(t, store, "fremd@example.com")
	if rec := sessionCall(router, "GET", up.URL, strangerToken, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger read: want 404, got %d", rec.Code)
	}
	if rec := mediaUpload(t, router, strangerToken, doc.ID, img, "image/png"); rec.Code != http.StatusForbidden {
		t.Fatalf("stranger upload: want 403, got %d", rec.Code)
	}
	// Only real images and recordings, within the limits
	if rec := mediaUpload(t, router, token, doc.ID, []byte("<svg onload=alert(1)>"), "image/svg+xml"); rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("svg: want 415, got %d", rec.Code)
	}
	if rec := mediaUpload(t, router, token, doc.ID, tinyPNG(t, 1<<20+10), "image/png"); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("too large: want 413, got %d %s", rec.Code, rec.Body.String())
	}
	// External images must not point into the server's own network
	if rec := sessionCall(router, "POST", "/api/v1/documents/"+doc.ID+"/media/fetch", token, `{"url":"https://127.0.0.1/bild.png"}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("fetch from localhost: want 400, got %d", rec.Code)
	}
}

func TestMediaQuota(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Media.MaxImageMB, srv.cfg.Media.QuotaMB = 2, 1
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, _ := store.CreateDocument(claims.UserID, "", "Quota", "", "", nil, nil, false)
	if rec := mediaUpload(t, router, token, doc.ID, tinyPNG(t, 700<<10), "image/png"); rec.Code != http.StatusCreated {
		t.Fatalf("first upload: %d", rec.Code)
	}
	if rec := mediaUpload(t, router, token, doc.ID, tinyPNG(t, 700<<10), "image/png"); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("over the quota: want 413, got %d", rec.Code)
	}
}

func TestMediaCleanupAndCopiedBlocks(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.Media.MaxImageMB, srv.cfg.Media.MaxAudioMB = 2, 2
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, _ := store.CreateDocument(claims.UserID, "", "Quelle", "", "", nil, nil, false)
	upload := func() string {
		var up struct{ ID string }
		_ = json.Unmarshal(mediaUpload(t, router, token, doc.ID, tinyPNG(t, 0), "image/png").Body.Bytes(), &up)
		return up.ID
	}
	used, unused := upload(), upload()

	// A second user copied the image bullet out of the note while it was shared with them; the copy
	// keeps working after the share ends (FLAW-43)
	other, otherToken := newTestUser(t, store, "kopie@example.com")
	if _, err := store.CreateDocShare(claims.UserID, doc.ID, other.ID, "read"); err != nil {
		t.Fatal(err)
	}
	_, _ = store.CreateDocument(other.ID, "", "Kopie", "", "", []domain.DocumentBlock{{ID: "blk_copy", Type: "image", Content: "![Foto](media:" + used + ")"}}, nil, false)
	if err := store.DeleteDocShare(claims.UserID, doc.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	if rec := sessionCall(router, "GET", "/api/v1/media/"+used, otherToken, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("copied block: want 200, got %d", rec.Code)
	}

	// Within the grace time nothing is removed, afterwards only the unused file
	srv.compactMedia(time.Now())
	if _, err := store.GetMedia(unused); err != nil {
		t.Fatal("fresh uploads must survive the grace time")
	}
	srv.compactMedia(time.Now().Add(2 * mediaGrace))
	if _, err := store.GetMedia(unused); err == nil {
		t.Fatal("unused file must be removed")
	}
	m, err := store.GetMedia(used)
	if err != nil {
		t.Fatal("referenced file must stay")
	}
	if _, err := os.Stat(srv.mediaPath(m)); err != nil {
		t.Fatalf("referenced file missing on disk: %v", err)
	}
}

func TestDetectMedia(t *testing.T) {
	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, make([]byte, 40)...)
	m4a := append([]byte{0, 0, 0, 0x20}, []byte("ftypM4A ")...)
	m4a = append(m4a, make([]byte, 40)...)
	webp := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), make([]byte, 40)...)
	cases := []struct {
		data             []byte
		declared         string
		wantMime, wantKd string
	}{
		{webm, "audio/webm;codecs=opus", "audio/webm", "audio"},
		{webm, "", "audio/webm", "audio"},
		{m4a, "audio/mp4", "audio/mp4", "audio"},
		{webp, "", "image/webp", "image"},
	}
	for _, c := range cases {
		mime, kind, ok := detectMedia(c.data, c.declared)
		if !ok || mime != c.wantMime || kind != c.wantKd {
			t.Fatalf("detect(%q): got %s %s %v", c.declared, mime, kind, ok)
		}
	}
	if _, _, ok := detectMedia([]byte("#!/bin/sh\nrm -rf /"), "audio/webm"); ok {
		t.Fatal("scripts must not pass as audio")
	}
}
