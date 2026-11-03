package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func syncDoc(t *testing.T, ts *httptest.Server, token, docID string, body map[string]interface{}) (int, syncResponse) {
	t.Helper()
	resp := doJSON(t, ts, http.MethodPost, "/api/v1/docs/"+docID+"/sync", token, body)
	var out syncResponse
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatalf("decode sync response: %v", err)
		}
	}
	return resp.StatusCode, out
}

func strp(s string) *string { return &s }

type collabFixture struct {
	ts                             *httptest.Server
	docID                          string
	ownerTok, editorTok, viewerTok string
	outsiderTok                    string
}

func newCollabFixture(t *testing.T) collabFixture {
	t.Helper()
	_, store, ts, owner, ownerTok := startRealtimeServer(t)
	editor, editorTok := newTestUser(t, store, "editor@example.com")
	viewer, viewerTok := newTestUser(t, store, "viewer@example.com")
	_, outsiderTok := newTestUser(t, store, "outsider2@example.com")
	doc, err := store.CreateDocument(owner.ID, "", "Gemeinsam", "🗒️", "", []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "Erster Punkt"}}, nil, false)
	if err != nil {
		t.Fatalf("create doc: %v", err)
	}
	if _, err := store.CreateDocShare(owner.ID, doc.ID, editor.ID, "write"); err != nil {
		t.Fatalf("share editor: %v", err)
	}
	if _, err := store.CreateDocShare(owner.ID, doc.ID, viewer.ID, "read"); err != nil {
		t.Fatalf("share viewer: %v", err)
	}
	return collabFixture{ts: ts, docID: doc.ID, ownerTok: ownerTok, editorTok: editorTok, viewerTok: viewerTok, outsiderTok: outsiderTok}
}

func TestDocSyncBetweenTwoEditors(t *testing.T) {
	f := newCollabFixture(t)

	// Owner inserts a block and edits the existing one in one round trip
	code, a := syncDoc(t, f.ts, f.ownerTok, f.docID, map[string]interface{}{
		"clientId": "owner-tab", "lastSeq": 0,
		"ops": []collab.Op{
			{OpID: "o1", Kind: collab.OpInsert, BlockID: "b2", ParentID: strp(""), OrderKey: "a5", Content: strp("Zweiter Punkt")},
			{OpID: "o2", Kind: collab.OpSetContent, BlockID: "b1", BaseVersion: 1, Content: strp("Erster Punkt (bearbeitet)")},
		},
	})
	if code != http.StatusOK || a.Results[0].Status != collab.StatusApplied || a.Results[1].Status != collab.StatusApplied {
		t.Fatalf("owner sync: %d %+v", code, a.Results)
	}
	if len(a.Leases.Granted) == 0 || a.Leases.Granted[0] != "b2" {
		t.Fatalf("inserted block must be leased to its author: %+v", a.Leases)
	}

	// Editor pulls everything since 0 and replays it
	code, b := syncDoc(t, f.ts, f.editorTok, f.docID, map[string]interface{}{"clientId": "editor-tab", "lastSeq": 0})
	if code != http.StatusOK || b.HeadSeq != a.HeadSeq || b.Role != "editor" || !b.Shared {
		t.Fatalf("editor pull: %d head=%d role=%s shared=%v", code, b.HeadSeq, b.Role, b.Shared)
	}
	replay := collab.NewDoc()
	for _, e := range b.Ops {
		replay.ApplyEffect(e.Effect)
	}
	flat := replay.Flatten()
	if len(flat) != 2 || flat[0].Content != "Erster Punkt (bearbeitet)" || flat[1].Content != "Zweiter Punkt" {
		t.Fatalf("replayed state wrong: %+v", flat)
	}
	if len(b.Leases.Others) == 0 {
		t.Fatal("editor must see the owner's lease on b2")
	}

	// Editor writes into the leased block: owner keeps it, editor's text becomes a conflict copy
	_, c := syncDoc(t, f.ts, f.editorTok, f.docID, map[string]interface{}{
		"clientId": "editor-tab", "lastSeq": b.HeadSeq,
		"ops": []collab.Op{{OpID: "e1", Kind: collab.OpSetContent, BlockID: "b2", BaseVersion: 1, Content: strp("Editor war hier")}},
	})
	if c.Results[0].Status != collab.StatusConflict || c.Results[0].ConflictBlockID == "" {
		t.Fatalf("write into foreign lease must conflict: %+v", c.Results)
	}
}

func TestDocSyncRetryIsIdempotent(t *testing.T) {
	f := newCollabFixture(t)
	body := map[string]interface{}{
		"clientId": "tab", "lastSeq": 0,
		"ops": []collab.Op{{OpID: "same-op", Kind: collab.OpSetContent, BlockID: "b1", BaseVersion: 1, Content: strp("Einmal")}},
	}
	_, first := syncDoc(t, f.ts, f.ownerTok, f.docID, body)
	_, second := syncDoc(t, f.ts, f.ownerTok, f.docID, body) // response of the first was "lost"
	if first.Results[0] != second.Results[0] || first.HeadSeq != second.HeadSeq {
		t.Fatalf("retry applied twice: %+v / %+v", first, second)
	}
}

