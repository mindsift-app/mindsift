package storage

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/importer"
)

// blocksOf returns the live bullets of a note by id.
func blocksOf(t *testing.T, s *Store, docID string) map[string]*collab.Block {
	t.Helper()
	d, _, err := loadCollabDoc(s.db, docID)
	if err != nil {
		t.Fatal(err)
	}
	return d.Blocks
}

// A bullet may only show a file its writer uploaded or may read: anything else would make the file
// readable through the bullet's note (Doku/sharing-and-permissions.md, "Files in Shared Notes"). Own files
// and files of notes shared with the writer stay.
func TestMediaGateKeepsOnlyReadableFiles(t *testing.T) {
	s, anna, ben := newImportStore(t)
	annaDoc, _ := s.CreateDocument(anna.ID, "", "Annas", "", "", nil, nil, false)
	sharedDoc, _ := s.CreateDocument(anna.ID, "", "Geteilt", "", "", nil, nil, false)
	benDoc, _ := s.CreateDocument(ben.ID, "", "Bens", "", "", nil, nil, false)
	private := storeTestMedia(t, s, annaDoc.ID, anna.ID, pngBytes(t, 3))
	shared := storeTestMedia(t, s, sharedDoc.ID, anna.ID, pngBytes(t, 4))
	own := storeTestMedia(t, s, benDoc.ID, ben.ID, pngBytes(t, 5))
	if _, err := s.CreateDocShare(anna.ID, sharedDoc.ID, ben.ID, "read"); err != nil {
		t.Fatal(err)
	}

	g := s.newMediaGate(ben.ID, nil)
	cases := []struct{ typ, in, wantType, want string }{
		{"image", blockfmt.MediaContent("image", own.ID, "Meins"), "image", blockfmt.MediaContent("image", own.ID, "Meins")},
		{"image", blockfmt.MediaContent("image", shared.ID, "Geteilt"), "image", blockfmt.MediaContent("image", shared.ID, "Geteilt")},
		{"image", blockfmt.MediaContent("image", private.ID, "Foto [1]"), "bullet", "Foto [1]"},
		{"audio", blockfmt.MediaContent("audio", private.ID, ""), "bullet", "(Datei nicht übernommen)"},
		{"image", "![x](media:med_00000000000000000000000000000000)", "bullet", "x"}, // no such file
		{"bullet", "Vorher ![Bild](media:" + private.ID + ") und media:" + private.ID + " und ![Meins](media:" + own.ID + ")",
			"bullet", "Vorher Bild und (Datei nicht übernommen) und ![Meins](media:" + own.ID + ")"},
		{"bullet", "Nur Text", "bullet", "Nur Text"},
	}
	for _, c := range cases {
		typ, got, _ := g.cleanBlock(c.typ, c.in)
		if typ != c.wantType || got != c.want {
			t.Errorf("%s %q: got %s %q, want %s %q", c.typ, c.in, typ, got, c.wantType, c.want)
		}
	}

	// A new note and the editor's operations go through the same check
	doc, _ := s.CreateDocument(ben.ID, "", "Neu", "", "", []domain.DocumentBlock{
		{ID: "blk_n1", Type: "image", Content: blockfmt.MediaContent("image", private.ID, "Fremd")},
		{ID: "blk_n2", Type: "image", Content: blockfmt.MediaContent("image", own.ID, "Eigen")},
	}, nil, false)
	got := blocksOf(t, s, doc.ID)
	if got["blk_n1"].Content != "Fremd" || got["blk_n1"].Type != "bullet" || got["blk_n2"].Type != "image" {
		t.Errorf("new note: %+v %+v", got["blk_n1"], got["blk_n2"])
	}
	root, key := "", "a0"
	content := blockfmt.MediaContent("image", private.ID, "Per Sync")
	if _, _, err := s.ApplyDocOps(benDoc.ID, collab.Actor{UserID: ben.ID, ClientID: "c"}, []collab.Op{
		{OpID: "op_gate", Kind: collab.OpInsert, BlockID: "blk_sync", ParentID: &root, OrderKey: key, Type: "image", Content: &content},
	}, nil); err != nil {
		t.Fatal(err)
	}
	if b := blocksOf(t, s, benDoc.ID)["blk_sync"]; b == nil || b.Content != "Per Sync" || b.Type != "bullet" {
		t.Errorf("sync insert: %+v", b)
	}
	m, _ := s.GetMedia(private.ID)
	if s.CanReadMedia(ben.ID, m) {
		t.Fatal("Ben must not be able to read Anna's private file")
	}

	// A task's title carried into its note: same rule
	th, _ := s.CreateThoughtWithDetails(ben.ID, "Aufgabe", "normal", "manual", "", "", "todo", "")
	_, _ = s.UpdateThoughtTriage(ben.ID, th.ID, "keep", "task", "", "", "")
	task, err := s.UpdateThoughtTriage(ben.ID, th.ID, "keep", "document", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	title := "Siehe ![Foto](media:" + private.ID + ")"
	_, _ = s.UpdateThoughtDetails(ben.ID, th.ID, &title, nil, nil, nil, nil, nil, nil, nil, nil)
	s.SyncTaskToDoc(ben.ID, th.ID)
	if b := blocksOf(t, s, task.DocID)[task.BlockID]; strings.Contains(b.Content, private.ID) {
		t.Errorf("task title brought the file into the note: %q", b.Content)
	}
	if s.CanReadMedia(ben.ID, m) {
		t.Fatal("Ben must still not be able to read Anna's private file")
	}
}

// A JSON backup changed by hand cannot bring someone else's file into the importer's notes; the preview
// names the note. Files the import brings along keep working (TestBackupZipCarriesMedia).
func TestImportDropsFilesOfOthers(t *testing.T) {
	s, anna, ben := newImportStore(t)
	annaDoc, _ := s.CreateDocument(anna.ID, "", "Annas", "", "", nil, nil, false)
	private := storeTestMedia(t, s, annaDoc.ID, anna.ID, pngBytes(t, 3))
	benDoc, _ := s.CreateDocument(ben.ID, "", "Bens", "", "", nil, nil, false)
	own := storeTestMedia(t, s, benDoc.ID, ben.ID, pngBytes(t, 5))

	exp := domain.FullExport{
		ExportedAt: "2026-11-14T00:00:00Z",
		Version:    "manipuliert",
		Documents: []domain.Document{{
			Title: "Beute", IsOwner: true,
			Blocks: []domain.DocumentBlock{
				{Type: "image", Content: blockfmt.MediaContent("image", private.ID, "Fremdes Foto")},
				{Type: "image", Content: blockfmt.MediaContent("image", own.ID, "Eigenes Foto")},
			},
		}, {
			Title: "Harmlos", IsOwner: true,
			Blocks: []domain.DocumentBlock{{Type: "image", Content: blockfmt.MediaContent("image", own.ID, "Eigenes Foto")}},
		}},
	}
	data, _ := json.Marshal(exp)
	plan, err := importer.PlanMindSiftJSONImport(data)
	if err != nil {
		t.Fatal(err)
	}
	s.CheckImportMedia(ben.ID, plan)
	if sum := plan.Summary(false); len(sum.Skipped) != 1 || sum.Skipped[0].Path != "Beute" {
		t.Fatalf("preview should name the note with the other person's file: %+v", sum.Skipped)
	}
	plan, _ = importer.PlanMindSiftJSONImport(data)
	sum, err := s.ApplyImport(ben.ID, plan)
	if err != nil {
		t.Fatal(err)
	}
	if len(sum.Skipped) != 1 {
		t.Errorf("summary after the import: %+v", sum.Skipped)
	}
	docs, _ := s.GetDocuments(ben.ID)
	found := false
	for _, d := range docs {
		if d.Title != "Beute" {
			continue
		}
		found = true
		full, _ := s.GetDocumentByID(ben.ID, d.ID)
		if len(full.Blocks) != 2 || full.Blocks[0].Content != "Fremdes Foto" || full.Blocks[0].Type != "bullet" ||
			full.Blocks[1].Content != blockfmt.MediaContent("image", own.ID, "Eigenes Foto") {
			t.Errorf("imported bullets: %+v", full.Blocks)
		}
	}
	if !found {
		t.Fatal("note not imported")
	}
	m, _ := s.GetMedia(private.ID)
	if s.CanReadMedia(ben.ID, m) {
		t.Fatal("the import gave Ben access to Anna's file")
	}
}

// Someone who changes a task but cannot read its note (a shared task list) does not take the owner's
// picture out of the task's bullet: the file would lose its last reference and media cleanup would
// delete it. Only files new in the title go through the gate.
func TestTaskTitleKeepsFilesTheBulletShows(t *testing.T) {
	s, anna, ben := newImportStore(t)
	th, _ := s.CreateThoughtWithDetails(anna.ID, "Aufgabe", "normal", "manual", "", "", "todo", "")
	_, _ = s.UpdateThoughtTriage(anna.ID, th.ID, "keep", "task", "", "", "")
	task, err := s.UpdateThoughtTriage(anna.ID, th.ID, "keep", "document", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	photo := storeTestMedia(t, s, task.DocID, anna.ID, pngBytes(t, 3))
	other := storeTestMedia(t, s, task.DocID, anna.ID, pngBytes(t, 4))
	m, _ := s.GetMedia(photo.ID)
	if s.CanReadMedia(ben.ID, m) {
		t.Fatal("Ben must not be able to read Anna's note")
	}
	setTitle := func(title string) {
		t.Helper()
		if _, err := s.db.Exec(`UPDATE thoughts SET content = ? WHERE id = ?`, title, th.ID); err != nil {
			t.Fatal(err)
		}
	}
	bullet := func() *collab.Block { return blocksOf(t, s, task.DocID)[task.BlockID] }

	withPhoto := "Siehe ![Foto](media:" + photo.ID + ")"
	setTitle(withPhoto)
	s.SyncTaskToDoc(anna.ID, th.ID)
	if bullet().Content != withPhoto {
		t.Fatalf("Anna's own title: %q", bullet().Content)
	}

	// Ben ticks the task: the title is the bullet's text already, nothing is rewritten
	if _, err := s.db.Exec(`UPDATE thoughts SET is_completed = 1 WHERE id = ?`, th.ID); err != nil {
		t.Fatal(err)
	}
	s.SyncTaskToDoc(ben.ID, th.ID)
	if b := bullet(); b.Content != withPhoto || !b.Props.Checked {
		t.Fatalf("after Ben's tick: %q checked=%v", b.Content, b.Props.Checked)
	}

	// Ben changes a word and adds another of Anna's files: the picture stays, the new file does not
	setTitle("Bitte ![Foto](media:" + photo.ID + ") und ![Mehr](media:" + other.ID + ")")
	s.SyncTaskToDoc(ben.ID, th.ID)
	if want := "Bitte ![Foto](media:" + photo.ID + ") und Mehr"; bullet().Content != want {
		t.Fatalf("after Ben's edit:\n got %q\nwant %q", bullet().Content, want)
	}
	if docs, _ := s.MediaReferencedIn(photo.ID); len(docs) == 0 {
		t.Fatal("the picture lost its reference")
	}
}

// Dropping references never makes a bullet longer: a short made-up reference without caption is dropped
// instead of becoming the longer placeholder, so a bullet just under the length limit full of them is
// stored (shortened) instead of refused as too long (re-test 2026-11-14, side finding 2).
func TestMediaGateNeverLengthensContent(t *testing.T) {
	s, u := newSyncTestStore(t)
	g := s.newMediaGate(u.ID, nil)
	for _, in := range []string{"![](media:med_1)", "media:med_1", "a ![](media:med_12) b media:med_3 c"} {
		if _, out, _ := g.cleanBlock("bullet", in); len(out) > len(in) || strings.Contains(out, "media:") {
			t.Errorf("%q became %q", in, out)
		}
	}
	// A real id is longer than the placeholder: that one stays
	realRef := "![](media:med_000000000000000000000001)"
	if _, out, _ := g.cleanBlock("bullet", realRef); out != "(Datei nicht übernommen)" {
		t.Errorf("%q became %q", realRef, out)
	}

	doc, err := s.CreateDocument(u.ID, "", "Lang", "", "", nil, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	ref := "![](media:med_1) "
	content := strings.Repeat(ref, (100_000-10)/len(ref))
	root := ""
	res, _, err := s.ApplyDocOps(doc.ID, collab.Actor{UserID: u.ID, ClientID: "c"}, []collab.Op{
		{OpID: "op_long", Kind: collab.OpInsert, BlockID: "blk_long", ParentID: &root, OrderKey: "a0", Type: "bullet", Content: &content},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || res[0].Status != collab.StatusApplied {
		t.Fatalf("bullet full of made-up references refused: %+v", res)
	}
	if b := blocksOf(t, s, doc.ID)["blk_long"]; b == nil || strings.Contains(b.Content, "media:") {
		t.Errorf("references kept: %v", b != nil)
	}
}

// A change (set_content) that points an image bullet to someone else's file keeps only the caption; the
// bullet then becomes a plain bullet with that text, as an insert does. A conflict copy too.
func TestMediaGateTurnsChangedImageBulletIntoText(t *testing.T) {
	s, anna, ben := newImportStore(t)
	annaDoc, _ := s.CreateDocument(anna.ID, "", "Annas", "", "", nil, nil, false)
	benDoc, _ := s.CreateDocument(ben.ID, "", "Bens", "", "", nil, nil, false)
	private := storeTestMedia(t, s, annaDoc.ID, anna.ID, pngBytes(t, 6))
	own := storeTestMedia(t, s, benDoc.ID, ben.ID, pngBytes(t, 7))
	other := storeTestMedia(t, s, benDoc.ID, ben.ID, pngBytes(t, 8))
	actor := collab.Actor{UserID: ben.ID, ClientID: "c", Name: "Ben"}
	apply := func(ops ...collab.Op) []collab.Result {
		t.Helper()
		res, _, err := s.ApplyDocOps(benDoc.ID, actor, ops, nil)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	root := ""
	mine := blockfmt.MediaContent("image", own.ID, "Meins")
	apply(collab.Op{OpID: "op_img", Kind: collab.OpInsert, BlockID: "blk_img", ParentID: &root, OrderKey: "a0", Type: "image", Content: &mine},
		collab.Op{OpID: "op_img2", Kind: collab.OpInsert, BlockID: "blk_img2", ParentID: &root, OrderKey: "a1", Type: "image", Content: &mine})
	if b := blocksOf(t, s, benDoc.ID)["blk_img"]; b == nil || b.Type != "image" || b.Content != mine {
		t.Fatalf("own image must stay: %+v", b)
	}

	// Another own picture: still an image
	otherContent := blockfmt.MediaContent("image", other.ID, "Anderes")
	if res := apply(collab.Op{OpID: "op_own", Kind: collab.OpSetContent, BlockID: "blk_img", BaseVersion: 1, Content: &otherContent}); res[0].Status != collab.StatusApplied {
		t.Fatalf("own change: %+v", res)
	}
	if b := blocksOf(t, s, benDoc.ID)["blk_img"]; b.Type != "image" || b.Content != otherContent {
		t.Fatalf("own picture must stay an image: %+v", b)
	}

	// Someone else's file: the caption as a plain bullet
	foreign := blockfmt.MediaContent("image", private.ID, "Fremdes Foto")
	if res := apply(collab.Op{OpID: "op_foreign", Kind: collab.OpSetContent, BlockID: "blk_img", BaseVersion: 2, Content: &foreign}); len(res) != 1 || res[0].Status != collab.StatusApplied {
		t.Fatalf("foreign change: %+v", res)
	}
	if b := blocksOf(t, s, benDoc.ID)["blk_img"]; b.Type != "bullet" || b.Content != "Fremdes Foto" {
		t.Fatalf("image bullet without its file must become text: %+v", b)
	}

	// The same on a stale version: the conflict copy is a plain bullet, the original stays an image
	res := apply(collab.Op{OpID: "op_stale", Kind: collab.OpSetContent, BlockID: "blk_img2", BaseVersion: 0, Content: &foreign})
	if len(res) != 1 || res[0].Status != collab.StatusConflict {
		t.Fatalf("stale change: %+v", res)
	}
	blocks := blocksOf(t, s, benDoc.ID)
	if c := blocks[res[0].ConflictBlockID]; c == nil || c.Type != "bullet" || c.Content != "Fremdes Foto" {
		t.Fatalf("conflict copy must be text: %+v", c)
	}
	if b := blocks["blk_img2"]; b.Type != "image" || b.Content != mine {
		t.Fatalf("the original stays untouched: %+v", b)
	}

	// The log alone rebuilds the same note: the type change is in it
	entries, _, err := s.GetDocOpsSince(benDoc.ID, 0, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	replay := collab.NewDoc()
	for _, e := range entries {
		replay.ApplyEffect(e.Effect)
	}
	if b := replay.Blocks["blk_img"]; b == nil || b.Type != "bullet" || b.Content != "Fremdes Foto" {
		t.Fatalf("log replay: %+v", b)
	}
}
