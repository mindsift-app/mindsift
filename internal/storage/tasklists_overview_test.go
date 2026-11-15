package storage

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The task-list overview before it was batched: about eight queries per list. Kept as the reference the
// batched GetTaskLists must answer exactly like (TestTaskListOverviewMatchesPerListQueries) and as the
// "before" of BenchmarkTaskLists.
func (s *Store) getTaskListsPerList(userID string) ([]domain.TaskList, error) {
	defaultCols := defaultColumns(s.MessageLanguage(userID))
	order := s.listOrder(userID, ListOrderTaskLists)
	rows, err := s.db.Query(
		`SELECT id, user_id, space_id, title, icon, color, COALESCE(columns, '[]'), created_at, updated_at
		 FROM task_lists
		 WHERE id IN (`+accessibleTaskListsSQL+`)
		 ORDER BY updated_at DESC`,
		accessibleTaskListArgs(userID)...,
	)
	if err != nil {
		return nil, err
	}
	list := make([]domain.TaskList, 0)
	for rows.Next() {
		var tl domain.TaskList
		var colsJSON string
		if err := rows.Scan(&tl.ID, &tl.UserID, &tl.SpaceID, &tl.Title, &tl.Icon, &tl.Color, &colsJSON, &tl.CreatedAt, &tl.UpdatedAt); err == nil {
			tl.IsOwner = (tl.UserID == userID)
			_ = json.Unmarshal([]byte(colsJSON), &tl.Columns)
			if len(tl.Columns) == 0 {
				tl.Columns = defaultCols
			}
			list = append(list, tl)
		}
	}
	_ = rows.Close()
	for i := range list {
		_ = s.db.QueryRow(
			`SELECT COUNT(*) FROM thoughts WHERE task_list_id = ? AND is_completed = 0 AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))`,
			list[i].ID,
		).Scan(&list[i].TasksCount)
		_ = s.db.QueryRow(`SELECT display_name FROM users WHERE id = ?`, list[i].UserID).Scan(&list[i].OwnerName)
		list[i].Shares = s.sharesPerList(list[i].ID)
		list[i].Permission = s.GetTaskListPermission(userID, list[i].ID)
		list[i].Members = s.membersPerList(&list[i])
	}
	sortByListOrder(list, order, taskListID)
	return list, nil
}

func (s *Store) sharesPerList(taskListID string) []domain.TaskListShare {
	rows, err := s.db.Query(
		`SELECT id, task_list_id, target_type, target_id, permission, created_at
		 FROM task_list_shares WHERE task_list_id = ? ORDER BY created_at ASC`,
		taskListID,
	)
	shares := make([]domain.TaskListShare, 0)
	if err != nil {
		return shares
	}
	for rows.Next() {
		var sh domain.TaskListShare
		if rows.Scan(&sh.ID, &sh.TaskListID, &sh.TargetType, &sh.TargetID, &sh.Permission, &sh.CreatedAt) == nil {
			shares = append(shares, sh)
		}
	}
	_ = rows.Close()
	for i := range shares {
		if shares[i].TargetType == "team" {
			_ = s.db.QueryRow(`SELECT name FROM teams WHERE id = ?`, shares[i].TargetID).Scan(&shares[i].TargetName)
		} else {
			_ = s.db.QueryRow(`SELECT display_name, email, avatar_url FROM users WHERE id = ?`, shares[i].TargetID).Scan(&shares[i].TargetName, &shares[i].Email, &shares[i].AvatarURL)
		}
	}
	return shares
}

// membersPerList: the members in no particular order (they came from a map).
func (s *Store) membersPerList(tl *domain.TaskList) []domain.TaskListMember {
	memberMap := make(map[string]domain.TaskListMember)
	var m0 domain.TaskListMember
	_ = s.db.QueryRow(`SELECT display_name, email, avatar_url FROM users WHERE id = ?`, tl.UserID).Scan(&m0.DisplayName, &m0.Email, &m0.AvatarURL)
	m0.UserID, m0.Role = tl.UserID, "owner"
	memberMap[tl.UserID] = m0
	for _, sh := range tl.Shares {
		switch sh.TargetType {
		case "team":
			rows, err := s.db.Query(`SELECT u.id, u.display_name, u.email, u.avatar_url FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ?`, sh.TargetID)
			if err == nil {
				for rows.Next() {
					var m domain.TaskListMember
					if rows.Scan(&m.UserID, &m.DisplayName, &m.Email, &m.AvatarURL) == nil {
						m.Role = "member"
						memberMap[m.UserID] = m
					}
				}
				_ = rows.Close()
			}
		case "user":
			var m domain.TaskListMember
			if s.db.QueryRow(`SELECT id, display_name, email, avatar_url FROM users WHERE id = ?`, sh.TargetID).Scan(&m.UserID, &m.DisplayName, &m.Email, &m.AvatarURL) == nil {
				m.Role = "member"
				memberMap[m.UserID] = m
			}
		}
	}
	out := make([]domain.TaskListMember, 0, len(memberMap))
	for _, m := range memberMap {
		out = append(out, m)
	}
	return out
}

