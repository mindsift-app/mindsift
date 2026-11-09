package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func mention(id string) string { return "{{mention:" + id + "}}" }

func TestMentionsInTasks(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	router := srv.Router()
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	bob, _ := newTestUser(t, store, "bob@example.com")
	carol, _ := newTestUser(t, store, "carol@example.com") // no access to the list
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	if _, err := store.AddTaskListShare(list.ID, "user", bob.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	task, _ := store.CreateThoughtWithDetails(owner.ID, "Keller aufräumen", "normal", "manual", "", list.ID, "todo", "")
	patch := func(body map[string]any) {
		raw, _ := json.Marshal(body)
		if rec := sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, string(raw), ""); rec.Code != http.StatusOK {
			t.Fatalf("patch: %d %s", rec.Code, rec.Body.String())
		}
	}
	flush := func() []string {
		srv.flushNotifications(time.Now().Add(10 * time.Minute))
		got := mailsTo(*sent, "bob@example.com")
		*sent = nil
		return got
	}

	patch(map[string]any{"notes": "Bitte " + mention(bob.ID) + " und " + mention(carol.ID) + " fragen"})
	if got := flush(); len(got) != 1 || !strings.Contains(got[0], "hat dich in „Keller aufräumen“ erwähnt") {
		t.Fatalf("bob should be told once, got %+v", got)
	}
	// Saving again with the same mention: nothing; a second mention: again
	patch(map[string]any{"notes": "Bitte " + mention(bob.ID) + " und " + mention(carol.ID) + " fragen (heute)"})
	if got := flush(); len(got) != 0 {
		t.Fatalf("kept mention must not notify again: %+v", got)
	}
	patch(map[string]any{"notes": "Bitte " + mention(bob.ID) + " fragen, " + mention(bob.ID) + " weiß es"})
	if got := flush(); len(got) != 1 {
		t.Fatalf("second mention notifies again, got %+v", got)
	}
	// In a subtask, too
	patch(map[string]any{"subtasks": []domain.SubTask{{ID: "st1", Title: "Regal " + mention(bob.ID)}}})
	if got := flush(); len(got) != 1 {
		t.Fatalf("mention in a subtask notifies, got %+v", got)
	}
}

func TestMentionsInNotes(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	owner, _ := newTestUser(t, store, "owner@example.com")
	bob, _ := newTestUser(t, store, "bob@example.com")
	doc, err := store.CreateDocument(owner.ID, "", "Planung", "🗒️", "", []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "Start"}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDocShare(owner.ID, doc.ID, bob.ID, "write"); err != nil {
		t.Fatal(err)
	}
	write := func(text string) {
		snap, _ := store.GetDocSnapshot(doc.ID)
		version := 0
		for _, b := range snap.Blocks {
			if b.ID == "b1" {
				version = b.Version
			}
		}
		if err := srv.applyNoteOps(owner.ID, nil, doc.ID, []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: "b1", BaseVersion: version, Content: &text}}); err != nil {
			t.Fatal(err)
		}
	}
	write("Frag " + mention(bob.ID))
	write("Frag " + mention(bob.ID) + " morgen") // typing on: no second notification
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if got := mailsTo(*sent, "bob@example.com"); len(got) != 1 || !strings.Contains(got[0], "hat dich in „Planung“ erwähnt") {
		t.Fatalf("bob should be told once, got %+v", *sent)
	}
	// Removed and written again: told again
	*sent = nil
	write("Frag morgen")
	write("Frag " + mention(bob.ID) + " morgen")
	srv.flushNotifications(time.Now().Add(10 * time.Minute))
	if got := mailsTo(*sent, "bob@example.com"); len(got) != 1 {
		t.Fatalf("mention written again notifies again, got %+v", *sent)
	}
}

func TestMentionCandidatesAndReadableText(t *testing.T) {
	srv, _ := notifyServer(t)
	store := srv.store
	router := srv.Router()
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	bob, _ := newTestUser(t, store, "bob@example.com")
	carol, _ := newTestUser(t, store, "carol@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	if _, err := store.AddTaskListShare(list.ID, "user", bob.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	rec := sessionCall(router, "GET", "/api/v1/mentions/candidates?taskListId="+list.ID, ownerToken, "", "")
	var cands []struct {
		ID        string `json:"id"`
		HasAccess bool   `json:"hasAccess"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cands); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("candidates: %d %s", rec.Code, rec.Body.String())
	}
	access := map[string]bool{}
	present := map[string]bool{}
	for _, c := range cands {
		present[c.ID], access[c.ID] = true, c.HasAccess
	}
	if present[owner.ID] || !access[bob.ID] || (present[carol.ID] && access[carol.ID]) {
		t.Fatalf("bob with access, carol (if visible) without, not myself: %s", rec.Body.String())
	}
	_, strangerToken := newTestUser(t, store, "fremd@example.com")
	if rec := sessionCall(router, "GET", "/api/v1/mentions/candidates?taskListId="+list.ID, strangerToken, "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger: want 404, got %d", rec.Code)
	}

	// Outside the app mentions read as @Name, and searching the name finds them
	if got := store.ReadableMentions("Frag " + mention(bob.ID)); got != "Frag @"+bob.DisplayName {
		t.Fatalf("readable: %q", got)
	}
	task, _ := store.CreateThoughtWithDetails(owner.ID, "Keller", "normal", "manual", "", list.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(owner.ID, task.ID, "keep", "task", "", "", list.ID)
	notes := "Mit " + mention(bob.ID) + " klären"
	_, _ = store.UpdateThoughtDetails(owner.ID, task.ID, nil, nil, nil, nil, nil, nil, &notes, nil, nil)
	res, err := store.SearchGlobal(owner.ID, strings.Split(bob.DisplayName, " ")[0])
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, th := range res.Thoughts {
		found = found || th.ID == task.ID
	}
	if !found {
		t.Fatalf("searching %q should find the task mentioning them", bob.DisplayName)
	}
}
