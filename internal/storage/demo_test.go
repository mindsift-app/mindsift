package storage

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/drawing"
)

func TestResetAndSeedDemo(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "demo_test.db")

	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	// Create custom user and data
	hash, _ := auth.HashPassword("secret")
	customUser, err := store.CreateUserWithUsername("custom@test.local", "customuser", hash, "Custom", "member")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	_, err = store.CreateThought(customUser.ID, "A personal secret note", "normal", "manual", "")
	if err != nil {
		t.Fatalf("CreateThought failed: %v", err)
	}

	// Call ResetAndSeedDemo
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatalf("ResetAndSeedDemo failed: %v", err)
	}

	// Custom user must be wiped
	u, err := store.GetUserByID(customUser.ID)
	if err == nil && u != nil {
		t.Fatalf("expected custom user to be wiped, but still found: %v", u)
	}

	// Demo accounts admin and user must exist
	admin, err := store.GetUserByLogin("admin")
	if err != nil || admin == nil {
		t.Fatalf("expected demo admin to exist after reset: %v", err)
	}
	user, err := store.GetUserByLogin("user")
	if err != nil || user == nil {
		t.Fatalf("expected demo user to exist after reset: %v", err)
	}

	// Resetting again should work cleanly (idempotence on repeated server starts)
	if err := store.ResetAndSeedDemo(); err != nil {
		t.Fatalf("second ResetAndSeedDemo failed: %v", err)
	}
}

func TestWithoutDemoModeDataIsNotWiped(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "nodemo_test.db")

	// 1. Initial start without demo mode
	store1, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("first NewStore failed: %v", err)
	}

	hash, _ := auth.HashPassword("secret123")
	user1, err := store1.CreateUserWithUsername("persistent@example.com", "persistent", hash, "Persistent", "member")
	if err != nil {
		t.Fatalf("CreateUserWithUsername failed: %v", err)
	}
	thought1, err := store1.CreateThought(user1.ID, "Important persistent note #keep", "high", "manual", "")
	if err != nil {
		t.Fatalf("CreateThought failed: %v", err)
	}

	// Close store simulating server shutdown
	store1.Close()

	// 2. Server restart without demo mode (standard NewStore)
	store2, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("second NewStore failed: %v", err)
	}
	defer store2.Close()

	// Verify existing data is preserved
	foundUser, err := store2.GetUserByID(user1.ID)
	if err != nil || foundUser == nil {
		t.Fatalf("expected user %s to be preserved without demo mode, err: %v", user1.ID, err)
	}
	if foundUser.Username != "persistent" {
		t.Fatalf("expected username 'persistent', got '%s'", foundUser.Username)
	}

	thoughts, err := store2.GetThoughts(user1.ID, "", 10)
	if err != nil {
		t.Fatalf("GetThoughts failed: %v", err)
	}
	if len(thoughts) != 1 || thoughts[0].ID != thought1.ID {
		t.Fatalf("expected thought %s to persist, got: %v", thought1.ID, thoughts)
	}
}

// The sample drawing must be a valid model, or the demo note shows a broken block
func TestSeedDrawingIsValid(t *testing.T) {
	for _, content := range []string{seedNetworkDrawing("Router / Firewall", "Nur 80 und 443 offen"), seedNetworkDrawing("Router / firewall", "Only 80 and 443 open")} {
		d, ok := drawing.Parse(content)
		if !ok || len(d.Els) != 14 {
			t.Fatalf("sample drawing broken: ok=%v els=%d", ok, len(d.Els))
		}
		if desc := drawing.Describe(content); !strings.Contains(desc, "„Nginx“ → „MindSift“") {
			t.Fatalf("description: %s", desc)
		}
	}
}

// The note with the agent's diagrams holds two laid out drawings in both languages, shown fully
func TestSeedMCPDiagrams(t *testing.T) {
	for _, lang := range []string{"de", "en"} {
		store, err := NewStore(filepath.Join(t.TempDir(), "seed-"+lang+".db"))
		if err != nil {
			t.Fatalf("NewStore: %v", err)
		}
		u, _ := store.CreateUser(lang+"@example.com", "hash", "Anna", "member")
		if lang == "de" {
			err = store.seedStarterDE(u)
		} else {
			err = store.seedStarterEN(u)
		}
		if err != nil {
			t.Fatalf("seed %s: %v", lang, err)
		}
		var title string
		var pinned int
		_ = store.db.QueryRow(`SELECT title, is_pinned FROM documents WHERE user_id = ? AND is_pinned = 1`, u.ID).Scan(&title, &pinned)
		if !strings.Contains(title, "MCP") {
			t.Errorf("%s: start note should be the MCP diagrams, got %q", lang, title)
		}
		docs, _ := store.GetDocuments(u.ID)
		drawings := 0
		for _, d := range docs {
			if d.Title != title {
				continue
			}
			full, _ := store.GetDocumentByID(u.ID, d.ID)
			for _, b := range full.Blocks {
				if b.Type == "drawing" {
					if dr, ok := drawing.Parse(b.Content); !ok || len(dr.Els) < 15 || !strings.HasPrefix(b.Content, `{"fit":"all",`) {
						t.Errorf("%s: drawing broken: %.80s", lang, b.Content)
					}
					drawings++
				}
			}
		}
		if drawings != 2 {
			t.Errorf("%s: want 2 drawings, got %d", lang, drawings)
		}
		store.Close()
	}
}
