package storage

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// --- ORGANIZATIONS & TEAMS ---

func (s *Store) CreateTeam(orgID, name, description string) (*domain.Team, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("team name required")
	}
	orgID = strings.TrimSpace(orgID)

	team := &domain.Team{
		ID:          domain.NewID("team"),
		OrgID:       orgID,
		Name:        name,
		Description: strings.TrimSpace(description),
		Members:     []domain.TeamMember{},
		CreatedAt:   domain.NowISO(),
	}
	_, err := s.db.Exec(
		`INSERT INTO teams (id, org_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)`,
		team.ID, team.OrgID, team.Name, team.Description, team.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return team, nil
}

func (s *Store) DeleteTeam(teamID string) error {
	_, err := s.db.Exec(`DELETE FROM teams WHERE id = ?`, teamID)
	s.pruneSharingNow()
	return err
}

func (s *Store) GetTeamByID(teamID string) (*domain.Team, error) {
	var t domain.Team
	err := s.db.QueryRow(
		`SELECT id, org_id, name, description, created_at FROM teams WHERE id = ?`,
		teamID,
	).Scan(&t.ID, &t.OrgID, &t.Name, &t.Description, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	if t.Members, err = s.GetTeamMembers(t.ID); err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) GetTeamsForUser(userID string) ([]domain.Team, error) {
	rows, err := s.db.Query(
		`SELECT DISTINCT t.id, t.org_id, t.name, t.description, t.created_at
		 FROM teams t
		 JOIN team_members tm ON tm.team_id = t.id
		 WHERE tm.user_id = ?
		 ORDER BY t.created_at ASC`,
		userID,
	)
	if err != nil {
		return []domain.Team{}, err
	}

	teams := make([]domain.Team, 0)
	for rows.Next() {
		var t domain.Team
		if err := rows.Scan(&t.ID, &t.OrgID, &t.Name, &t.Description, &t.CreatedAt); !dbFailed(err) {
			t.Members = []domain.TeamMember{}
			teams = append(teams, t)
		}
	}
	if err := rows.Err(); err != nil {
		return []domain.Team{}, err
	}
	_ = rows.Close()

	for i := range teams {
		members, _ := s.GetTeamMembers(teams[i].ID)
		teams[i].Members = members
	}
	return teams, nil
}

func (s *Store) UpdateTeam(teamID, name, description string) (*domain.Team, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("Name für die Gruppe ist erforderlich")
	}
	_, err := s.db.Exec(`UPDATE teams SET name = ?, description = ? WHERE id = ?`, name, strings.TrimSpace(description), teamID)
	if err != nil {
		return nil, err
	}
	return s.GetTeamByID(teamID)
}

func (s *Store) GetTeamMemberRole(teamID, userID string) (string, error) {
	var role string
	err := s.db.QueryRow(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, teamID, userID).Scan(&role)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return role, nil
}

func (s *Store) CountTeamAdmins(teamID string) (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM team_members WHERE team_id = ? AND role = 'admin'`, teamID).Scan(&count)
	return count, err
}

func (s *Store) AddTeamMember(teamID, userID, role string) error {
	role = strings.ToLower(strings.TrimSpace(role))
	if !domain.ValidTeamRole(role) {
		role = domain.TeamRoleMember
	}
	_, err := s.db.Exec(
		`INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role`,
		teamID, userID, role, domain.NowISO(),
	)
	return err
}

func (s *Store) UpdateTeamMemberRole(teamID, userID, role string) error {
	role = strings.ToLower(strings.TrimSpace(role))
	if !domain.ValidTeamRole(role) {
		return errors.New("Ungültige Rolle (erlaubt sind: admin, member)")
	}
	currentRole, err := s.GetTeamMemberRole(teamID, userID)
	if err != nil {
		return err
	}
	if currentRole == "" {
		return errors.New("Benutzer ist kein Mitglied dieser Gruppe")
	}
	if currentRole == domain.TeamRoleAdmin && role != domain.TeamRoleAdmin {
		adminCount, err := s.CountTeamAdmins(teamID)
		if err != nil {
			return err
		}
		if adminCount <= 1 {
			return errors.New("Die Gruppe muss mindestens einen Gruppen-Admin behalten")
		}
	}
	_, err = s.db.Exec(`UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?`, role, teamID, userID)
	return err
}

func (s *Store) RemoveTeamMember(teamID, userID string) error {
	currentRole, err := s.GetTeamMemberRole(teamID, userID)
	if err != nil {
		return err
	}
	if currentRole == domain.TeamRoleAdmin {
		adminCount, err := s.CountTeamAdmins(teamID)
		if err != nil {
			return err
		}
		if adminCount <= 1 {
			return errors.New("Du bist der letzte Gruppen-Admin. Bitte ernenne zuerst einen anderen Admin oder lösche die Gruppe.")
		}
	}
	_, err = s.db.Exec(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, teamID, userID)
	// Whoever leaves a group also loses the shares they made with it
	s.pruneSharingNow()
	return err
}

func (s *Store) GetTeamMembers(teamID string) ([]domain.TeamMember, error) {
	rows, err := s.db.Query(
		`SELECT tm.team_id, tm.user_id, u.display_name, u.email, u.avatar_url, tm.role, tm.joined_at
		 FROM team_members tm
		 JOIN users u ON u.id = tm.user_id
		 WHERE tm.team_id = ?
		 ORDER BY tm.joined_at ASC`,
		teamID,
	)
	if err != nil {
		return []domain.TeamMember{}, err
	}
	defer rows.Close()

	members := make([]domain.TeamMember, 0)
	for rows.Next() {
		var m domain.TeamMember
		if err := rows.Scan(&m.TeamID, &m.UserID, &m.DisplayName, &m.Email, &m.AvatarURL, &m.Role, &m.JoinedAt); !dbFailed(err) {
			members = append(members, m)
		}
	}
	if err := rows.Err(); err != nil {
		return []domain.TeamMember{}, err
	}
	return members, nil
}

// TeamShares is what is shared with a group: task lists, lists, notes and shared folders (ids). Lists
// maps each list to the id of its share with the group.
type TeamShares struct {
	TaskLists []string
	Lists     map[string]string
	Docs      []string
	Folders   []string
}

// GetTeamShares lists what is shared with a group, so a change of its members can tell the people who
// gain or lose it (queryUserIDs collects any one column of distinct ids).
func (s *Store) GetTeamShares(teamID string) TeamShares {
	out := TeamShares{
		TaskLists: s.queryUserIDs(`SELECT task_list_id FROM task_list_shares WHERE target_type = 'team' AND target_id = ?`, teamID),
		Lists:     map[string]string{},
		Docs:      s.queryUserIDs(`SELECT doc_id FROM doc_team_shares WHERE team_id = ?`, teamID),
		Folders:   s.queryUserIDs(`SELECT folder_id FROM workspace_folder_shares WHERE target_type = 'team' AND target_id = ?`, teamID),
	}
	rows, err := s.db.Query(`SELECT list_id, id FROM list_shares WHERE target_type = 'team' AND target_id = ?`, teamID)
	if dbFailed(err) {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var listID, shareID string
		if err := rows.Scan(&listID, &shareID); !dbFailed(err) {
			out.Lists[listID] = shareID
		}
	}
	logDBErr(rows.Err())
	return out
}
