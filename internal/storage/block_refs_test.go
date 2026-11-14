package storage

import (
	"fmt"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestBlockRefsOf(t *testing.T) {
	for _, c := range []struct {
		content string
		want    []blockRef
	}{
		{"", nil},
		{"Nur Text mit media: und {{secret:", nil},
		{"![Strand](media:med_0a1b)", []blockRef{{refMedia, "med_0a1b"}}},
		{"[Sprachnotiz](media:med_ff)", []blockRef{{refMedia, "med_ff"}}},
		{"IP {{secret:sec12}} und Token {{secret:sec34}}, nochmal {{secret:sec12}}",
			[]blockRef{{refSecret, "sec12"}, {refSecret, "sec34"}}},
		{"media:med_b2 vor media:med_a1 und {{secret:x_1}}",
			[]blockRef{{refMedia, "med_a1"}, {refMedia, "med_b2"}, {refSecret, "x_1"}}},
		{"media:nicht_med und {{secret:}} und {{secret:a b}}", nil},
	} {
		if got := blockRefsOf(c.content); !reflect.DeepEqual(got, c.want) {
			t.Errorf("blockRefsOf(%q) = %v, want %v", c.content, got, c.want)
		}
	}
}

// ownMedia registers made-up file ids as uploads of userID: a bullet only keeps references to files
// its writer uploaded or may read (mediaGate).
func ownMedia(t *testing.T, s *Store, userID string, ids ...string) {
	t.Helper()
	for _, id := range ids {
		if _, err := s.createMediaWithID(id, "", userID, "image", "image/png", 0, ""); err != nil {
			t.Fatal(err)
		}
	}
}

// refRows lists block_refs as "block doc kind ref", sorted.
func refRows(t *testing.T, s *Store) []string {
	t.Helper()
	rows, err := s.db.Query(`SELECT block_id, document_id, kind, ref_id FROM block_refs`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var b, d, k, r string
		if err := rows.Scan(&b, &d, &k, &r); err != nil {
			t.Fatal(err)
		}
		out = append(out, strings.Join([]string{b, d, k, r}, " "))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Strings(out)
	return out
}

func blockVersion(t *testing.T, s *Store, docID, blockID string) int {
	t.Helper()
	d, err := s.readCollabDoc(docID)
	if err != nil {
		t.Fatal(err)
	}
	b, ok := d.Blocks[blockID]
	if !ok {
		t.Fatalf("block %s not in %s", blockID, docID)
	}
	return b.Version
}

func applyOps(t *testing.T, s *Store, docID string, a collab.Actor, ops ...collab.Op) {
	t.Helper()
	res, _, err := s.ApplyDocOps(docID, a, ops, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range res {
		if r.Status != collab.StatusApplied {
			t.Fatalf("op %s: %+v", r.OpID, r)
		}
	}
}

// block_refs follows every way a bullet changes: created with the note, inserted, edited, deleted
// (tombstone), purged, copied into another note, and deleted with its note.
func TestBlockRefsFollowBlocks(t *testing.T) {
	s, u := newSyncTestStore(t)
	ownMedia(t, s, u.ID, "med_aa", "med_bb", "med_cc")
	a := collab.Actor{UserID: u.ID, ClientID: "tab1"}
	doc, err := s.CreateDocument(u.ID, "", "Urlaub", "🏖️", "", []domain.DocumentBlock{
		{ID: "img", Type: "image", Content: MediaContent("image", "med_aa", "Strand")},
		{ID: "ip", Type: "bullet", Content: "Router {{secret:secip}}"},
		{ID: "txt", Type: "bullet", Content: "Nur Text"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"img " + doc.ID + " media med_aa",
		"ip " + doc.ID + " secret secip",
	}
	if got := refRows(t, s); !reflect.DeepEqual(got, want) {
		t.Fatalf("after creating the note:\n got %v\nwant %v", got, want)
	}

	// Editing: another file replaces the first; text gains a secret; an insert brings a file
	img2 := MediaContent("image", "med_bb", "Berg")
	txt := "Nur Text und {{secret:sectxt}}"
	audio, root := MediaContent("audio", "med_cc", "Gruß"), ""
	state, _ := s.readCollabDoc(doc.ID)
	roots := state.Children("")
	key, _ := collab.KeyBetween(roots[len(roots)-1].OrderKey, "")
	applyOps(t, s, doc.ID, a,
		collab.Op{OpID: "o1", Kind: collab.OpSetContent, BlockID: "img", BaseVersion: blockVersion(t, s, doc.ID, "img"), Content: &img2},
		collab.Op{OpID: "o2", Kind: collab.OpSetContent, BlockID: "txt", BaseVersion: blockVersion(t, s, doc.ID, "txt"), Content: &txt},
		collab.Op{OpID: "o3", Kind: collab.OpInsert, BlockID: "aud", ParentID: &root, OrderKey: key, Type: "audio", Content: &audio},
	)
	want = []string{
		"aud " + doc.ID + " media med_cc",
		"img " + doc.ID + " media med_bb",
		"ip " + doc.ID + " secret secip",
		"txt " + doc.ID + " secret sectxt",
	}
	if got := refRows(t, s); !reflect.DeepEqual(got, want) {
		t.Fatalf("after editing:\n got %v\nwant %v", got, want)
	}
	if docs, _ := s.MediaReferencedIn("med_aa"); len(docs) != 0 {
		t.Errorf("the replaced file is still referenced in %v", docs)
	}

	// Deleting a bullet leaves a tombstone: the file still counts (undo), the note no longer shows it
	applyOps(t, s, doc.ID, a, collab.Op{OpID: "o4", Kind: collab.OpDelete, BlockID: "img"})
	if docs, _ := s.MediaReferencedIn("med_bb"); !reflect.DeepEqual(docs, []string{doc.ID}) {
		t.Errorf("a deleted bullet keeps its file for undo, got %v", docs)
	}
	if s.DocShowsMedia(doc.ID, "med_bb") {
		t.Error("a deleted bullet does not show its file on a public page")
	}
	if !s.DocShowsMedia(doc.ID, "med_cc") || !s.DocReferencesSecret(doc.ID, "secip") {
		t.Error("live bullets show their file and hold their secret")
	}

	// Moving the bullet with the secret into another note copies it there
	other, _ := s.CreateDocument(u.ID, "", "Technik", "🔧", "", nil, nil, false)
	if _, err := s.MoveBranch(u.ID, doc.ID, "ip", other.ID, a, nil, nil); err != nil {
		t.Fatal(err)
	}
	applyOps(t, s, doc.ID, a, collab.Op{OpID: "o5", Kind: collab.OpDelete, BlockID: "ip"})
	if docs, _ := s.docsReferencingSecret("secip", nil); !reflect.DeepEqual(docs, []string{other.ID}) {
		t.Errorf("the secret is held only by the moved bullet now, got %v", docs)
	}
	if !s.DocReferencesSecret(other.ID, "secip") || s.DocReferencesSecret(doc.ID, "secip") {
		t.Error("DocReferencesSecret after the move")
	}

	// Purging tombstones drops their rows
	if _, err := s.CompactDocs(time.Now().Add(TombstoneRetention + 24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if docs, _ := s.MediaReferencedIn("med_bb"); len(docs) != 0 {
		t.Errorf("a purged bullet still references its file in %v", docs)
	}
	for _, row := range refRows(t, s) {
		if strings.HasPrefix(row, "img ") || strings.HasPrefix(row, "ip ") {
			t.Errorf("row of a purged bullet left: %s", row)
		}
	}

	// Deleting the note for good drops the rows of all its bullets
	if err := s.DeleteDocument(u.ID, doc.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.PurgeDocument(u.ID, doc.ID); err != nil {
		t.Fatal(err)
	}
	for _, row := range refRows(t, s) {
		if strings.Contains(row, " "+doc.ID+" ") {
			t.Errorf("row of a purged note left: %s", row)
		}
	}
	if docs, _ := s.docsReferencingSecret("secip", nil); !reflect.DeepEqual(docs, []string{other.ID}) {
		t.Errorf("the other note keeps its reference, got %v", docs)
	}
}

// Migration 41 fills block_refs from the bullets of an existing database, tombstones included. Earlier
// steps that rewrite notes (here 28, links with ids) run before the table exists and must not fail.
func TestBlockRefsMigrationBackfill(t *testing.T) {
	path := filepath.Join(t.TempDir(), "refs.db")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	ownMedia(t, s, u.ID, "med_01", "med_02", "med_03")
	a := collab.Actor{UserID: u.ID, ClientID: "tab1"}
	target, _ := s.CreateDocument(u.ID, "", "Ziel", "", "", nil, nil, false)
	doc, _ := s.CreateDocument(u.ID, "", "Quelle", "", "", []domain.DocumentBlock{
		{ID: "b1", Type: "image", Content: MediaContent("image", "med_01", "Bild")},
		{ID: "b2", Type: "bullet", Content: "{{secret:s1}} und media:med_02 im Text, siehe [[Ziel]]"},
		{ID: "b3", Type: "audio", Content: MediaContent("audio", "med_03", "")},
	}, nil, false)
	_, _ = s.CreateDocument(u.ID, "", "Kopie", "", "", []domain.DocumentBlock{
		{ID: "c1", Type: "image", Content: MediaContent("image", "med_01", "Kopie")},
	}, nil, false)
	applyOps(t, s, doc.ID, a, collab.Op{OpID: "del", Kind: collab.OpDelete, BlockID: "b3"})
	before := refRows(t, s)
	if len(before) != 5 {
		t.Fatalf("expected 5 rows, got %v", before)
	}

	// Back to a database from before migration 41, with the wiki links of migration 28 still to do
	for _, q := range []string{
		`DROP TRIGGER trg_blocks_refs_ad`,
		`DROP TABLE block_refs`,
		`DELETE FROM schema_migrations WHERE id IN (28, 41)`,
		`UPDATE blocks SET content = '{{secret:s1}} und media:med_02 im Text, siehe [[Ziel]]' WHERE id = 'b2'`,
	} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	_ = s.Close()

	s, err = NewStore(path)
	if err != nil {
		t.Fatalf("migrating: %v", err)
	}
	defer s.Close()
	if got := refRows(t, s); !reflect.DeepEqual(got, before) {
		t.Fatalf("backfill:\n got %v\nwant %v", got, before)
	}
	d, err := s.readCollabDoc(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if c := d.Blocks["b2"].Content; !strings.Contains(c, target.ID) {
		t.Errorf("migration 28 ran again and gave the link its id: %q", c)
	}
	// The trigger is back: a purged note takes its rows along
	if err := s.DeleteDocument(u.ID, doc.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.PurgeDocument(u.ID, doc.ID); err != nil {
		t.Fatal(err)
	}
	if got := refRows(t, s); len(got) != 1 || !strings.HasPrefix(got[0], "c1 ") {
		t.Errorf("after purging the note: %v", got)
	}
}

// The lookups through block_refs never read all blocks: every step on blocks or block_refs is a search
// through an index, not a scan (the instr() queries before migration 41 scanned every block).
func TestBlockRefQueriesUseIndexes(t *testing.T) {
	s, u := newSyncTestStore(t)
	for i := 0; i < 20; i++ {
		ownMedia(t, s, u.ID, fmt.Sprintf("med_%02x", i))
		_, _ = s.CreateDocument(u.ID, "", "Notiz", "", "", []domain.DocumentBlock{
			{ID: domain.NewID("blk"), Type: "image", Content: MediaContent("image", fmt.Sprintf("med_%02x", i), "")},
			{ID: domain.NewID("blk"), Type: "bullet", Content: "Text"},
		}, nil, false)
	}
	scan := regexp.MustCompile(`\bSCAN (b|r|blocks|block_refs)\b`)
	for name, q := range map[string]struct {
		sql  string
		args []any
	}{
		"sqlDocsWithMedia":                {sqlDocsWithMedia, []any{"med_0a"}},
		"sqlUnreferencedMedia":            {sqlUnreferencedMedia, []any{"2026-01-01"}},
		"sqlMediaOfUser":                  {sqlMediaOfUser, []any{u.ID}},
		"sqlDocShowsMedia":                {sqlDocShowsMedia, []any{"med_0a", "doc"}},
		"sqlDocHoldsSecret":               {sqlDocHoldsSecret, []any{"sec", "doc"}},
		"sqlDocsHoldingSecret":            {sqlDocsHoldingSecret, []any{"sec"}},
		"sqlDeleteSecretsHeldNowhereElse": {sqlDeleteSecretsHeldNowhereElse, []any{"doc"}},
		"sqlCappedLiveBlocksOfDoc":        {sqlCappedLiveBlocksOfDoc, []any{"doc", "doc"}},
	} {
		rows, err := s.db.Query(`EXPLAIN QUERY PLAN `+q.sql, q.args...)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		var plan []string
		for rows.Next() {
			var id, parent, unused int
			var detail string
			if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
				t.Fatal(err)
			}
			plan = append(plan, detail)
		}
		_ = rows.Close()
		for _, step := range plan {
			if scan.MatchString(step) {
				t.Errorf("%s scans: %s\n%s", name, step, strings.Join(plan, "\n"))
			}
		}
	}
}

// A bullet full of made-up file references keeps at most maxBlockRefs rows (audit 2026-11-13, N1):
// before, every "media:med_…" in a long bullet became a row of its own.
func TestBlockRefsCappedPerBullet(t *testing.T) {
	var sb strings.Builder
	sb.WriteString("![Bild](media:med_00) ")
	for i := 1; i < 500; i++ {
		fmt.Fprintf(&sb, "media:med_%04x ", i)
	}
	refs := blockRefsOf(sb.String())
	if len(refs) != maxBlockRefs {
		t.Fatalf("blockRefsOf kept %d references, want %d", len(refs), maxBlockRefs)
	}
	// The first references of the bullet are kept (an image bullet's own file comes first)
	found := false
	for _, r := range refs {
		if r.id == "med_00" {
			found = true
		}
	}
	if !found {
		t.Fatal("the bullet's own file was dropped")
	}

	s, u := newSyncTestStore(t)
	// The first maxBlockRefs files are the writer's own; the gate drops the rest unchecked anyway
	ownMedia(t, s, u.ID, "med_00")
	for i := 1; i < maxBlockRefs; i++ {
		ownMedia(t, s, u.ID, fmt.Sprintf("med_%04x", i))
	}
	doc, err := s.CreateDocument(u.ID, "", "Viele Verweise", "", "", []domain.DocumentBlock{
		{ID: "many", Type: "bullet", Content: sb.String()},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM block_refs WHERE document_id = ?`, doc.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != maxBlockRefs {
		t.Fatalf("block_refs has %d rows for the bullet, want %d", n, maxBlockRefs)
	}
}

// A bullet that really shows more files than maxBlockRefs (a table full of pictures written before the
// cap) keeps all of them: the media cleanup does not delete the ones beyond the cap, and backups take them.
func TestFilesBeyondTheRefCapAreKept(t *testing.T) {
	s, u := newSyncTestStore(t)
	const files = maxBlockRefs + 6
	var sb strings.Builder
	sb.WriteString("| Bild |\n|---|\n")
	for i := range files {
		id := fmt.Sprintf("med_%04x", i)
		ownMedia(t, s, u.ID, id)
		fmt.Fprintf(&sb, "| ![%d](media:%s) |\n", i, id)
	}
	ownMedia(t, s, u.ID, "med_ffff") // shown nowhere
	doc, err := s.CreateDocument(u.ID, "", "Bildertabelle", "", "", []domain.DocumentBlock{
		{ID: "tbl", Type: "table", Content: "leer"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	// The content as an older version stored it, block_refs filled as migration 41 does
	if _, err := s.db.Exec(`UPDATE blocks SET content = ? WHERE id = 'tbl'`, sb.String()); err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := fillBlockRefs(tx); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM block_refs WHERE document_id = ?`, doc.ID).Scan(&n)
	if n != maxBlockRefs {
		t.Fatalf("block_refs has %d rows, want the cap %d", n, maxBlockRefs)
	}

	orphans, err := s.UnreferencedMedia(time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(orphans) != 1 || orphans[0].ID != "med_ffff" {
		t.Fatalf("the cleanup would delete %v, want only med_ffff", orphans)
	}
	backup, err := s.MediaOfUser(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(backup) != files {
		t.Fatalf("a backup takes %d files, want %d", len(backup), files)
	}
}

// Editing a bullet that shows more files than maxBlockRefs sends its whole text again: the files beyond
// the cap the note shows already stay, a new own file beyond the cap is checked and stays, someone
// else's file beyond the cap is dropped. block_refs keeps the cap.
func TestEditKeepsFilesBeyondTheRefCap(t *testing.T) {
	s, anna, ben := newImportStore(t)
	const files = maxBlockRefs + 6
	var sb strings.Builder
	for i := range files {
		id := fmt.Sprintf("med_%04x", i)
		ownMedia(t, s, anna.ID, id)
		fmt.Fprintf(&sb, "| ![%d](media:%s) |\n", i, id)
	}
	ownMedia(t, s, anna.ID, "med_a000") // a new picture of Anna's
	ownMedia(t, s, ben.ID, "med_b000")  // Ben's, which Anna may not read
	doc, err := s.CreateDocument(anna.ID, "", "Bildertabelle", "", "", []domain.DocumentBlock{
		{ID: "tbl", Type: "table", Content: "leer"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	// The content as an older version stored it, block_refs filled as migration 41 does
	if _, err := s.db.Exec(`UPDATE blocks SET content = ? WHERE id = 'tbl'`, sb.String()); err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := fillBlockRefs(tx); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	edited := "| Kopf |\n" + sb.String() + "| ![neu](media:med_a000) |\n| ![fremd](media:med_b000) |\n"
	b := blocksOf(t, s, doc.ID)["tbl"]
	res, _, err := s.ApplyDocOps(doc.ID, collab.Actor{UserID: anna.ID, ClientID: "c"}, []collab.Op{
		{OpID: "op_edit", Kind: collab.OpSetContent, BlockID: "tbl", BaseVersion: b.Version, Content: &edited},
	}, nil)
	if err != nil || len(res) != 1 || res[0].Status != collab.StatusApplied {
		t.Fatalf("edit not applied: %+v %v", res, err)
	}
	got := blocksOf(t, s, doc.ID)["tbl"].Content
	for i := range files {
		if id := fmt.Sprintf("media:med_%04x", i); !strings.Contains(got, id) {
			t.Errorf("%s got lost", id)
		}
	}
	if !strings.Contains(got, "media:med_a000") {
		t.Error("the new own picture beyond the cap got lost")
	}
	if strings.Contains(got, "med_b000") || !strings.Contains(got, "| fremd |") {
		t.Errorf("someone else's picture beyond the cap was kept: %q", got[len(got)-60:])
	}
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM block_refs WHERE document_id = ?`, doc.ID).Scan(&n)
	if n != maxBlockRefs {
		t.Fatalf("block_refs has %d rows, want the cap %d", n, maxBlockRefs)
	}

	// The gate's lookups stay bounded: beyond the cap, made-up ids not in the note cost at most
	// maxBlockRefs lookups per gate, after that they are dropped unchecked.
	g := s.newDocMediaGate(anna.ID, doc.ID)
	var many strings.Builder
	for i := range 3 * maxBlockRefs {
		fmt.Fprintf(&many, "media:med_c%04x ", i)
	}
	g.clean(many.String())
	if len(g.known) != 2*maxBlockRefs {
		t.Errorf("the gate looked up %d files, want %d", len(g.known), 2*maxBlockRefs)
	}
}
