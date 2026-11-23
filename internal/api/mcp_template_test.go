package api

import (
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// create_note with a template starts the note with the template's bullets, as the app's "Neue Notiz"
// from a template does: same levels, to-dos open, placeholders filled in (not in code), content
// below. It needs notes:read, finds templates by id or title and only among the person's own.
func TestMCPCreateNoteFromTemplate(t *testing.T) {
	t.Parallel()
	srv, store, token := setupTestServer(t)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	uid := claims.UserID
	key, _ := store.CreateAPIKey(uid, "Modell", []string{"notes:create", "notes:read"})
	createOnly, _ := store.CreateAPIKey(uid, "Nur anlegen", []string{"notes:create"})
	call := mcpCaller(t, srv)

	tmpl, err := store.CreateDocument(uid, "", "Besprechung", "", "", []domain.DocumentBlock{
		{Type: "h2", Content: "Besprechung {{titel}}", Level: 0},
		{Type: "todo", Content: "Agenda verschicken", Checked: true, Level: 1},
		{Type: "paragraph", Content: "Am {{ Datum }}", Level: 1},
		{Type: "code", Content: "echo {{date}}", Lang: "bash", Level: 0},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.CreateDocument(uid, "", "Keine Vorlage", "", "", nil, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetDocTemplate(uid, tmpl.ID, true); err != nil {
		t.Fatal(err)
	}

	// list_notes names the templates
	_, isErr, text := call(key.RawKey, "list_notes", `{"templates":true}`)
	if isErr || !strings.Contains(text, tmpl.ID) || strings.Contains(text, other.ID) || !strings.Contains(text, "isTemplate") {
		t.Fatalf("list_notes templates=true: %s", text)
	}

	date := i18n.ShortDate(srv.userLanguage(uid), clock.In(time.Now()))
	for _, ref := range []string{tmpl.ID, "Besprechung", "besprechung"} {
		note, isErr, text := call(key.RawKey, "create_note", `{"title":"Montag","template":"`+ref+`","content":"- Sonstiges"}`)
		if isErr {
			t.Fatalf("template %q: %s", ref, text)
		}
		doc, err := store.GetDocumentByID(uid, note["id"].(string))
		if err != nil {
			t.Fatal(err)
		}
		type got struct {
			typ, content string
			level        int
			checked      bool
		}
		want := []got{
			{"h2", "Besprechung Montag", 0, false},
			{"todo", "Agenda verschicken", 1, false},
			{"paragraph", "Am " + date, 1, false},
			{"code", "echo {{date}}", 0, false},
			{"bullet", "Sonstiges", 0, false},
		}
		if len(doc.Blocks) != len(want) {
			t.Fatalf("template %q: bullets %+v", ref, doc.Blocks)
		}
		for i, b := range doc.Blocks {
			g := got{b.Type, b.Content, b.Level, b.Checked}
			if b.Type == "paragraph" && want[i].typ == "bullet" {
				g.typ = "bullet"
			}
			if g != want[i] || b.TaskID != "" {
				t.Errorf("template %q, bullet %d: %+v, want %+v", ref, i, b, want[i])
			}
			for _, tb := range tmpl.Blocks {
				if tb.ID == b.ID {
					t.Errorf("bullet %d kept the template's id", i)
				}
			}
		}
	}
	// The template itself is unchanged
	if again, _ := store.GetDocumentByID(uid, tmpl.ID); again.Blocks[1].Checked != true || again.Blocks[0].Content != "Besprechung {{titel}}" {
		t.Errorf("template changed: %+v", again.Blocks)
	}

	// notes:create alone may not read the template
	if _, isErr, text := call(createOnly.RawKey, "create_note", `{"title":"X","template":"`+tmpl.ID+`"}`); !isErr || !strings.Contains(text, "notes:read") {
		t.Errorf("without notes:read: %v %s", isErr, text)
	}
	// A note that is no template, an unknown title
	for _, ref := range []string{other.ID, "Keine Vorlage", "Gibt es nicht"} {
		if _, isErr, text := call(key.RawKey, "create_note", `{"title":"X","template":"`+ref+`"}`); !isErr || !strings.Contains(text, "Template not found") {
			t.Errorf("template %q: %v %s", ref, isErr, text)
		}
	}
	// Two templates with the same title: the id decides
	twin, _ := store.CreateDocument(uid, "", "Besprechung", "", "", nil, nil, false)
	if err := store.SetDocTemplate(uid, twin.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, isErr, text := call(key.RawKey, "create_note", `{"title":"X","template":"Besprechung"}`); !isErr || !strings.Contains(text, "id") {
		t.Errorf("ambiguous title: %v %s", isErr, text)
	}
	if _, isErr, text := call(key.RawKey, "create_note", `{"title":"X","template":"`+tmpl.ID+`"}`); isErr {
		t.Errorf("by id despite a twin: %s", text)
	}
}
