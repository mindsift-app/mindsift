package storage

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Migration 48 drops documents.markdown_cache; notes read as before, their markdown built from the
// bullets.
func TestMarkdownCacheDropped(t *testing.T) {
	path := filepath.Join(t.TempDir(), "md.db")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.CreateUser("anna@test.local", "hash", "Anna", "member")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := s.CreateDocument(u.ID, "", "Markdown", "", "", []domain.DocumentBlock{
		{ID: "m1", Type: "bullet", Content: "Erste Zeile"},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := s.columnExists("documents", "markdown_cache"); err != nil || ok {
		t.Fatalf("markdown_cache still there on a new database (%v)", err)
	}
	// A database from before the step: the column is there (empty since migration 44)
	for _, q := range []string{`ALTER TABLE documents ADD COLUMN markdown_cache TEXT NOT NULL DEFAULT ''`,
		`DELETE FROM schema_migrations WHERE id = 48`} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	_ = s.Close()
	if s, err = NewStore(path); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if ok, err := s.columnExists("documents", "markdown_cache"); err != nil || ok {
		t.Fatalf("markdown_cache not dropped (%v)", err)
	}
	got, err := s.GetDocumentByID(u.ID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got.MarkdownCache, "Erste Zeile") || got.Content != "Erste Zeile\n" {
		t.Fatalf("note after the step: %q / %q", got.MarkdownCache, got.Content)
	}
	if _, err := s.CreateDocument(u.ID, "", "Neu", "", "", nil, nil, false); err != nil {
		t.Fatalf("creating a note: %v", err)
	}
	requireIntegrity(t, s)
}

// Migration 51 drops documents.content. A note whose old block list could not be converted keeps its
// text in blocks_json: the journal counts its day as not empty, and reading it converts it.
func TestDocumentContentDropped(t *testing.T) {
	path := filepath.Join(t.TempDir(), "content.db")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.CreateUser("anna@test.local", "hash", "Anna", "member")
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := s.columnExists("documents", "content"); err != nil || ok {
		t.Fatalf("content still there on a new database (%v)", err)
	}
	day := func(date, text string) string {
		doc, err := s.CreateDocument(u.ID, "", date, "📅", "", []domain.DocumentBlock{{ID: "j" + date, Type: "bullet", Content: text}}, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.SetJournalDay(u.ID, date, doc.ID); err != nil {
			t.Fatal(err)
		}
		return doc.ID
	}
	day("2026-11-01", "")
	day("2026-11-02", "Heute")
	legacy := day("2026-11-03", "")
	// A database from before the step, with a note that only has blocks_json and its plain text
	for _, q := range []string{`ALTER TABLE documents ADD COLUMN content TEXT NOT NULL DEFAULT ''`,
		`DELETE FROM schema_migrations WHERE id = 51`,
		`DELETE FROM block_tags WHERE document_id = '` + legacy + `'`,
		`DELETE FROM blocks WHERE document_id = '` + legacy + `'`,
		`DELETE FROM doc_ops WHERE doc_id = '` + legacy + `'`,
		`UPDATE documents SET head_seq = 0, content = 'Alte Zeile', blocks_json = '[{"id":"alt1","type":"bullet","content":"Alte Zeile"}]' WHERE id = '` + legacy + `'`} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	_ = s.Close()
	if s, err = NewStore(path); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if ok, err := s.columnExists("documents", "content"); err != nil || ok {
		t.Fatalf("content not dropped (%v)", err)
	}
	want := map[string]bool{"2026-11-01": true, "2026-11-02": false, "2026-11-03": false}
	for _, step := range []string{"before reading", "after reading"} {
		days, err := s.JournalDays(u.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range days {
			if d.Empty != want[d.Date] {
				t.Errorf("%s: day %s empty = %v", step, d.Date, d.Empty)
			}
		}
		got, err := s.GetDocumentByID(u.ID, legacy)
		if err != nil {
			t.Fatal(err)
		}
		if got.Content != "Alte Zeile\n" {
			t.Fatalf("%s: old note reads %q", step, got.Content)
		}
	}
	list, err := s.GetDocumentList(t.Context(), u.ID)
	if err != nil || len(list) != 3 {
		t.Fatalf("list: %v, %d notes", err, len(list))
	}
	if _, err := s.CreateDocument(u.ID, "", "Neu", "", "", nil, nil, false); err != nil {
		t.Fatalf("creating a note: %v", err)
	}
	requireIntegrity(t, s)
}
