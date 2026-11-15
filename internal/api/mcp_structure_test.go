package api

import (
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
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

// move_note_bullet places a bullet with its children like drag and drop, Alt+Shift+arrows, Tab and Shift+Tab.
func TestMCPMoveNoteBullet(t *testing.T) {
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write"})
	doc, err := store.CreateDocument(claims.UserID, "", "Ordnen", "", "", []domain.DocumentBlock{
		{ID: "blk_mv_a", Type: "text", Content: "A", Level: 0},
		{ID: "blk_mv_a1", Type: "text", Content: "A1", Level: 1},
		{ID: "blk_mv_b", Type: "text", Content: "B", Level: 0},
		{ID: "blk_mv_b1", Type: "text", Content: "B1", Level: 1},
		{ID: "blk_mv_b2", Type: "text", Content: "B2", Level: 1},
		{ID: "blk_mv_b3", Type: "text", Content: "B3", Level: 1},
		{ID: "blk_mv_c", Type: "text", Content: "C", Level: 0},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	move := func(args string) (string, bool, string) {
		t.Helper()
		res, isErr, msg := call(key.RawKey, "move_note_bullet", `{"noteId":"`+doc.ID+`",`+args+`}`)
		return strings.Join(bulletTexts(res), "|"), isErr, msg
	}
	expect := func(args, want string) {
		t.Helper()
		got, isErr, msg := move(args)
		if isErr || got != want {
			t.Fatalf("%s:\n got %s %s\nwant %s", args, got, msg, want)
		}
	}
	// Places: after (with its children), before, as the last child, to the end of the top level
	expect(`"bulletId":"blk_mv_a","afterId":"blk_mv_c"`, "0:B|1:B1|1:B2|1:B3|0:C|0:A|1:A1")
	expect(`"bulletId":"blk_mv_a","beforeId":"blk_mv_b"`, "0:A|1:A1|0:B|1:B1|1:B2|1:B3|0:C")
	expect(`"bulletId":"blk_mv_c","parentId":"blk_mv_a"`, "0:A|1:A1|1:C|0:B|1:B1|1:B2|1:B3")
	expect(`"bulletId":"blk_mv_c","parentId":""`, "0:A|1:A1|0:B|1:B1|1:B2|1:B3|0:C")
	expect(`"bulletId":"blk_mv_b2","afterId":"blk_mv_a1"`, "0:A|1:A1|1:B2|0:B|1:B1|1:B3|0:C")
	// Steps: up, down, indent (below the bullet above, as its last child), outdent (followers become children)
	expect(`"bulletId":"blk_mv_b3","step":"up"`, "0:A|1:A1|1:B2|0:B|1:B3|1:B1|0:C")
	expect(`"bulletId":"blk_mv_b3","step":"down"`, "0:A|1:A1|1:B2|0:B|1:B1|1:B3|0:C")
	expect(`"bulletId":"blk_mv_c","step":"indent"`, "0:A|1:A1|1:B2|0:B|1:B1|1:B3|1:C")
	expect(`"bulletId":"blk_mv_b1","step":"outdent"`, "0:A|1:A1|1:B2|0:B|0:B1|1:B3|1:C")

	// Wrong input: nothing changes
	for name, args := range map[string]string{
		"into itself":       `"bulletId":"blk_mv_a","parentId":"blk_mv_a"`,
		"into its children": `"bulletId":"blk_mv_a","afterId":"blk_mv_a1"`,
		"before itself":     `"bulletId":"blk_mv_b1","beforeId":"blk_mv_b1"`,
		"no target":         `"bulletId":"blk_mv_a"`,
		"two targets":       `"bulletId":"blk_mv_a","afterId":"blk_mv_b","step":"up"`,
		"unknown step":      `"bulletId":"blk_mv_a","step":"sideways"`,
		"unknown bullet":    `"bulletId":"blk_nope","step":"up"`,
		"unknown target":    `"bulletId":"blk_mv_a","afterId":"blk_nope"`,
		"first up":          `"bulletId":"blk_mv_a","step":"up"`,
		"last down":         `"bulletId":"blk_mv_b1","step":"down"`,
		"indent first":      `"bulletId":"blk_mv_a1","step":"indent"`,
		"outdent top":       `"bulletId":"blk_mv_a","step":"outdent"`,
	} {
		if got, isErr, msg := move(args); !isErr || strings.Contains(msg, "Internal error") || got != "" {
			t.Errorf("%s: want a clear tool error, got %v %s %s", name, isErr, got, msg)
		}
	}
	if res, _, _ := call(key.RawKey, "get_note", `{"id":"`+doc.ID+`"}`); strings.Join(bulletTexts(res), "|") != "0:A|1:A1|1:B2|0:B|0:B1|1:B3|1:C" {
		t.Fatalf("refused moves changed the note: %v", bulletTexts(res))
	}

	// A bullet someone is editing stays where it is
	srv.leases.Hold(doc.ID, collab.Actor{UserID: claims.UserID, ClientID: "browser"}, []string{"blk_mv_c"})
	if _, isErr, msg := move(`"bulletId":"blk_mv_c","parentId":""`); !isErr || !strings.Contains(msg, "editing this bullet") {
		t.Fatalf("leased bullet: %s", msg)
	}
	// Outdent moves the followers as well: one of them being edited stops it
	if _, isErr, _ := move(`"bulletId":"blk_mv_b3","step":"outdent"`); !isErr {
		t.Fatal("outdent with a leased follower must be refused")
	}

	// No write right: a notes:read key, a read-only share
	reader, _ := store.CreateAPIKey(claims.UserID, "Leser", []string{"notes:read"})
	if _, isErr, _ := call(reader.RawKey, "move_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_mv_a","step":"down"}`); !isErr {
		t.Fatal("notes:read must not move bullets")
	}
	other, _ := newTestUser(t, store, "nur-lesen@example.com")
	if _, err := store.CreateDocShare(claims.UserID, doc.ID, other.ID, "read"); err != nil {
		t.Fatal(err)
	}
	otherKey, _ := store.CreateAPIKey(other.ID, "Agent", []string{"notes:read", "notes:write"})
	if _, isErr, msg := call(otherKey.RawKey, "move_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_mv_a","step":"down"}`); !isErr || !strings.Contains(msg, "write") {
		t.Fatalf("read-only share: %v %s", isErr, msg)
	}
}

// A conflict copy stays right below its bullet when that one moves (the editor moves them together).
func TestMCPMoveKeepsConflictCopies(t *testing.T) {
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write"})
	doc, _ := store.CreateDocument(claims.UserID, "", "Konflikt", "", "", []domain.DocumentBlock{
		{ID: "blk_kc_a", Type: "text", Content: "A", Level: 0},
		{ID: "blk_kc_b", Type: "text", Content: "B", Level: 0},
	}, nil, false)
	// Two writers on the same version: the second one's text becomes a conflict copy below B
	snap, _ := store.GetDocSnapshot(doc.ID)
	version := 0
	for _, b := range snap.Blocks {
		if b.ID == "blk_kc_b" {
			version = b.Version
		}
	}
	for i, text := range []string{"B neu", "B anders"} {
		op := collab.Op{OpID: "kc" + string(rune('0'+i)), Kind: collab.OpSetContent, BlockID: "blk_kc_b", BaseVersion: version, Content: &text}
		if _, _, err := store.ApplyDocOps(doc.ID, collab.Actor{UserID: claims.UserID, ClientID: "tab" + string(rune('0'+i))}, []collab.Op{op}, nil); err != nil {
			t.Fatal(err)
		}
	}
	res, isErr, msg := call(key.RawKey, "move_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_kc_b","step":"up"}`)
	if got := strings.Join(bulletTexts(res), "|"); isErr || got != "0:B neu|0:B anders|0:A" {
		t.Fatalf("copy must move along: %s %s", got, msg)
	}
}
