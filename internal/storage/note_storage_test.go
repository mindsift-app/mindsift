package storage

import (
	"encoding/json"
	"fmt"
	"maps"
	"math/rand"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestTextDeltaGivesBackTheOlderText(t *testing.T) {
	cases := [][2]string{
		{"", ""}, {"abc", ""}, {"", "abc"}, {"Hallo Welt", "Hallo schöne Welt"}, {"aaaa", "aaa"},
		{"aé", "aè"}, {"Grüße 👋 aus Köln", "Grüße 🖐 aus Köln"}, {"ü", "ö"}, {"abcabc", "abc"},
		{"x\xffy", "x\xfey"}, // not valid UTF-8: the middle goes as bytes
	}
	r := rand.New(rand.NewSource(7))
	alphabet := []rune("ab äöüß€👋\n")
	random := func() string {
		rs := make([]rune, r.Intn(12))
		for i := range rs {
			rs[i] = alphabet[r.Intn(len(alphabet))]
		}
		return string(rs)
	}
	for range 2000 {
		cases = append(cases, [2]string{random(), random()})
	}
	for _, c := range cases {
		newer, older := c[0], c[1]
		d := makeTextDelta(newer, older)
		// Through JSON, the way the log stores it
		b, _ := json.Marshal(d)
		var back textDelta
		if err := json.Unmarshal(b, &back); err != nil {
			t.Fatal(err)
		}
		got, err := back.apply(newer)
		if err != nil || got != older {
			t.Fatalf("delta %+v of %q -> %q gave %q (%v)", d, newer, older, got, err)
		}
		if utf8.ValidString(older) && d.MiddleBytes != nil {
			t.Fatalf("valid text %q must go as text: %+v", older, d)
		}
	}
	if _, err := (textDelta{Prefix: 3, Suffix: 2}).apply("abcd"); err == nil {
		t.Fatal("a delta longer than the text must fail")
	}
}

// editText changes a text the way typing does: a few characters in, out or replaced somewhere.
func editText(r *rand.Rand, s string) string {
	rs := []rune(s)
	pos := 0
	if len(rs) > 0 {
		pos = r.Intn(len(rs) + 1)
	}
	switch r.Intn(4) {
	case 0: // delete a few
		end := min(len(rs), pos+1+r.Intn(3))
		if pos < end {
			rs = append(rs[:pos], rs[end:]...)
		}
	case 1: // replace everything (paste)
		return fmt.Sprintf("neu %d ä 👋 %s", r.Intn(1000), strings.Repeat("x", r.Intn(50)))
	default:
		ins := []rune([]string{"a", "ü", " Wort", "👍", "\n", "ß"}[r.Intn(6)])
		rs = append(rs[:pos], append(ins, rs[pos:]...)...)
	}
	return string(rs)
}

// The log stores texts as references and deltas, but reading it gives every effect exactly as it was
// produced, from any position and in pages of any size. The expected effects come from replaying the
// same operations on a copy of the note.
func TestLogGivesBackEveryText(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, err := s.CreateDocument(u.ID, "", "Protokoll", "", "", flatBlocks([3]any{"a", 0, "Anfang"}, [3]any{"b", 0, "Zweiter"}), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	snap, _ := s.GetDocSnapshot(doc.ID)
	shadow := collab.NewDoc()
	shadow.Title, shadow.TitleVersion = snap.Title, snap.TitleVersion
	for i := range snap.Blocks {
		b := snap.Blocks[i]
		shadow.Blocks[b.ID] = &b
	}
	start := snap.HeadSeq
	var want []DocLogEntry
	a := collab.Actor{UserID: u.ID, ClientID: "tab1"}
	r := rand.New(rand.NewSource(3))
	n := 0
	ids := []string{"a", "b"}
	for batch := 0; batch < 150; batch++ {
		var ops []collab.Op
		plan := shadow.Clone() // the note as the client sees it while it builds the batch
		for k := r.Intn(4); k >= 0; k-- {
			n++
			op := collab.Op{OpID: fmt.Sprintf("op%d", n)}
			id := ids[r.Intn(len(ids))]
			cur := plan.Blocks[id]
			x := r.Intn(10)
			if cur == nil {
				x = 0 // an insert that was refused
			}
			switch {
			case x < 2:
				id = fmt.Sprintf("n%d", n)
				ids = append(ids, id)
				text := editText(r, "neu")
				parent := ""
				op.Kind, op.BlockID, op.ParentID, op.OrderKey, op.Content = collab.OpInsert, id, &parent, fmt.Sprintf("a%d5", n%10), &text
			case x < 7:
				text := editText(r, cur.Content)
				op.Kind, op.BlockID, op.BaseVersion, op.Content = collab.OpSetContent, id, cur.Version, &text
			case x == 7:
				op.Kind, op.BlockID = collab.OpDelete, id
			case x == 8:
				op.Kind, op.IDs = collab.OpRestore, []string{id}
			default:
				checked := !cur.Props.Checked
				op.Kind, op.BlockID, op.Patch = collab.OpSetProps, id, &collab.PropsPatch{Checked: &checked}
			}
			ops = append(ops, op)
			collab.Apply(plan, op, a, collab.Env{})
		}
		results, _, err := s.ApplyDocOps(doc.ID, a, ops, nil)
		if err != nil {
			t.Fatal(err)
		}
		for i, op := range ops {
			effects, res := collab.Apply(shadow, op, a, collab.Env{})
			if res.Status != results[i].Status {
				t.Fatalf("op %s: server %+v, copy %+v", op.OpID, results[i], res)
			}
			for _, e := range effects {
				want = append(want, DocLogEntry{Seq: start + int64(len(want)) + 1, OpID: op.OpID, UserID: a.UserID, ClientID: a.ClientID, Effect: e})
			}
		}
		// Now and then a client that catches up from somewhere in the middle, in small pages
		if batch%10 == 9 {
			from := start + int64(r.Intn(len(want)+1))
			checkLog(t, s, doc.ID, from, 1+r.Intn(5), want[from-start:])
		}
	}
	checkLog(t, s, doc.ID, start, 1_000_000, want)
	checkLog(t, s, doc.ID, start, 1, want)
	var forms [3]int
	rows, _ := s.db.Query(`SELECT content_ref, COUNT(*) FROM doc_ops WHERE doc_id = ? GROUP BY content_ref`, doc.ID)
	for rows.Next() {
		var f, c int
		_ = rows.Scan(&f, &c)
		forms[f] = c
	}
	rows.Close()
	if forms[logTextBlock] == 0 || forms[logTextDelta] == 0 {
		t.Fatalf("expected entries referring to bullets and deltas: %v", forms)
	}
	checkSearchIndex(t, s)
}

// checkLog reads the log after since in pages of limit and compares it with want.
func checkLog(t *testing.T, s *Store, docID string, since int64, limit int, want []DocLogEntry) {
	t.Helper()
	var got []DocLogEntry
	for {
		page, head, err := s.GetDocOpsSince(docID, since, limit)
		if err != nil {
			t.Fatalf("log after %d: %v", since, err)
		}
		got = append(got, page...)
		if len(page) == 0 || page[len(page)-1].Seq >= head {
			break
		}
		since = page[len(page)-1].Seq
	}
	if len(got) != len(want) {
		t.Fatalf("log: %d entries, want %d", len(got), len(want))
	}
	for i := range want {
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Fatalf("entry %d:\n got %+v\nwant %+v", want[i].Seq, got[i], want[i])
		}
	}
}

// checkSearchIndex: the index of notes matches the bullets and titles it reads its text from.
func checkSearchIndex(t *testing.T, s *Store) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO documents_fts(documents_fts, rank) VALUES('integrity-check', 1)`); err != nil {
		t.Fatalf("search index does not match the notes: %v", err)
	}
}

// Compaction purges old tombstones; log entries of such a bullet that are still in the log get their
// texts written into them first, since the bullet they refer to is gone afterwards.
func TestPurgeKeepsTheTextsOfTheLog(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, _ := s.CreateDocument(u.ID, "", "Notiz", "", "", flatBlocks([3]any{"x", 0, "eins"}, [3]any{"y", 0, "bleibt"}), nil, false)
	a := collab.Actor{UserID: u.ID, ClientID: "tab1"}
	for i, text := range []string{"eins zwei", "eins zwei drei", "zwei drei"} {
		applyOps(t, s, doc.ID, a, collab.Op{OpID: fmt.Sprintf("e%d", i), Kind: collab.OpSetContent, BlockID: "x", BaseVersion: i + 1, Content: &text})
	}
	applyOps(t, s, doc.ID, a, collab.Op{OpID: "del", Kind: collab.OpDelete, BlockID: "x"})
	before, head, err := s.GetDocOpsSince(doc.ID, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	// The tombstone is old, the log is not
	old := time.Now().Add(-40 * 24 * time.Hour).UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`UPDATE blocks SET deleted_at = ? WHERE id = 'x'`, old); err != nil {
		t.Fatal(err)
	}
	if st, err := s.CompactDocs(time.Now()); err != nil || st.Tombstones != 1 {
		t.Fatalf("compaction: %+v %v", st, err)
	}
	after, newHead, err := s.GetDocOpsSince(doc.ID, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if newHead != head+1 || len(after) != len(before)+1 || after[len(after)-1].Effect.Kind != collab.OpPurge {
		t.Fatalf("expected the log plus one purge entry, got %d entries (head %d)", len(after), newHead)
	}
	if !reflect.DeepEqual(after[:len(before)], before) {
		t.Fatal("the texts of the log changed with the purge")
	}
	var refs int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM doc_ops WHERE doc_id = ? AND block_id = 'x' AND content_ref != 0`, doc.ID).Scan(&refs)
	if refs != 0 {
		t.Fatalf("%d entries still refer to the purged bullet", refs)
	}
}