// normalizeMembers sorts the members by id, as the old answer had no order. The old one also called
// the owner a "member" when they belonged to a team the list was shared with; the owner stays the
// owner now.
func normalizeMembers(lists []domain.TaskList) {
	for i := range lists {
		for j := range lists[i].Members {
			if lists[i].Members[j].UserID == lists[i].UserID {
				lists[i].Members[j].Role = "owner"
			}
		}
		sort.Slice(lists[i].Members, func(a, b int) bool { return lists[i].Members[a].UserID < lists[i].Members[b].UserID })
	}
}

// seedTaskListOverview: lists of anna shared with people and teams (editor and viewer, the viewer also
// as editor through a team), lists of others shared with anna, open, completed and inbox tasks, a share
// with a removed team, and a muted list.
func seedTaskListOverview(t testing.TB, s *Store, extraLists int) (anna, ben, carla *domain.User) {
	t.Helper()
	sys, _ := s.GetSystemSettings()
	sys.SharingMode = SharingOpen
	_ = s.UpdateSystemSettings(sys)
	anna, _ = s.CreateUser("anna@example.com", "h", "Anna", "member")
	ben, _ = s.CreateUser("ben@example.com", "h", "Ben", "member")
	carla, _ = s.CreateUser("carla@example.com", "h", "carla", "member")
	dora, _ := s.CreateUser("dora@example.com", "h", "Dora", "member")
	_, _ = s.db.Exec(`UPDATE users SET avatar_url = '/avatars/ben.webp' WHERE id = ?`, ben.ID)
	team, _ := s.CreateTeam("", "Team A", "")
	_ = s.AddTeamMember(team.ID, anna.ID, "member")
	_ = s.AddTeamMember(team.ID, carla.ID, "member")
	_ = s.AddTeamMember(team.ID, dora.ID, "member")
	_ = s.AddTeamMember(team.ID, ben.ID, "member") // so he may share with the team
	team2, _ := s.CreateTeam("", "Team B", "")
	_ = s.AddTeamMember(team2.ID, ben.ID, "member")
	_ = s.AddTeamMember(team2.ID, dora.ID, "member")

	mk := func(owner *domain.User, title string, open, done int) *domain.TaskList {
		tl, err := s.CreateTaskList(owner.ID, "", "", title, "", "")
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < open+done; i++ {
			th, err := s.CreateThoughtWithDetails(owner.ID, fmt.Sprintf("%s %d", title, i), "", "manual", "", tl.ID, "todo", "")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = s.db.Exec(`UPDATE thoughts SET status = 'kept', is_completed = ? WHERE id = ?`, boolInt(i >= open), th.ID)
		}
		return tl
	}
	solo := mk(anna, "Allein", 3, 2)
	shared := mk(anna, "Geteilt", 4, 1)
	_, _ = s.AddTaskListShare(shared.ID, "user", ben.ID, "editor", anna.ID)
	_, _ = s.AddTaskListShare(shared.ID, "user", carla.ID, "viewer", anna.ID)
	_, _ = s.AddTaskListShare(shared.ID, "team", team.ID, "editor", anna.ID) // anna (owner) is in team A
	fromBen := mk(ben, "Von Ben", 2, 0)
	_, _ = s.AddTaskListShare(fromBen.ID, "user", anna.ID, "viewer", ben.ID)
	_, _ = s.AddTaskListShare(fromBen.ID, "team", team.ID, "editor", ben.ID) // editor through the team wins
	viewOnly := mk(carla, "Nur lesen", 1, 1)
	_, _ = s.AddTaskListShare(viewOnly.ID, "team", team.ID, "viewer", carla.ID)
	gone := mk(dora, "Team weg", 0, 0)
	_, _ = s.AddTaskListShare(gone.ID, "user", anna.ID, "editor", dora.ID)
	_, _ = s.AddTaskListShare(gone.ID, "team", team2.ID, "viewer", dora.ID)
	_, _ = s.db.Exec(`DELETE FROM team_members WHERE team_id = ?`, team2.ID)
	_, _ = s.db.Exec(`DELETE FROM teams WHERE id = ?`, team2.ID) // a share whose team no longer exists
	_ = s.SetTaskListMuted(anna.ID, fromBen.ID, true)
	// An inbox thought of anna that is not a task, in the solo list
	_, _ = s.CreateThoughtWithDetails(anna.ID, "Noch nicht sortiert", "", "manual", "", solo.ID, "todo", "")
	for i := 0; i < extraLists; i++ {
		tl := mk(anna, fmt.Sprintf("Mehr %d", i), 5, 3)
		if i%2 == 0 {
			_, _ = s.AddTaskListShare(tl.ID, "user", ben.ID, "editor", anna.ID)
		}
		if i%3 == 0 {
			_, _ = s.AddTaskListShare(tl.ID, "team", team.ID, "viewer", anna.ID)
		}
	}
	return anna, ben, carla
}

