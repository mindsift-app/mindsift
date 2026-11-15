package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

// GET /lists/{id}/suggestions: anyone who may read the list (viewers too) gets its history, others a
// 404 like for a missing list; API keys need lists:read
func TestListSuggestionsEndpoint(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	viewer, viewerToken := newTestUser(t, store, "mitbewohner@example.com")
	_, strangerToken := newTestUser(t, store, "fremd@example.com")
	list, err := store.CreateList(owner.ID, "Supermarkt", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddListShare(owner.ID, list.ID, "user", viewer.ID, "viewer"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"Milch #Kühlregal", "Mineralwasser", "Milch"} {
		if resp := doJSON(t, ts, http.MethodPost, "/api/v1/lists/"+list.ID+"/items", ownerToken, map[string]string{"content": name}); resp.StatusCode != http.StatusCreated {
			t.Fatalf("add %q: %d", name, resp.StatusCode)
		}
	}
	if resp := doJSON(t, ts, http.MethodPost, "/api/v1/lists/"+list.ID+"/clear-completed", ownerToken, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("clear: %d", resp.StatusCode)
	}

	var body struct {
		Items []struct {
			Content  string `json:"content"`
			Category string `json:"category"`
			Count    int    `json:"count"`
		} `json:"items"`
	}
	resp := doJSON(t, ts, http.MethodGet, "/api/v1/lists/"+list.ID+"/suggestions?q=mi", viewerToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("viewer: %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Items) != 2 || body.Items[0].Content != "Milch" || body.Items[0].Count != 2 || body.Items[0].Category != "Kühlregal" {
		t.Fatalf("suggestions: %+v", body.Items)
	}

	if resp := doJSON(t, ts, http.MethodGet, "/api/v1/lists/"+list.ID+"/suggestions", strangerToken, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("stranger: %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, ts, http.MethodGet, "/api/v1/lists/lst_missing/suggestions", ownerToken, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing list: %d, want 404", resp.StatusCode)
	}

	reader, _ := store.CreateAPIKey(owner.ID, "Leser", []string{"lists:read"})
	tasksOnly, _ := store.CreateAPIKey(owner.ID, "Nur Aufgaben", []string{"tasks:read"})
	if code, _ := keyRequest(t, ts.Config.Handler, reader.RawKey, http.MethodGet, "/api/v1/lists/"+list.ID+"/suggestions", ""); code != http.StatusOK {
		t.Fatalf("lists:read key: %d", code)
	}
	if code, _ := keyRequest(t, ts.Config.Handler, tasksOnly.RawKey, http.MethodGet, "/api/v1/lists/"+list.ID+"/suggestions", ""); code != http.StatusForbidden {
		t.Fatalf("tasks:read key: %d, want 403", code)
	}
}
