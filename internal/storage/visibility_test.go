package storage

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func setSharingMode(t *testing.T, store *Store, mode string) {
	t.Helper()
	sys, _ := store.GetSystemSettings()
	sys.SharingMode = mode
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatalf("UpdateSystemSettings: %v", err)
	}
}

func TestVisibilityFollowsOrganizations(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "visibility.db"))
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()
	if store.SharingMode() != SharingOrganizations {
		t.Fatalf("default mode should be organizations, got %q", store.SharingMode())
	}

	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	carl, _ := store.CreateUser("carl@example.com", "hash", "Carl", "admin")
	dora, _ := store.CreateUser("dora@example.com", "hash", "Dora", "member")
	org1, _ := store.CreateOrganization("Familie")
	org2, _ := store.CreateOrganization("Firma")
	_ = store.AddOrganizationMember(org1.ID, anna.ID)
	_ = store.AddOrganizationMember(org1.ID, ben.ID)
	_ = store.AddOrganizationMember(org2.ID, carl.ID)

	// Who sees whom (server admins follow the same rule)
	cases := []struct {
		a, b *domain.User
		want bool
	}{
		{anna, ben, true}, {ben, anna, true}, {anna, carl, false}, {carl, anna, false},
		{dora, anna, false}, {anna, dora, false}, {dora, dora, true},
	}
	for _, c := range cases {
		if got := store.CanSee(c.a.ID, c.b.ID); got != c.want {
			t.Errorf("CanSee(%s, %s) = %v, want %v", c.a.DisplayName, c.b.DisplayName, got, c.want)
		}
	}
	if users, _ := store.GetDiscoverableUsers(anna.ID); len(users) != 2 {
		t.Errorf("Anna should see herself and Ben, got %d users", len(users))
	}
	if users, _ := store.GetDiscoverableUsers(dora.ID); len(users) != 1 || users[0].ID != dora.ID {
		t.Errorf("Dora without organization should only see herself, got %+v", users)
	}

	// Sharing: visible people only; an invisible e-mail looks like an unknown one
	doc, _ := store.CreateDocument(anna.ID, "", "Einkauf", "🗒️", "", nil, nil, false)
	if _, err := store.CreateDocShare(anna.ID, doc.ID, ben.ID, "write"); err != nil {
		t.Fatalf("share with Ben failed: %v", err)
	}
	if _, err := store.CreateDocShare(anna.ID, doc.ID, "carl@example.com", "read"); !errors.Is(err, ErrTargetNotFound) {
		t.Errorf("share with invisible Carl must look like not found, got %v", err)
	}
	if _, err := store.CreateDocShare(anna.ID, doc.ID, "nobody@example.com", "read"); !errors.Is(err, ErrTargetNotFound) {
		t.Errorf("share with unknown address must be not found, got %v", err)
	}

	// Only the owner shares a list
	list, _ := store.CreateList(anna.ID, "Wocheneinkauf", "🛒", "shopping")
	if _, err := store.AddListShare(anna.ID, list.ID, "user", ben.ID, "editor"); err != nil {
		t.Fatalf("list share with Ben failed: %v", err)
	}
	if _, err := store.AddListShare(ben.ID, list.ID, "user", anna.ID, "editor"); err == nil {
		t.Errorf("an editor must not reshare a list")
	}

	// Groups: only members may share with them
	team, _ := store.CreateTeam(org1.ID, "WG", "")
	_ = store.AddTeamMember(team.ID, anna.ID, "admin")
	_ = store.AddTeamMember(team.ID, ben.ID, "member")
	tl, _ := store.CreateTaskList(anna.ID, "", "", "Haushalt", "🏠", "")
	if _, err := store.AddTaskListShare(tl.ID, "team", team.ID, "editor", anna.ID); err != nil {
		t.Fatalf("group share failed: %v", err)
	}
	carlList, _ := store.CreateTaskList(carl.ID, "", "", "Fremd", "🔒", "")
	if _, err := store.AddTaskListShare(carlList.ID, "team", team.ID, "editor", carl.ID); !errors.Is(err, ErrTargetNotFound) {
		t.Errorf("non-member must not share with a group, got %v", err)
	}
	task, _ := store.CreateThoughtWithDetails(anna.ID, "Bad putzen", "normal", "manual", "", tl.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "", tl.ID)
	if _, err := store.SetTaskAssignees(anna.ID, task.ID, []string{ben.ID}); err != nil {
		t.Fatalf("assign Ben failed: %v", err)
	}

	// A dry run counts without changing anything
	n, err := store.PruneSharing(SharingPrivate, true)
	if err != nil || n == 0 {
		t.Fatalf("dry run should report affected rows, got %d (%v)", n, err)
	}
	if shares, _ := store.GetDocShares(doc.ID); len(shares) != 1 {
		t.Fatalf("dry run must not remove shares")
	}

	// Ben moves to the other organization: he loses shares, group and assignment
	if err := store.AddOrganizationMember(org2.ID, ben.ID); err != nil {
		t.Fatalf("AddOrganizationMember failed: %v", err)
	}
	if err := store.RemoveOrganizationMember(org1.ID, ben.ID); err != nil {
		t.Fatalf("RemoveOrganizationMember failed: %v", err)
	}
	if shares, _ := store.GetDocShares(doc.ID); len(shares) != 0 {
		t.Errorf("doc share with Ben should be gone, got %+v", shares)
	}
	if l, _ := store.GetListByID(anna.ID, list.ID); len(l.Shares) != 0 {
		t.Errorf("list share with Ben should be gone, got %+v", l.Shares)
	}
	if members, _ := store.GetTeamMembers(team.ID); len(members) != 1 {
		t.Errorf("Ben should have left the group, members: %+v", members)
	}
	if th, _ := store.GetThoughtByID(anna.ID, task.ID); len(th.Assignees) != 0 {
		t.Errorf("Ben's assignment should be gone, got %v", th.Assignees)
	}

	// Open mode: everyone sees everyone
	setSharingMode(t, store, SharingOpen)
	if !store.CanSee(anna.ID, carl.ID) || !store.CanSee(dora.ID, anna.ID) {
		t.Errorf("open mode should make everyone visible")
	}

	// Private mode: no sharing at all, groups disappear
	if _, err := store.PruneSharing(SharingPrivate, false); err != nil {
		t.Fatalf("PruneSharing private failed: %v", err)
	}
	setSharingMode(t, store, SharingPrivate)
	if store.CanSee(anna.ID, ben.ID) || store.CanShareWith(anna.ID, "team", team.ID) {
		t.Errorf("private mode must not allow seeing or sharing")
	}
	if tls, _ := store.GetTaskListShares(tl.ID); len(tls) != 0 {
		t.Errorf("private mode should remove all task list shares, got %+v", tls)
	}
	if _, err := store.GetTeamByID(team.ID); err == nil {
		t.Errorf("groups should be gone in private mode")
	}
}

