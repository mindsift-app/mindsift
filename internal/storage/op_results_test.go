package storage

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
)

// replayBatch: one batch with every kind of answer (applied with and without a log entry, a conflict
// copy, rejected, a revived text change).
func replayBatch() []collab.Op {
	root := ""
	text, late, fresh, gone := "Neu", "Später", "Eingefügt", "Aus dem Nichts"
	typ := "todo"
	return []collab.Op{
		{OpID: "c_r.1", Kind: collab.OpSetContent, BlockID: "a", BaseVersion: 1, Content: &text},
		{OpID: "c_r.2", Kind: collab.OpSetContent, BlockID: "a", BaseVersion: 1, Content: &late}, // old base: conflict copy
		{OpID: "c_r.3", Kind: collab.OpInsert, BlockID: "n", ParentID: &root, OrderKey: "a5", Content: &fresh},
		{OpID: "c_r.4", Kind: collab.OpSetProps, BlockID: "a", Patch: &collab.PropsPatch{Type: &typ}},
		{OpID: "c_r.5", Kind: collab.OpMove, BlockID: "missing", ParentID: &root, OrderKey: "a6"},     // rejected
		{OpID: "c_r.6", Kind: collab.OpSetContent, BlockID: "purged", Content: &gone},                 // revived
		{OpID: "c_r.7", Kind: collab.OpSetProps, BlockID: "a", Patch: &collab.PropsPatch{Type: &typ}}, // no change
		{OpID: "", Kind: collab.OpDelete, BlockID: "a"},                                               // invalid id
	}
}

// A batch sent again gets the same answers and changes nothing (doc_op_results, op_results.go), also
// after the results kept in the old form (JSON with user_id, migration 52) were converted.
func TestReplayedBatchGetsTheSameAnswers(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, err := s.CreateDocument(u.ID, "", "Replay", "", "", flatBlocks([3]any{"a", 0, "Alt"}), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	a := collab.Actor{UserID: u.ID, ClientID: "c_r"}
	first, head, err := s.ApplyDocOps(doc.ID, a, replayBatch(), nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{collab.StatusApplied, collab.StatusConflict, collab.StatusApplied, collab.StatusApplied,
		collab.StatusRejected, collab.StatusApplied, collab.StatusApplied, collab.StatusRejected}
	for i, r := range first {
		if r.Status != want[i] {
			t.Fatalf("op %d: %+v, want %s", i, r, want[i])
		}
	}
	if first[1].ConflictBlockID == "" || first[5].Reason != "revived" || first[0].Seq == 0 {
		t.Fatalf("unexpected first answers: %+v", first)
	}
	snapshot := func() []byte {
		t.Helper()
		snap, err := s.GetDocSnapshot(doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		out, _ := json.Marshal(snap.Blocks)
		return out
	}
	state := snapshot()
	replay := func(label string) {
		t.Helper()
		again, head2, err := s.ApplyDocOps(doc.ID, a, replayBatch(), nil)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(again, first) {
			t.Fatalf("%s: replay answered\n%+v\nwant\n%+v", label, again, first)
		}
		if head2 != head || string(snapshot()) != string(state) {
			t.Fatalf("%s: the replay changed the note (head %d → %d)", label, head, head2)
		}
	}
	replay("compact results")

	// The same op id sent to another note is refused, as before
	other, _ := s.CreateDocument(u.ID, "", "Andere", "", "", flatBlocks([3]any{"o", 0, "x"}), nil, false)
	res, _, err := s.ApplyDocOps(other.ID, a, replayBatch()[:1], nil)
	if err != nil || res[0].Status != collab.StatusRejected || res[0].Reason != "op_id_reused" {
		t.Fatalf("op id of another note: %+v %v", res, err)
	}

	// Results kept in the old form before migration 52 answer the same once converted
	if _, err := s.db.Exec(`DROP TABLE doc_op_results`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TABLE doc_op_results (op_id TEXT PRIMARY KEY,
		doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, user_id TEXT NOT NULL DEFAULT '',
		result TEXT NOT NULL, created_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	created := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	for _, r := range first {
		if r.OpID == "" {
			continue
		}
		js, _ := json.Marshal(r)
		if _, err := s.db.Exec(`INSERT INTO doc_op_results (op_id, doc_id, user_id, result, created_at) VALUES (?, ?, ?, ?, ?)`,
			r.OpID, doc.ID, u.ID, string(js), created); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(`INSERT INTO doc_op_results (op_id, doc_id, user_id, result, created_at) VALUES ('broken', ?, '', 'kein json', ?)`, doc.ID, created); err != nil {
		t.Fatal(err)
	}
	if err := s.migrateCompactOpResults(); err != nil {
		t.Fatal(err)
	}
	replay("converted results")
	if res, _, _ := s.ApplyDocOps(doc.ID, a, []collab.Op{{OpID: "broken", Kind: collab.OpDelete, BlockID: "a"}}, nil); res[0].Reason != "op_id_reused" {
		t.Errorf("a result that did not parse answers as before: %+v", res)
	}
	var age int64
	if err := s.db.QueryRow(`SELECT ? - created_at FROM doc_op_results WHERE op_id = 'c_r.1'`, time.Now().Unix()).Scan(&age); err != nil || age < 3500 || age > 3700 {
		t.Errorf("the time of a converted result is kept: %d s old (%v)", age, err)
	}

	// The retention still goes by the time (90 days)
	if _, err := s.db.Exec(`UPDATE doc_op_results SET created_at = ? WHERE op_id = 'c_r.1'`, time.Now().Add(-OpResultRetention-time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	st, err := s.CompactDocs(time.Now())
	if err != nil || st.OpResults != 1 {
		t.Fatalf("retention removed %d results (%v), want 1", st.OpResults, err)
	}
}

// Operations the server makes itself (random ids nobody sends again) keep no result.
func TestServerOperationsKeepNoResult(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, _ := s.CreateDocument(u.ID, "", "Server", "", "", flatBlocks([3]any{"a", 0, "x"}), nil, false)
	if !s.SetBlockChecked(u.ID, doc.ID, "a", true) {
		t.Fatal("SetBlockChecked failed")
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM doc_op_results WHERE doc_id = ?`, doc.ID).Scan(&n); err != nil || n != 0 {
		t.Errorf("%d results kept for server operations (%v)", n, err)
	}
}
