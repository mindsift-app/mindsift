package storage

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestTaskAssigneesFollowListAccess(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "assignees.db"))
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	owner, _ := store.EnsureDefaultUser()
	direct, _ := store.CreateUser("direct@example.com", "hash", "Direkt", "member")
	viaTeam, _ := store.CreateUser("team@example.com", "hash", "Team", "member")
	stranger, _ := store.CreateUser("stranger@example.com", "hash", "Fremd", "member")

	tl, err := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "")
	if err != nil {
		t.Fatalf("CreateTaskList failed: %v", err)
	}
	task, err := store.CreateThoughtWithDetails(owner.ID, "Fenster putzen", "normal", "manual", "", tl.ID, "todo", "")
	if err != nil {
		t.Fatalf("CreateThoughtWithDetails failed: %v", err)
	}
	if _, err := store.UpdateThoughtTriage(owner.ID, task.ID, "keep", "task", "", "", tl.ID); err != nil {
		t.Fatalf("UpdateThoughtTriage failed: %v", err)
	}

	// Everyone but the stranger shares the organization, so they can see each other
	org, _ := store.CreateOrganization("Familie")
	for _, u := range []string{owner.ID, direct.ID, viaTeam.ID} {
		if err := store.SetUserOrganization(u, org.ID); err != nil {
			t.Fatalf("SetUserOrganization failed: %v", err)
		}
	}
	team, err := store.CreateTeam(org.ID, "WG", "")
	if err != nil {
		t.Fatalf("CreateTeam failed: %v", err)
	}
	_ = store.AddTeamMember(team.ID, owner.ID, "admin")
	_ = store.AddTeamMember(team.ID, viaTeam.ID, "member")
	if _, err := store.AddTaskListShare(tl.ID, "user", direct.ID, "editor", owner.ID); err != nil {
		t.Fatalf("AddTaskListShare user failed: %v", err)
	}
	if _, err := store.AddTaskListShare(tl.ID, "team", team.ID, "viewer", owner.ID); err != nil {
		t.Fatalf("AddTaskListShare team failed: %v", err)
	}

	if _, err := store.SetTaskAssignees(owner.ID, task.ID, []string{stranger.ID}); !errors.Is(err, ErrAssigneeNoAccess) {
		t.Fatalf("assigning someone without access must fail, got %v", err)
	}
	if _, err := store.SetTaskAssignees(viaTeam.ID, task.ID, []string{viaTeam.ID}); !errors.Is(err, ErrTaskListReadOnly) {
		t.Fatalf("viewer must not assign, got %v", err)
	}
	got, err := store.SetTaskAssignees(direct.ID, task.ID, []string{owner.ID, direct.ID, viaTeam.ID, direct.ID})
	if err != nil || len(got) != 3 {
		t.Fatalf("expected 3 assignees, got %v (%v)", got, err)
	}

	tasks, _ := store.GetTasks(owner.ID, tl.ID)
	if len(tasks) != 1 || len(tasks[0].Assignees) != 3 {
		t.Fatalf("GetTasks should carry assignees, got %+v", tasks)
	}

	// Leaving the team removes the team member's assignment
	if err := store.RemoveTeamMember(team.ID, viaTeam.ID); err != nil {
		t.Fatalf("RemoveTeamMember failed: %v", err)
	}
	assertAssignees(t, store, owner.ID, task.ID, owner.ID, direct.ID)

	// Removing the direct share removes that user's assignment, the owner stays
	if err := store.RemoveTaskListShare(tl.ID, direct.ID); err != nil {
		t.Fatalf("RemoveTaskListShare failed: %v", err)
	}
	assertAssignees(t, store, owner.ID, task.ID, owner.ID)

	// Access through a second path keeps the assignment
	_ = store.AddTeamMember(team.ID, direct.ID, "member")
	_, _ = store.AddTaskListShare(tl.ID, "user", direct.ID, "editor", owner.ID)
	if _, err := store.SetTaskAssignees(owner.ID, task.ID, []string{owner.ID, direct.ID}); err != nil {
		t.Fatalf("re-assign failed: %v", err)
	}
	_ = store.RemoveTaskListShare(tl.ID, direct.ID)
	assertAssignees(t, store, owner.ID, task.ID, owner.ID, direct.ID)

	// Deleting the team takes the last path away
	if err := store.DeleteTeam(team.ID); err != nil {
		t.Fatalf("DeleteTeam failed: %v", err)
	}
	assertAssignees(t, store, owner.ID, task.ID, owner.ID)

	// Moving the task out of the list drops all assignments
	empty := ""
	if _, err := store.UpdateThoughtDetails(owner.ID, task.ID, nil, nil, nil, nil, &empty, nil, nil, nil, nil); err != nil {
		t.Fatalf("UpdateThoughtDetails failed: %v", err)
	}
	assertAssignees(t, store, owner.ID, task.ID)
}

func assertAssignees(t *testing.T, store *Store, viewerID, taskID string, want ...string) {
	t.Helper()
	th, err := store.GetThoughtByID(viewerID, taskID)
	if err != nil {
		t.Fatalf("GetThoughtByID failed: %v", err)
	}
	if len(th.Assignees) != len(want) {
		t.Fatalf("expected assignees %v, got %v", want, th.Assignees)
	}
	have := map[string]bool{}
	for _, id := range th.Assignees {
		have[id] = true
	}
	for _, id := range want {
		if !have[id] {
			t.Fatalf("expected assignees %v, got %v", want, th.Assignees)
		}
	}
}

// The open-task counter (nav badge, "Alle Aufgaben") counts what "Alle Aufgaben" shows,
// including tasks others created in a shared list
func TestDashboardCountsTasksOfSharedLists(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "stats.db"))
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	owner, _ := store.CreateUser("owner@example.com", "hash", "Owner", "member")
	member, _ := store.CreateUser("member@example.com", "hash", "Member", "member")
	tl, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "")
	if _, err := store.AddTaskListShare(tl.ID, "user", member.ID, "editor", owner.ID); err != nil {
		t.Fatalf("share: %v", err)
	}
	for i, title := range []string{"Bad putzen", "Müll raus"} {
		th, _ := store.CreateThoughtWithDetails(owner.ID, title, "normal", "manual", "", tl.ID, "todo", "")
		_, _ = store.UpdateThoughtTriage(owner.ID, th.ID, "keep", "task", "", "", tl.ID)
		if i == 1 {
			done := true
			_, _ = store.UpdateThoughtDetails(owner.ID, th.ID, nil, &done, nil, nil, nil, nil, nil, nil, nil)
		}
	}
	own, _ := store.CreateThoughtWithDetails(member.ID, "Eigene Aufgabe", "normal", "manual", "", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(member.ID, own.ID, "keep", "task", "", "", "")

	st, err := store.GetDashboardStats(member.ID)
	if err != nil {
		t.Fatalf("GetDashboardStats: %v", err)
	}
	tasks, _ := store.GetTasks(member.ID, "")
	open := 0
	for _, task := range tasks {
		if !task.IsCompleted {
			open++
		}
	}
	if st.TasksOpenCount != 2 || st.TasksOpenCount != open || st.TasksDoneCount != 1 {
		t.Fatalf("expected 2 open / 1 done matching GetTasks (%d open), got %d / %d", open, st.TasksOpenCount, st.TasksDoneCount)
	}
}
