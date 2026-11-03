package storage

import (
	"path/filepath"
	"testing"
)

func TestVoiceInputChoice(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "voice.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	if v := store.VoiceInput(anna.ID); v != "" {
		t.Fatalf("default should be the Whisper server (\"\"), got %q", v)
	}
	if err := store.SetVoiceInput(anna.ID, "browser"); err != nil || store.VoiceInput(anna.ID) != "browser" {
		t.Fatalf("browser not stored: %v", err)
	}
	if err := store.SetVoiceInput(anna.ID, "google"); err == nil {
		t.Fatal("unknown values must be refused")
	}
}
