package storage

import (
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
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
