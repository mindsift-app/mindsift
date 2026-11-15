package api

import (
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// snapBullet: a bullet of the stored note (type, text, language)
func snapBullet(t *testing.T, srv *Server, docID, id string) (typ, content, lang string) {
	t.Helper()
	snap, err := srv.store.GetDocSnapshot(docID)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range snap.Blocks {
		if b.ID == id && !b.Deleted {
			return b.Type, b.Content, b.Props.Lang
		}
	}
	t.Fatalf("bullet %s not in %s", id, docID)
	return
}

// Code bullets with a language and dividers, as /code and /divider make them; code keeps no hidden value.
func TestMCPCodeAndDivider(t *testing.T) {
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write"})
	reader, _ := store.CreateAPIKey(claims.UserID, "Leser", []string{"notes:read"})
	doc, err := store.CreateDocument(claims.UserID, "", "Technik", "", "", []domain.DocumentBlock{
		{ID: "blk_cd1", Type: "text", Content: "Eins", Level: 0},
		{ID: "blk_cd2", Type: "table", Content: "| a | b |\n| --- | --- |\n| 1 | 2 |", Lang: "wrap", Level: 0},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := store.CreateDocument(claims.UserID, "", "Andere Notiz", "", "", nil, nil, false)
	_ = other

	// Code with an editor id, an alias and an unknown language; [[…]] stays text in code
	code := "func main() {\n\tfmt.Println(\"[[Andere Notiz]]\")\n}"
	for _, c := range []struct{ lang, want string }{{"go", "go"}, {"TS", "typescript"}, {"c++", "cpp"}, {"klingon", ""}, {"", ""}} {
		res, isErr, msg := call(key.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","type":"code","language":"`+c.lang+`","text":`+jsonString(code)+`}`)
		if isErr {
			t.Fatalf("code %q: %s", c.lang, msg)
		}
		id := res["addedId"].(string)
		typ, content, lang := snapBullet(t, srv, doc.ID, id)
		if typ != "code" || content != code || lang != c.want {
			t.Fatalf("code %q: %s %q %q", c.lang, typ, content, lang)
		}
		if b := bulletByID(t, res, id); b["language"] != nilIfEmpty(c.want) {
			t.Fatalf("get_note language for %q: %v", c.lang, b)
		}
	}
	// A language for anything but code, an unknown type
	if _, isErr, msg := call(key.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","type":"text","language":"go","text":"x"}`); !isErr || !strings.Contains(msg, "language") {
		t.Fatalf("language on text: %v %s", isErr, msg)
	}
	if _, isErr, _ := call(key.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","type":"quote","text":"x"}`); !isErr {
		t.Fatal("unknown type must fail")
	}

	// A divider has no text, even when one is sent; no text needed at all
	res, isErr, msg := call(key.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","type":"divider","text":"---","afterId":"blk_cd1"}`)
	if isErr {
		t.Fatalf("divider: %s", msg)
	}
	div := res["addedId"].(string)
	if typ, content, _ := snapBullet(t, srv, doc.ID, div); typ != "divider" || content != "" {
		t.Fatalf("divider: %s %q", typ, content)
	}
	if _, isErr, msg := call(key.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","type":"divider"}`); isErr {
		t.Fatalf("divider without text: %s", msg)
	}
	if _, isErr, msg := call(key.RawKey, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"`+div+`","text":"Titel"}`); !isErr || !strings.Contains(msg, "divider") {
		t.Fatalf("text for a divider: %v %s", isErr, msg)
	}

	// update: text becomes code with a language, the language changes, the line becomes text again
	if _, isErr, msg := call(key.RawKey, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_cd1","type":"code","language":"py","text":"print(1)"}`); isErr {
		t.Fatalf("to code: %s", msg)
	}
	if typ, content, lang := snapBullet(t, srv, doc.ID, "blk_cd1"); typ != "code" || content != "print(1)" || lang != "python" {
		t.Fatalf("to code: %s %q %q", typ, content, lang)
	}
	if _, isErr, msg := call(key.RawKey, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_cd1","language":"bash"}`); isErr {
		t.Fatalf("language only: %s", msg)
	}
	if _, _, lang := snapBullet(t, srv, doc.ID, "blk_cd1"); lang != "bash" {
		t.Fatalf("language only: %q", lang)
	}
	if _, isErr, _ := call(key.RawKey, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"`+div+`","language":"go"}`); !isErr {
		t.Fatal("a language for a divider must fail")
	}
	// A table's line mode is no language: it goes when the table becomes code
	if _, isErr, msg := call(key.RawKey, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_cd2","type":"code"}`); isErr {
		t.Fatalf("table to code: %s", msg)
	}
	if typ, _, lang := snapBullet(t, srv, doc.ID, "blk_cd2"); typ != "code" || lang != "" {
		t.Fatalf("table to code: %s %q", typ, lang)
	}
	// A bullet that becomes a divider loses its text
	if _, isErr, msg := call(key.RawKey, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_cd2","type":"divider"}`); isErr {
		t.Fatalf("to divider: %s", msg)
	}
	if typ, content, _ := snapBullet(t, srv, doc.ID, "blk_cd2"); typ != "divider" || content != "" {
		t.Fatalf("to divider: %s %q", typ, content)
	}

	// Code keeps no hidden value: written into a new code bullet, into an existing one, or a bullet
	// with one becoming code — each time the placeholder instead of the reference
	secret := createSecretIn(t, srv.Router(), token, doc.ID, "10.0.0.1")
	ref := "{{secret:" + secret + "}}"
	res, _, _ = call(key.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","type":"code","text":"ssh `+ref+`"}`)
	codeID := res["addedId"].(string)
	if _, content, _ := snapBullet(t, srv, doc.ID, codeID); strings.Contains(content, ref) || !strings.HasPrefix(content, "ssh ") {
		t.Fatalf("new code bullet kept the value: %q", content)
	}
	if _, isErr, _ := call(key.RawKey, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"`+codeID+`","text":"scp `+ref+`"}`); isErr {
		t.Fatal("update code text")
	}
	if _, content, _ := snapBullet(t, srv, doc.ID, codeID); strings.Contains(content, ref) || !strings.HasPrefix(content, "scp ") {
		t.Fatalf("code text kept the value: %q", content)
	}
	res, _, _ = call(key.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","text":"IP `+ref+`"}`)
	plainID := res["addedId"].(string)
	if _, content, _ := snapBullet(t, srv, doc.ID, plainID); !strings.Contains(content, ref) {
		t.Fatalf("a text bullet keeps its value: %q", content)
	}
	if _, isErr, _ := call(key.RawKey, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"`+plainID+`","type":"code"}`); isErr {
		t.Fatal("text with a value to code")
	}
	if _, content, _ := snapBullet(t, srv, doc.ID, plainID); strings.Contains(content, ref) || !strings.HasPrefix(content, "IP ") {
		t.Fatalf("bullet turned into code kept the value: %q", content)
	}

	// Only with notes:write
	if _, isErr, _ := call(reader.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","type":"code","text":"x"}`); !isErr {
		t.Fatal("notes:read must not add code")
	}
}

func jsonString(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`, "\t", `\t`).Replace(s) + `"`
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