// Existing data must survive a restart, whatever user_version the database carries.
func TestDataSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keep.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	_, _ = store.CreateUser("old@example.com", "hash", "Alt", "member")
	_, _ = store.db.Exec(`PRAGMA user_version = 1`)
	_ = store.Close()

	store, err = NewStore(path)
	if err != nil {
		t.Fatalf("reopen failed: %v", err)
	}
	defer store.Close()
	if n, _ := store.CountUsers(); n != 1 {
		t.Fatalf("data must be kept on restart, found %d users", n)
	}
	var v int
	_ = store.db.QueryRow(`PRAGMA user_version`).Scan(&v)
	if want := migrations[len(migrations)-1].id; v != want {
		t.Fatalf("user_version = %d, want %d", v, want)
	}
}

func TestListItemsNeedWriteAccess(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "listacl.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	eve, _ := store.CreateUser("eve@example.com", "hash", "Eve", "member")
	list, _ := store.CreateList(anna.ID, "Einkauf", "", "shopping")
	item, _ := store.CreateListItem(list.ID, "Milch", "", "", 0, anna.ID)
	other, _ := store.CreateList(eve.ID, "Eves Liste", "", "shopping")
	otherItem, _ := store.CreateListItem(other.ID, "Geheim", "", "", 0, eve.ID)
	_, _ = store.AddListShare(anna.ID, list.ID, "user", ben.ID, "viewer")

	if err := store.EnsureListItemsWritable(anna.ID, list.ID, item.ID); err != nil {
		t.Errorf("owner must write: %v", err)
	}
	if err := store.EnsureListItemsWritable(ben.ID, list.ID, item.ID); err != ErrListReadOnly {
		t.Errorf("viewer must be read-only, got %v", err)
	}
	if err := store.EnsureListItemsWritable(eve.ID, list.ID, ""); err != ErrListNotFound {
		t.Errorf("stranger must not see the list, got %v", err)
	}
	if err := store.EnsureListItemsWritable(anna.ID, list.ID, otherItem.ID); err != ErrListNotFound {
		t.Errorf("an item of another list must not be reachable through my list, got %v", err)
	}
	// Turning a thought into an item of someone else's list is refused as well
	th, _ := store.CreateThoughtWithDetails(eve.ID, "Spam", "normal", "manual", "", "", "todo", "")
	if _, err := store.UpdateThoughtTriage(eve.ID, th.ID, "keep", "list_item", list.ID, "", ""); err == nil {
		t.Errorf("thought must not become an item of a list without write access")
	}
}

