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
