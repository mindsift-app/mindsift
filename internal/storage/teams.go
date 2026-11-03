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

func (s *Store) GetAllTeams() ([]domain.Team, error) {
	rows, err := s.db.Query(
		`SELECT id, org_id, name, description, created_at FROM teams ORDER BY name COLLATE NOCASE ASC`,
	)
	if err != nil {
		return []domain.Team{}, err
	}
	defer rows.Close()

	teams := make([]domain.Team, 0)
	for rows.Next() {
		var t domain.Team
		if err := rows.Scan(&t.ID, &t.OrgID, &t.Name, &t.Description, &t.CreatedAt); err == nil {
			t.Members = []domain.TeamMember{}
			teams = append(teams, t)
		}
	}
	for i := range teams {
		members, _ := s.GetTeamMembers(teams[i].ID)
		teams[i].Members = members
	}
	return teams, nil
}

func (s *Store) GetTeamsForOrg(orgID string) ([]domain.Team, error) {
	rows, err := s.db.Query(
		`SELECT id, org_id, name, description, created_at FROM teams WHERE org_id = ? ORDER BY created_at ASC`,
		orgID,
	)
	if err != nil {
		return []domain.Team{}, err
	}

	teams := make([]domain.Team, 0)
	for rows.Next() {
		var t domain.Team
		if err := rows.Scan(&t.ID, &t.OrgID, &t.Name, &t.Description, &t.CreatedAt); err == nil {
			t.Members = []domain.TeamMember{}
			teams = append(teams, t)
		}
	}
	_ = rows.Close()

	for i := range teams {
		members, _ := s.GetTeamMembers(teams[i].ID)
		teams[i].Members = members
	}
	return teams, nil
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
	t.Members, _ = s.GetTeamMembers(t.ID)
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
		if err := rows.Scan(&t.ID, &t.OrgID, &t.Name, &t.Description, &t.CreatedAt); err == nil {
			t.Members = []domain.TeamMember{}
			teams = append(teams, t)
		}
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
	if role != "admin" && role != "member" {
		role = "member"
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
	if role != "admin" && role != "member" {
		return errors.New("Ungültige Rolle (erlaubt sind: admin, member)")
	}
	currentRole, err := s.GetTeamMemberRole(teamID, userID)
	if err != nil {
		return err
	}
	if currentRole == "" {
		return errors.New("Benutzer ist kein Mitglied dieser Gruppe")
	}
	if currentRole == "admin" && role != "admin" {
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
	if currentRole == "admin" {
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
		if err := rows.Scan(&m.TeamID, &m.UserID, &m.DisplayName, &m.Email, &m.AvatarURL, &m.Role, &m.JoinedAt); err == nil {
			members = append(members, m)
		}
	}
	return members, nil
}
