package storage

import (
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A checked or edited item is sent to the list's viewers as it comes back from the store; the
// author must stay in it, otherwise their avatar disappears until the list is loaded again
func TestChangedListItemKeepsAuthor(t *testing.T) {
	store, alice, bob := setupTestStore(t)
	defer store.Close()

	lst, err := store.CreateList(alice.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatalf("CreateList failed: %v", err)
	}
	item, err := store.CreateListItem(lst.ID, "Brot", "", "", 0, alice.ID)
	if err != nil {
		t.Fatalf("CreateListItem failed: %v", err)
	}

	checkAuthor := func(step string, got string, gotName string) {
		t.Helper()
		if got != alice.ID || gotName != "Alice" {
			t.Errorf("%s: author = %q (%q), want %q (Alice)", step, got, gotName, alice.ID)
		}
	}

	done, err := store.ToggleListItem(item.ID, true, bob.ID, "Bob")
	if err != nil {
		t.Fatalf("ToggleListItem(true) failed: %v", err)
	}
	checkAuthor("checked", done.CreatedBy, done.CreatedByName)
	if done.CompletedBy != bob.ID || done.CompletedByName != "Bob" {
		t.Errorf("checked: completedBy = %q (%q), want Bob", done.CompletedBy, done.CompletedByName)
	}

	open, err := store.ToggleListItem(item.ID, false, bob.ID, "Bob")
	if err != nil {
		t.Fatalf("ToggleListItem(false) failed: %v", err)
	}
	checkAuthor("unchecked", open.CreatedBy, open.CreatedByName)
	if open.CompletedBy != "" || open.CompletedByName != "" || open.CompletedAt != "" {
		t.Errorf("unchecked: completion still set: %q %q %q", open.CompletedBy, open.CompletedByName, open.CompletedAt)
	}

	qty := "2"
	edited, err := store.UpdateListItem(item.ID, nil, nil, &qty)
	if err != nil {
		t.Fatalf("UpdateListItem failed: %v", err)
	}
	checkAuthor("edited", edited.CreatedBy, edited.CreatedByName)
	if edited.Quantity != "2" || edited.Content != "Brot" {
		t.Errorf("edited: got %q / %q", edited.Content, edited.Quantity)
	}

	if _, err := store.ToggleListItem("itm_missing", true, bob.ID, "Bob"); err != ErrListItemNotFound {
		t.Errorf("missing item: err = %v, want ErrListItemNotFound", err)
	}
}

// A shared shopping list, one phone offline for a while: its ticks arrive late. Ticking means "checked",
// never "toggle": two people ticking the same item leave it ticked (and the first one its "done by"), and
// an older change sent late does not undo a newer one.
func TestSetListItemDoneOfflineReplay(t *testing.T) {
	store, alice, bob := setupTestStore(t)
	defer store.Close()

	lst, err := store.CreateList(alice.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	newItem := func(name string) string {
		t.Helper()
		it, err := store.CreateListItem(lst.ID, name, "", "", 0, alice.ID)
		if err != nil {
			t.Fatal(err)
		}
		return it.ID
	}
	set := func(id string, done bool, at time.Time, who *domain.User) (bool, bool) {
		t.Helper()
		it, changed, err := store.SetListItemDone(id, done, at, who.ID, who.DisplayName)
		if err != nil {
			t.Fatal(err)
		}
		return it.IsCompleted, changed
	}
	now := time.Now()

	// Alice ticked it offline a minute ago, Bob ticks it now, Alice's tick arrives: stays ticked, Bob's
	milk := newItem("Hafermilch")
	if done, changed := set(milk, true, time.Time{}, bob); !done || !changed {
		t.Fatalf("Bob's tick: done=%v changed=%v", done, changed)
	}
	if done, changed := set(milk, true, now.Add(-time.Minute), alice); !done || changed {
		t.Errorf("Alice's late tick: done=%v changed=%v, want ticked and nothing written", done, changed)
	}
	if it, _ := store.getListItem(milk); it.CompletedBy != bob.ID {
		t.Errorf("done by %q, want Bob (who ticked it first)", it.CompletedBy)
	}

	// Alice ticked it offline two minutes ago; Bob ticked and opened it again a minute ago: open (Bob last)
	yoghurt := newItem("Joghurt")
	set(yoghurt, true, now.Add(-90*time.Second), bob)
	set(yoghurt, false, now.Add(-time.Minute), bob)
	if done, changed := set(yoghurt, true, now.Add(-2*time.Minute), alice); done || changed {
		t.Errorf("Alice's older tick: done=%v changed=%v, want open and nothing written", done, changed)
	}
	// Alice's newer change wins
	if done, changed := set(yoghurt, true, now.Add(-30*time.Second), alice); !done || !changed {
		t.Errorf("Alice's newer tick: done=%v changed=%v, want ticked", done, changed)
	}

	// Alice opened it offline (it was ticked before), Bob did nothing: open
	cheese := newItem("Bergkäse")
	set(cheese, true, now.Add(-time.Hour), bob)
	if done, changed := set(cheese, false, now.Add(-time.Minute), alice); done || !changed {
		t.Errorf("Alice's open: done=%v changed=%v, want open", done, changed)
	}

	// A time in the future (a phone's clock ahead) counts as now
	bread := newItem("Brot")
	set(bread, true, now.Add(time.Hour), alice)
	if done, changed := set(bread, false, time.Time{}, bob); done || !changed {
		t.Errorf("Bob's open after a future tick: done=%v changed=%v, want open", done, changed)
	}

	// Deleted meanwhile: not found
	gone := newItem("Weg")
	if _, err := store.DeleteListItem(gone); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.SetListItemDone(gone, true, now.Add(-time.Minute), alice.ID, "Alice"); err != ErrListItemNotFound {
		t.Errorf("deleted item: err = %v, want ErrListItemNotFound", err)
	}
}

// Editing the quantity writes only the quantity: a tick or a new text made meanwhile stays.
func TestUpdateListItemWritesOnlyGivenFields(t *testing.T) {
	store, alice, bob := setupTestStore(t)
	defer store.Close()

	lst, err := store.CreateList(alice.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	item, err := store.CreateListItem(lst.ID, "Äpfel", "Obst", "1 kg", 0, alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ToggleListItem(item.ID, true, bob.ID, "Bob"); err != nil {
		t.Fatal(err)
	}
	content := "Äpfel (Elstar)"
	if _, err := store.UpdateListItem(item.ID, &content, nil, nil); err != nil {
		t.Fatal(err)
	}
	qty := "2 kg"
	got, err := store.UpdateListItem(item.ID, nil, nil, &qty)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IsCompleted || got.Content != content || got.Category != "Obst" || got.Quantity != qty {
		t.Errorf("got %+v, want ticked, %q, Obst, %q", got, content, qty)
	}
	if _, err := store.UpdateListItem("itm_missing", nil, nil, &qty); err != ErrListItemNotFound {
		t.Errorf("missing item: err = %v, want ErrListItemNotFound", err)
	}
}
