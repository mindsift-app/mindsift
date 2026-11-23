package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// POST /documents with copied bullets (ids of another note), a bullet without id and a repeated id
// answers with the ids the note was stored with, the same as GET /documents/{id}.
func TestCreateDocumentAnswersStoredIDs(t *testing.T) {
	t.Parallel()
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	if _, err := store.CreateDocument(claims.UserID, "", "Vorlage", "", "", []domain.DocumentBlock{
		{ID: "blk_vorlage1", Type: "bullet", Content: "Original"},
		{ID: "blk_vorlage2", Type: "bullet", Content: "Original 2"},
	}, nil, false); err != nil {
		t.Fatal(err)
	}

	body := `{"title":"Kopie","blocks":[
		{"id":"blk_vorlage1","type":"bullet","content":"Kopiert #kopie"},
		{"id":"blk_vorlage2","type":"todo","content":"Darunter","level":1},
		{"id":"","type":"bullet","content":"Ohne Id"},
		{"id":"blk_frei","type":"bullet","content":"Frei"},
		{"id":"blk_frei","type":"bullet","content":"Doppelt"}]}`
	rec := sessionCall(router, "POST", "/api/v1/documents", token, body, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var created domain.Document
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	rec = sessionCall(router, "GET", "/api/v1/documents/"+created.ID, token, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get: %d %s", rec.Code, rec.Body.String())
	}
	var stored domain.Document
	_ = json.Unmarshal(rec.Body.Bytes(), &stored)

	if len(created.Blocks) != 5 || len(stored.Blocks) != 5 {
		t.Fatalf("bullets: answer %d, stored %d", len(created.Blocks), len(stored.Blocks))
	}
	seen := map[string]bool{}
	for i, b := range created.Blocks {
		if b.ID != stored.Blocks[i].ID || b.Content != stored.Blocks[i].Content {
			t.Fatalf("bullet %d: answer %+v, stored %+v", i, b, stored.Blocks[i])
		}
		if b.ID == "" || b.ID == "blk_vorlage1" || b.ID == "blk_vorlage2" || seen[b.ID] {
			t.Fatalf("answer names id %q the note does not have", b.ID)
		}
		seen[b.ID] = true
	}
	if created.Blocks[3].ID != "blk_frei" {
		t.Fatalf("free id not kept: %q", created.Blocks[3].ID)
	}
}
