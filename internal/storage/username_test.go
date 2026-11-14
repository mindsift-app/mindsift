package storage

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
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

// Migration 45: names held twice before the unique index are resolved, the oldest account keeps its name
func TestMigrateUniqueUsernames(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "unique.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	// The database as before the step: the plain index let two requests write the same name
	if _, err := store.db.Exec(`DROP INDEX idx_users_username`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`CREATE INDEX idx_users_username ON users(username)`); err != nil {
		t.Fatal(err)
	}
	for _, r := range [][3]string{
		{"u3", "sandro", "2026-01-03T00:00:00Z"},
		{"u1", "sandro", "2026-01-01T00:00:00Z"}, // oldest: keeps the name
		{"u2", "Sandro", "2026-01-02T00:00:00Z"},
		{"u4", "sandro1", "2026-01-04T00:00:00Z"}, // already has the first number: the others skip it
		{"u5", "Anna", "2026-01-05T00:00:00Z"},    // alone, only lowered
		{"u6", "", "2026-01-06T00:00:00Z"},
		{"u7", "", "2026-01-07T00:00:00Z"},
	} {
		if _, err := store.db.Exec(`INSERT INTO users (id, email, username, password_hash, display_name, role, is_active, token_version, alarm_channels, discord_webhook_url, custom_webhook_url, notify_before_minutes, avatar_url, created_at)
			VALUES (?, ?, ?, 'x', 'Name', 'member', 1, 1, '', '', '', 30, '', ?)`, r[0], r[0]+"@example.org", r[1], r[2]); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.migrateUniqueUsernames(); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"u1": "sandro", "u2": "sandro2", "u3": "sandro3", "u4": "sandro1", "u5": "anna", "u6": "", "u7": ""}
	for id, w := range want {
		u, err := store.GetUserByID(id)
		if err != nil || u.Username != w {
			t.Errorf("%s: username %v (%v), want %q", id, u, err, w)
		}
	}
	// From now on the database itself refuses a second account with the name
	if _, err := store.db.Exec(`UPDATE users SET username = 'sandro' WHERE id = 'u2'`); usernameTakenErr(err) != ErrUsernameTaken {
		t.Errorf("duplicate after the migration: %v", err)
	}
	// Running it again changes nothing
	if err := store.migrateUniqueUsernames(); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if u, _ := store.GetUserByID("u3"); u.Username != "sandro3" {
		t.Errorf("second run renamed u3 to %q", u.Username)
	}
}

// Accounts created at the same moment with the same name each get their own (the unique index refuses a
// name another request took after the check; the store then takes the next free one)
func TestConcurrentAccountsGetDistinctUsernames(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "race.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	const n = 12
	var wg sync.WaitGroup
	names := make(chan string, n)
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			u, err := store.CreateUser(fmt.Sprintf("p%d@example.org", i), "x", "Sandro", "member")
			if err != nil {
				errs <- err
				return
			}
			names <- u.Username
		}(i)
	}
	wg.Wait()
	close(names)
	close(errs)
	for err := range errs {
		t.Errorf("CreateUser: %v", err)
	}
	seen := map[string]bool{}
	for name := range names {
		if seen[name] {
			t.Errorf("username %q handed out twice", name)
		}
		seen[name] = true
	}
	var stored int
	if err := store.db.QueryRow(`SELECT COUNT(DISTINCT username) FROM users WHERE username LIKE 'sandro%'`).Scan(&stored); err != nil || stored != n {
		t.Errorf("%d distinct usernames stored (%v), want %d", stored, err, n)
	}
}

// The race itself: the name is free at the check and taken at the write
func TestCreateUserRetriesTakenUsername(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "retry.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	// Another account takes the name just after the check, twice
	var taken []string
	inside := false
	afterUsernameCheck = func(name string) {
		if inside || len(taken) == 2 {
			return
		}
		inside = true
		defer func() { inside = false }()
		taken = append(taken, name)
		if _, err := store.CreateUser(fmt.Sprintf("other%d@example.org", len(taken)), "x", name, "member"); err != nil {
			t.Errorf("other account: %v", err)
		}
	}
	defer func() { afterUsernameCheck = func(string) {} }()
	b, err := store.CreateUser("second@example.org", "x", "Anna", "member")
	if err != nil || b.Username != "anna2" {
		t.Fatalf("Anna after the race: %v, %v; want anna2", b, err)
	}
	if len(taken) != 2 || taken[0] != "anna" || taken[1] != "anna1" {
		t.Errorf("names checked: %v", taken)
	}
	if err := store.SetUsername(b.ID, "anna"); !errors.Is(err, ErrUsernameTaken) {
		t.Errorf("SetUsername to a taken name: %v", err)
	}
	if _, err := store.db.Exec(`UPDATE users SET username = 'anna' WHERE id = ?`, b.ID); !errors.Is(usernameTakenErr(err), ErrUsernameTaken) {
		t.Errorf("write past the check: %v", err)
	}
}

// Without a display name an account shows its username, at creation and when the name is cleared
func TestEmptyDisplayNameShowsUsername(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "names.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	a, err := store.CreateUser("sandro@email.de", "x", "", "member")
	if err != nil {
		t.Fatal(err)
	}
	b, err := store.CreateInactiveUser("sandro@firma.de", "x", " \n\u202e ", "member")
	if err != nil {
		t.Fatal(err)
	}
	if a.Username != "sandro" || a.DisplayName != "sandro" || b.Username != "sandro1" || b.DisplayName != "sandro1" {
		t.Fatalf("got %q/%q and %q/%q, want sandro/sandro and sandro1/sandro1", a.Username, a.DisplayName, b.Username, b.DisplayName)
	}
	if stored, _ := store.GetUserByID(b.ID); stored.DisplayName != "sandro1" {
		t.Errorf("stored display name %q", stored.DisplayName)
	}
	c, err := store.CreateUserWithUsername("", "anna.admin", "x", "", "admin")
	if err != nil || c.DisplayName != "anna.admin" {
		t.Fatalf("with username: %v, %v", c, err)
	}

	if _, err := store.UpdateUser(a.ID, ptr("Sandro Dach"), nil, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := store.SetUsername(a.ID, "chef"); err != nil {
		t.Fatal(err)
	}
	u, err := store.UpdateUser(a.ID, ptr("  "), nil, nil, nil, nil, nil)
	if err != nil || u.DisplayName != "chef" {
		t.Fatalf("cleared name: %v, %v; want chef", u, err)
	}
	if stored, _ := store.GetUserByID(a.ID); stored.DisplayName != "chef" {
		t.Errorf("stored display name %q", stored.DisplayName)
	}
}

func ptr(s string) *string { return &s }
