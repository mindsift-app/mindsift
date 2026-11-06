package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestSecretsOnlyRevealToLoginsWithAccess(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, _ := store.CreateDocument(claims.UserID, "", "Server", "", "", nil, nil, false)

	rec := sessionCall(router, "POST", "/api/v1/documents/"+doc.ID+"/secrets", token, `{"value":"192.168.1.10"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var created struct{ ID, Ref string }
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Ref != "{{secret:"+created.ID+"}}" {
		t.Fatalf("unexpected answer %+v", created)
	}
	if sec, _ := store.GetSecret(created.ID); strings.Contains(sec.Ciphertext, "192.168") {
		t.Fatalf("value stored in clear text")
	}
	reveal := func(docID, tok string) *httptest.ResponseRecorder {
		return sessionCall(router, "GET", "/api/v1/documents/"+docID+"/secrets/"+created.ID, tok, "", "")
	}
	if rec := reveal(doc.ID, token); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "192.168.1.10") {
		t.Fatalf("owner reveal: %d %s", rec.Code, rec.Body.String())
	}

	// API keys (and so MCP) never reach it
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"tasks:read", "tasks:write"})
	req := httptest.NewRequest("GET", "/api/v1/documents/"+doc.ID+"/secrets/"+created.ID, nil)
	req.Header.Set("X-API-Key", key.RawKey)
	keyRec := httptest.NewRecorder()
	router.ServeHTTP(keyRec, req)
	if keyRec.Code != http.StatusForbidden {
		t.Fatalf("API key must not reveal, got %d", keyRec.Code)
	}

	// A stranger copying the reference into an own note gets nothing
	stranger, strangerToken := newTestUser(t, store, "fremd@example.com")
	if rec := reveal(doc.ID, strangerToken); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger on the owner's note: want 404, got %d", rec.Code)
	}
	own, _ := store.CreateDocument(stranger.ID, "", "Geklaut", "", "", []domain.DocumentBlock{{ID: "s1", Type: "bullet", Content: created.Ref}}, nil, false)
	if rec := reveal(own.ID, strangerToken); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger via own note: want 404, got %d", rec.Code)
	}

	// The bullet moved to another note of the owner: the secret follows it there
	moved, _ := store.CreateDocument(claims.UserID, "", "Neu", "", "", []domain.DocumentBlock{{ID: "m1", Type: "bullet", Content: "IP " + created.Ref}}, nil, false)
	if rec := reveal(moved.ID, token); rec.Code != http.StatusOK {
		t.Fatalf("reveal in the new note: %d", rec.Code)
	}
	if sec, _ := store.GetSecret(created.ID); sec.DocumentID != moved.ID {
		t.Fatalf("secret must now belong to the new note")
	}

	// Readers of the note may reveal, only writers may change it
	viewer, viewerToken := newTestUser(t, store, "leser@example.com")
	if _, err := store.CreateDocShare(claims.UserID, moved.ID, viewer.ID, "read"); err != nil {
		t.Fatal(err)
	}
	if rec := reveal(moved.ID, viewerToken); rec.Code != http.StatusOK {
		t.Fatalf("reader reveal: %d", rec.Code)
	}
	put := func(tok string) int {
		return sessionCall(router, "PUT", "/api/v1/documents/"+moved.ID+"/secrets/"+created.ID, tok, `{"value":"10.0.0.1"}`, "").Code
	}
	if code := put(viewerToken); code != http.StatusForbidden {
		t.Fatalf("reader change: want 403, got %d", code)
	}
	if code := put(token); code != http.StatusNoContent {
		t.Fatalf("owner change: %d", code)
	}
	if rec := reveal(moved.ID, token); !strings.Contains(rec.Body.String(), "10.0.0.1") {
		t.Fatalf("changed value not returned: %s", rec.Body.String())
	}
	if rec := sessionCall(router, "GET", "/api/v1/documents/"+moved.ID+"/secrets/sec_missing", token, "", ""); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "secret_gone") {
		t.Fatalf("unknown secret: %d %s", rec.Code, rec.Body.String())
	}
}
