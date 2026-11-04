package storage

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestUsernameFromName(t *testing.T) {
	cases := map[string]string{
		"Sandro Dach":        "sandro.dach",
		"  Anna-Lena Müller": "anna-lena.mueller",
		"Jürgen (Büro)":      "juergen.buero",
		"Max__Power":         "max__power",
		"a . b":              "a.b",
		"!!!":                "",
		"Ünal Øster":         "uenal.ster",
	}
	for in, want := range cases {
		if got := UsernameFromName(in); got != want {
			t.Errorf("UsernameFromName(%q) = %q, want %q", in, got, want)
		}
	}
	if got := UsernameFromName("Ein sehr sehr langer Anzeigename mit vielen Wörtern"); len(got) > usernameMaxLen || !ValidUsername(got) {
		t.Errorf("long name gives %q", got)
	}
}

func TestUsernamesFromDisplayNamesAndLogin(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "usernames.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	a, err := store.CreateUser("sandro@example.org", "x", "Sandro Dach", "member")
	if err != nil {
		t.Fatal(err)
	}
	b, err := store.CreateUser("other@example.org", "x", "Sandro Dach", "member")
	if err != nil {
		t.Fatal(err)
	}
	if a.Username != "sandro.dach" || b.Username != "sandro.dach1" {
		t.Fatalf("usernames %q and %q, want sandro.dach and sandro.dach1", a.Username, b.Username)
	}

	// Signing in: username, the name typed like the display name, email and its local part
	for _, login := range []string{"sandro.dach", "Sandro Dach", "SANDRO.DACH", "sandro@example.org", "sandro"} {
		u, err := store.GetUserByLogin(login)
		if err != nil || u.ID != a.ID {
			t.Errorf("login %q: got %v, %v; want %s", login, u, err, a.ID)
		}
	}

	// The display name alone does not sign in any more once it differs from the username
	if _, err := store.UpdateUser(a.ID, ptr("Der Chef"), nil, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if u, err := store.GetUserByLogin("Der Chef"); err == nil && u != nil {
		t.Errorf("display name signed in as %s", u.ID)
	}

	if err := store.SetUsername(a.ID, "sandro.dach1"); !errors.Is(err, ErrUsernameTaken) {
		t.Errorf("taken name: %v", err)
	}
	if err := store.SetUsername(a.ID, "mit leerzeichen"); !errors.Is(err, ErrInvalidUsername) {
		t.Errorf("invalid name: %v", err)
	}
	if err := store.SetUsername(a.ID, "Chef"); err != nil {
		t.Fatalf("SetUsername: %v", err)
	}
	if u, _ := store.GetUserByLogin("chef"); u == nil || u.ID != a.ID {
		t.Errorf("new username does not sign in")
	}
}

func TestMigrateUsernames(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "migrate.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	// Accounts as older versions left them: username from the email, display names with spaces
	for _, q := range []string{
		`INSERT INTO users (id, email, username, password_hash, display_name, role, is_active, token_version, alarm_channels, alarm_email, discord_webhook_url, custom_webhook_url, notify_before_minutes, avatar_url, created_at) VALUES ('u1', 'sd@x.de', 'sd', 'x', 'Sandro Dach', 'admin', 1, 1, '', '', '', '', 30, '', '2026-01-01T00:00:00Z')`,
		`INSERT INTO users (id, email, username, password_hash, display_name, role, is_active, token_version, alarm_channels, alarm_email, discord_webhook_url, custom_webhook_url, notify_before_minutes, avatar_url, created_at) VALUES ('u2', 'zwei@x.de', 'zwei', 'x', 'Sandro Dach', 'member', 1, 1, '', '', '', '', 30, '', '2026-01-02T00:00:00Z')`,
		`INSERT INTO users (id, email, username, password_hash, display_name, role, is_active, token_version, alarm_channels, alarm_email, discord_webhook_url, custom_webhook_url, notify_before_minutes, avatar_url, created_at) VALUES ('u3', 'drei@x.de', 'drei', 'x', '???', 'member', 1, 1, '', '', '', '', 30, '', '2026-01-03T00:00:00Z')`,
	} {
		if _, err := store.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.migrateUsernames(); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"u1": "sandro.dach", "u2": "sandro.dach1", "u3": "drei"}
	for id, w := range want {
		u, _ := store.GetUserByID(id)
		if u == nil || u.Username != w {
			t.Errorf("%s: username %v, want %s", id, u, w)
		}
	}
}

func ptr(s string) *string { return &s }
