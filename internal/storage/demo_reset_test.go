package storage

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// demoSchemaCounts: how many FTS5 tables, shadow tables of FTS5 tables and planner statistics tables
// the schema holds, and the lowest rowid of a shadow table compared to its virtual table.
func demoSchemaCounts(t *testing.T, db *sql.DB) (vtables, shadows, stats int, shadowFirst bool) {
	t.Helper()
	q := func(query string) int {
		var n int
		if err := db.QueryRow(query).Scan(&n); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		return n
	}
	vtables = q(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'`)
	shadows = q(`SELECT COUNT(*) FROM sqlite_master s, sqlite_master v WHERE v.sql LIKE 'CREATE VIRTUAL TABLE%'
		AND s.type = 'table' AND s.name GLOB v.name || '_*' AND s.rootpage > 0`)
	stats = q(`SELECT COUNT(*) FROM sqlite_master WHERE name GLOB 'sqlite_stat*'`)
	shadowFirst = q(`SELECT COUNT(*) FROM sqlite_master s, sqlite_master v WHERE v.sql LIKE 'CREATE VIRTUAL TABLE%'
		AND s.type = 'table' AND s.name GLOB v.name || '_*' AND s.rootpage > 0 AND s.rowid < v.rowid`) > 0
	return
}

func requireIntegrity(t *testing.T, s *Store) {
	t.Helper()
	var res string
	if err := s.db.QueryRow(`PRAGMA integrity_check`).Scan(&res); err != nil || res != "ok" {
		t.Fatalf("integrity_check: %q %v", res, err)
	}
}

// The demo reset drops FTS5 tables before their shadow tables, whatever order sqlite_master lists them
// in (VACUUM puts the virtual tables behind their shadow tables), and takes the planner statistics along.
// A shadow table dropped first left the index unopenable and the demo in a crash loop.
func TestDemoResetRepeatedlyDropsSearchIndexesFirst(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "demo_reset.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatal(err)
	}
	sawShadowFirst := false
	for i := range 20 {
		// Data in every search index, then statistics, and every other round VACUUM to reorder the schema
		if _, err := store.CreateThought(DemoAdminID, "Suchbarer Gedanke #demo", "normal", "manual", ""); err != nil {
			t.Fatal(err)
		}
		if _, err := store.db.Exec(`ANALYZE`); err != nil {
			t.Fatal(err)
		}
		if i%2 == 1 {
			if _, err := store.db.Exec(`VACUUM`); err != nil {
				t.Fatal(err)
			}
		}
		vtables, shadows, stats, shadowFirst := demoSchemaCounts(t, store.db)
		if vtables != 3 || shadows == 0 || stats == 0 {
			t.Fatalf("round %d before reset: vtables=%d shadows=%d stats=%d", i, vtables, shadows, stats)
		}
		sawShadowFirst = sawShadowFirst || shadowFirst

		// dropAllTables on its own must succeed: the fallback that wipes the file is not what is tested here
		if err := store.dropAllTables(); err != nil {
			t.Fatalf("round %d: drop all tables: %v", i, err)
		}
		var left int
		if err := store.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name <> 'sqlite_sequence'`).Scan(&left); err != nil || left != 0 {
			t.Fatalf("round %d: %d schema entries left after the drop (%v)", i, left, err)
		}
		if err := store.ResetAndSeedDemo(); err != nil {
			t.Fatalf("round %d: reset: %v", i, err)
		}
		if _, _, stats, _ := demoSchemaCounts(t, store.db); stats != 0 {
			t.Fatalf("round %d: %d statistics tables survived the reset", i, stats)
		}
		requireIntegrity(t, store)
		if u, err := store.GetUserByLogin("admin"); err != nil || u == nil {
			t.Fatalf("round %d: demo admin missing: %v", i, err)
		}
		if res, _, err := store.SearchAll(DemoAdminID, "Suchbarer"); err != nil || len(res) != 0 {
			t.Fatalf("round %d: search after reset: %d results, %v", i, len(res), err)
		}
	}
	if !sawShadowFirst {
		t.Fatal("test setup: VACUUM should have listed a shadow table before its virtual table")
	}
}

// breakSearchIndexes leaves the database the way the half-done reset left the demo: the FTS5 tables are
// still in the schema, their shadow tables and all other tables are gone, the statistics stay.
func breakSearchIndexes(t *testing.T, db *sql.DB, keepTables bool) {
	t.Helper()
	rows, err := db.Query(`SELECT s.name FROM sqlite_master s, sqlite_master v WHERE v.sql LIKE 'CREATE VIRTUAL TABLE%'
		AND s.type = 'table' AND s.name GLOB v.name || '_*' AND s.rootpage > 0`)
	if err != nil {
		t.Fatal(err)
	}
	var drops []string
	for rows.Next() {
		var name string
		_ = rows.Scan(&name)
		drops = append(drops, `DROP TABLE "`+name+`"`)
	}
	_ = rows.Close()
	if !keepTables {
		rows, err = db.Query(`SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT GLOB 'sqlite_*'
			AND COALESCE(sql, '') NOT LIKE 'CREATE VIRTUAL TABLE%' AND name NOT GLOB '*_fts_*' ORDER BY type = 'table'`)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var typ, name string
			_ = rows.Scan(&typ, &name)
			drops = append(drops, `DROP `+strings.ToUpper(typ)+` "`+name+`"`)
		}
		_ = rows.Close()
	}
	if len(drops) == 0 {
		t.Fatal("test setup: nothing to drop")
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		t.Fatal(err)
	}
	for _, q := range drops {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
}

// A demo database left half reset (FTS5 tables without their shadow tables) stopped every start in the
// migrations. In demo mode the store wipes it and starts over; a real server stops and keeps it as it is.
func TestDemoModeRecoversFromHalfResetDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mindsift.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`ANALYZE`); err != nil {
		t.Fatal(err)
	}
	breakSearchIndexes(t, store.db, false)
	store.Close()

	// The incident: the migrations rebuild the first tables and stop at the broken index
	if _, err := NewStore(path); err == nil || !strings.Contains(err.Error(), "vtable constructor failed") {
		t.Fatalf("without demo mode the start must fail on the broken index, got %v", err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	vtables, shadows, _, _ := demoSchemaCounts(t, raw)
	_ = raw.Close()
	if vtables != 3 || shadows != 0 {
		t.Fatalf("a server without demo mode must leave the database alone: vtables=%d shadows=%d", vtables, shadows)
	}

	store, err = NewStore(path, WithDemoMode())
	if err != nil {
		t.Fatalf("demo mode must recover: %v", err)
	}
	defer store.Close()
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatal(err)
	}
	requireIntegrity(t, store)
	if u, err := store.GetUserByLogin("admin"); err != nil || u == nil {
		t.Fatalf("demo admin missing after recovery: %v", err)
	}
	if vtables, shadows, _, _ := demoSchemaCounts(t, store.db); vtables != 3 || shadows == 0 {
		t.Fatalf("search indexes not rebuilt: vtables=%d shadows=%d", vtables, shadows)
	}
	if _, err := store.CreateThought(DemoAdminID, "Nach der Reparatur", "normal", "manual", ""); err != nil {
		t.Fatal(err)
	}
	if res, _, err := store.SearchAll(DemoAdminID, "Reparatur"); err != nil || len(res) != 1 {
		t.Fatalf("search after recovery: %d results, %v", len(res), err)
	}
}

// A running demo whose index broke under it: the reset's drop fails (and rolls back), the store wipes the
// database and seeds it anew.
func TestDemoResetRecoversWhenDropFails(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "mindsift.db"), WithDemoMode())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatal(err)
	}
	breakSearchIndexes(t, store.db, true)
	// A connection that has the index open drops it without its shadow tables; a new one cannot open it
	store.db.SetMaxIdleConns(0)
	store.db.SetMaxIdleConns(store.maxIdleConns)
	if err := store.dropAllTables(); err == nil || !strings.Contains(err.Error(), "vtable constructor failed") {
		t.Fatalf("drop on the broken index should fail, got %v", err)
	}
	// One transaction: the failed drop left every other table in place
	var users int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil || users == 0 {
		t.Fatalf("failed drop must roll back: users=%d %v", users, err)
	}
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatalf("reset must recover: %v", err)
	}
	requireIntegrity(t, store)
	if u, err := store.GetUserByLogin("user"); err != nil || u == nil {
		t.Fatalf("demo user missing after recovery: %v", err)
	}
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatalf("next reset after recovery: %v", err)
	}
}
