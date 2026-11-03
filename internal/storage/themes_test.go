package storage

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestUserThemesArePrivateAndLimited(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "themes.db"))
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")

	css := `:root[data-theme="wald"] { --accent-primary: #15803d; }`
	th, err := store.SaveUserTheme(anna.ID, "", "Wald", css)
	if err != nil {
		t.Fatalf("SaveUserTheme failed: %v", err)
	}
	if _, err := store.SaveUserTheme(anna.ID, th.ID, "Wald 2", css); err != nil {
		t.Fatalf("update failed: %v", err)
	}
	if themes, _ := store.GetUserThemes(anna.ID); len(themes) != 1 || themes[0].Name != "Wald 2" {
		t.Fatalf("expected one updated theme, got %+v", themes)
	}

	// Other users neither see, change nor delete it
	if themes, _ := store.GetUserThemes(ben.ID); len(themes) != 0 {
		t.Errorf("Ben must not see Anna's themes")
	}
	if _, err := store.SaveUserTheme(ben.ID, th.ID, "Gekapert", css); err == nil {
		t.Errorf("Ben must not update Anna's theme")
	}
	if err := store.DeleteUserTheme(ben.ID, th.ID); err == nil {
		t.Errorf("Ben must not delete Anna's theme")
	}

	if _, err := store.SaveUserTheme(anna.ID, "", "Riesig", strings.Repeat("a", MaxThemeCSSBytes+1)); err == nil {
		t.Errorf("oversized theme must be rejected")
	}
	if _, err := store.SaveUserTheme(anna.ID, "", " ", css); err == nil {
		t.Errorf("theme without name must be rejected")
	}
	if err := store.DeleteUserTheme(anna.ID, th.ID); err != nil {
		t.Fatalf("delete failed: %v", err)
	}
}
