package storage

import (
	"fmt"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The note list counts open to-dos through the index of migration 50 instead of reading every bullet.
func TestOpenTodoCountUsesIndex(t *testing.T) {
	s, _ := newSyncTestStore(t)
	owner, err := s.CreateUser("zaehler@example.com", "hash", "Zähler", "member")
	if err != nil {
		t.Fatal(err)
	}
	var docs []domain.Document
	for i := 0; i < 30; i++ {
		blocks := []domain.DocumentBlock{{ID: "t1", Type: "todo", Content: "Offen"}, {ID: "t2", Type: "todo", Content: "Erledigt", Checked: true}}
		for j := 0; j < 20; j++ {
			blocks = append(blocks, domain.DocumentBlock{ID: fmt.Sprintf("b%d", j), Type: "bullet", Content: "Text"})
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
	plan := strings.Join(queryPlan(t, s, `SELECT b.document_id, COUNT(*) FROM blocks b
		WHERE b.document_id IN (SELECT value FROM json_each(?)) AND b.deleted = 0 AND `+sqlOpenTodo+`
		GROUP BY b.document_id`, docIDsJSON(docs)), "\n")
	if !strings.Contains(plan, "idx_blocks_open_todo") {
		t.Errorf("open to-dos are counted without the index:\n%s", plan)
	}
	if err := s.attachListStats(t.Context(), docs); err != nil {
		t.Fatal(err)
	}
	for _, d := range docs {
		if d.OpenTodos != 1 {
			t.Fatalf("note %s: %d open to-dos, want 1", d.Title, d.OpenTodos)
		}
	}
}
