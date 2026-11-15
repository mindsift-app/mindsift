package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A shared shopping list on two phones, one of them offline for a while: the app's outbox sends the ticks
// made offline later, as the wanted state with when it was made (changedAt) and when it was sent (sentAt),
// both on the phone's clock. Two people ticking the same item leave it ticked, an older tick does not undo
// a newer change, and a change that writes nothing tells nobody.
func TestListItemTickSentLate(t *testing.T) {
	_, store, ts, owner, ownerToken := startRealtimeServer(t)
	friend, friendToken := newTestUser(t, store, "partnerin@example.com")
	list, err := store.CreateList(owner.ID, "Supermarkt", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddListShare(owner.ID, list.ID, "user", friend.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	ownerStream := openSSE(t, ts, ownerToken)
	if resp := doJSON(t, ts, http.MethodPost, "/api/v1/events/rooms", ownerToken, map[string]string{"sseId": ownerStream.id, "room": list.ID}); resp.StatusCode != http.StatusOK {
		t.Fatalf("join: %d", resp.StatusCode)
	}
	newItem := func(name string) string {
		t.Helper()
		it, err := store.CreateListItem(list.ID, name, "", "", 0, owner.ID)
		if err != nil {
			t.Fatal(err)
		}
		return it.ID
	}
	patch := func(token, itemID string, body map[string]any) domain.ListItem {
		t.Helper()
		resp := doJSON(t, ts, http.MethodPatch, "/api/v1/lists/"+list.ID+"/items/"+itemID, token, body)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("patch %v: %d", body, resp.StatusCode)
		}
		var it domain.ListItem
		_ = json.NewDecoder(resp.Body).Decode(&it)
		return it
	}
	// The phone's clock is a day behind: only the time between change and sending counts
	phone := time.Now().Add(-24 * time.Hour).UnixMilli()
	late := func(done bool, agoMs int64) map[string]any {
		return map[string]any{"isCompleted": done, "changedAt": phone - agoMs, "sentAt": phone}
	}

	// The owner ticked it offline a minute ago, the friend ticks it now, the owner's phone sends: ticked,
	// done by the friend, and the owner's devices hear nothing more than the friend's tick
	milk := newItem("Hafermilch")
	if it := patch(friendToken, milk, map[string]any{"isCompleted": true}); !it.IsCompleted {
		t.Fatal("friend's tick not stored")
	}
	if ownerStream.waitFor(t, "ITEM_TOGGLED", 10*time.Second) == nil {
		t.Fatal("no ITEM_TOGGLED for the friend's tick")
	}
	it := patch(ownerToken, milk, late(true, 60_000))
	if !it.IsCompleted || it.CompletedBy != friend.ID {
		t.Errorf("after the late tick: done=%v by %q, want ticked by the friend", it.IsCompleted, it.CompletedBy)
	}
	if ownerStream.waitFor(t, "ITEM_TOGGLED", 500*time.Millisecond) != nil {
		t.Error("a tick that changed nothing was broadcast")
	}

	// The owner ticked it offline two minutes ago; the friend ticked and opened it again since: open
	yoghurt := newItem("Joghurt")
	patch(friendToken, yoghurt, map[string]any{"isCompleted": true})
	patch(friendToken, yoghurt, map[string]any{"isCompleted": false})
	if it := patch(ownerToken, yoghurt, late(true, 120_000)); it.IsCompleted {
		t.Error("an older tick sent late undid the friend's newer un-tick")
	}

	// The owner opened a ticked item offline, nobody touched it since: open
	cheese := newItem("Bergkäse")
	patch(friendToken, cheese, map[string]any{"isCompleted": true})
	time.Sleep(20 * time.Millisecond)
	if it := patch(ownerToken, cheese, late(false, 5)); it.IsCompleted {
		t.Error("the owner's un-tick sent late was not stored")
	}

	// Without changedAt (online): the wanted state, as before
	if it := patch(ownerToken, cheese, map[string]any{"isCompleted": true}); !it.IsCompleted {
		t.Error("online tick not stored")
	}
	if it := patch(ownerToken, cheese, map[string]any{"isCompleted": true}); !it.IsCompleted {
		t.Error("the same tick twice opened the item")
	}

	// Deleted by the friend meanwhile: 404, which the outbox drops
	gone := newItem("Weg")
	if resp := doJSON(t, ts, http.MethodDelete, "/api/v1/lists/"+list.ID+"/items/"+gone, friendToken, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	if resp := doJSON(t, ts, http.MethodPatch, "/api/v1/lists/"+list.ID+"/items/"+gone, ownerToken, late(true, 60_000)); resp.StatusCode != http.StatusNotFound {
		t.Errorf("late tick of a deleted item: %d, want 404", resp.StatusCode)
	}
}

func TestChangeTime(t *testing.T) {
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		changedAt, sentAt int64
		want              time.Time
	}{
		{0, 0, time.Time{}},
		{1000, 0, time.Time{}},
		{5000, 5000, time.Time{}},
		{6000, 5000, time.Time{}}, // sent before it was made: a clock that jumped, counts as now
		{1000, 61_000, now.Add(-time.Minute)},
	} {
		if got := changeTime(c.changedAt, c.sentAt, now); !got.Equal(c.want) {
			t.Errorf("changeTime(%d, %d) = %v, want %v", c.changedAt, c.sentAt, got, c.want)
		}
	}
}
