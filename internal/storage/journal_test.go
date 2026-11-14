package storage

import (
	"maps"
	"testing"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func journalEmpty(t *testing.T, s *Store, userID string) map[string]bool {
	t.Helper()
	days, err := s.JournalDays(userID)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, d := range days {
		out[d.Date] = d.Empty
	}
	return out
}

// A journal day is empty by its bullets: documents.content stays empty since migration 44, so it cannot
// tell any more whether a day has text.
func TestJournalDayEmptyFromBullets(t *testing.T) {
	s, u := newSyncTestStore(t)
	a := collab.Actor{UserID: u.ID, ClientID: "tab1"}
	day := func(date string, blocks []domain.DocumentBlock) string {
		doc, err := s.CreateDocument(u.ID, "", date, "📅", "", blocks, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.SetJournalDay(u.ID, date, doc.ID); err != nil {
			t.Fatal(err)
		}
		return doc.ID
	}
	typed := day("2026-11-01", nil)
	day("2026-11-02", flatBlocks([3]any{"b1", 0, ""}, [3]any{"b2", 1, ""}))
	day("2026-11-03", []domain.DocumentBlock{{ID: "img", Type: "image", Content: MediaContent("image", "med_aa", "Berg")}})
	day("2026-11-04", []domain.DocumentBlock{{ID: "dw", Type: "drawing", Content: `{"v":1,"els":[{"id":"e1","t":"text","x":1,"y":2,"txt":"Skizze"}]}`}})
	day("2026-11-05", []domain.DocumentBlock{{ID: "dw0", Type: "drawing", Content: `{"v":1,"els":[{"id":"e1","t":"pen","x":1,"y":2,"pts":[[0,0],[1,1]]}]}`}})
	day("2026-11-06", []domain.DocumentBlock{{ID: "td", Type: "todo", Content: "Milch kaufen"}})

	want := map[string]bool{"2026-11-01": true, "2026-11-02": true, "2026-11-03": false, "2026-11-04": false, "2026-11-05": true, "2026-11-06": false}
	if got := journalEmpty(t, s, u.ID); !maps.Equal(got, want) {
		t.Fatalf("after creating:\n got %v\nwant %v", got, want)
	}

	// Typing into the day's note through the normal path
	text, root := "Heute war ein guter Tag", ""
	applyOps(t, s, typed, a, collab.Op{OpID: "o1", Kind: collab.OpInsert, BlockID: "t1", ParentID: &root, OrderKey: "a0", Content: &text})
	if got := journalEmpty(t, s, u.ID); got["2026-11-01"] {
		t.Fatal("a day with text counts as empty")
	}
	// Deleting the only bullet leaves a tombstone, which does not count
	applyOps(t, s, typed, a, collab.Op{OpID: "o2", Kind: collab.OpDelete, BlockID: "t1"})
	if got := journalEmpty(t, s, u.ID); !got["2026-11-01"] {
		t.Fatal("a day whose only bullet was deleted is not empty")
	}
}
