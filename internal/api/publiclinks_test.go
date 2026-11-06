package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

func getPublic(t *testing.T, url, key string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if key != "" {
		req.Header.Set("X-Public-Key", key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func TestPublicLinks(t *testing.T) {
	srv, store, ts, owner, ownerToken := startRealtimeServer(t)
	_, otherToken := newTestUser(t, store, "andere@example.com")

	doc, err := store.CreateDocument(owner.ID, "", "Anleitung", "📘", "", []domain.DocumentBlock{
		{ID: "blk_a", Type: "bullet", Content: "Zugang: {{secret:sec_123}}", Level: 0, Position: 1},
		{ID: "blk_b", Type: "bullet", Content: "Siehe [[Geheime Notiz]]", Level: 0, Position: 2},
		{ID: "blk_c", Type: "bullet", Content: "Wird gelöscht", Level: 0, Position: 3},
	}, nil, false)
	if err != nil {
		t.Fatalf("create note: %v", err)
	}
	if _, _, err := store.ApplyDocOps(doc.ID, collab.Actor{UserID: owner.ID, ClientID: "test"}, []collab.Op{
		{OpID: "op1", Kind: "delete", BlockID: "blk_c"},
	}, nil); err != nil {
		t.Fatalf("delete block: %v", err)
	}

	// Only the owner, only allowed durations
	if resp := doJSON(t, ts, http.MethodPut, "/api/v1/documents/"+doc.ID+"/public-link", otherToken, map[string]any{"hours": 24}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("someone else made a link: status %d", resp.StatusCode)
	}
	if resp := doJSON(t, ts, http.MethodPut, "/api/v1/documents/"+doc.ID+"/public-link", ownerToken, map[string]any{"hours": 24 * 30}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a 30-day link must be refused: status %d", resp.StatusCode)
	}
	resp := doJSON(t, ts, http.MethodPut, "/api/v1/documents/"+doc.ID+"/public-link", ownerToken, map[string]any{"hours": 24})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create link: status %d", resp.StatusCode)
	}
	var state struct {
		Link *publicLinkView `json:"link"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&state)
	if state.Link == nil || len(state.Link.Token) < 40 {
		t.Fatalf("no usable token: %+v", state.Link)
	}
	url := ts.URL + "/api/v1/public/" + state.Link.Token

	// Visitors get the note without hidden values, deleted text, names or a way into other notes
	resp = getPublic(t, url, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("public note: status %d", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("X-Robots-Tag"), "noindex") {
		t.Errorf("public answers must carry noindex, got %q", resp.Header.Get("X-Robots-Tag"))
	}
	body, _ := io.ReadAll(resp.Body)
	for _, leak := range []string{"sec_123", "Wird gelöscht", owner.ID} {
		if strings.Contains(string(body), leak) {
			t.Errorf("public note leaks %q: %s", leak, body)
		}
	}
	var note struct {
		Title   string         `json:"title"`
		HeadSeq int64          `json:"headSeq"`
		Blocks  []collab.Block `json:"blocks"`
	}
	_ = json.Unmarshal(body, &note)
	if note.Title != "Anleitung" || !strings.Contains(string(body), storage.PublicSecretRef) {
		t.Errorf("unexpected public note: %s", body)
	}

	// Nothing changed: 204
	if resp := getPublic(t, url+"?since="+jsonNumber(note.HeadSeq), ""); resp.StatusCode != http.StatusNoContent {
		t.Errorf("unchanged note: status %d, want 204", resp.StatusCode)
	}

	// Password: locked without the key, a wrong password fails, the right one unlocks
	resp = doJSON(t, ts, http.MethodPut, "/api/v1/documents/"+doc.ID+"/public-link", ownerToken, map[string]any{"hours": 1, "password": "Sesam öffne dich"})
	_ = json.NewDecoder(resp.Body).Decode(&state)
	if resp := getPublic(t, url, ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("the replaced link must stop working: status %d", resp.StatusCode)
	}
	url = ts.URL + "/api/v1/public/" + state.Link.Token
	if resp := getPublic(t, url, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("locked link without key: status %d, want 401", resp.StatusCode)
	}
	if resp := doJSON(t, ts, http.MethodPost, "/api/v1/public/"+state.Link.Token+"/unlock", "", map[string]string{"password": "falsch"}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("wrong password: status %d", resp.StatusCode)
	}
	resp = doJSON(t, ts, http.MethodPost, "/api/v1/public/"+state.Link.Token+"/unlock", "", map[string]string{"password": "Sesam öffne dich"})
	var unlocked struct {
		Key string `json:"key"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&unlocked)
	if resp := getPublic(t, url, unlocked.Key); resp.StatusCode != http.StatusOK {
		t.Errorf("unlocked link: status %d", resp.StatusCode)
	}
	if resp := getPublic(t, url, unlocked.Key+"0"); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a tampered key must not open the link: status %d", resp.StatusCode)
	}

	// The admin's switch closes every link
	off := false
	sys, _ := store.GetSystemSettings()
	sys.PublicLinks = &off
	_ = store.UpdateSystemSettings(sys)
	if resp := getPublic(t, url, unlocked.Key); resp.StatusCode != http.StatusNotFound {
		t.Errorf("switched off: status %d, want 404", resp.StatusCode)
	}
	on := true
	sys.PublicLinks = &on
	_ = store.UpdateSystemSettings(sys)

	// Revoked: gone at once; expired links are cleaned up
	if resp := doJSON(t, ts, http.MethodDelete, "/api/v1/documents/"+doc.ID+"/public-link", ownerToken, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("revoke: status %d", resp.StatusCode)
	}
	if resp := getPublic(t, url, unlocked.Key); resp.StatusCode != http.StatusNotFound {
		t.Errorf("revoked link: status %d, want 404", resp.StatusCode)
	}
	resp = doJSON(t, ts, http.MethodPut, "/api/v1/documents/"+doc.ID+"/public-link", ownerToken, map[string]any{"hours": 1})
	_ = json.NewDecoder(resp.Body).Decode(&state)
	if n, _ := store.PurgePublicLinks(time.Now().Add(2 * time.Hour)); n != 1 {
		t.Errorf("an expired link should be purged, removed %d", n)
	}
	_ = srv
}

func jsonNumber(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
