package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// GET /documents answers without bullets but with their counts; to-dos and single bullets have their own
// routes, and nobody reads a bullet of a note they cannot see.
func TestNoteListRoutes(t *testing.T) {
	t.Parallel()
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, err := store.CreateDocument(claims.UserID, "", "Einkauf", "", "", []domain.DocumentBlock{
		{ID: "t1", Type: "todo", Content: "Milch #laden"},
		{ID: "b1", Type: "bullet", Content: "Notiz"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}

	rec := sessionCall(router, "GET", "/api/v1/documents", token, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	var list []map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	var note map[string]any
	for _, d := range list {
		if blocks, _ := d["blocks"].([]any); len(blocks) != 0 || d["content"] != "" {
			t.Fatalf("list carries bullets: %v", d)
		}
		if d["id"] == doc.ID {
			note = d
		}
	}
	if note == nil {
		t.Fatal("note missing from the list")
	}
	if note["openTodos"] != float64(1) {
		t.Fatalf("openTodos = %v", note["openTodos"])
	}
	if tc, _ := note["tagCounts"].(map[string]any); tc["laden"] != float64(1) {
		t.Fatalf("tagCounts = %v", note["tagCounts"])
	}

	rec = sessionCall(router, "GET", "/api/v1/documents/todos", token, "", "")
	var todos []domain.NoteTodo
	_ = json.Unmarshal(rec.Body.Bytes(), &todos)
	mine := 0
	for _, td := range todos {
		if td.DocID == doc.ID {
			mine++
			if td.BlockID != "t1" || td.Content != "Milch #laden" {
				t.Fatalf("to-do: %+v", td)
			}
		}
	}
	if rec.Code != http.StatusOK || mine != 1 {
		t.Fatalf("todos: %d %s", rec.Code, rec.Body.String())
	}

	rec = sessionCall(router, "GET", "/api/v1/blocks/b1", token, "", "")
	if rec.Code != http.StatusOK || !json.Valid(rec.Body.Bytes()) {
		t.Fatalf("own bullet: %d %s", rec.Code, rec.Body.String())
	}
	_, strangerToken := newTestUser(t, store, "fremd@example.com")
	if rec := sessionCall(router, "GET", "/api/v1/blocks/b1", strangerToken, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("someone else's bullet: want 404, got %d", rec.Code)
	}
	if rec := sessionCall(router, "GET", "/api/v1/documents/todos", strangerToken, "", ""); rec.Code != http.StatusOK || rec.Body.String() == "" {
		t.Fatalf("stranger's to-dos: %d", rec.Code)
	} else {
		var none []domain.NoteTodo
		_ = json.Unmarshal(rec.Body.Bytes(), &none)
		if len(none) != 0 {
			t.Fatalf("stranger sees to-dos: %v", none)
		}
	}
}
