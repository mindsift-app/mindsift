package storage

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The functions below only need ids, titles and folder paths of the notes a person can open and read
// them without the bullets. These tests pin what they return: own and shared notes, the trash, folders.

func titlesStore(t *testing.T) (*Store, *domain.User, *domain.User) {
	t.Helper()
	s, err := NewStore(filepath.Join(t.TempDir(), "titles.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	openSharing(t, s)
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := s.CreateUser("ben@example.com", "hash", "Ben", "member")
	return s, anna, ben
}

func TestWikiLinkerResolvesTitlesOfVisibleNotes(t *testing.T) {
	s, anna, ben := titlesStore(t)
	garten, _ := s.CreateDocument(anna.ID, "", "Garten", "", "", []domain.DocumentBlock{
		{ID: "blk_g1", Type: "bullet", Content: "Beete", Level: 0},
	}, nil, false)
	_, _ = s.CreateDocument(anna.ID, "", "Doppelt", "", "A", nil, nil, false)
	_, _ = s.CreateDocument(anna.ID, "", "Doppelt", "", "B", nil, nil, false)
	weg, _ := s.CreateDocument(anna.ID, "", "Weg", "", "", nil, nil, false)
	if err := s.DeleteDocument(anna.ID, weg.ID); err != nil {
		t.Fatal(err)
	}
	geteilt, _ := s.CreateDocument(ben.ID, "", "Bens Plan", "", "", nil, nil, false)
	if _, err := s.CreateDocShare(ben.ID, geteilt.ID, anna.ID, "read"); err != nil {
		t.Fatal(err)
	}
	_, _ = s.CreateDocument(ben.ID, "", "Privat", "", "", nil, nil, false)

	link := s.WikiLinker(anna.ID)
	cases := map[string]string{
		"[[ garten |hier]]":    "[[Garten#" + garten.ID + "|hier]]",
		"[[Bens Plan]]":        "[[Bens Plan#" + geteilt.ID + "]]",
		"[[Doppelt]]":          "[[Doppelt]]", // ambiguous
		"[[Weg]]":              "[[Weg]]",     // in the trash
		"[[Privat]]":           "[[Privat]]",  // Ben's, not shared
		"[[Alt#^blk_g1|Beet]]": "[[Garten#" + garten.ID + "^blk_g1|Beet]]",
		"ohne Link":            "ohne Link",
	}
	for in, want := range cases {
		if got := link(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

func TestUniqueTitleCountsOwnAndSharedNotes(t *testing.T) {
	s, anna, ben := titlesStore(t)
	_, _ = s.CreateDocument(anna.ID, "", "Plan", "", "", []domain.DocumentBlock{{ID: "blk_p", Type: "bullet", Content: "x"}}, nil, false)
	_, _ = s.CreateDocument(anna.ID, "", "plan (2)", "", "", nil, nil, false)
	idee, _ := s.CreateDocument(ben.ID, "", "Idee", "", "", nil, nil, false)
	if _, err := s.CreateDocShare(ben.ID, idee.ID, anna.ID, "write"); err != nil {
		t.Fatal(err)
	}
	_, _ = s.CreateDocument(ben.ID, "", "Nur Ben", "", "", nil, nil, false)
	for in, want := range map[string]string{"Plan": "Plan (3)", "Idee": "Idee (2)", "Nur Ben": "Nur Ben", "Neu": "Neu"} {
		if got := s.uniqueTitle(anna.ID, in); got != want {
			t.Errorf("uniqueTitle(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFoldersOfNotesWithoutBullets(t *testing.T) {
	s, anna, ben := titlesStore(t)
	blocks := []domain.DocumentBlock{{ID: "blk_f1", Type: "bullet", Content: "Inhalt", Level: 0}}
	a, _ := s.CreateDocument(anna.ID, "", "A", "", "Projekte/Haus", blocks, nil, false)
	b, _ := s.CreateDocument(anna.ID, "", "B", "", "Projekte/Haus/Keller", nil, nil, false)
	c, _ := s.CreateDocument(anna.ID, "", "C", "", "Projekte/Garten", nil, nil, false)
	fremd, _ := s.CreateDocument(ben.ID, "", "Fremd", "", "Bens Ordner", nil, nil, false)
	if _, err := s.CreateDocShare(ben.ID, fremd.ID, anna.ID, "read"); err != nil {
		t.Fatal(err)
	}
	_, _ = s.CreateDocument(ben.ID, "", "Geheim", "", "Geheim", nil, nil, false)

	folders, err := s.GetFolders(anna.ID)
	if err != nil {
		t.Fatal(err)
	}
	// A note shared directly appears without its owner's folder
	want := []string{"Projekte", "Projekte/Garten", "Projekte/Haus", "Projekte/Haus/Keller"}
	if !slices.Equal(folders, want) {
		t.Fatalf("folders: %v, want %v", folders, want)
	}

	newPath, moved, err := s.MoveFolder(anna.ID, "Projekte/Haus", "")
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(moved)
	wantMoved := []string{a.ID, b.ID}
	slices.Sort(wantMoved)
	if newPath != "Haus" || !slices.Equal(moved, wantMoved) {
		t.Fatalf("move: %q %v, want Haus %v", newPath, moved, wantMoved)
	}
	for id, want := range map[string]string{a.ID: "Haus", b.ID: "Haus/Keller", c.ID: "Projekte/Garten"} {
		d, err := s.GetDocumentByID(anna.ID, id)
		if err != nil || d.FolderPath != want {
			t.Fatalf("%s in %q, want %q (%v)", id, d.FolderPath, want, err)
		}
	}
	if d, _ := s.GetDocumentByID(anna.ID, a.ID); len(d.Blocks) != 1 || d.Blocks[0].Content != "Inhalt" {
		t.Fatalf("moving the folder changed the bullets: %+v", d.Blocks)
	}
}

// BenchmarkNoteTitles: lookups that need only the titles or folders of a person's notes, on the server
// of BenchmarkDocumentList (136 notes of about 40 bullets each). Run with
//
//	go test -run XXX -bench BenchmarkNoteTitles ./internal/storage/
func BenchmarkNoteTitles(b *testing.B) {
	store, me := seedListBench(b)
	b.ResetTimer()
	b.Run("WikiLinker", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = store.WikiLinker(me.ID)("[[Notiz 7]]")
		}
	})
	b.Run("uniqueTitle", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = store.uniqueTitle(me.ID, "Notiz 7")
		}
	})
	b.Run("GetFolders", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := store.GetFolders(me.ID); err != nil {
				b.Fatal(err)
			}
		}
	})
}
