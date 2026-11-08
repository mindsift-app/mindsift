package api

import (
	"fmt"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// mcpCaller returns a function that calls one tool with a key and gives its structured result.
func mcpCaller(t *testing.T, srv *Server) func(key, name, args string) (map[string]interface{}, bool, string) {
	router := srv.Router()
	return func(key, name, args string) (map[string]interface{}, bool, string) {
		t.Helper()
		_, res := rpc(t, router, key, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+name+`","arguments":`+args+`}}`)
		result, isErr := callResult(t, res)
		sc, _ := result["structuredContent"].(map[string]interface{})
		return sc, isErr, fmt.Sprint(result["content"])
	}
}

func bulletTexts(res map[string]interface{}) []string {
	out := []string{}
	bullets, _ := res["bullets"].([]interface{})
	for _, b := range bullets {
		m := b.(map[string]interface{})
		out = append(out, fmt.Sprintf("%v:%v", m["level"], m["text"]))
	}
	return out
}

func bulletID(t *testing.T, res map[string]interface{}, text string) string {
	t.Helper()
	bullets, _ := res["bullets"].([]interface{})
	for _, b := range bullets {
		m := b.(map[string]interface{})
		if m["text"] == text {
			return m["id"].(string)
		}
	}
	t.Fatalf("bullet %q not in %v", text, res["bullets"])
	return ""
}

// notes:write changes bullets through the sync operations, renames and trashes own notes only.
func TestMCPNoteWrite(t *testing.T) {
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	agentKey, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write"})
	key := agentKey.RawKey
	reader, _ := store.CreateAPIKey(claims.UserID, "Leser", []string{"notes:read"})

	doc, err := store.CreateDocument(claims.UserID, "", "Plan", "", "", []domain.DocumentBlock{
		{ID: "blk_mw1", Type: "text", Content: "Eins", Level: 0},
		{ID: "blk_mw2", Type: "text", Content: "Zwei", Level: 0},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	got, isErr, _ := call(key, "get_note", `{"id":"`+doc.ID+`"}`)
	if isErr || strings.Join(bulletTexts(got), "|") != "0:Eins|0:Zwei" {
		t.Fatalf("get_note bullets: %v", got)
	}

	// After a bullet, as a child, at the end
	res, isErr, msg := call(key, "add_note_bullet", `{"noteId":"`+doc.ID+`","text":"Eins b","afterId":"blk_mw1"}`)
	if isErr || res["addedId"] == "" {
		t.Fatalf("add after: %v %s", res, msg)
	}
	res, _, _ = call(key, "add_note_bullet", `{"noteId":"`+doc.ID+`","text":"Kind","parentId":"blk_mw2","type":"todo"}`)
	res, _, _ = call(key, "add_note_bullet", `{"noteId":"`+doc.ID+`","text":"Ende"}`)
	if s := strings.Join(bulletTexts(res), "|"); s != "0:Eins|0:Eins b|0:Zwei|1:Kind|0:Ende" {
		t.Fatalf("insert positions: %s", s)
	}

	// Change text, tick the to-do, delete a bullet with its children
	kind := bulletID(t, res, "Kind")
	if _, isErr, msg := call(key, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"`+kind+`","text":"Kind neu","checked":true}`); isErr {
		t.Fatalf("update bullet: %s", msg)
	}
	res, _, _ = call(key, "delete_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_mw2"}`)
	if s := strings.Join(bulletTexts(res), "|"); s != "0:Eins|0:Eins b|0:Ende" {
		t.Fatalf("delete with children: %s", s)
	}
	// The stored note follows (lists, search and the editor read it)
	stored, _ := store.GetDocumentByID(claims.UserID, doc.ID)
	if len(stored.Blocks) != 3 || stored.Blocks[1].Content != "Eins b" {
		t.Fatalf("stored blocks: %+v", stored.Blocks)
	}
	snap, _ := store.GetDocSnapshot(doc.ID)
	for _, b := range snap.Blocks {
		if b.ID == kind && (b.Content != "Kind neu" || !b.Props.Checked) {
			t.Fatalf("text and tick of the to-do: %+v", b)
		}
	}

	// A bullet someone is editing stays untouched
	srv.leases.Hold(doc.ID, collab.Actor{UserID: claims.UserID, ClientID: "browser"}, []string{"blk_mw1"})
	if _, isErr, msg := call(key, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_mw1","text":"x"}`); !isErr || !strings.Contains(msg, "editing this bullet") {
		t.Fatalf("leased bullet must be refused: %s", msg)
	}

	// Read only: no changes
	if _, isErr, _ := call(reader.RawKey, "add_note_bullet", `{"noteId":"`+doc.ID+`","text":"x"}`); !isErr {
		t.Fatal("notes:read must not add bullets")
	}

	// Rename, then trash; a note in the trash is not deleted for good
	if res, isErr, msg := call(key, "update_note", `{"id":"`+doc.ID+`","title":"Plan 2"}`); isErr || res["title"] != "Plan 2" {
		t.Fatalf("rename: %v %s", res, msg)
	}
	if _, isErr, msg := call(key, "delete_note", `{"id":"`+doc.ID+`"}`); isErr {
		t.Fatalf("delete_note: %s", msg)
	}
	if trash, _ := store.GetTrash(claims.UserID); len(trash) != 1 {
		t.Fatalf("note should be in the trash: %+v", trash)
	}
	if _, isErr, msg := call(key, "delete_note", `{"id":"`+doc.ID+`"}`); !isErr || !strings.Contains(msg, "trash") {
		t.Fatalf("second delete must not purge: %s", msg)
	}
	if _, isErr, _ := call(key, "add_note_bullet", `{"noteId":"`+doc.ID+`","text":"x"}`); !isErr {
		t.Fatal("a note in the trash is read-only")
	}

	// A note shared for editing can be changed, not deleted (that would only leave it)
	other, _ := store.CreateUser("owner@example.com", "hash", "Owner", "member")
	shared, _ := store.CreateDocument(other.ID, "", "Geteilt", "", "", []domain.DocumentBlock{{ID: "blk_mw9", Type: "text", Content: "A", Level: 0}}, nil, false)
	if _, err := store.CreateDocShare(other.ID, shared.ID, claims.UserID, "write"); err != nil {
		t.Fatal(err)
	}
	if _, isErr, msg := call(key, "add_note_bullet", `{"noteId":"`+shared.ID+`","text":"B"}`); isErr {
		t.Fatalf("shared for editing: %s", msg)
	}
	if _, isErr, msg := call(key, "delete_note", `{"id":"`+shared.ID+`"}`); !isErr || !strings.Contains(msg, "own notes") {
		t.Fatalf("shared note must not be deleted: %s", msg)
	}
}

// inbox:read lists open entries, inbox:write converts or discards them, never reaches tasks.
func TestMCPInbox(t *testing.T) {
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	reader, _ := store.CreateAPIKey(claims.UserID, "Leser", []string{"inbox:read"})
	writer, _ := store.CreateAPIKey(claims.UserID, "Sortierer", []string{"inbox:read", "inbox:write"})

	// The test server starts with a few demo entries in the inbox
	before, _, _ := call(reader.RawKey, "list_inbox", `{"limit":100}`)
	base := len(before["items"].([]interface{}))
	a, _ := store.CreateThought(claims.UserID, "Milch kaufen", "normal", "manual", "")
	b, _ := store.CreateThought(claims.UserID, "Zahnarzt anrufen", "high", "manual", "")
	c, _ := store.CreateThought(claims.UserID, "Idee für Blog", "normal", "manual", "")
	d, _ := store.CreateThought(claims.UserID, "Altpapier", "normal", "manual", "")
	task, _ := store.CreateThought(claims.UserID, "Schon eine Aufgabe", "normal", "manual", "")
	if _, err := store.UpdateThoughtTriage(claims.UserID, task.ID, "keep", "task", "", "", ""); err != nil {
		t.Fatal(err)
	}

	res, isErr, _ := call(reader.RawKey, "list_inbox", `{"limit":100}`)
	if items, _ := res["items"].([]interface{}); isErr || len(items) != base+4 {
		t.Fatalf("list_inbox: %v", res)
	}
	res, _, _ = call(reader.RawKey, "list_inbox", `{"query":"zahn"}`)
	if items, _ := res["items"].([]interface{}); len(items) != 1 || items[0].(map[string]interface{})["id"] != b.ID {
		t.Fatalf("query filter: %v", res)
	}
	if _, isErr, _ := call(reader.RawKey, "discard_inbox_item", `{"id":"`+a.ID+`"}`); !isErr {
		t.Fatal("inbox:read must not discard")
	}

	lst, _ := store.CreateList(claims.UserID, "Einkauf", "🛒", "shopping")
	if res, isErr, msg := call(writer.RawKey, "convert_inbox_item", `{"id":"`+a.ID+`","to":"list_item","listId":"`+lst.ID+`"}`); isErr || res["convertedType"] != "list_item" {
		t.Fatalf("to list item: %v %s", res, msg)
	}
	if res, isErr, msg := call(writer.RawKey, "convert_inbox_item", `{"id":"`+b.ID+`","to":"task","dueDate":"2026-12-01"}`); isErr || res["convertedType"] != "task" {
		t.Fatalf("to task: %v %s", res, msg)
	}
	if res, isErr, msg := call(writer.RawKey, "convert_inbox_item", `{"id":"`+c.ID+`","to":"note"}`); isErr || res["convertedType"] != "document" || res["refId"] == nil {
		t.Fatalf("to note: %v %s", res, msg)
	}
	if res, isErr, _ := call(writer.RawKey, "discard_inbox_item", `{"id":"`+d.ID+`"}`); isErr || res["status"] != "discarded" {
		t.Fatalf("discard: %v", res)
	}
	if res, _, _ := call(reader.RawKey, "list_inbox", `{"limit":100}`); len(res["items"].([]interface{})) != base {
		t.Fatalf("the four entries should have left the inbox: %v", res)
	}
	got, _ := store.GetListByID(claims.UserID, lst.ID)
	if got == nil || len(got.Items) != 1 || got.Items[0].Content != "Milch kaufen" {
		t.Fatalf("list item: %+v", got)
	}

	// Tasks stay out of reach of the inbox rights
	if _, isErr, msg := call(writer.RawKey, "discard_inbox_item", `{"id":"`+task.ID+`"}`); !isErr || !strings.Contains(msg, "inbox item") {
		t.Fatalf("a task must not be discarded through the inbox: %s", msg)
	}
	if _, isErr, _ := call(writer.RawKey, "convert_inbox_item", `{"id":"`+d.ID+`","to":"task"}`); !isErr {
		t.Fatal("a discarded entry is no inbox entry any more")
	}
}

// Agents read drawings as a description and cannot overwrite them with text
func TestMCPDrawings(t *testing.T) {
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	agentKey, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write"})
	key := agentKey.RawKey
	content := `{"v":1,"els":[{"id":"a","ver":1,"t":"rect","x":0,"y":0,"w":100,"h":50,"s":"main","f":"none","sw":2,"txt":"Start"},` +
		`{"id":"b","ver":1,"t":"ellipse","x":300,"y":0,"w":100,"h":50,"s":"main","f":"none","sw":2,"txt":"Ziel"},` +
		`{"id":"c","ver":1,"t":"arrow","a":[100,25],"b":[300,25],"from":"a","to":"b","route":"straight","head":2,"s":"main","sw":2}]}`
	doc, err := store.CreateDocument(claims.UserID, "", "Ablauf", "", "", []domain.DocumentBlock{
		{ID: "blk_dr1", Type: "drawing", Content: content, Level: 0},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	got, isErr, msg := call(key, "get_note", `{"id":"`+doc.ID+`"}`)
	if isErr || !strings.Contains(msg, "„Start“ → „Ziel“") || strings.Contains(msg, `"els"`) {
		t.Fatalf("get_note should describe the drawing: %s", msg)
	}
	if s := strings.Join(bulletTexts(got), "|"); s != "0:[Zeichnung: „Start“ → „Ziel“]" {
		t.Fatalf("bullets: %s", s)
	}
	if _, isErr, _ := call(key, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_dr1","text":"Überschrieben"}`); !isErr {
		t.Fatal("changing the text of a drawing must fail")
	}
	snap, _ := store.GetDocSnapshot(doc.ID)
	if snap.Blocks[0].Content != content {
		t.Fatalf("drawing changed: %q", snap.Blocks[0].Content)
	}
	if res, isErr, _ := call(key, "delete_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_dr1"}`); isErr || len(bulletTexts(res)) != 0 {
		t.Fatalf("deleting a drawing: %v", res)
	}
}

// Agents draw with Mermaid (laid out by the server) or with the drawing model
func TestMCPCreatesDrawings(t *testing.T) {
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	call := mcpCaller(t, srv)
	agentKey, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"notes:read", "notes:write", "notes:create"})
	key := agentKey.RawKey
	doc, _ := store.CreateDocument(claims.UserID, "", "Ablauf", "", "", []domain.DocumentBlock{{ID: "blk_t1", Type: "text", Content: "Davor"}}, nil, false)

	res, isErr, msg := call(key, "add_note_bullet", `{"noteId":"`+doc.ID+`","type":"drawing","text":"flowchart LR\nA[Start] -->|los| B{Fertig?}\nstyle B fill:#9f9"}`)
	if isErr {
		t.Fatalf("add drawing: %s", msg)
	}
	if s := strings.Join(bulletTexts(res), "|"); !strings.Contains(s, "[Zeichnung: „Start“ → „Fertig?“ (los)]") {
		t.Fatalf("bullets: %s", s)
	}
	added := res["addedId"].(string)
	snap, _ := store.GetDocSnapshot(doc.ID)
	for _, b := range snap.Blocks {
		if b.ID == added && (b.Type != "drawing" || !strings.Contains(b.Content, `"f":"green"`)) {
			t.Fatalf("stored drawing: %s %s", b.Type, b.Content)
		}
	}
	// Replace it with a mindmap; a plain bullet becomes a drawing only with one
	if _, isErr, msg := call(key, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"`+added+`","text":"mindmap\n  Ziel\n    Weg A\n    Weg B"}`); isErr {
		t.Fatalf("replace drawing: %s", msg)
	}
	if _, isErr, _ := call(key, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"`+added+`","type":"text"}`); !isErr {
		t.Fatal("a drawing must not turn into text")
	}
	if _, isErr, _ := call(key, "update_note_bullet", `{"noteId":"`+doc.ID+`","bulletId":"blk_t1","type":"drawing"}`); !isErr {
		t.Fatal("type drawing without a drawing must fail")
	}
	if _, isErr, _ := call(key, "add_note_bullet", `{"noteId":"`+doc.ID+`","type":"drawing","text":"sequenceDiagram\nA->>B: Hi"}`); !isErr {
		t.Fatal("unsupported Mermaid must fail")
	}
	got, _, _ := call(key, "get_note", `{"id":"`+doc.ID+`"}`)
	if s := strings.Join(bulletTexts(got), "|"); !strings.Contains(s, "„Ziel“ — „Weg A“") {
		t.Fatalf("after replacing: %s", s)
	}

	// create_note: a fenced mermaid block becomes a drawing
	res, isErr, msg = call(key, "create_note", `{"title":"Mit Diagramm","content":"Einleitung\n\n`+"```mermaid"+`\ngraph TD\nX --> Y\n`+"```"+`"}`)
	if isErr {
		t.Fatalf("create_note: %s", msg)
	}
	id, _ := res["id"].(string)
	stored, _ := store.GetDocumentByID(claims.UserID, id)
	found := false
	for _, b := range stored.Blocks {
		found = found || b.Type == "drawing"
	}
	if !found {
		t.Fatalf("no drawing in %+v", stored.Blocks)
	}
}
