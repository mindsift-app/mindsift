package storage

import (
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func suggestionNames(t *testing.T, s *Store, listID, q string) []string {
	t.Helper()
	got, err := s.ListItemSuggestions(listID, q, 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	out := make([]string, 0, len(got))
	for _, g := range got {
		out = append(out, g.Content)
	}
	return out
}

func equalNames(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Every addition counts, also of items ticked and cleared since; the spelling and category of the last
// use are kept, a missing category keeps the earlier one
func TestListHistorySurvivesClearing(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	defer store.Close()
	lst, _ := store.CreateList(alice.ID, "Einkauf", "🛒", "shopping")

	for range 3 {
		it, err := store.CreateListItem(lst.ID, "milch #Kühlregal", "", "", 0, alice.ID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.ToggleListItem(it.ID, true, alice.ID, "Alice"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.CreateListItem(lst.ID, "  Milch ", "", "", 0, alice.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClearCompletedListItems(lst.ID); err != nil {
		t.Fatal(err)
	}
	got, err := store.ListItemSuggestions(lst.ID, "mi", 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Content != "Milch" || got[0].Category != "Kühlregal" || got[0].Count != 4 {
		t.Fatalf("history after clearing: %+v", got)
	}
}

// Starting with the text first, then a word starting with it, then containing it; within each the more
// often and more recently used first
func TestListSuggestionRanking(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	defer store.Close()
	lst, _ := store.CreateList(alice.ID, "Einkauf", "🛒", "shopping")
	now := time.Now()
	ago := func(days int) string { return now.AddDate(0, 0, -days).UTC().Format(time.RFC3339) }
	for _, e := range []struct {
		name  string
		count int
		at    string
	}{
		{"Mineralwasser", 3, ago(1)},
		{"Milch", 8, ago(2)},
		{"Mehl", 20, ago(1)},          // no match
		{"Hafermilch", 30, ago(1)},    // contains
		{"Kokos-Milch", 1, ago(1)},    // a word starts with it
		{"Mixer-Beutel", 9, ago(400)}, // many uses, but a year ago
	} {
		_, key := listHistoryName(e.name)
		if _, err := store.db.Exec(`INSERT INTO list_item_history (list_id, name_key, content, category, use_count, last_used) VALUES (?, ?, ?, '', ?, ?)`,
			lst.ID, key, e.name, e.count, e.at); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{"Milch", "Mineralwasser", "Mixer-Beutel", "Kokos-Milch", "Hafermilch"}
	if got := suggestionNames(t, store, lst.ID, "mi"); !equalNames(got, want) {
		t.Fatalf("ranking for \"mi\" = %v, want %v", got, want)
	}
	if got := suggestionNames(t, store, lst.ID, "MILCH"); !equalNames(got, []string{"Milch", "Kokos-Milch", "Hafermilch"}) {
		t.Fatalf("case-insensitive: %v", got)
	}
	if got := suggestionNames(t, store, lst.ID, ""); len(got) != 6 || got[0] != "Hafermilch" {
		t.Fatalf("all by score: %v", got)
	}
	if got, _ := store.ListItemSuggestions(lst.ID, "", 2, now); len(got) != 2 {
		t.Fatalf("limit: %d", len(got))
	}
}

// A renamed item moves its use to the new name, a new category goes along, and a list keeps at most
// listHistoryMax names
func TestListHistoryRenameCategoryAndBound(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	defer store.Close()
	lst, _ := store.CreateList(alice.ID, "Einkauf", "🛒", "shopping")

	it, _ := store.CreateListItem(lst.ID, "Mlich", "", "", 0, alice.ID)
	fixed := "Milch"
	if _, err := store.UpdateListItem(it.ID, &fixed, nil, nil); err != nil {
		t.Fatal(err)
	}
	if got := suggestionNames(t, store, lst.ID, ""); !equalNames(got, []string{"Milch"}) {
		t.Fatalf("after rename: %v", got)
	}
	cat := "Kühlregal"
	if _, err := store.UpdateListItem(it.ID, nil, &cat, nil); err != nil {
		t.Fatal(err)
	}
	got, _ := store.ListItemSuggestions(lst.ID, "milch", 0, time.Now())
	if len(got) != 1 || got[0].Category != "Kühlregal" || got[0].Count != 1 {
		t.Fatalf("after category: %+v", got)
	}
	// Dragged into another group (the app sends category and content of the dragged item)
	moved, content := "Getränke", "Milch"
	if err := store.ReorderListItems(lst.ID, []domain.ListItemReorderItem{{ID: it.ID, SortOrder: 0, Category: &moved, Content: &content}}); err != nil {
		t.Fatal(err)
	}
	got, _ = store.ListItemSuggestions(lst.ID, "milch", 0, time.Now())
	if len(got) != 1 || got[0].Category != "Getränke" {
		t.Fatalf("after drag: %+v", got)
	}
	_, _ = store.CreateListItem(lst.ID, "Milch", "", "", 0, alice.ID) // used twice now

	// Bound: the least used go first
	for i := range listHistoryMax + 5 {
		store.recordListItemUse(lst.ID, "Artikel "+string(rune('A'+i/26/26%26))+string(rune('A'+i/26%26))+string(rune('A'+i%26)), "", time.Now().UTC().Format(time.RFC3339))
	}
	var n int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM list_item_history WHERE list_id = ?`, lst.ID).Scan(&n)
	if n != listHistoryMax {
		t.Fatalf("history holds %d names, want %d", n, listHistoryMax)
	}
	if got := suggestionNames(t, store, lst.ID, "milch"); len(got) != 1 {
		t.Fatalf("the most used name must stay: %v", got)
	}
}

// Moving an item to another list counts it there; deleting a list deletes its history; a shared list's
// history is the same for everyone
func TestListHistoryMoveDeleteShared(t *testing.T) {
	store, alice, bob := setupTestStore(t)
	defer store.Close()
	a, _ := store.CreateList(alice.ID, "Einkauf", "🛒", "shopping")
	b, _ := store.CreateList(alice.ID, "Drogerie", "🧴", "shopping")
	if _, err := store.AddListShare(alice.ID, a.ID, "user", bob.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateListItem(a.ID, "Brot", "", "", 0, bob.ID); err != nil {
		t.Fatal(err)
	}
	it, _ := store.CreateListItem(a.ID, "Zahnpasta", "", "", 0, alice.ID)
	if _, err := store.MoveListItem(it.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	if got := suggestionNames(t, store, a.ID, ""); len(got) != 2 {
		t.Fatalf("shared list history (Bob's and Alice's items): %v", got)
	}
	if got := suggestionNames(t, store, b.ID, "zahn"); !equalNames(got, []string{"Zahnpasta"}) {
		t.Fatalf("moved item in the target's history: %v", got)
	}
	if err := store.DeleteList(alice.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = store.db.QueryRow(`SELECT COUNT(*) FROM list_item_history WHERE list_id = ?`, b.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("%d history rows left after deleting the list", n)
	}
}

// The migration fills the history from the items still there
func TestListHistoryMigrationBackfill(t *testing.T) {
	store, alice, _ := setupTestStore(t)
	defer store.Close()
	lst, _ := store.CreateList(alice.ID, "Einkauf", "🛒", "shopping")
	_, _ = store.CreateListItem(lst.ID, "Äpfel", "Obst", "", 0, alice.ID)
	_, _ = store.CreateListItem(lst.ID, "äpfel", "", "", 0, alice.ID)
	if _, err := store.db.Exec(`DROP TABLE list_item_history`); err != nil {
		t.Fatal(err)
	}
	if err := store.migrateListItemHistory(); err != nil {
		t.Fatal(err)
	}
	got, _ := store.ListItemSuggestions(lst.ID, "äp", 0, time.Now())
	if len(got) != 1 || got[0].Count != 2 || got[0].Category != "Obst" {
		t.Fatalf("backfill: %+v", got)
	}
}
