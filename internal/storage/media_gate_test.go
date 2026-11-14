package storage

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
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
// readable through the bullet's note (FLAW-43). Own files and files of notes shared with the writer stay.
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
		{"image", MediaContent("image", own.ID, "Meins"), "image", MediaContent("image", own.ID, "Meins")},
		{"image", MediaContent("image", shared.ID, "Geteilt"), "image", MediaContent("image", shared.ID, "Geteilt")},
		{"image", MediaContent("image", private.ID, "Foto [1]"), "bullet", "Foto [1]"},
		{"audio", MediaContent("audio", private.ID, ""), "bullet", "(Datei nicht übernommen)"},
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
		{ID: "blk_n1", Type: "image", Content: MediaContent("image", private.ID, "Fremd")},
		{ID: "blk_n2", Type: "image", Content: MediaContent("image", own.ID, "Eigen")},
	}, nil, false)
	got := blocksOf(t, s, doc.ID)
	if got["blk_n1"].Content != "Fremd" || got["blk_n1"].Type != "bullet" || got["blk_n2"].Type != "image" {
		t.Errorf("new note: %+v %+v", got["blk_n1"], got["blk_n2"])
	}
	root, key := "", "a0"
	content := MediaContent("image", private.ID, "Per Sync")
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
				{Type: "image", Content: MediaContent("image", private.ID, "Fremdes Foto")},
				{Type: "image", Content: MediaContent("image", own.ID, "Eigenes Foto")},
			},
		}, {
			Title: "Harmlos", IsOwner: true,
			Blocks: []domain.DocumentBlock{{Type: "image", Content: MediaContent("image", own.ID, "Eigenes Foto")}},
		}},
	}
	data, _ := json.Marshal(exp)
	plan, err := PlanMindSiftJSONImport(data)
	if err != nil {
		t.Fatal(err)
	}
	s.CheckImportMedia(ben.ID, plan)
	if sum := plan.Summary(false); len(sum.Skipped) != 1 || sum.Skipped[0].Path != "Beute" {
		t.Fatalf("preview should name the note with the other person's file: %+v", sum.Skipped)
	}
	plan, _ = PlanMindSiftJSONImport(data)
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
			full.Blocks[1].Content != MediaContent("image", own.ID, "Eigenes Foto") {
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