func TestDocSyncPermissions(t *testing.T) {
	f := newCollabFixture(t)
	op := map[string]interface{}{
		"clientId": "tab", "lastSeq": 0,
		"ops": []collab.Op{{OpID: "v1", Kind: collab.OpSetContent, BlockID: "b1", BaseVersion: 1, Content: strp("Leser schreibt")}},
	}
	if code, _ := syncDoc(t, f.ts, f.viewerTok, f.docID, op); code != http.StatusForbidden {
		t.Errorf("viewer sending ops: want 403, got %d", code)
	}
	code, pull := syncDoc(t, f.ts, f.viewerTok, f.docID, map[string]interface{}{"clientId": "tab", "lastSeq": 0, "leases": map[string]interface{}{"hold": []string{"b1"}}})
	if code != http.StatusOK || pull.Role != "viewer" || len(pull.Leases.Granted) != 0 {
		t.Errorf("viewer pull: %d role=%s granted=%v", code, pull.Role, pull.Leases.Granted)
	}
	if code, _ := syncDoc(t, f.ts, f.outsiderTok, f.docID, map[string]interface{}{"clientId": "tab"}); code != http.StatusNotFound {
		t.Errorf("outsider: want 404, got %d", code)
	}
	for _, path := range []string{"/snapshot", "/changes?wait=0"} {
		if resp := doJSON(t, f.ts, http.MethodGet, "/api/v1/docs/"+f.docID+path, f.outsiderTok, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("outsider %s: want 404, got %d", path, resp.StatusCode)
		}
	}
}

func TestDocSnapshotMatchesLog(t *testing.T) {
	f := newCollabFixture(t)
	syncDoc(t, f.ts, f.ownerTok, f.docID, map[string]interface{}{
		"clientId": "tab", "lastSeq": 0,
		"ops": []collab.Op{{OpID: "t1", Kind: collab.OpSetTitle, BaseVersion: 0, Title: strp("Neuer Titel")}},
	})
	resp := doJSON(t, f.ts, http.MethodGet, "/api/v1/docs/"+f.docID+"/snapshot", f.editorTok, nil)
	var snap struct {
		Title   string         `json:"title"`
		HeadSeq int64          `json:"headSeq"`
		Blocks  []collab.Block `json:"blocks"`
		Role    string         `json:"role"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		t.Fatal(err)
	}
	if snap.Title != "Neuer Titel" || snap.HeadSeq == 0 || len(snap.Blocks) != 1 || snap.Role != "editor" {
		t.Fatalf("snapshot: %+v", snap)
	}
}

func TestDocChangesLongPollWakesOnChange(t *testing.T) {
	f := newCollabFixture(t)
	_, base := syncDoc(t, f.ts, f.editorTok, f.docID, map[string]interface{}{"clientId": "editor-tab", "lastSeq": 0})

	type pollResult struct {
		Changed bool  `json:"changed"`
		HeadSeq int64 `json:"headSeq"`
	}
	done := make(chan pollResult, 1)
	start := time.Now()
	go func() {
		req, _ := http.NewRequest(http.MethodGet, f.ts.URL+"/api/v1/docs/"+f.docID+"/changes?wait=20&since="+itoa(base.HeadSeq), nil)
		req.Header.Set("Authorization", "Bearer "+f.editorTok)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			done <- pollResult{}
			return
		}
		defer resp.Body.Close()
		var r pollResult
		_ = json.NewDecoder(resp.Body).Decode(&r)
		done <- r
	}()

	time.Sleep(300 * time.Millisecond)
	syncDoc(t, f.ts, f.ownerTok, f.docID, map[string]interface{}{
		"clientId": "owner-tab", "lastSeq": 0,
		"ops": []collab.Op{{OpID: "lp1", Kind: collab.OpSetContent, BlockID: "b1", BaseVersion: 1, Content: strp("Weckruf")}},
	})
	select {
	case r := <-done:
		if !r.Changed || r.HeadSeq <= base.HeadSeq || time.Since(start) > 5*time.Second {
			t.Fatalf("long poll result: %+v after %v", r, time.Since(start))
		}
	case <-time.After(10 * time.Second):
		t.Fatal("long poll did not wake up")
	}
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func TestDocSyncAfterCompaction(t *testing.T) {
	srv, store, ts, owner, ownerTok := startRealtimeServer(t)
	doc, err := store.CreateDocument(owner.ID, "", "Alt", "🗒️", "", []domain.DocumentBlock{
		{ID: "b1", Type: "bullet", Content: "Bleibt"}, {ID: "b2", Type: "bullet", Content: "Weg"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	_, live := syncDoc(t, ts, ownerTok, doc.ID, map[string]interface{}{
		"clientId": "live", "lastSeq": 0, "ops": []collab.Op{{OpID: "d", Kind: collab.OpDelete, BlockID: "b2"}},
	})

	// 40 days later: log and tombstone are past their retention
	st, err := srv.store.CompactDocs(time.Now().Add(40 * 24 * time.Hour))
	if err != nil || st.Tombstones != 1 {
		t.Fatalf("compaction: %+v %v", st, err)
	}

	// A client that was up to date only gets the purge entry
	_, up := syncDoc(t, ts, ownerTok, doc.ID, map[string]interface{}{"clientId": "live", "lastSeq": live.HeadSeq})
	if up.Resync || len(up.Ops) != 1 || up.Ops[0].Effect.Kind != collab.OpPurge {
		t.Fatalf("up-to-date client: resync=%v ops=%+v", up.Resync, up.Ops)
	}
	// A client behind the compacted log must reload; its own changes are still applied
	code, old := syncDoc(t, ts, ownerTok, doc.ID, map[string]interface{}{
		"clientId": "old", "lastSeq": 1,
		"ops": []collab.Op{{OpID: "late", Kind: collab.OpSetContent, BlockID: "b1", BaseVersion: 1, Content: strp("Spät")}},
	})
	if code != http.StatusOK || !old.Resync || len(old.Ops) != 0 || old.Results[0].Status != collab.StatusApplied {
		t.Fatalf("stale client: %d resync=%v results=%+v", code, old.Resync, old.Results)
	}
}
