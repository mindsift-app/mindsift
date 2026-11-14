package api

import (
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// Tools called with the id of someone else's task, list, item, note or inbox entry answer "not found"
// and change nothing; before, update_task and complete_task answered "Internal error" (sql: no rows in
// result set) for a foreign task (re-test 2026-11-14, side finding 1).
func TestMCPForeignIDsAnswerNotFound(t *testing.T) {
	srv, store, token := setupTestServer(t)
	call := mcpCaller(t, srv)
	claims, _ := auth.ValidateToken(testJWTSecret, token)
	key, _ := store.CreateAPIKey(claims.UserID, "Agent", []string{"tasks:read", "tasks:write", "lists:read", "lists:write",
		"notes:read", "notes:write", "inbox:read", "inbox:write"})

	bob, _ := store.CreateUser("bob@example.com", "hash", "Bob", "member")
	task, _ := store.CreateThought(bob.ID, "Bobs Aufgabe", "normal", "manual", "")
	if _, err := store.UpdateThoughtTriage(bob.ID, task.ID, "keep", "task", "", "", ""); err != nil {
		t.Fatal(err)
	}
	inbox, _ := store.CreateThought(bob.ID, "Bobs Gedanke", "normal", "manual", "")
	list, _ := store.CreateList(bob.ID, "Bobs Einkauf", "🛒", "shopping")
	item, _ := store.CreateListItem(list.ID, "Milch", "", "", 0, bob.ID)
	doc, err := store.CreateDocument(bob.ID, "", "Bobs Notiz", "", "", []domain.DocumentBlock{{ID: "blk_bob1", Type: "bullet", Content: "Geheim"}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}

	for name, args := range map[string]string{
		"get_task":           `{"id":"` + task.ID + `"}`,
		"update_task":        `{"id":"` + task.ID + `","content":"Übernommen"}`,
		"complete_task":      `{"id":"` + task.ID + `"}`,
		"add_subtask":        `{"taskId":"` + task.ID + `","title":"Neu"}`,
		"update_subtask":     `{"taskId":"` + task.ID + `","subtaskId":"st_x","completed":true}`,
		"delete_task":        `{"id":"` + task.ID + `"}`,
		"get_list":           `{"listId":"` + list.ID + `"}`,
		"add_list_item":      `{"listId":"` + list.ID + `","content":"Brot"}`,
		"check_list_item":    `{"listId":"` + list.ID + `","itemId":"` + item.ID + `"}`,
		"update_list_item":   `{"listId":"` + list.ID + `","itemId":"` + item.ID + `","content":"Brot"}`,
		"get_note":           `{"id":"` + doc.ID + `"}`,
		"update_note":        `{"id":"` + doc.ID + `","title":"Übernommen"}`,
		"add_note_bullet":    `{"noteId":"` + doc.ID + `","text":"Neu"}`,
		"update_note_bullet": `{"noteId":"` + doc.ID + `","bulletId":"blk_bob1","text":"Neu"}`,
		"delete_note_bullet": `{"noteId":"` + doc.ID + `","bulletId":"blk_bob1"}`,
		"delete_note":        `{"id":"` + doc.ID + `"}`,
		"convert_inbox_item": `{"id":"` + inbox.ID + `","to":"task"}`,
		"discard_inbox_item": `{"id":"` + inbox.ID + `"}`,
	} {
		_, isErr, text := call(key.RawKey, name, args)
		if !isErr {
			t.Errorf("%s on someone else's data succeeded: %s", name, text)
			continue
		}
		lower := strings.ToLower(text)
		if strings.Contains(text, "Internal error") || !strings.Contains(lower, "not found") && !strings.Contains(lower, "no open inbox item") {
			t.Errorf("%s: want a not found answer, got %s", name, text)
		}
	}

	// Nothing of Bob's changed
	if th, _ := store.GetThoughtByID(bob.ID, task.ID); th == nil || th.Content != "Bobs Aufgabe" || th.IsCompleted {
		t.Errorf("Bob's task changed: %+v", th)
	}
	if d, _ := store.GetDocumentByID(bob.ID, doc.ID); d == nil || d.Title != "Bobs Notiz" || len(d.Blocks) != 1 {
		t.Errorf("Bob's note changed: %+v", d)
	}
}
