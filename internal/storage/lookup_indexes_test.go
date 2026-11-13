package storage

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// queryPlan returns the steps of EXPLAIN QUERY PLAN for q.
func queryPlan(t *testing.T, s *Store, q string, args ...any) []string {
	t.Helper()
	rows, err := s.db.Query(`EXPLAIN QUERY PLAN `+q, args...)
	if err != nil {
		t.Fatalf("%v\n%s", err, q)
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	return plan
}

// Tasks of a note's bullets and old deleted bullets are found through the indexes of migration 42: before,
// every lookup read all thoughts (substr/instr on converted_ref_id) or all blocks (CompactDocs).
func TestTaskOfNoteQueriesUseIndexes(t *testing.T) {
	s, u := newSyncTestStore(t)
	// Several people with notes, tasks from bullets and plain thoughts, so the statistics below look
	// like a real database (on a few rows of one person every scan is as cheap as a search)
	for k := 0; k < 10; k++ {
		owner, err := s.CreateUser(fmt.Sprintf("person%d@example.com", k), "hash", "Person", "member")
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 10; i++ {
			doc, err := s.CreateDocument(owner.ID, "", "Notiz", "", "", []domain.DocumentBlock{
				{ID: "blk_1", Type: "todo", Content: "Aufgabe"},
			}, nil, false)
			if err != nil {
				t.Fatal(err)
			}
			for j := 0; j < 6; j++ {
				th, err := s.CreateThought(owner.ID, "Gedanke", "normal", "manual", "")
				if err != nil {
					t.Fatal(err)
				}
				if j == 0 {
					if _, err := s.db.Exec(`UPDATE thoughts SET status = 'kept', converted_type = 'document_block', converted_ref_id = ? WHERE id = ?`,
						doc.ID+":blk_1", th.ID); err != nil {
						t.Fatal(err)
					}
				}
			}
		}
	}
	scan := regexp.MustCompile(`\bSCAN (t|d|thoughts|documents|blocks)\b`)
	cutoff := time.Now().UTC().Format(time.RFC3339)
	for _, stats := range []bool{false, true} {
		if stats {
			if err := s.Optimize(); err != nil {
				t.Fatal(err)
			}
		}
		for name, q := range map[string]struct {
			sql  string
			args []any
		}{
			"docTaskLinks":              {`SELECT id, converted_ref_id FROM thoughts WHERE ` + sqlTasksOfNoteBlocks, []any{"doc_1"}},
			"hardDeleteDocument":        {`UPDATE thoughts SET converted_type = '', converted_ref_id = '' WHERE ` + sqlTasksOfNoteBlocks, []any{"doc_1"}},
			"sqlUnlinkTasksOfUserNotes": {sqlUnlinkTasksOfUserNotes, []any{u.ID}},
			"CompactDocs tombstones":    {sqlOldTombstoneDocs, []any{cutoff}},
		} {
			plan := queryPlan(t, s, q.sql, q.args...)
			for _, step := range plan {
				if scan.MatchString(step) {
					t.Errorf("%s (statistics: %v) scans: %s\n%s", name, stats, step, strings.Join(plan, "\n"))
				}
			}
		}
	}
}

// The prefix range finds exactly the tasks of one note: not those of a note whose id starts with the
// same characters, and not references without the separator.
func TestTasksOfNoteBlocksRange(t *testing.T) {
	s, u := newSyncTestStore(t)
	refs := map[string]string{
		"own1":   "doc_ab:blk_1",
		"own2":   "doc_ab:blk_2",
		"longer": "doc_abc:blk_3",
		"before": "doc_aa:blk_4",
		"semi":   "doc_ab;blk_5",
		"noSep":  "doc_ab",
		"bare":   "doc_abblk_6",
	}
	names := map[string]string{}
	for name, ref := range refs {
		th, err := s.CreateThought(u.ID, name, "normal", "manual", "")
		if err != nil {
			t.Fatal(err)
		}
		names[th.ID] = name
		if _, err := s.db.Exec(`UPDATE thoughts SET status = 'kept', converted_type = 'document_block', converted_ref_id = ? WHERE id = ?`, ref, th.ID); err != nil {
			t.Fatal(err)
		}
	}
	var got []string
	for block, taskID := range s.docTaskLinks("doc_ab") {
		got = append(got, names[taskID]+"="+block)
	}
	sort.Strings(got)
	if strings.Join(got, ",") != "own1=blk_1,own2=blk_2" {
		t.Fatalf("docTaskLinks(doc_ab) = %v", got)
	}

	// Purging the note unlinks the same two tasks, nothing else
	if err := s.hardDeleteDocument("doc_ab"); err != nil {
		t.Fatal(err)
	}
	rows, err := s.db.Query(`SELECT content FROM thoughts WHERE converted_type = 'document_block' ORDER BY content`)
	if err != nil {
		t.Fatal(err)
	}
	var linked []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			t.Fatal(err)
		}
		linked = append(linked, c)
	}
	_ = rows.Close()
	if strings.Join(linked, ",") != "bare,before,longer,noSep,semi" {
		t.Fatalf("still linked after purging doc_ab: %v", linked)
	}
}

// Optimize writes statistics for the query planner (sqlite_stat1) on a database that has only been
// opened and filled, without any earlier ANALYZE.
func TestOptimizeWritesStatistics(t *testing.T) {
	s, u := newSyncTestStore(t)
	for i := 0; i < 200; i++ {
		if _, err := s.CreateThought(u.ID, "Gedanke", "normal", "manual", ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Optimize(); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_stat1 WHERE tbl = 'thoughts'`).Scan(&n); err != nil {
		t.Fatalf("no statistics: %v", err)
	}
	if n == 0 {
		t.Fatal("no statistics for thoughts after Optimize")
	}
}
