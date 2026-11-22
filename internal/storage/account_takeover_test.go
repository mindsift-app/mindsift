package storage

import (
	"strconv"
	"testing"
)

// A backup holds every task, not only the first 200 (GetThoughts' page), and the tasks others added to
// the person's own task lists, which a restore of those lists would otherwise lose.
func TestExportHoldsAllTasksOfOwnLists(t *testing.T) {
	store, anna, ben := newImportStore(t)
	tl, _ := store.CreateTaskList(anna.ID, "", "", "Haushalt", "🏠", "")
	if _, err := store.AddTaskListShare(tl.ID, "user", ben.ID, "editor", anna.ID); err != nil {
		t.Fatalf("share: %v", err)
	}
	for i := range 250 {
		if _, err := store.CreateThoughtWithDetails(anna.ID, "Aufgabe "+strconv.Itoa(i), "normal", "manual", "", tl.ID, "todo", ""); err != nil {
			t.Fatalf("task: %v", err)
		}
	}
	if _, err := store.CreateThoughtWithDetails(ben.ID, "Von Ben", "normal", "manual", "", tl.ID, "todo", ""); err != nil {
		t.Fatalf("Ben's task: %v", err)
	}
	// Ben's own task elsewhere is none of Anna's business
	if _, err := store.CreateThought(ben.ID, "Bens Idee", "normal", "manual", ""); err != nil {
		t.Fatalf("Ben's thought: %v", err)
	}
	exp, err := store.ExportUserData(anna.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if len(exp.Thoughts) != 251 {
		t.Fatalf("exported %d tasks, want 251", len(exp.Thoughts))
	}
	for _, th := range exp.Thoughts {
		if th.Content == "Bens Idee" {
			t.Error("Ben's own thought is in Anna's backup")
		}
	}
}

// The accounts of a snapshot with what each owns.
func TestSnapshotAccounts(t *testing.T) {
	store, anna, ben := newImportStore(t)
	seedAnna(t, store, anna)
	_, _ = store.CreateThought(ben.ID, "Idee", "normal", "manual", "")
	accounts, err := store.SnapshotAccounts()
	if err != nil || len(accounts) != 2 {
		t.Fatalf("accounts: %+v, %v", accounts, err)
	}
	if a := accounts[0]; a.ID != anna.ID || a.Notes != 1 || a.Tasks != 1 || a.Lists != 1 || a.Inbox != 0 || a.Email != "anna@example.com" {
		t.Errorf("Anna: %+v", a)
	}
	if b := accounts[1]; b.ID != ben.ID || b.Notes != 0 || b.Inbox != 1 {
		t.Errorf("Ben: %+v", b)
	}
}

// Taking an account over hands out only the hidden values of notes it owns, not a value of someone else's
// note its notes refer to.
func TestHiddenValuesOfOnlyOwnNotes(t *testing.T) {
	store, anna, ben := newImportStore(t)
	annaDoc, _ := store.CreateDocument(anna.ID, "", "Annas", "📄", "", nil, nil, false)
	benDoc, _ := store.CreateDocument(ben.ID, "", "Bens", "📄", "", nil, nil, false)
	if err := store.CreateSecret("secanna", annaDoc.ID, anna.ID, "v1:anna"); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateSecret("secben", benDoc.ID, ben.ID, "v1:ben"); err != nil {
		t.Fatal(err)
	}
	got, err := store.HiddenValuesOf(anna.ID, []string{"secanna", "secben", "secnone"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got["secanna"] != "v1:anna" {
		t.Errorf("Anna's values: %v", got)
	}
}
