package storage

import (
	"fmt"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The note list counts open to-dos through the index of migration 50 instead of reading every bullet,
// and its hashtags through the covering indexes of migration 51.
func TestListStatsUseIndexes(t *testing.T) {
	s, _ := newSyncTestStore(t)
	owner, err := s.CreateUser("zaehler@example.com", "hash", "Zähler", "member")
	if err != nil {
		t.Fatal(err)
	}
	var docs []domain.Document
	for i := 0; i < 30; i++ {
		blocks := []domain.DocumentBlock{{ID: "t1", Type: "todo", Content: "Offen #liste"}, {ID: "t2", Type: "todo", Content: "Erledigt #liste", Checked: true}}
		for j := 0; j < 20; j++ {
			blocks = append(blocks, domain.DocumentBlock{ID: fmt.Sprintf("b%d", j), Type: "bullet", Content: "Text #notiz"})
		}
		doc, err := s.CreateDocument(owner.ID, "", fmt.Sprintf("Notiz %d", i), "", "", blocks, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		docs = append(docs, *doc)
	}
	if err := s.Optimize(); err != nil {
		t.Fatal(err)
	}
	plan := strings.Join(queryPlan(t, s, sqlListOpenTodos, docIDsJSON(docs)), "\n")
	if !strings.Contains(plan, "idx_blocks_open_todo") {
		t.Errorf("open to-dos are counted without the index:\n%s", plan)
	}
	// The hashtag counts read only the indexes of migration 51, the counts in the order of their groups
	plan = strings.Join(queryPlan(t, s, sqlListTagCounts, docIDsJSON(docs)), "\n")
	if !strings.Contains(plan, "COVERING INDEX idx_block_tags_doc_tag") || strings.Contains(plan, "TEMP B-TREE") {
		t.Errorf("hashtag counts without the covering index:\n%s", plan)
	}
	plan = strings.Join(queryPlan(t, s, sqlListTagOpenTodos, docIDsJSON(docs)), "\n")
	if !strings.Contains(plan, "idx_blocks_open_todo") || !strings.Contains(plan, "COVERING INDEX idx_block_tags_block") {
		t.Errorf("open to-dos per hashtag without the indexes:\n%s", plan)
	}
	if err := attachListStats(s.db, docs); err != nil {
		t.Fatal(err)
	}
	for _, d := range docs {
		if d.OpenTodos != 1 {
			t.Fatalf("note %s: %d open to-dos, want 1", d.Title, d.OpenTodos)
		}
		if d.TagCounts["liste"] != 2 || d.TagOpenTodos["liste"] != 1 || d.TagCounts["notiz"] != 20 || d.TagOpenTodos["notiz"] != 0 {
			t.Fatalf("note %s: tags %v, open %v", d.Title, d.TagCounts, d.TagOpenTodos)
		}
	}
}
