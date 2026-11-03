package storage

import (
	"path/filepath"
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
