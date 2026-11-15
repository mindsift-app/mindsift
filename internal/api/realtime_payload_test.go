package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// The payloads of NOTIFICATION, LIST_UPDATED and LIST_CREATED: a replacing entry names what it replaced,
// a changed list carries nothing that differs per person, a new list reaches its creator's devices.
func TestRealtimePayloads(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	friend, friendToken := newTestUser(t, store, "freundin@example.com")

	// NOTIFICATION: the friend watches a task of the owner's; the second change replaces the first entry
	tl, err := store.CreateTaskList(owner.ID, "", "", "Geteilt", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddTaskListShare(tl.ID, "user", friend.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	task, _, _, err := store.CreateTask(owner.ID, "Einkaufen", "", "", "", tl.ID, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.WatchTask(task.ID, friend.ID, true); err != nil {
		t.Fatal(err)
	}
	friendStream := openSSE(t, ts, friendToken)
	notification := func(body map[string]any) (id int64, replaces []int64) {
		t.Helper()
		if resp := doJSON(t, ts, http.MethodPatch, "/api/v1/thoughts/"+task.ID, ownerToken, body); resp.StatusCode != http.StatusOK {
			t.Fatalf("patch: %d", resp.StatusCode)
		}
		for {
			m := friendStream.waitFor(t, "NOTIFICATION", 10*time.Second)
			if m == nil {
				t.Fatal("no NOTIFICATION")
			}
			var e struct {
				ID       int64   `json:"id"`
				Kind     string  `json:"kind"`
				Replaces []int64 `json:"replaces"`
			}
			_ = json.Unmarshal(m.Payload, &e)
			if e.Kind == "watched" {
				return e.ID, e.Replaces
			}
		}
	}
	first, replaces := notification(map[string]any{"priority": "high"})
	if len(replaces) != 0 {
		t.Errorf("the first entry replaced %v", replaces)
	}
	second, replaces := notification(map[string]any{"notes": "Milch"})
	if second == first || len(replaces) != 1 || replaces[0] != first {
		t.Errorf("second entry %d replaces %v, want [%d]", second, replaces, first)
	}

	// LIST_UPDATED: without isOwner and role (they are the changer's)
	list, err := store.CreateList(owner.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddListShare(owner.ID, list.ID, "user", friend.ID, "viewer"); err != nil {
		t.Fatal(err)
	}
	if resp := doJSON(t, ts, http.MethodPost, "/api/v1/events/rooms", friendToken, map[string]string{"sseId": friendStream.id, "room": list.ID}); resp.StatusCode != http.StatusOK {
		t.Fatalf("join: %d", resp.StatusCode)
	}
	if resp := doJSON(t, ts, http.MethodPatch, "/api/v1/lists/"+list.ID, ownerToken, map[string]any{"title": "Wocheneinkauf"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("rename: %d", resp.StatusCode)
	}
	m := friendStream.waitFor(t, "LIST_UPDATED", 10*time.Second)
	if m == nil {
		t.Fatal("no LIST_UPDATED")
	}
	var payload map[string]any
	_ = json.Unmarshal(m.Payload, &payload)
	if payload["title"] != "Wocheneinkauf" || payload["id"] != list.ID {
		t.Errorf("LIST_UPDATED payload: %s", m.Payload)
	}
	for _, k := range []string{"isOwner", "role"} {
		if _, ok := payload[k]; ok {
			t.Errorf("LIST_UPDATED carries %s: %s", k, m.Payload)
		}
	}

	// LIST_CREATED: to the creator's other devices, nobody else
	ownerStream := openSSE(t, ts, ownerToken)
	resp := doJSON(t, ts, http.MethodPost, "/api/v1/lists", ownerToken, map[string]any{"title": "Neu"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create list: %d", resp.StatusCode)
	}
	if ownerStream.waitFor(t, "LIST_CREATED", 10*time.Second) == nil {
		t.Error("the creator's other device did not get LIST_CREATED")
	}
	if friendStream.waitFor(t, "LIST_CREATED", 500*time.Millisecond) != nil {
		t.Error("someone else got LIST_CREATED of a list not shared with them")
	}
}
