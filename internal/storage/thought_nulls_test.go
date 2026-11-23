package storage

import (
	"path/filepath"
	"testing"
)

// A task row with NULL in the columns declared without NOT NULL (an import or a hand-made INSERT) is
// read like one with empty strings and shows up in the task queries; migration 74 turns such NULLs into
// empty strings.
func TestThoughtNullsAreReadAndRepaired(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nulls.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	if err != nil {
		t.Fatal(err)
	}
	task, _, _, err := store.CreateTask(user.ID, "Ohne Datum", "normal", "manual", "", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`UPDATE thoughts SET due_date = NULL, converted_ref_id = NULL, triaged_at = NULL WHERE id = ?`, task.ID); err != nil {
		t.Fatal(err)
	}
	check := func(label string) {
		t.Helper()
		for name, q := range map[string]TaskQuery{
			"all": {}, "open": {Status: "open"}, "dueFirst": {DueFirst: true}, "dueBefore": {DueBefore: "2999-01-01"},
		} {
			got, err := store.QueryTasks(user.ID, q)
			if err != nil {
				t.Fatal(err)
			}
			want := name != "dueBefore" // a task without a due date is left out by a due condition
			if (len(got) == 1) != want {
				t.Fatalf("%s: query %s returned %d tasks", label, name, len(got))
			}
			if want && (got[0].ID != task.ID || got[0].DueDate != "" || got[0].ConvertedType != "task") {
				t.Fatalf("%s: query %s returned %+v", label, name, got[0])
			}
		}
		got, err := store.GetTasks(user.ID, "")
		if err != nil || len(got) != 1 {
			t.Fatalf("%s: GetTasks returned %d tasks, %v", label, len(got), err)
		}
		if one, err := store.GetThoughtByIDUnchecked(task.ID); err != nil || one == nil {
			t.Fatalf("%s: GetThoughtByIDUnchecked: %v", label, err)
		}
	}
	check("NULL read")

	// Migration 74 on a database from before it
	if _, err := store.db.Exec(`DELETE FROM schema_migrations WHERE id = 74`); err != nil {
		t.Fatal(err)
	}
	_ = store.Close()
	if store, err = NewStore(path); err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var nulls int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE due_date IS NULL OR converted_type IS NULL OR converted_ref_id IS NULL OR triaged_at IS NULL`).Scan(&nulls); err != nil {
		t.Fatal(err)
	}
	if nulls != 0 {
		t.Fatalf("migration 74 left %d rows with NULL", nulls)
	}
	check("NULL repaired")
}
