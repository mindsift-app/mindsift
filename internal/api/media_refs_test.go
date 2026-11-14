package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
)

func importArchive(t *testing.T, router http.Handler, token, path string, files map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	for name, body := range files {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(body))
	}
	_ = zw.Close()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "Vault.zip")
	_, _ = fw.Write(archive.Bytes())
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept-Language", "de")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// Pentest 2026-11-14: knowing the id of someone else's picture was enough to read it, by importing a
// note (or writing a bullet) that shows it; the bullet made the file readable for its note's readers.
// References to files the writer may not read are dropped now, on import and in the editor sync.
func TestForeignMediaReferencesGiveNoAccess(t *testing.T) {
	srv, store, tokenA := setupTestServer(t)
	srv.cfg.Media.MaxImageMB = 1
	router := srv.Router()
	claimsA, _ := auth.ValidateToken(testJWTSecret, tokenA)
	docA, _ := store.CreateDocument(claimsA.UserID, "", "Privat", "", "", nil, nil, false)
	var up struct{ ID string }
	_ = json.Unmarshal(mediaUpload(t, router, tokenA, docA.ID, tinyPNG(t, 0), "image/png").Body.Bytes(), &up)
	if up.ID == "" {
		t.Fatal("upload failed")
	}
	mediaURL := "/api/v1/media/" + up.ID

	userB, tokenB := newTestUser(t, store, "angreifer@example.com")
	if rec := sessionCall(router, "GET", mediaURL, tokenB, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("before: want 404, got %d", rec.Code)
	}

	// Import: the preview names the note, the import keeps only the caption
	vault := map[string]string{"Vault/Beute.md": "- Text\n- ![Foto](media:" + up.ID + ")\n- Siehe media:" + up.ID}
	rec := importArchive(t, router, tokenB, "/api/v1/import/obsidian?preview=1", vault)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Beute.md") {
		t.Fatalf("preview should list the note as skipped: %d %s", rec.Code, rec.Body.String())
	}
	if rec := importArchive(t, router, tokenB, "/api/v1/import/obsidian", vault); rec.Code != http.StatusOK {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, "GET", mediaURL, tokenB, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("after the import: want 404, got %d", rec.Code)
	}
	docs, _ := store.GetDocuments(userB.ID)
	for _, d := range docs {
		full, _ := store.GetDocumentByID(userB.ID, d.ID)
		for _, b := range full.Blocks {
			if strings.Contains(b.Content, up.ID) {
				t.Errorf("imported bullet still points to the file: %q", b.Content)
			}
		}
	}

	// The editor sync drops the reference the same way
	docB, _ := store.CreateDocument(userB.ID, "", "Eigene", "", "", nil, nil, false)
	content := "![Foto](media:" + up.ID + ")"
	body, _ := json.Marshal(map[string]any{"clientId": "c1", "ops": []map[string]any{{
		"opId": "op1", "kind": "insert", "blockId": "blk_beute", "parentId": "", "orderKey": "a0", "type": "image", "content": content,
	}}})
	if rec := sessionCall(router, "POST", "/api/v1/docs/"+docB.ID+"/sync", tokenB, string(body), ""); rec.Code != http.StatusOK {
		t.Fatalf("sync: %d %s", rec.Code, rec.Body.String())
	}
	if rec := sessionCall(router, "GET", mediaURL, tokenB, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("after the sync: want 404, got %d", rec.Code)
	}
	full, _ := store.GetDocumentByID(userB.ID, docB.ID)
	for _, b := range full.Blocks {
		if b.ID == "blk_beute" && (b.Content != "Foto" || b.Type != "bullet") {
			t.Errorf("synced bullet: want plain bullet \"Foto\", got %s %q", b.Type, b.Content)
		}
	}

	// The owner's own reference stays, in the editor as on import
	ownBody, _ := json.Marshal(map[string]any{"clientId": "c2", "ops": []map[string]any{{
		"opId": "op2", "kind": "insert", "blockId": "blk_own", "parentId": "", "orderKey": "a0", "type": "image", "content": content,
	}}})
	if rec := sessionCall(router, "POST", "/api/v1/docs/"+docA.ID+"/sync", tokenA, string(ownBody), ""); rec.Code != http.StatusOK {
		t.Fatalf("own sync: %d %s", rec.Code, rec.Body.String())
	}
	fullA, _ := store.GetDocumentByID(claimsA.UserID, docA.ID)
	kept := false
	for _, b := range fullA.Blocks {
		kept = kept || (b.ID == "blk_own" && b.Content == content && b.Type == "image")
	}
	if !kept {
		t.Errorf("the owner's own image bullet must stay: %+v", fullA.Blocks)
	}
}
