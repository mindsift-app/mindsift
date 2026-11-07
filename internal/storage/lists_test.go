package storage

import "testing"

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
