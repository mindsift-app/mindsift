package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

var secretRefRe = regexp.MustCompile(`\{\{secret:([A-Za-z0-9_]+)\}\}`)

// secretIn: the id of the only reference in a bullet of the note ("" without one).
func secretIn(t *testing.T, store *storage.Store, userID, docID, blockID string) string {
	t.Helper()
	full, err := store.GetDocumentByID(userID, docID)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range full.Blocks {
		if b.ID == blockID {
			if m := secretRefRe.FindAllStringSubmatch(b.Content, -1); len(m) == 1 {
				return m[0][1]
			}
			return ""
		}
	}
	t.Fatalf("bullet %s not in %s", blockID, docID)
	return ""
}

func createSecretIn(t *testing.T, router http.Handler, token, docID, value string) string {
	t.Helper()
	rec := sessionCall(router, "POST", "/api/v1/documents/"+docID+"/secrets", token, `{"value":"`+value+`"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var created struct{ ID, Ref string }
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Ref != "{{secret:"+created.ID+"}}" {
		t.Fatalf("unexpected answer %+v", created)
	}
	return created.ID
}

func TestSecretsOnlyRevealToLoginsWithAccess(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, _ := store.CreateDocument(claims.UserID, "", "Server", "", "", nil, nil, false)
	id := createSecretIn(t, router, token, doc.ID, "192.168.1.10")
	ref := "{{secret:" + id + "}}"
	if sec, _ := store.GetSecret(id); strings.Contains(sec.Ciphertext, "192.168") {
		t.Fatalf("value stored in clear text")
	}
	reveal := func(docID, secretID, tok string) *httptest.ResponseRecorder {
		return sessionCall(router, "GET", "/api/v1/documents/"+docID+"/secrets/"+secretID, tok, "", "")
	}
	if rec := reveal(doc.ID, id, token); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "192.168.1.10") {
		t.Fatalf("owner reveal: %d %s", rec.Code, rec.Body.String())
	}

	// API keys (and so MCP) never reach it
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"tasks:read", "tasks:write"})
	req := httptest.NewRequest("GET", "/api/v1/documents/"+doc.ID+"/secrets/"+id, nil)
	req.Header.Set("X-API-Key", key.RawKey)
	keyRec := httptest.NewRecorder()
	router.ServeHTTP(keyRec, req)
	if keyRec.Code != http.StatusForbidden {
		t.Fatalf("API key must not reveal, got %d", keyRec.Code)
	}

	// A stranger writing the reference into an own note gets a placeholder, not the value
	stranger, strangerToken := newTestUser(t, store, "fremd@example.com")
	if rec := reveal(doc.ID, id, strangerToken); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger on the owner's note: want 404, got %d", rec.Code)
	}
	own, _ := store.CreateDocument(stranger.ID, "", "Geklaut", "", "", []domain.DocumentBlock{{ID: "s1", Type: "bullet", Content: ref}}, nil, false)
	if rec := reveal(own.ID, id, strangerToken); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger via own note: want 404, got %d", rec.Code)
	}
	if got := secretIn(t, store, stranger.ID, own.ID, "s1"); got != "" {
		t.Fatalf("the stranger's bullet still holds a reference: %s", got)
	}

	// The bullet copied into another note of the owner: that note gets its own value
	moved, _ := store.CreateDocument(claims.UserID, "", "Neu", "", "", []domain.DocumentBlock{{ID: "m1", Type: "bullet", Content: "IP " + ref}}, nil, false)
	cp := secretIn(t, store, claims.UserID, moved.ID, "m1")
	if cp == "" || cp == id {
		t.Fatalf("want a copy in the new note, got %q", cp)
	}
	if rec := reveal(moved.ID, id, token); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "secret_gone") {
		t.Fatalf("a note never reveals the value of another note: %d %s", rec.Code, rec.Body.String())
	}
	if rec := reveal(moved.ID, cp, token); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "192.168.1.10") {
		t.Fatalf("reveal of the copy: %d %s", rec.Code, rec.Body.String())
	}

	// Readers of the note may reveal, only writers may change it; the copy changes alone
	viewer, viewerToken := newTestUser(t, store, "leser@example.com")
	if _, err := store.CreateDocShare(claims.UserID, moved.ID, viewer.ID, "read"); err != nil {
		t.Fatal(err)
	}
	if rec := reveal(moved.ID, cp, viewerToken); rec.Code != http.StatusOK {
		t.Fatalf("reader reveal: %d", rec.Code)
	}
	put := func(secretID, tok string) int {
		return sessionCall(router, "PUT", "/api/v1/documents/"+moved.ID+"/secrets/"+secretID, tok, `{"value":"10.0.0.1"}`, "").Code
	}
	if code := put(cp, viewerToken); code != http.StatusForbidden {
		t.Fatalf("reader change: want 403, got %d", code)
	}
	if code := put(id, token); code != http.StatusNotFound {
		t.Fatalf("changing the value of another note through this one: want 404, got %d", code)
	}
	if code := put(cp, token); code != http.StatusNoContent {
		t.Fatalf("owner change: %d", code)
	}
	if rec := reveal(moved.ID, cp, token); !strings.Contains(rec.Body.String(), "10.0.0.1") {
		t.Fatalf("changed value not returned: %s", rec.Body.String())
	}
	if rec := reveal(doc.ID, id, token); !strings.Contains(rec.Body.String(), "192.168.1.10") {
		t.Fatalf("changing the copy changed the original: %s", rec.Body.String())
	}
	if rec := reveal(moved.ID, "sec_missing", token); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "secret_gone") {
		t.Fatalf("unknown secret: %d %s", rec.Code, rec.Body.String())
	}
}

// A reader pasting a bullet with the owner's value into an own note gets a copy of their own: the sync
// answer brings the bullet with the new reference back to the editor. Changing the copy leaves the
// owner's value alone, and the copy stays when the share ends (a copy is a copy); pasting again after
// that gives the placeholder.
func TestSecretCopiedByAReaderIsTheirOwn(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	doc, _ := store.CreateDocument(claims.UserID, "", "Server", "", "", nil, nil, false)
	id := createSecretIn(t, router, token, doc.ID, "geheim")
	ref := "{{secret:" + id + "}}"

	reader, readerToken := newTestUser(t, store, "leser@example.com")
	if _, err := store.CreateDocShare(claims.UserID, doc.ID, reader.ID, "read"); err != nil {
		t.Fatal(err)
	}
	own, _ := store.CreateDocument(reader.ID, "", "Kopie", "", "", nil, nil, false)
	sync := func(blockID, content string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"clientId": "c1", "lastSeq": 0, "ops": []map[string]any{{
			"opId": "op_" + blockID, "kind": "insert", "blockId": blockID, "parentId": "", "orderKey": "a" + blockID[len(blockID)-1:], "type": "bullet", "content": content,
		}}})
		rec := sessionCall(router, "POST", "/api/v1/docs/"+own.ID+"/sync", readerToken, string(body), "")
		if rec.Code != http.StatusOK {
			t.Fatalf("sync: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Results []struct{ Status string }
			Ops     []struct {
				Effect struct{ BlockID, Content string }
			}
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if len(res.Results) != 1 || res.Results[0].Status != "applied" {
			t.Fatalf("sync result: %s", rec.Body.String())
		}
		for _, e := range res.Ops {
			if e.Effect.BlockID == blockID {
				return e.Effect.Content
			}
		}
		t.Fatalf("the sync answer does not bring the bullet back: %s", rec.Body.String())
		return ""
	}
	got := sync("c1", "Zugang "+ref)
	m := secretRefRe.FindStringSubmatch(got)
	if m == nil || m[1] == id {
		t.Fatalf("the editor must get the rewritten reference, got %q", got)
	}
	cp := m[1]
	reveal := func(docID, secretID string) *httptest.ResponseRecorder {
		return sessionCall(router, "GET", "/api/v1/documents/"+docID+"/secrets/"+secretID, readerToken, "", "")
	}
	if rec := reveal(own.ID, cp); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "geheim") {
		t.Fatalf("reader reveals the own copy: %d %s", rec.Code, rec.Body.String())
	}
	if rec := reveal(own.ID, id); rec.Code != http.StatusNotFound {
		t.Fatalf("the owner's value through the reader's note: want 404, got %d", rec.Code)
	}
	if rec := sessionCall(router, "PUT", "/api/v1/documents/"+own.ID+"/secrets/"+cp, readerToken, `{"value":"x"}`, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("reader changing the own copy: want 204, got %d", rec.Code)
	}
	if rec := sessionCall(router, "GET", "/api/v1/documents/"+doc.ID+"/secrets/"+id, token, "", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "geheim") {
		t.Fatalf("owner lost the value: %d %s", rec.Code, rec.Body.String())
	}

	if rec := sessionCall(router, "DELETE", "/api/v1/documents/"+doc.ID+"/shares/"+reader.ID, token, "", ""); rec.Code >= 300 {
		t.Fatalf("ending the share: %d %s", rec.Code, rec.Body.String())
	}
	if rec := reveal(own.ID, cp); rec.Code != http.StatusOK {
		t.Fatalf("the copy stays after the share ended: %d", rec.Code)
	}
	if got := sync("c2", ref); strings.Contains(got, "{{secret:") {
		t.Fatalf("without access to the note of origin a paste gives the placeholder, got %q", got)
	}
}

// An agent adding a bullet with a reference over MCP: the same rule as the editor.
func TestMCPBulletWithSecretGetsOwnCopy(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write"})
	origin, _ := store.CreateDocument(claims.UserID, "", "Server", "", "", nil, nil, false)
	id := createSecretIn(t, router, token, origin.ID, "10.1.1.1")
	target, _ := store.CreateDocument(claims.UserID, "", "Ziel", "", "", []domain.DocumentBlock{{ID: "blk_t0", Type: "text", Content: "Start"}}, nil, false)
	if _, isErr, msg := call(key.RawKey, "add_note_bullet", `{"noteId":"`+target.ID+`","text":"IP {{secret:`+id+`}}"}`); isErr {
		t.Fatalf("add_note_bullet: %s", msg)
	}
	full, _ := store.GetDocumentByID(claims.UserID, target.ID)
	var cp string
	for _, b := range full.Blocks {
		if m := secretRefRe.FindStringSubmatch(b.Content); m != nil {
			cp = m[1]
		}
	}
	if cp == "" || cp == id {
		t.Fatalf("want a copy in the target note: %+v", full.Blocks)
	}
	if rec := sessionCall(router, "GET", "/api/v1/documents/"+target.ID+"/secrets/"+cp, token, "", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "10.1.1.1") {
		t.Fatalf("reveal of the copy: %d %s", rec.Code, rec.Body.String())
	}
}
