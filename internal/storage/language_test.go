package storage

import (
	"archive/zip"
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

// Accounts from before the language choice keep German; new ones start without a choice.
func TestLanguageMigrationKeepsGerman(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "lang.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	old, _ := store.CreateUser("old@example.com", "hash", "Old", "member")
	if got := store.Language(old.ID); got != "" {
		t.Fatalf("new account should start without a choice, got %q", got)
	}
	// As if the account had existed when migration 19 ran
	if err := store.migrateLanguage(); err != nil {
		t.Fatal(err)
	}
	if got := store.Language(old.ID); got != "de" {
		t.Fatalf("existing account should keep German, got %q", got)
	}
	if err := store.SetLanguage(old.ID, "xx"); err != ErrInvalidLanguage {
		t.Fatalf("unknown language must be refused, got %v", err)
	}
	if err := store.SetLanguage(old.ID, ""); err != nil || store.Language(old.ID) != "" {
		t.Fatalf("empty choice follows the browser again: %v", err)
	}
}

// Texts the store writes follow the person's language: board columns, untitled notes, archive folders;
// an archive in one language imports back with another.
func TestStoreTextsInLanguage(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "lang.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ada, _ := store.CreateUser("ada@example.com", "hash", "Ada", "member")
	if got := store.MessageLanguage(ada.ID); got != "de" {
		t.Fatalf("without any choice German, got %q", got)
	}
	store.ConfiguredLanguage = "en"
	if got := store.MessageLanguage(ada.ID); got != "en" {
		t.Fatalf("DEFAULT_LANGUAGE, got %q", got)
	}
	store.ConfiguredLanguage = ""
	_ = store.SetLanguage(ada.ID, "en")

	tl, _ := store.CreateTaskList(ada.ID, "", "", "", "", "")
	if tl.Title != "My tasks" || tl.Columns[0].Name != "To do" || tl.Columns[3].Name != "Done" {
		t.Fatalf("English task list: %q %+v", tl.Title, tl.Columns)
	}
	doc, _ := store.CreateDocument(ada.ID, "", "", "", "", nil, nil, false)
	if doc.Title != "Untitled note" {
		t.Fatalf("English untitled note: %q", doc.Title)
	}
	task, _ := store.CreateThoughtWithDetails(ada.ID, "Call Bob", "normal", "manual", "", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(ada.ID, task.ID, "keep", "task", "", "", "")

	var buf bytes.Buffer
	if err := store.WriteMarkdownVault(ada.ID, &buf); err != nil {
		t.Fatal(err)
	}
	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	if !strings.Contains(strings.Join(names, ","), "Tasks/No list.md") {
		t.Fatalf("English archive folders: %v", names)
	}
	plan, err := PlanMindSiftArchiveImport(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil || len(plan.TaskLists) != 2 || plan.TaskLists[1].title != "" || len(plan.TaskLists[1].tasks) != 1 || len(plan.Folders) != 0 {
		t.Fatalf("English archive must import its tasks: %v %+v", err, plan)
	}
}
