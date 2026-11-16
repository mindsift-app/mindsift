package storage

import (
	"strings"
	"testing"
)

func TestSeedOutline(t *testing.T) {
	got := seedOutline(`
		## Heading
		  - bullet
		    - nested
		  - [x] done #tag
		  1. step
		  > callout
		  ! careful
		  | a | b |
		  | --- | --- |
		  | 1 | 2 |
		  ~~~go
		  func main() {
		  	x := 1
		  }
		  ~~~
		---
	`)
	want := []struct {
		level   int
		typ     string
		text    string
		checked bool
	}{
		{0, "h2", "Heading", false}, {1, "", "bullet", false}, {2, "", "nested", false}, {1, "todo", "done #tag", true},
		{1, "numbered", "step", false}, {1, "callout", "callout", false}, {1, "warning", "careful", false},
		{1, "table", "| a | b |\n| --- | --- |\n| 1 | 2 |", false},
		{1, "code", "func main() {\n\tx := 1\n}", false}, {0, "divider", "", false},
	}
	if len(got) != len(want) {
		t.Fatalf("%d blocks, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		g := got[i]
		if g.level != w.level || g.typ != w.typ || g.text != w.text || g.checked != w.checked {
			t.Errorf("block %d: got %+v, want %+v", i, g, w)
		}
	}
}

// The sample knowledge base: every [[link]] finds its note, there are plenty of notes with shared hashtags,
// and only the help notes carry an icon of their own (the rest has the standard one).
func TestSeedKnowledgeBase(t *testing.T) {
	for _, c := range []struct{ lang, help string }{{"de", "MindSift-Hilfe"}, {"en", "MindSift help"}} {
		s, u := newSyncTestStore(t)
		if err := s.SetLanguage(u.ID, c.lang); err != nil {
			t.Fatal(err)
		}
		if err := s.SeedStarterContent(u); err != nil {
			t.Fatal(err)
		}
		docs, _ := s.GetDocuments(u.ID)
		if len(docs) < 45 {
			t.Errorf("%s: only %d notes", c.lang, len(docs))
		}
		for _, d := range docs {
			if d.Icon != "🗒️" && d.FolderPath != c.help {
				t.Errorf("%s: %q outside the help folder has the icon %q", c.lang, d.Title, d.Icon)
			}
			full, err := s.GetDocumentByID(u.ID, d.ID)
			if err != nil {
				t.Fatal(err)
			}
			for _, b := range full.Blocks {
				links, _ := wikiLinks(b.Content)
				for _, l := range links {
					// "[[Notiztitel]]" in the help is the syntax shown as an example
					if l.DocID == "" && l.Title != "Notiztitel" && l.Title != "Note title" {
						t.Errorf("%s: %q links to %q, which is no note (or not unique)", c.lang, d.Title, l.Title)
					}
				}
				if d.FolderPath != c.help && strings.ContainsAny(b.Content, "🎨🚀🥗") {
					t.Errorf("%s: %q has an emoji in its text: %s", c.lang, d.Title, b.Content)
				}
			}
		}
		// Hashtags used in several notes, so the hashtag pages have something to list
		var shared int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM (SELECT tag FROM block_tags GROUP BY tag HAVING COUNT(DISTINCT document_id) >= 3)`).Scan(&shared)
		if shared < 8 {
			t.Errorf("%s: only %d hashtags are used in three notes or more", c.lang, shared)
		}
		var nested int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE user_id = ? AND folder_path LIKE '%/%'`, u.ID).Scan(&nested)
		if nested < 5 {
			t.Errorf("%s: only %d notes in subfolders", c.lang, nested)
		}
	}
}
