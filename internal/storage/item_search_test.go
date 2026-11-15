package storage

import (
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// checkItemSearchIndexes: both indexes hold exactly what their tables say.
func checkItemSearchIndexes(t *testing.T, s *Store) {
	t.Helper()
	for _, fts := range []string{"thoughts_fts", "list_items_fts"} {
		if _, err := s.db.Exec(`INSERT INTO ` + fts + `(` + fts + `, rank) VALUES('integrity-check', 1)`); err != nil {
			t.Fatalf("%s does not match its table: %v", fts, err)
		}
	}
}

// itemHits: the task and list item hits of a search, with snippet and score.
func itemHits(t *testing.T, s *Store, userID, query string) []SearchHit {
	t.Helper()
	res, err := s.SearchGlobal(userID, query)
	if err != nil {
		t.Fatal(err)
	}
	var out []SearchHit
	for _, h := range res.Hits {
		if h.Type == "thought" || h.Type == "list_item" {
			out = append(out, h)
		}
	}
	return out
}

func itemHitIDs(t *testing.T, s *Store, userID, query string) []string {
	t.Helper()
	var ids []string
	for _, h := range itemHits(t, s, userID, query) {
		ids = append(ids, h.ID)
	}
	return ids
}

// Changing, ticking, deleting and restoring tasks and list items keeps the search indexes right: a
// changed text is found by its new words only, a deleted entry not at all, a restored one again.
func TestItemSearchFollowsChanges(t *testing.T) {
	s, u, _ := setupTestStore(t)
	defer s.Close()

	task, err := s.CreateThoughtWithDetails(u.ID, "Fahrrad reparieren", "normal", "manual", "", "", "todo", "Schlauch kaufen")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateThoughtTriage(u.ID, task.ID, "keep", "task", "", "", ""); err != nil {
		t.Fatal(err)
	}
	other, _ := s.CreateThought(u.ID, "Fahrradtour planen", "normal", "manual", "")
	list, err := s.CreateList(u.ID, "Einkauf", "🛒", "shopping")
	if err != nil {
		t.Fatal(err)
	}
	item, err := s.CreateListItem(list.ID, "Haferflocken", "Frühstück", "", 0, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := func(query string, ids ...string) {
		t.Helper()
		got := itemHitIDs(t, s, u.ID, query)
		sort.Strings(got)
		sort.Strings(ids)
		if len(got) == 0 && len(ids) == 0 {
			return
		}
		if !reflect.DeepEqual(got, ids) {
			t.Fatalf("search %q: got %v, want %v", query, got, ids)
		}
		checkItemSearchIndexes(t, s)
	}
	want("Fahrrad", task.ID, other.ID)
	want("Schlauch", task.ID)
	want("Haferflocken", item.ID)
	want("Frühstück", item.ID)

	content, notes := "Auto waschen", "Felgen putzen"
	if _, err := s.UpdateThoughtDetails(u.ID, task.ID, &content, nil, nil, nil, nil, nil, &notes, nil, nil); err != nil {
		t.Fatal(err)
	}
	want("Fahrrad", other.ID)
	want("Schlauch")
	want("Auto", task.ID)
	want("Felgen", task.ID)
	// Columns the index does not hold leave it alone
	done, board := true, "done"
	if _, err := s.UpdateThoughtDetails(u.ID, task.ID, nil, &done, nil, nil, nil, &board, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	want("Auto", task.ID)

	if err := s.DeleteThought(u.ID, task.ID); err != nil {
		t.Fatal(err)
	}
	want("Auto")
	// Another task takes the next key meanwhile; the restored one gets a new key, not its old one
	newer, _ := s.CreateThought(u.ID, "Auto tanken", "normal", "manual", "")
	if _, err := s.RestoreTrashedTask(u.ID, task.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	gotAuto := itemHitIDs(t, s, u.ID, "Auto")
	if len(gotAuto) != 2 {
		t.Fatalf("after restoring: %v (want %s and %s)", gotAuto, task.ID, newer.ID)
	}
	checkItemSearchIndexes(t, s)
	if err := s.DeleteThought(u.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	want("Fahrradtour")

	cat, text := "Vorrat", "Dinkelflocken"
	if _, err := s.UpdateListItem(item.ID, &text, &cat, nil); err != nil {
		t.Fatal(err)
	}
	want("Haferflocken")
	want("Frühstück")
	want("Dinkelflocken", item.ID)
	want("Vorrat", item.ID)
	if _, err := s.ToggleListItem(item.ID, true, u.ID, u.DisplayName); err != nil {
		t.Fatal(err)
	}
	want("Dinkelflocken", item.ID)
	if _, err := s.DeleteListItem(item.ID); err != nil {
		t.Fatal(err)
	}
	want("Dinkelflocken")

	// No copy of the text in either index
	var copies int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name IN ('thoughts_fts_content', 'list_items_fts_content')`).Scan(&copies); err != nil || copies != 0 {
		t.Fatalf("%d search indexes keep a copy of the text (%v)", copies, err)
	}
}

// Changes to a task or list item go to the index by key: the triggers no longer search the index for the
// row's id (FTS5 can only answer that by reading all of it).
func TestItemSearchTriggersUseKeys(t *testing.T) {
	s, _, _ := setupTestStore(t)
	defer s.Close()
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'
		AND (sql LIKE '%DELETE FROM thoughts_fts%' OR sql LIKE '%DELETE FROM list_items_fts%')`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("%d triggers still delete from the index by a column", n)
	}
	var au string
	if err := s.db.QueryRow(`SELECT sql FROM sqlite_master WHERE name = 'trg_thoughts_au'`).Scan(&au); err != nil {
		t.Fatal(err)
	}
	if want := "AFTER UPDATE OF content, notes, subtasks ON thoughts"; !strings.Contains(strings.ToLower(au), strings.ToLower(want)) {
		t.Fatalf("trg_thoughts_au should only fire for the searched columns:\n%s", au)
	}
}

// oldItemSearchSQL: the indexes of tasks and list items as the baseline (migration 3) created them, with
// a copy of the text and the row's id in an UNINDEXED column.
var oldItemSearchSQL = []string{
	`CREATE VIRTUAL TABLE thoughts_fts USING fts5(thought_id UNINDEXED, content, notes, subtasks, tokenize='unicode61')`,
	`CREATE VIRTUAL TABLE list_items_fts USING fts5(item_id UNINDEXED, list_id UNINDEXED, content, category, tokenize='unicode61')`,
	`CREATE TRIGGER trg_thoughts_ai AFTER INSERT ON thoughts BEGIN
		INSERT INTO thoughts_fts(thought_id, content, notes, subtasks) VALUES (new.id, new.content, new.notes, new.subtasks);
	END`,
	`CREATE TRIGGER trg_thoughts_au AFTER UPDATE ON thoughts BEGIN
		DELETE FROM thoughts_fts WHERE thought_id = old.id;
		INSERT INTO thoughts_fts(thought_id, content, notes, subtasks) VALUES (new.id, new.content, new.notes, new.subtasks);
	END`,
	`CREATE TRIGGER trg_thoughts_ad AFTER DELETE ON thoughts BEGIN
		DELETE FROM thoughts_fts WHERE thought_id = old.id;
	END`,
	`CREATE TRIGGER trg_list_items_ai AFTER INSERT ON list_items BEGIN
		INSERT INTO list_items_fts(item_id, list_id, content, category) VALUES (new.id, new.list_id, new.content, new.category);
	END`,
	`CREATE TRIGGER trg_list_items_au AFTER UPDATE ON list_items BEGIN
		DELETE FROM list_items_fts WHERE item_id = old.id;
		INSERT INTO list_items_fts(item_id, list_id, content, category) VALUES (new.id, new.list_id, new.content, new.category);
	END`,
	`CREATE TRIGGER trg_list_items_ad AFTER DELETE ON list_items BEGIN
		DELETE FROM list_items_fts WHERE item_id = old.id;
	END`,
	`INSERT INTO thoughts_fts(thought_id, content, notes, subtasks) SELECT id, content, notes, subtasks FROM thoughts`,
	`INSERT INTO list_items_fts(item_id, list_id, content, category) SELECT id, list_id, content, category FROM list_items`,
}

type itemHit struct {
	id, snippet string
	score       float64
}

// oldItemHits searches the indexes from before migration 47 the way Search did then (the same filters
// and order for one person's own tasks and lists).
func oldItemHits(t *testing.T, s *Store, userID, query string) []itemHit {
	t.Helper()
	fts := PrepareFTSQuery(query)
	var out []itemHit
	for _, q := range []string{
		`SELECT f.thought_id, snippet(thoughts_fts, -1, '<mark>', '</mark>', '…', 14),
		        bm25(thoughts_fts, 5.0, 1.0, 1.0) AS score
		FROM thoughts_fts f JOIN thoughts t ON t.id = f.thought_id
		WHERE thoughts_fts MATCH ? AND t.user_id = ?
		ORDER BY t.status = 'discarded' ASC, t.is_completed ASC, score ASC LIMIT 40`,
		`SELECT f.item_id, snippet(list_items_fts, -1, '<mark>', '</mark>', '…', 14),
		        bm25(list_items_fts, 2.0, 1.0) AS score
		FROM list_items_fts f JOIN list_items li ON li.id = f.item_id JOIN lists l ON l.id = li.list_id
		WHERE list_items_fts MATCH ? AND l.user_id = ?
		ORDER BY li.is_completed ASC, score ASC LIMIT 40`,
	} {
		rows, err := s.db.Query(q, fts, userID)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var h itemHit
			if err := rows.Scan(&h.id, &h.snippet, &h.score); err != nil {
				t.Fatal(err)
			}
			out = append(out, h)
		}
		_ = rows.Close()
	}
	return out
}

// Migration 47 converts the indexes of an existing database: every search finds the same tasks and list
// items with the same snippets and scores as before, and writing goes on in the new form.
func TestItemSearchMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "items.db")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	openSharing(t, s)
	u, err := s.CreateUserWithUsername("anna@test.local", "anna", "hash", "Anna", "member")
	if err != nil {
		t.Fatal(err)
	}
	texts := []struct{ content, notes string }{
		{"Heizung entlüften", "Vor dem Winter, Heizung Heizung"},
		{"Steuererklärung abgeben", "Belege vom Arzt sammeln"},
		{"Arzttermin ausmachen", ""},
		{"Garten winterfest machen", "Heizung in der Laube abdrehen"},
		{"Ölwechsel am Auto", "Werkstatt anrufen"},
	}
	for i, x := range texts {
		th, err := s.CreateThoughtWithDetails(u.ID, x.content, "normal", "manual", "", "", "todo", x.notes)
		if err != nil {
			t.Fatal(err)
		}
		if i%2 == 0 {
			if _, err := s.UpdateThoughtTriage(u.ID, th.ID, "keep", "task", "", "", ""); err != nil {
				t.Fatal(err)
			}
		}
	}
	list, _ := s.CreateList(u.ID, "Einkauf", "🛒", "shopping")
	for _, it := range [][2]string{{"Heizöl bestellen", "Haus"}, {"Milch", "Kühlregal"}, {"Arztkoffer", "Apotheke"}, {"Hafermilch", "Kühlregal"}} {
		if _, err := s.CreateListItem(list.ID, it[0], it[1], "", 0, u.ID); err != nil {
			t.Fatal(err)
		}
	}
	queries := []string{"Heizung", "Arzt", "Kühlregal", "milch", "Auto Werkstatt", "winter"}

	// Back to the state before migration 47
	for _, q := range append([]string{
		`DROP TRIGGER trg_thoughts_ai`, `DROP TRIGGER trg_thoughts_au`, `DROP TRIGGER trg_thoughts_ad`,
		`DROP TRIGGER trg_list_items_ai`, `DROP TRIGGER trg_list_items_au`, `DROP TRIGGER trg_list_items_ad`,
		`DROP TABLE thoughts_fts`, `DROP TABLE list_items_fts`,
		`DROP INDEX idx_thoughts_fts_rowid`, `DROP INDEX idx_list_items_fts_rowid`,
		`ALTER TABLE thoughts DROP COLUMN fts_rowid`, `ALTER TABLE list_items DROP COLUMN fts_rowid`,
		`DELETE FROM schema_migrations WHERE id = 47`,
	}, oldItemSearchSQL...) {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	before := map[string][]itemHit{}
	for _, q := range queries {
		before[q] = oldItemHits(t, s, u.ID, q)
		if len(before[q]) == 0 {
			t.Fatalf("search %q finds nothing before the migration", q)
		}
	}
	_ = s.Close()

	s, err = NewStore(path)
	if err != nil {
		t.Fatalf("migrating: %v", err)
	}
	defer s.Close()
	openSharing(t, s)
	checkItemSearchIndexes(t, s)
	for _, q := range queries {
		var got []itemHit
		for _, h := range itemHits(t, s, u.ID, q) {
			got = append(got, itemHit{h.ID, h.Snippet, h.Score})
		}
		if !reflect.DeepEqual(got, before[q]) {
			t.Fatalf("search %q changed:\n got %+v\nwant %+v", q, got, before[q])
		}
	}
	var missing int
	if err := s.db.QueryRow(`SELECT (SELECT COUNT(*) FROM thoughts WHERE fts_rowid IS NULL) + (SELECT COUNT(*) FROM list_items WHERE fts_rowid IS NULL)`).Scan(&missing); err != nil || missing != 0 {
		t.Fatalf("%d rows without a key (%v)", missing, err)
	}

	// Writing goes on in the new form
	th, err := s.CreateThought(u.ID, "Heizung warten lassen", "normal", "manual", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := itemHitIDs(t, s, u.ID, "warten"); !reflect.DeepEqual(got, []string{th.ID}) {
		t.Fatalf("new task not found: %v", got)
	}
	checkItemSearchIndexes(t, s)
}
