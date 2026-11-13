package api

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
)

func importRequest(t *testing.T, router http.Handler, token, path string) *httptest.ResponseRecorder {
	t.Helper()
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	w, _ := zw.Create("Vault/Notiz.md")
	_, _ = w.Write([]byte("- Inhalt"))
	_ = zw.Close()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "Vault.zip")
	_, _ = fw.Write(archive.Bytes())
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// One import per person and two per server run at a time, previews included; the others get 429.
func TestImportsRunOneAtATime(t *testing.T) {
	srv, _, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	paths := []string{"/api/v1/import/obsidian?preview=1", "/api/v1/import/obsidian", "/api/v1/import/mindsift?preview=1"}

	// The person's own import is still running
	if !srv.imports.enter(claims.UserID) {
		t.Fatal("gate should be free")
	}
	for _, path := range paths {
		if rec := importRequest(t, router, token, path); rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
			t.Fatalf("%s during an own import: %d %s, want 429", path, rec.Code, rec.Body.String())
		}
	}
	srv.imports.leave(claims.UserID)

	// Two imports of other people keep the server busy
	srv.imports.enter("usr_a")
	srv.imports.enter("usr_b")
	if rec := importRequest(t, router, token, paths[0]); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("with two imports running: %d, want 429", rec.Code)
	}
	srv.imports.leave("usr_b")
	if rec := importRequest(t, router, token, paths[0]); rec.Code != http.StatusOK {
		t.Fatalf("with a place free: %d %s, want 200", rec.Code, rec.Body.String())
	}
	// The finished import gave its place back
	if rec := importRequest(t, router, token, paths[0]); rec.Code != http.StatusOK {
		t.Fatalf("after the previous import: %d %s, want 200", rec.Code, rec.Body.String())
	}
}
