package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// A note title has at most collab.MaxTitleRunes characters through REST, MCP and the sync; a longer title
// from before (or an import) stays and may be edited as long as it does not grow.
func TestNoteTitleLimit(t *testing.T) {
	srv, store, token := setupTestServer(t)
	router := srv.Router()
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	agentKey, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write", "notes:create"})

	// Umlauts count as one character each
	atLimit := strings.Repeat("ä", collab.MaxTitleRunes)
	tooLong := atLimit + "x"

	rec := sessionCall(router, "POST", "/api/v1/documents", token, `{"title":"`+atLimit+`"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create at the limit: %d %s", rec.Code, rec.Body.String())
	}
	rec = sessionCall(router, "POST", "/api/v1/documents", token, `{"title":"`+tooLong+`"}`, "")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "60") {
		t.Fatalf("create too long: %d %s", rec.Code, rec.Body.String())
	}
	if _, isErr, msg := call(agentKey.RawKey, "create_note", `{"title":"`+tooLong+`"}`); !isErr || !strings.Contains(msg, "60") {
		t.Fatalf("MCP create too long: %v %s", isErr, msg)
	}

	// A longer title from before the limit (stored directly, like an import)
	old := strings.TrimSpace(strings.Repeat("Langer Titel ", 8)) // 103 characters
	doc, err := store.CreateDocument(claims.UserID, "", old, "", "", []domain.DocumentBlock{{ID: "blk_nt1", Type: "text", Content: "x"}}, nil, false)
	if err != nil || doc.Title != old {
		t.Fatalf("stored long title: %v %q", err, doc.Title)
	}
	patch := func(title string) int {
		body, _ := json.Marshal(map[string]string{"title": title})
		return sessionCall(router, "PUT", "/api/v1/documents/"+doc.ID, token, string(body), "").Code
	}
	if code := patch(old + " mehr"); code != http.StatusBadRequest {
		t.Fatalf("growing a long title: %d", code)
	}
	if code := patch(old[:80]); code != http.StatusOK {
		t.Fatalf("shortening a long title: %d", code)
	}
	short, _ := store.CreateDocument(claims.UserID, "", "Kurz", "", "", nil, nil, false)
	if _, isErr, msg := call(agentKey.RawKey, "update_note", `{"id":"`+short.ID+`","title":"`+tooLong+`"}`); !isErr || !strings.Contains(msg, "60") {
		t.Fatalf("MCP update too long: %v %s", isErr, msg)
	}
	if _, isErr, msg := call(agentKey.RawKey, "update_note", `{"id":"`+doc.ID+`","title":"Kurz"}`); isErr {
		t.Fatalf("MCP update: %s", msg)
	}
}

func TestTitleAllowed(t *testing.T) {
	limit := strings.Repeat("a", collab.MaxTitleRunes)
	cases := []struct {
		title, current string
		want           bool
	}{
		{limit, "", true},
		{limit + "b", "", false},
		{limit + "b", limit + "bc", true},    // shortening a longer title
		{limit + "bcd", limit + "bc", false}, // growing it
	}
	for _, c := range cases {
		if got := collab.TitleAllowed(c.title, c.current); got != c.want {
			t.Errorf("TitleAllowed(%d runes, %d runes) = %v", len(c.title), len(c.current), got)
		}
	}
	d := collab.NewDoc()
	d.Title = "Kurz"
	long := limit + "b"
	_, res := collab.Apply(d, collab.Op{OpID: "op1", Kind: collab.OpSetTitle, Title: &long, BaseVersion: d.TitleVersion}, collab.Actor{UserID: "u"}, collab.Env{})
	if res.Status != collab.StatusRejected || res.Reason != "too_long" {
		t.Fatalf("set_title too long: %+v", res)
	}
}