// The note's text lives in blocks only; the API still gets its plain text and markdown.
func TestNoteTextStoredOnce(t *testing.T) {
	s, u := newSyncTestStore(t)
	doc, err := s.CreateDocument(u.ID, "", "Einmal", "", "", []domain.DocumentBlock{
		{ID: "t1", Type: "todo", Content: "Milch kaufen"},
		{ID: "t2", Type: "bullet", Content: "Zweite Zeile", Level: 1},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	var blocksJSON, markdown, content string
	_ = s.db.QueryRow(`SELECT blocks_json, markdown_cache, content FROM documents WHERE id = ?`, doc.ID).Scan(&blocksJSON, &markdown, &content)
	if blocksJSON != "[]" || markdown != "" || content != "" {
		t.Fatalf("documents keeps a copy: %q %q %q", blocksJSON, markdown, content)
	}
	got, err := s.GetDocumentByID(u.ID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "Milch kaufen\nZweite Zeile\n" || !strings.Contains(got.MarkdownCache, "Milch kaufen") {
		t.Fatalf("text built from the bullets: %q / %q", got.Content, got.MarkdownCache)
	}
	all, _ := s.GetDocuments(u.ID)
	for _, d := range all {
		if d.ID == doc.ID && d.Content != got.Content {
			t.Fatalf("list: %q", d.Content)
		}
	}
	if st, _ := s.GetDashboardStats(u.ID); st.DocsTodosOpenCount != 1 {
		t.Fatalf("open todos: %d", st.DocsTodosOpenCount)
	}
	var stored int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM doc_ops WHERE doc_id = ? AND payload LIKE '%Milch%'`, doc.ID).Scan(&stored)
	if stored != 0 {
		t.Fatal("the log keeps the text of the bullet a second time")
	}
}

// docState is what a reader sees of a note: its blocks, texts and log.
type docState struct {
	Title    string
	Content  string
	Markdown string
	Blocks   []domain.DocumentBlock
	Log      []DocLogEntry
}

func readDocState(t *testing.T, s *Store, userID, docID string) docState {
	t.Helper()
	d, err := s.GetDocumentByID(userID, docID)
	if err != nil {
		t.Fatal(err)
	}
	log, _, err := s.GetDocOpsSince(docID, 0, 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	return docState{d.Title, d.Content, d.MarkdownCache, d.Blocks, log}
}

func searchHits(t *testing.T, s *Store, userID, query string) []string {
	t.Helper()
	res, err := s.Search(userID, query, SearchOptions{Type: "document"})
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, h := range res.Hits {
		out = append(out, fmt.Sprintf("%s|%s|%s|%.4f", h.DocID, h.BlockID, h.Snippet, h.Score))
	}
	return out
}

// Migration 44 on a database in the earlier form: copies of the text in documents, complete texts in
// the log, a search index with its own copy, a note that only has blocks_json. Afterwards every note
// reads the same, the log gives back the same effects, the search finds the same, and the copies are gone.
func TestNoteStorageMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.db")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	openSharing(t, s)
	u, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	a := collab.Actor{UserID: u.ID, ClientID: "tab1"}
	typed, _ := s.CreateDocument(u.ID, "", "Getippt", "", "", flatBlocks([3]any{"p1", 0, "Einkaufsliste für Sonntag"}, [3]any{"p2", 1, "Äpfel"}), nil, false)
	r := rand.New(rand.NewSource(11))
	text := "Einkaufsliste für Sonntag"
	for i := range 40 {
		next := editText(r, text) + " Wochenmarkt"
		applyOps(t, s, typed.ID, a, collab.Op{OpID: fmt.Sprintf("t%d", i), Kind: collab.OpSetContent, BlockID: "p1", BaseVersion: i + 1, Content: &next})
		text = next
	}
	drawingJSON := `{"v":1,"els":[{"id":"e1","t":"text","x":1,"y":2,"txt":"Skizze Gartenhaus"}]}`
	mixed, _ := s.CreateDocument(u.ID, "", "Gemischt", "", "", []domain.DocumentBlock{
		{ID: "m1", Type: "table", Content: "| Spalte | Wert |\n|---|---|\n| Gartenzaun | 3 |"},
		{ID: "m2", Type: "drawing", Content: drawingJSON},
		{ID: "m3", Type: "todo", Content: "Gartenzaun streichen"},
	}, nil, false)
	trashed, _ := s.CreateDocument(u.ID, "", "Papierkorb Gartenzaun", "", "", flatBlocks([3]any{"k1", 0, "Gartenzaun alt"}), nil, false)
	if err := s.DeleteDocument(u.ID, trashed.ID); err != nil {
		t.Fatal(err)
	}
	legacy, _ := s.CreateDocument(u.ID, "", "Uralt", "", "", flatBlocks([3]any{"l1", 0, "Uralter Gartenzaun"}, [3]any{"l2", 1, "darunter"}), nil, false)

	blank, _ := s.CreateDocument(u.ID, "", "Leer", "", "", flatBlocks([3]any{"e1", 0, ""}), nil, false)
	for day, id := range map[string]string{"2026-11-01": typed.ID, "2026-11-02": mixed.ID, "2026-11-03": legacy.ID, "2026-11-04": blank.ID} {
		if err := s.SetJournalDay(u.ID, day, id); err != nil {
			t.Fatal(err)
		}
	}
	wantJournal := map[string]bool{"2026-11-01": false, "2026-11-02": false, "2026-11-03": false, "2026-11-04": true}

	docs := []string{typed.ID, mixed.ID, legacy.ID}
	want := map[string]docState{}
	for _, id := range docs {
		want[id] = readDocState(t, s, u.ID, id)
	}
	queries := []string{"Gartenzaun", "Wochenmarkt", "Gartenhaus", "Wert", "Äpfel", "Getippt"}
	wantHits := map[string][]string{}
	for _, q := range queries {
		wantHits[q] = searchHits(t, s, u.ID, q)
		if len(wantHits[q]) == 0 {
			t.Fatalf("no hits for %q before the migration", q)
		}
	}

	// Back to the earlier form
	for _, id := range append(docs, trashed.ID) {
		d, err := s.readCollabDoc(id)
		if err != nil {
			t.Fatal(err)
		}
		flat := flatDocumentBlocks(id, d)
		bj, _ := json.Marshal(flat)
		if _, err := s.db.Exec(`UPDATE documents SET blocks_json = ?, markdown_cache = ?, content = ? WHERE id = ?`,
			string(bj), domain.CompileBlocksToMarkdown(flat), docPlainText(flat), id); err != nil {
			t.Fatal(err)
		}
		log, _, _ := s.GetDocOpsSince(id, 0, 1_000_000)
		for _, e := range log {
			p, _ := json.Marshal(e.Effect)
			if _, err := s.db.Exec(`UPDATE doc_ops SET payload = ?, content_ref = 0 WHERE doc_id = ? AND seq = ?`, string(p), id, e.Seq); err != nil {
				t.Fatal(err)
			}
		}
	}
	// The oldest notes had no bullets and no log, only blocks_json
	for _, q := range []string{`DELETE FROM block_tags WHERE document_id = ?`, `DELETE FROM blocks WHERE document_id = ?`, `DELETE FROM doc_ops WHERE doc_id = ?`,
		`UPDATE documents SET head_seq = 0 WHERE id = ?`} {
		if _, err := s.db.Exec(q, legacy.ID); err != nil {
			t.Fatal(err)
		}
	}
	for _, q := range append(noteSearchSQL()[:8],
		`DROP INDEX idx_doc_ops_text`, `DROP INDEX idx_blocks_fts_rowid`, `DROP INDEX idx_documents_fts_rowid`,
		`ALTER TABLE doc_ops DROP COLUMN content_ref`, `ALTER TABLE blocks DROP COLUMN fts_rowid`, `ALTER TABLE documents DROP COLUMN fts_rowid`,
		`DELETE FROM schema_migrations WHERE id = 44`) {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	s.migrateSearchFTS() // the index with its own copy of the text, filled from the notes
	var copies int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents_fts_content`).Scan(&copies)
	if copies == 0 {
		t.Fatal("the old index must hold its copy")
	}
	_ = s.Close()

	s, err = NewStore(path)
	if err != nil {
		t.Fatalf("migrating: %v", err)
	}
	defer s.Close()
	openSharing(t, s)

	for _, id := range docs {
		got := readDocState(t, s, u.ID, id)
		w := want[id]
		if id == legacy.ID {
			// Converted from blocks_json: same text and outline, written to the log anew
			if !reflect.DeepEqual(outline(got.Blocks), outline(w.Blocks)) || got.Content != w.Content || len(got.Log) == 0 {
				t.Fatalf("old note:\n got %+v\nwant %+v", got.Blocks, w.Blocks)
			}
			continue
		}
		if !reflect.DeepEqual(got, w) {
			t.Fatalf("note %s changed:\n got %+v\nwant %+v", id, got, w)
		}
	}
	// The journal reads whether a day has text from the bullets, not from the emptied copies
	if got := journalEmpty(t, s, u.ID); !maps.Equal(got, wantJournal) {
		t.Fatalf("journal days after the migration:\n got %v\nwant %v", got, wantJournal)
	}
	var leftover int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE blocks_json != '[]' OR markdown_cache != '' OR content != ''`).Scan(&leftover)
	if leftover != 0 {
		t.Fatalf("%d notes keep a copy of their text", leftover)
	}
	var full, refs, deltas int
	_ = s.db.QueryRow(`SELECT COUNT(*) FILTER (WHERE content_ref = 0 AND kind IN ('insert', 'set_content')),
		COUNT(*) FILTER (WHERE content_ref = 1), COUNT(*) FILTER (WHERE content_ref = 2) FROM doc_ops`).Scan(&full, &refs, &deltas)
	if full != 0 || refs == 0 || deltas < 40 {
		t.Fatalf("log not converted: %d complete, %d references, %d deltas", full, refs, deltas)
	}
	var shadow int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'documents_fts_content'`).Scan(&shadow)
	if shadow != 0 {
		t.Fatal("the search index still keeps a copy of the text")
	}
	checkSearchIndex(t, s)
	for _, q := range queries {
		got := searchHits(t, s, u.ID, q)
		if q == "Gartenzaun" {
			// The converted old note has new bullet ids; compare without it
			got, wantHits[q] = withoutDoc(got, legacy.ID), withoutDoc(wantHits[q], legacy.ID)
		}
		if !reflect.DeepEqual(got, wantHits[q]) {
			t.Fatalf("search %q:\n got %v\nwant %v", q, got, wantHits[q])
		}
	}
	if h := searchHits(t, s, u.ID, "Uralter"); len(h) != 1 {
		t.Fatalf("converted old note not found: %v", h)
	}

	// Writing goes on in the new form: edits, titles, the trash, purging
	more := "Gartenzaun neu gestrichen"
	applyOps(t, s, mixed.ID, a, collab.Op{OpID: "after", Kind: collab.OpSetContent, BlockID: "m3", BaseVersion: 1, Content: &more},
		collab.Op{OpID: "title", Kind: collab.OpSetTitle, BaseVersion: 0, Title: ptr("Gemischt neu")})
	if err := s.RestoreDocument(u.ID, trashed.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteDocument(u.ID, typed.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.PurgeDocument(u.ID, typed.ID); err != nil {
		t.Fatal(err)
	}
	checkSearchIndex(t, s)
	if h := searchHits(t, s, u.ID, "gestrichen"); len(h) != 1 || !strings.Contains(h[0], "<mark>gestrichen</mark>") {
		t.Fatalf("edited bullet: %v", h)
	}
	if h := searchHits(t, s, u.ID, "Wochenmarkt"); len(h) != 0 {
		t.Fatalf("purged note still found: %v", h)
	}
	if h := searchHits(t, s, u.ID, "Papierkorb"); len(h) != 1 {
		t.Fatalf("restored note's title: %v", h)
	}
}

func withoutDoc(hits []string, docID string) []string {
	var out []string
	for _, h := range hits {
		if !strings.HasPrefix(h, docID+"|") {
			out = append(out, h)
		}
	}
	return out
}
