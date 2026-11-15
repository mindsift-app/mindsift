package storage

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The note search finds a matched bullet through the covering index of migration 53: everything it
// reads of the bullet (key, deleted, note, id) is in the index, so no row of blocks is read per match.
func TestNoteSearchUsesCoveringIndex(t *testing.T) {
	s, owner := newSyncTestStore(t)
	var ids []string
	for i := 0; i < 20; i++ {
		var blocks []domain.DocumentBlock
		for j := 0; j < 30; j++ {
			blocks = append(blocks, domain.DocumentBlock{ID: fmt.Sprintf("b%d", j), Type: "bullet", Content: fmt.Sprintf("Server Backup %d", j)})
		}
		doc, err := s.CreateDocument(owner.ID, "", fmt.Sprintf("Notiz %d", i), "", "", blocks, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, doc.ID)
	}
	if err := s.Optimize(); err != nil {
		t.Fatal(err)
	}
	idsJSON, _ := json.Marshal(ids)
	plan := strings.Join(queryPlan(t, s, sqlNoteSearchHits, `"Server"*`, string(idsJSON), 40), "\n")
	if !strings.Contains(plan, "COVERING INDEX idx_blocks_fts_cover") {
		t.Errorf("matched bullets are not found through the covering index:\n%s", plan)
	}
	rows, err := s.searchVisibleNotes(t.Context(), owner.ID, `"Server"*`, "", 40)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 40 || rows[0].blockID == "" || rows[0].content == "" {
		t.Fatalf("search: %d hits, first %+v", len(rows), rows)
	}
}
