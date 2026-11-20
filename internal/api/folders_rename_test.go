package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestRenameFolderEndpoint(t *testing.T) {
	_, store, ts, owner, token := startRealtimeServer(t)
	doc, err := store.CreateDocument(owner.ID, "", "Plan", "", "Alt", []domain.DocumentBlock{{ID: "x1", Type: "bullet", Content: "Text", Level: 0}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateFolder(owner.ID, "Belegt"); err != nil {
		t.Fatal(err)
	}

	resp := doJSON(t, ts, http.MethodPost, "/api/v1/folders/rename", token, map[string]string{"path": "Alt", "name": "Neu"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rename: status %d", resp.StatusCode)
	}
	var out struct {
		NewPath     string   `json:"newPath"`
		MovedDocIDs []string `json:"movedDocIds"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.NewPath != "Neu" || len(out.MovedDocIDs) != 1 || out.MovedDocIDs[0] != doc.ID {
		t.Errorf("unexpected answer: %+v", out)
	}
	if resp := doJSON(t, ts, http.MethodPost, "/api/v1/folders/rename", token, map[string]string{"path": "Neu", "name": "Belegt"}); resp.StatusCode != http.StatusConflict {
		t.Errorf("taken name: status %d, want 409", resp.StatusCode)
	}
	if resp := doJSON(t, ts, http.MethodPost, "/api/v1/folders/rename", token, map[string]string{"path": "Neu", "name": "a/b"}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("name with slash: status %d, want 400", resp.StatusCode)
	}
}
