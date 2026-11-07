package storage

import (
	"strings"
	"testing"
)

// The order of the tabs belongs to the person: sorted lists first, new ones after them, others unaffected.
func TestListOrderPerPerson(t *testing.T) {
	store, alice, bob := setupTestStore(t)
	a, _ := store.CreateList(alice.ID, "A", "", "shopping")
	b, _ := store.CreateList(alice.ID, "B", "", "shopping")
	c, _ := store.CreateList(alice.ID, "C", "", "shopping")
	titles := func(userID string) string {
		t.Helper()
		lists, err := store.GetAllListsForUser(userID)
		if err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, l := range lists {
			if len(l.Title) == 1 {
				out = append(out, l.Title)
			}
		}
		return strings.Join(out, "")
	}

	if err := store.SetListOrder(alice.ID, ListOrderLists, []string{b.ID, a.ID, c.ID}); err != nil {
		t.Fatal(err)
	}
	if got := titles(alice.ID); got != "BAC" {
		t.Fatalf("stored order: %s", got)
	}
	_, _ = store.CreateList(alice.ID, "D", "", "shopping")
	if got := titles(alice.ID); got != "BACD" {
		t.Fatalf("a new list goes after the sorted ones: %s", got)
	}
	if err := store.SetListOrder(bob.ID, ListOrderLists, []string{c.ID}); err != nil {
		t.Fatal(err)
	}
	if got := titles(alice.ID); got != "BACD" {
		t.Fatalf("another person's order must not change alice's: %s", got)
	}

	tl1, _ := store.CreateTaskList(alice.ID, "", "", "X", "", "")
	tl2, _ := store.CreateTaskList(alice.ID, "", "", "Y", "", "")
	if err := store.SetListOrder(alice.ID, ListOrderTaskLists, []string{tl1.ID, tl2.ID}); err != nil {
		t.Fatal(err)
	}
	lists, _ := store.GetTaskLists(alice.ID)
	var order []string
	for _, l := range lists {
		if l.ID == tl1.ID || l.ID == tl2.ID {
			order = append(order, l.Title)
		}
	}
	if strings.Join(order, "") != "XY" {
		t.Fatalf("task list order: %v", order)
	}
	if err := store.SetListOrder(alice.ID, "other", nil); err == nil {
		t.Fatal("unknown kind must be refused")
	}
}
