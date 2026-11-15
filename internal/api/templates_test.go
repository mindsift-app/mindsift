package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// PUT /documents/{id} with isTemplate marks the note as the caller's template; a reader may do it for
// themselves, someone without access gets 404, and the mark is in the note and the note list.
func TestDocumentTemplateFlag(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, err := store.CreateDocument(claims.UserID, "", "Wochenplan", "", "", []domain.DocumentBlock{
		{ID: "w1", Type: "todo", Content: "Einkaufen"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}

	rec := sessionCall(router, "PUT", "/api/v1/documents/"+doc.ID, token, `{"isTemplate":true}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("mark: %d %s", rec.Code, rec.Body.String())
	}
	var got domain.Document
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if !got.IsTemplate {
		t.Error("answer without isTemplate")
	}
	rec = sessionCall(router, "GET", "/api/v1/documents", token, "", "")
	var list []domain.Document
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	found := false
	for _, d := range list {
		if d.ID == doc.ID {
			found = d.IsTemplate
		}
	}
	if !found {
		t.Error("note list does not mark the template")
	}

	// Someone without access gets 404; with a read right they mark it for themselves
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	benToken, _ := auth.GenerateToken(srv.cfg.JWTSecret, ben.ID, ben.Email, ben.DisplayName, ben.TokenVersion, testSession(t, store, ben.ID))
	rec = sessionCall(router, "PUT", "/api/v1/documents/"+doc.ID, benToken, `{"isTemplate":true}`, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("stranger: %d %s, want 404", rec.Code, rec.Body.String())
	}
	if _, err := store.CreateDocShare(claims.UserID, doc.ID, ben.Email, "read"); err != nil {
		t.Fatal(err)
	}
	rec = sessionCall(router, "PUT", "/api/v1/documents/"+doc.ID, benToken, `{"isTemplate":true}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("reader: %d %s", rec.Code, rec.Body.String())
	}

	// Unmarking for the owner leaves the reader's mark
	rec = sessionCall(router, "PUT", "/api/v1/documents/"+doc.ID, token, `{"isTemplate":false}`, "")
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || got.IsTemplate {
		t.Fatalf("unmark: %d %+v", rec.Code, got.IsTemplate)
	}
	if d, _ := store.GetDocumentByID(ben.ID, doc.ID); d == nil || !d.IsTemplate {
		t.Error("the reader's template lost its mark")
	}
}