func TestSeveralOrganizations(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "orgs.db"))
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	carl, _ := store.CreateUser("carl@example.com", "hash", "Carl", "member")
	family, _ := store.CreateOrganization("Familie")
	work, _ := store.CreateOrganization("Firma")
	_ = store.AddOrganizationMember(family.ID, anna.ID)
	_ = store.AddOrganizationMember(family.ID, ben.ID)
	_ = store.AddOrganizationMember(work.ID, ben.ID)
	_ = store.AddOrganizationMember(work.ID, carl.ID)

	// Ben is in both: he sees everyone, Anna and Carl do not see each other
	cases := []struct {
		a, b *domain.User
		want bool
	}{{ben, anna, true}, {ben, carl, true}, {anna, carl, false}, {carl, anna, false}}
	for _, c := range cases {
		if got := store.CanSee(c.a.ID, c.b.ID); got != c.want {
			t.Errorf("CanSee(%s, %s) = %v, want %v", c.a.DisplayName, c.b.DisplayName, got, c.want)
		}
	}
	if ids := store.UserOrganizationIDs(ben.ID); len(ids) != 2 {
		t.Errorf("Ben should be in two organizations, got %v", ids)
	}

	// Ben shares one note with both; Anna's group lives in the family
	doc, _ := store.CreateDocument(ben.ID, "", "Anleitung", "🗒️", "", nil, nil, false)
	if _, err := store.CreateDocShare(ben.ID, doc.ID, anna.ID, "read"); err != nil {
		t.Fatalf("share with Anna: %v", err)
	}
	if _, err := store.CreateDocShare(ben.ID, doc.ID, carl.ID, "read"); err != nil {
		t.Fatalf("share with Carl: %v", err)
	}
	team, _ := store.CreateTeam(family.ID, "WG", "")
	_ = store.AddTeamMember(team.ID, anna.ID, "admin")
	_ = store.AddTeamMember(team.ID, ben.ID, "member")
	if store.FitsTeamOrganization(team.ID, carl.ID) {
		t.Errorf("Carl is not in the family and must not join its group")
	}

	// Preview: leaving the company costs Ben only the share with Carl
	n, err := store.RemoveOrganizationMemberImpact(work.ID, ben.ID)
	if err != nil || n != 1 {
		t.Fatalf("impact of leaving the company = %d (%v), want 1", n, err)
	}
	if shares, _ := store.GetDocShares(doc.ID); len(shares) != 2 {
		t.Fatalf("the preview must not change anything, shares: %+v", shares)
	}

	// Leaving the family takes the share with Anna and the group, the company keeps Carl
	if err := store.RemoveOrganizationMember(family.ID, ben.ID); err != nil {
		t.Fatalf("RemoveOrganizationMember: %v", err)
	}
	shares, _ := store.GetDocShares(doc.ID)
	if len(shares) != 1 || shares[0].UserID != carl.ID {
		t.Errorf("only the share with Carl should be left, got %+v", shares)
	}
	if members, _ := store.GetTeamMembers(team.ID); len(members) != 1 {
		t.Errorf("Ben should have left the family group, members: %+v", members)
	}

	// Deleting the organization frees its members
	if err := store.DeleteOrganization(work.ID); err != nil {
		t.Fatalf("DeleteOrganization: %v", err)
	}
	if store.CanSee(ben.ID, carl.ID) {
		t.Errorf("without a common organization Ben and Carl must not see each other")
	}
}