func TestTaskListOverviewMatchesPerListQueries(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "tl.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	anna, ben, carla := seedTaskListOverview(t, s, 4)

	for _, u := range []*domain.User{anna, ben, carla} {
		want, err := s.getTaskListsPerList(u.ID)
		if err != nil {
			t.Fatal(err)
		}
		got, err := s.GetTaskLists(u.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) == 0 {
			t.Fatalf("%s: no lists", u.DisplayName)
		}
		// The owner comes first, the others by name
		for _, tl := range got {
			if tl.Members[0].UserID != tl.UserID || tl.Members[0].Role != "owner" {
				t.Fatalf("%s: owner not first: %+v", tl.Title, tl.Members)
			}
		}
		normalizeMembers(want)
		normalizeMembers(got)
		if !reflect.DeepEqual(got, want) {
			gj, _ := json.MarshalIndent(got, "", " ")
			wj, _ := json.MarshalIndent(want, "", " ")
			t.Fatalf("%s: batched overview differs\n got: %s\nwant: %s", u.DisplayName, gj, wj)
		}
		// One list by id answers the same as in the overview
		for _, tl := range got {
			one, err := s.GetTaskListByID(u.ID, tl.ID)
			if err != nil {
				t.Fatal(err)
			}
			single := []domain.TaskList{*one}
			normalizeMembers(single)
			if !reflect.DeepEqual(single[0], tl) {
				t.Fatalf("%s: GetTaskListByID differs from the overview: %+v vs %+v", tl.Title, single[0], tl)
			}
			if sh, _ := s.GetTaskListShares(tl.ID); !reflect.DeepEqual(sh, tl.Shares) {
				t.Fatalf("%s: GetTaskListShares differs: %+v vs %+v", tl.Title, sh, tl.Shares)
			}
		}
	}

	// Spot checks on what the comparison covers
	lists, _ := s.GetTaskLists(anna.ID)
	byTitle := map[string]domain.TaskList{}
	for _, tl := range lists {
		byTitle[tl.Title] = tl
	}
	if tl := byTitle["Geteilt"]; tl.TasksCount != 4 || len(tl.Shares) != 3 || len(tl.Members) != 4 || tl.Members[1].DisplayName != "Ben" || tl.Members[2].DisplayName != "carla" || tl.Permission != "owner" {
		t.Fatalf("Geteilt: %+v", tl)
	}
	if tl := byTitle["Von Ben"]; tl.Permission != "editor" || tl.OwnerName != "Ben" || tl.IsOwner {
		t.Fatalf("Von Ben: %+v", tl)
	}
	if tl := byTitle["Nur lesen"]; tl.Permission != "viewer" {
		t.Fatalf("Nur lesen: %+v", tl)
	}
	if tl := byTitle["Team weg"]; len(tl.Shares) != 2 || tl.Shares[1].TargetName != "" || len(tl.Members) != 2 {
		t.Fatalf("Team weg: %+v", tl)
	}
	if tl := byTitle["Allein"]; tl.TasksCount != 3 || len(tl.Shares) != 0 || tl.Shares == nil || len(tl.Members) != 1 {
		t.Fatalf("Allein: %+v", tl)
	}
	if muted := s.MutedTaskListIDs(anna.ID); !muted[byTitle["Von Ben"].ID] || len(muted) != 1 {
		t.Fatalf("muted lists: %v", muted)
	}
}

// BenchmarkTaskLists: the task-list overview of a person with 60 lists (half shared with a person, a
// third with a team, 8 tasks each), per list ("before") and batched. Run with
//
//	go test -run XXX -bench BenchmarkTaskLists ./internal/storage/
func BenchmarkTaskLists(b *testing.B) {
	s, err := NewStore(filepath.Join(b.TempDir(), "bench.db"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = s.Close() })
	anna, _, _ := seedTaskListOverview(b, s, 55)
	lists, _ := s.GetTaskLists(anna.ID)
	if len(lists) != 60 {
		b.Fatalf("%d lists, want 60", len(lists))
	}
	b.ResetTimer()
	b.Run("per-list", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := s.getTaskListsPerList(anna.ID); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("batched", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := s.GetTaskLists(anna.ID); err != nil {
				b.Fatal(err)
			}
		}
	})
}
