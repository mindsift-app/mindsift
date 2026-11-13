package storage

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestOpenListItemsCountCoversSharedLists(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "stats.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	carla, _ := store.CreateUser("carla@example.com", "hash", "Carla", "member")

	addItems := func(owner, listID string, open, done int) {
		for i := 0; i < open+done; i++ {
			item, _ := store.CreateListItem(listID, "Eintrag", "", "", i, owner)
			if i >= open {
				_, _ = store.ToggleListItem(item.ID, true, owner, "")
			}
		}
	}
	own, _ := store.CreateList(anna.ID, "Einkauf", "🛒", "shopping")
	addItems(anna.ID, own.ID, 2, 1)
	direct, _ := store.CreateList(ben.ID, "Bens Liste", "", "shopping")
	addItems(ben.ID, direct.ID, 1, 2)
	if _, err := store.AddListShare(ben.ID, direct.ID, "user", anna.ID, "viewer"); err != nil {
		t.Fatalf("share: %v", err)
	}
	viaGroup, _ := store.CreateList(carla.ID, "WG-Putzplan", "", "shopping")
	addItems(carla.ID, viaGroup.ID, 3, 0)
	team, _ := store.CreateTeam("", "WG", "")
	_ = store.AddTeamMember(team.ID, anna.ID, "member")
	_ = store.AddTeamMember(team.ID, carla.ID, "admin")
	if _, err := store.AddListShare(carla.ID, viaGroup.ID, "team", team.ID, "editor"); err != nil {
		t.Fatalf("team share: %v", err)
	}
	foreign, _ := store.CreateList(ben.ID, "Privat", "", "shopping")
	addItems(ben.ID, foreign.ID, 5, 0)

	st, _ := store.GetDashboardStats(anna.ID)
	if st.ListItemsOpenCount != 6 || st.ListsCount != 3 {
		t.Errorf("want 6 open items in 3 lists (own 2 + direct 1 + group 3), got %d in %d", st.ListItemsOpenCount, st.ListsCount)
	}
}

// The settings come from memory after the first read; a change, a direct write that went around the store
// and the copies handed out behave as without the cache
func TestSystemSettingsCache(t *testing.T) {
	store, _, _ := setupTestStore(t)
	first, err := store.GetSystemSettings()
	if err != nil {
		t.Fatal(err)
	}
	// Writing the table directly is not seen: the copy in memory answers
	if _, err := store.db.Exec(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('instance_name', 'Direkt')`); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.GetSystemSettings(); got.InstanceName != first.InstanceName {
		t.Fatalf("expected the cached name %q, got %q", first.InstanceName, got.InstanceName)
	}
	// A change through the store is seen at once
	first.InstanceName = "Über den Store"
	off := false
	first.MCPEnabled = &off
	if err := store.UpdateSystemSettings(first); err != nil {
		t.Fatal(err)
	}
	got, _ := store.GetSystemSettings()
	if got.InstanceName != "Über den Store" || got.MCPEnabled == nil || *got.MCPEnabled {
		t.Fatalf("change not seen: %q %v", got.InstanceName, got.MCPEnabled)
	}
	// What a caller changes in its copy stays there, pointer fields included
	got.InstanceName = "Nur hier"
	*got.MCPEnabled = true
	*got.PeopleSearch = false
	again, _ := store.GetSystemSettings()
	if again.InstanceName != "Über den Store" || *again.MCPEnabled || !*again.PeopleSearch {
		t.Fatalf("a caller's change reached the cache: %+v", again)
	}
	// Every pointer field of a copy is its own (also for fields added later)
	v := reflect.ValueOf(cloneSystemSettings(again)).Elem()
	w := reflect.ValueOf(again).Elem()
	for i := 0; i < v.NumField(); i++ {
		if v.Field(i).Kind() == reflect.Pointer && !v.Field(i).IsNil() && v.Field(i).Pointer() == w.Field(i).Pointer() {
			t.Errorf("cloneSystemSettings shares %s", v.Type().Field(i).Name)
		}
	}
}

// The server's time zone: "" until set, nil in an update leaves it, an unknown name is refused, ""
// takes it back
func TestTimeZoneSetting(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "tz.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	zone := func() string {
		s, _ := store.GetSystemSettings()
		if s.TimeZone == nil {
			t.Fatal("TimeZone is never nil when read")
		}
		return *s.TimeZone
	}
	if zone() != "" {
		t.Fatalf("not set at first: %q", zone())
	}
	s, _ := store.GetSystemSettings()
	berlin := " Europe/Berlin "
	s.TimeZone = &berlin
	if err := store.UpdateSystemSettings(s); err != nil || zone() != "Europe/Berlin" {
		t.Fatalf("set: %v %q", err, zone())
	}
	s, _ = store.GetSystemSettings()
	s.TimeZone = nil
	s.InstanceName = "Zuhause"
	if err := store.UpdateSystemSettings(s); err != nil || zone() != "Europe/Berlin" {
		t.Fatalf("nil must leave it: %v %q", err, zone())
	}
	bad := "Mars/Olympus"
	s.TimeZone = &bad
	if err := store.UpdateSystemSettings(s); err != ErrInvalidTimeZone || zone() != "Europe/Berlin" {
		t.Fatalf("unknown zone: %v %q", err, zone())
	}
	empty := ""
	s.TimeZone = &empty
	if err := store.UpdateSystemSettings(s); err != nil || zone() != "" {
		t.Fatalf("reset: %v %q", err, zone())
	}
}
