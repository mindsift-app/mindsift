package storage

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestValidAvatar(t *testing.T) {
	ok := []string{"", "🦊", "☕", "👨‍👩‍👧‍👦", "data:image/webp;base64,UklGRg==", "data:image/jpeg;base64,/9j/4AAQ"}
	bad := []string{
		"https://tracker.example/me.png", "http://example.com/a.png", "/api/v1/media/x",
		"data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PGI+",
		"data:image/png;base64," + strings.Repeat("A", MaxAvatarBytes), "<b>hi</b>",
	}
	for _, v := range ok {
		if !ValidAvatar(v) {
			t.Errorf("refused %.40q", v)
		}
	}
	for _, v := range bad {
		if ValidAvatar(v) {
			t.Errorf("accepted %.40q", v)
		}
	}
}

// Links to other servers are refused when saving and removed from older accounts (SA-07)
func TestAvatarsOnlyUploadedOrEmoji(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "avatar.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	u, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ext := "https://tracker.example/me.png"
	if _, err := store.UpdateUserFull(u.ID, nil, nil, nil, nil, nil, nil, nil, nil, nil, &ext); err != ErrInvalidAvatar {
		t.Fatalf("external picture: want ErrInvalidAvatar, got %v", err)
	}
	fox := "🦊"
	if _, err := store.UpdateUserFull(u.ID, nil, nil, nil, nil, nil, nil, nil, nil, nil, &fox); err != nil {
		t.Fatalf("emoji: %v", err)
	}
	// An older account with a link from before
	_, _ = store.db.Exec(`UPDATE users SET avatar_url = ? WHERE id = ?`, ext, u.ID)
	if err := store.migrateAvatars(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if got, _ := store.GetUserByID(u.ID); got.AvatarURL != "" {
		t.Fatalf("old link kept: %q", got.AvatarURL)
	}
}
