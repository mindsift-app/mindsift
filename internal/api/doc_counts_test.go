package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Deleting a folder takes its notes out of the lists of everyone sharing them, also of those who do not
// have a note open: one WORKSPACE_FOLDERS_UPDATED with all of them, no DOC_DELETED per note.
func TestFolderDeleteReachesSharedUsers(t *testing.T) {
	_, store, ts, owner, token := startRealtimeServer(t)
	anna, annaToken := newTestUser(t, store, "anna@example.com")
	var ids []string
	for _, title := range []string{"Plan", "Einkauf"} {
		doc, err := store.CreateDocument(owner.ID, "", title, "", "Zz Projekt", nil, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		if r := doJSON(t, ts, http.MethodPost, "/api/v1/documents/"+doc.ID+"/shares", token, map[string]string{"userId": anna.ID, "permission": "write"}); r.StatusCode != http.StatusCreated {
			t.Fatalf("share: %d", r.StatusCode)
		}
		ids = append(ids, doc.ID)
	}
	stream := openSSE(t, ts, annaToken)

	if r := doJSON(t, ts, http.MethodDelete, "/api/v1/folders?path=Zz%20Projekt", token, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("delete folder: %d", r.StatusCode)
	}
	deadline := time.After(3 * time.Second)
	for {
		select {
		case m, ok := <-stream.events:
			if !ok {
				t.Fatal("stream closed")
			}
			if m.Event == "DOC_DELETED" {
				t.Fatalf("DOC_DELETED per note: %s", m.Payload)
			}
			if m.Event != "WORKSPACE_FOLDERS_UPDATED" {
				continue
			}
			var p struct {
				Type          string   `json:"type"`
				Path          *string  `json:"path"`
				DeletedDocIDs []string `json:"deletedDocIds"`
			}
			_ = json.Unmarshal(m.Payload, &p)
			if p.Type != "deleted" || p.Path != nil || len(p.DeletedDocIDs) != 2 {
				t.Fatalf("event for the shared user: %s", m.Payload)
			}
			got := map[string]bool{p.DeletedDocIDs[0]: true, p.DeletedDocIDs[1]: true}
			if !got[ids[0]] || !got[ids[1]] {
				t.Fatalf("deletedDocIds %v, want %v", p.DeletedDocIDs, ids)
			}
			return
		case <-deadline:
			t.Fatal("no WORKSPACE_FOLDERS_UPDATED for the shared user")
		}
	}
}

// A changed note sends its counts once per check to everyone with access, and only when they differ from
// the counts sent last; changes until the check are folded into one.
func TestDocCountsOnlyWhenChanged(t *testing.T) {
	srv, store, ts, owner, token := startRealtimeServer(t)
	anna, annaToken := newTestUser(t, store, "anna@example.com")
	doc, err := store.CreateDocument(owner.ID, "", "Plan", "", "", []domain.DocumentBlock{
		{ID: "c_b1", Type: "todo", Content: "Milch kaufen #einkauf"},
		{ID: "c_b2", Type: "bullet", Content: "Notiz #einkauf"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if r := doJSON(t, ts, http.MethodPost, "/api/v1/documents/"+doc.ID+"/shares", token, map[string]string{"userId": anna.ID, "permission": "read"}); r.StatusCode != http.StatusCreated {
		t.Fatalf("share: %d", r.StatusCode)
	}
	stream := openSSE(t, ts, annaToken)

	now := time.Now()
	srv.touchDocCounts(doc.ID, now)
	srv.touchDocCounts(doc.ID, now.Add(2*time.Second)) // folded into the first
	srv.sendDueDocCounts(now.Add(time.Second))         // not due yet
	srv.docCounts.mu.Lock()
	pending := len(srv.docCounts.due)
	srv.docCounts.mu.Unlock()
	if pending != 1 {
		t.Fatalf("%d notes pending, want 1", pending)
	}
	srv.sendDueDocCounts(now.Add(docCountsDelay))
	m := stream.waitFor(t, "DOC_COUNTS", 3*time.Second)
	if m == nil {
		t.Fatal("no DOC_COUNTS")
	}
	var c storage.DocCounts
	_ = json.Unmarshal(m.Payload, &c)
	if c.ID != doc.ID || c.OpenTodos != 1 || c.TagCounts["einkauf"] != 2 || c.TagOpenTodos["einkauf"] != 1 {
		t.Fatalf("DOC_COUNTS %s", m.Payload)
	}

	// The same counts again: nothing is sent
	srv.touchDocCounts(doc.ID, now)
	srv.sendDueDocCounts(now.Add(docCountsDelay))
	if m := stream.waitFor(t, "DOC_COUNTS", 400*time.Millisecond); m != nil {
		t.Fatalf("unchanged counts sent again: %s", m.Payload)
	}

	// Other counts than sent last: sent
	srv.docCounts.mu.Lock()
	srv.docCounts.last[doc.ID] = "{}"
	srv.docCounts.mu.Unlock()
	srv.touchDocCounts(doc.ID, now)
	srv.sendDueDocCounts(now.Add(docCountsDelay))
	if m := stream.waitFor(t, "DOC_COUNTS", 3*time.Second); m == nil {
		t.Fatal("changed counts not sent")
	}
}
