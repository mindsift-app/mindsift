package api

import (
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// create_note takes content the way small models send it, never stores an empty note silently,
// checks the icon and links the note into the app.
func TestMCPCreateNoteContentIconAndLinks(t *testing.T) {
	srv, store, token := setupTestServer(t)
	srv.cfg.BaseURL = "https://ms.example/"
	srv.cfg.BaseURLSet = true
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	key, _ := store.CreateAPIKey(claims.UserID, "Modell", []string{"notes:create", "notes:read", "notes:write", "tasks:read"})
	call := mcpCaller(t, srv)
	texts := func(id string) []string {
		t.Helper()
		doc, err := store.GetDocumentByID(claims.UserID, id)
		if err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, b := range doc.Blocks {
			out = append(out, b.Content)
		}
		return out
	}

	cases := []struct {
		name, content string
		want          []string
	}{
		{"paragraphs", `"Erster Absatz.\n\n      Zweiter Absatz, tief eingerückt.\n\n1. Eins\n2. Zwei"`, []string{"Erster Absatz.", "Zweiter Absatz, tief eingerückt.", "Eins", "Zwei"}},
		{"escaped twice", `"Erste Zeile\\n\\nZweite Zeile"`, []string{"Erste Zeile", "Zweite Zeile"}},
		{"list of strings", `["Milch", "Brot"]`, []string{"Milch", "Brot"}},
		{"indented quote", `"Absatz\n  > Zitat"`, []string{"Absatz", "> Zitat"}},
	}
	for _, c := range cases {
		note, isErr, text := call(key.RawKey, "create_note", `{"title":"Test","content":`+c.content+`}`)
		if isErr {
			t.Fatalf("%s: %s", c.name, text)
		}
		if got := texts(note["id"].(string)); strings.Join(got, "|") != strings.Join(c.want, "|") {
			t.Fatalf("%s: bullets %q, want %q", c.name, got, c.want)
		}
		if note["warnings"] != nil {
			t.Fatalf("%s: unexpected warnings %v", c.name, note["warnings"])
		}
	}

	// Text that gives no bullets, and a misspelled field, come back as warnings
	note, _, _ := call(key.RawKey, "create_note", `{"title":"Leer","content":"---","body":"Text"}`)
	if w := strings.Join(toStrings(note["warnings"]), " "); !strings.Contains(w, "gave no bullets") || !strings.Contains(w, "arguments: body") {
		t.Fatalf("warnings: %v", note["warnings"])
	}
	// Without content an empty note is fine
	if note, _, _ := call(key.RawKey, "create_note", `{"title":"Leer"}`); note["warnings"] != nil {
		t.Fatalf("empty note must not warn: %v", note["warnings"])
	}

	// Icons: one emoji or nothing
	for _, icon := range []string{"🗒️", "👩‍💻", "👍🏽", "🇩🇪", "1️⃣", "❤️", "★"} {
		if _, isErr, text := call(key.RawKey, "create_note", `{"title":"Icon","icon":"`+icon+`"}`); isErr {
			t.Fatalf("icon %q refused: %s", icon, text)
		}
	}
	for _, icon := range []string{"optional", "📋📋", "a", "1", "🗒️ Notiz"} {
		if _, isErr, text := call(key.RawKey, "create_note", `{"title":"Icon","icon":"`+icon+`"}`); !isErr || !strings.Contains(text, "single emoji") {
			t.Fatalf("icon %q must be refused, got %v %s", icon, isErr, text)
		}
	}
	if _, isErr, _ := call(key.RawKey, "update_note", `{"id":"`+note["id"].(string)+`","icon":"optional"}`); !isErr {
		t.Fatal("update_note must refuse a word as icon")
	}

	// Links into the app
	if note["url"] != "https://ms.example/?note="+note["id"].(string) {
		t.Fatalf("note url: %v", note["url"])
	}
	got, _, _ := call(key.RawKey, "get_note", `{"id":"`+note["id"].(string)+`"}`)
	if got["url"] != note["url"] {
		t.Fatalf("get_note url: %v", got["url"])
	}
	found, _, _ := call(key.RawKey, "search", `{"query":"Milch"}`)
	if hits := found["notes"].([]any); len(hits) == 0 || !strings.HasPrefix(hits[0].(map[string]any)["url"].(string), "https://ms.example/?note=doc") {
		t.Fatalf("search url: %v", found)
	}
	task, _ := store.CreateThoughtWithDetails(claims.UserID, "Milch kaufen", "normal", "manual", "", "", "todo", "")
	if got, _, _ := call(key.RawKey, "get_task", `{"id":"`+task.ID+`"}`); got["url"] != "https://ms.example/?task="+task.ID {
		t.Fatalf("task url: %v", got["url"])
	}

	// Without BASE_URL there is no address to link to
	srv.cfg.BaseURLSet = false
	if got, _, _ := call(key.RawKey, "get_note", `{"id":"`+note["id"].(string)+`"}`); got["url"] != nil {
		t.Fatalf("no url without BASE_URL: %v", got["url"])
	}
}

func toStrings(v any) []string {
	out := []string{}
	items, _ := v.([]any)
	for _, it := range items {
		out = append(out, it.(string))
	}
	return out
}
