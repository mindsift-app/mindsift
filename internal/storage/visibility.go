package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Sharing modes (system_settings.sharing_mode). They decide who can see whom; every way of finding
// people (directory, search, sharing, groups) goes through CanSee / CanShareWith.
const (
	SharingPrivate       = "private"       // nobody sees anybody, sharing and groups are off
	SharingOrganizations = "organizations" // only members of the same organization see each other
	SharingOpen          = "open"          // everybody sees everybody
)

// ErrSharingDisabled is returned for sharing or group actions while the server runs in private mode.
var ErrSharingDisabled = errors.New("Teilen ist auf diesem Server deaktiviert")

// ErrTargetNotFound is returned both for unknown people/groups and for ones the caller may not see,
// so nobody can probe which accounts exist.
var ErrTargetNotFound = errors.New("Benutzer oder Gruppe nicht gefunden")

func NormalizeSharingMode(mode string) string {
	switch mode {
	case SharingPrivate, SharingOpen:
		return mode
	}
	return SharingOrganizations
}

func (s *Store) SharingMode() string {
	sys, _ := s.GetSystemSettings()
	if sys == nil {
		return SharingOrganizations
	}
	return NormalizeSharingMode(sys.SharingMode)
}

func (s *Store) userOrganization(userID string) string {
	var org string
	_ = s.db.QueryRow(`SELECT organization_id FROM users WHERE id = ?`, userID).Scan(&org)
	return org
}

// CanSee reports whether viewer may find target and share with it. Server admins follow the same rule;
// they manage everybody through the admin endpoints instead.
func (s *Store) CanSee(viewerID, targetID string) bool {
	if viewerID == "" || targetID == "" {
		return false
	}
	if viewerID == targetID {
		return true
	}
	switch s.SharingMode() {
	case SharingOpen:
		var n int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, targetID).Scan(&n)
		return n > 0
	case SharingPrivate:
		return false
	}
	org := s.userOrganization(viewerID)
	return org != "" && org == s.userOrganization(targetID)
}

// CanShareWith reports whether owner may share something with a user or group: users must be visible,
// groups must have owner as a member. Sharing is only ever done by the owner of the shared item.
func (s *Store) CanShareWith(ownerID, targetType, targetID string) bool {
	if s.SharingMode() == SharingPrivate {
		return false
	}
	if targetType == "team" {
		var n int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM team_members WHERE team_id = ? AND user_id = ?`, targetID, ownerID).Scan(&n)
		return n > 0
	}
	return ownerID != targetID && s.CanSee(ownerID, targetID)
}

// GetDiscoverableUsers returns everyone the viewer can see, the viewer included.
func (s *Store) GetDiscoverableUsers(viewerID string) ([]domain.User, error) {
	var rows *sql.Rows
	var err error
	switch s.SharingMode() {
	case SharingOpen:
		rows, err = s.db.Query(`SELECT ` + userSelectCols + ` FROM users ORDER BY display_name COLLATE NOCASE`)
	case SharingPrivate:
		rows, err = s.db.Query(`SELECT `+userSelectCols+` FROM users WHERE id = ?`, viewerID)
	default:
		rows, err = s.db.Query(
			`SELECT `+userSelectCols+` FROM users
			 WHERE id = ? OR (organization_id != '' AND organization_id = (SELECT organization_id FROM users WHERE id = ?))
			 ORDER BY display_name COLLATE NOCASE`,
			viewerID, viewerID,
		)
	}
	if err != nil {
		return []domain.User{}, err
	}
	defer rows.Close()
	users := make([]domain.User, 0)
	for rows.Next() {
		if u, err := scanUser(rows); err == nil {
			users = append(users, *u)
		}
	}
	return users, nil
}

// visibleSQL is the SQL form of CanSee for two user ID expressions under the given mode.
func visibleSQL(mode, a, b string) string {
	switch mode {
	case SharingOpen:
		return "1"
	case SharingPrivate:
		return fmt.Sprintf("(%s = %s)", a, b)
	}
	return fmt.Sprintf(
		`(%[1]s = %[2]s OR EXISTS (SELECT 1 FROM users ua JOIN users ub ON ub.organization_id = ua.organization_id
		  WHERE ua.id = %[1]s AND ub.id = %[2]s AND ua.organization_id != ''))`, a, b)
}

// PruneSharing removes everything that is no longer allowed under mode: group memberships across
// organizations, shares with people the owner cannot see, and shares with groups the owner is not in.
// Task assignments follow via PruneTaskAssignees. With dryRun nothing changes and only the number of
// affected memberships and shares is returned (used to warn before tightening the mode).
func (s *Store) PruneSharing(mode string, dryRun bool) (int64, error) {
	mode = NormalizeSharingMode(mode)
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var stmts []string
	switch mode {
	case SharingPrivate:
		stmts = append(stmts, `DELETE FROM team_members`)
	case SharingOrganizations:
		// A group belongs to its creator's organization (teams.org_id)
		stmts = append(stmts, `DELETE FROM team_members WHERE
			(SELECT organization_id FROM users WHERE id = team_members.user_id) != (SELECT org_id FROM teams WHERE id = team_members.team_id)
			OR (SELECT org_id FROM teams WHERE id = team_members.team_id) = ''`)
	}

	type shareTable struct{ table, owner, userCol, teamCol string }
	tables := []shareTable{
		{"doc_shares", "(SELECT user_id FROM documents WHERE id = doc_shares.doc_id)", "doc_shares.user_id", ""},
		{"doc_team_shares", "(SELECT user_id FROM documents WHERE id = doc_team_shares.doc_id)", "", "doc_team_shares.team_id"},
		{"task_list_shares", "(SELECT user_id FROM task_lists WHERE id = task_list_shares.task_list_id)", "task_list_shares.target_id", "task_list_shares.target_id"},
		{"list_shares", "(SELECT user_id FROM lists WHERE id = list_shares.list_id)", "list_shares.target_id", "list_shares.target_id"},
		{"workspace_folder_shares", "(SELECT owner_id FROM workspace_shared_folders WHERE id = workspace_folder_shares.folder_id)", "workspace_folder_shares.target_id", "workspace_folder_shares.target_id"},
	}
	for _, t := range tables {
		hasType := t.userCol != "" && t.teamCol != ""
		if t.userCol != "" {
			cond := "NOT " + visibleSQL(mode, t.owner, t.userCol)
			if hasType {
				cond = "target_type = 'user' AND " + cond
			}
			stmts = append(stmts, fmt.Sprintf(`DELETE FROM %s WHERE %s`, t.table, cond))
		}
		if t.teamCol != "" {
			cond := fmt.Sprintf(`NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = %s AND user_id = %s)`, t.teamCol, t.owner)
			if hasType {
				cond = "target_type = 'team' AND " + cond
			}
			stmts = append(stmts, fmt.Sprintf(`DELETE FROM %s WHERE %s`, t.table, cond))
		}
	}

	var affected int64
	for _, q := range stmts {
		res, err := tx.Exec(q)
		if err != nil {
			return 0, fmt.Errorf("prune sharing: %w", err)
		}
		n, _ := res.RowsAffected()
		affected += n
	}
	// Groups without members disappear; groups that lost their last admin get one
	if _, err := tx.Exec(`DELETE FROM teams WHERE id NOT IN (SELECT team_id FROM team_members)`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`UPDATE team_members SET role = 'admin' WHERE rowid IN (
		SELECT MIN(rowid) FROM team_members GROUP BY team_id HAVING SUM(role = 'admin') = 0)`); err != nil {
		return 0, err
	}
	if dryRun {
		return affected, nil
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	s.PruneTaskAssignees()
	return affected, nil
}

// pruneSharingNow applies the current mode after a membership or organization change.
func (s *Store) pruneSharingNow() {
	_, _ = s.PruneSharing(s.SharingMode(), false)
}

// --- ORGANIZATIONS (managed by server admins only) ---

func (s *Store) GetOrganizations() ([]domain.Organization, error) {
	rows, err := s.db.Query(
		`SELECT o.id, o.name, o.created_at, (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id)
		 FROM organizations o ORDER BY o.name COLLATE NOCASE`,
	)
	if err != nil {
		return []domain.Organization{}, err
	}
	defer rows.Close()
	orgs := make([]domain.Organization, 0)
	for rows.Next() {
		var o domain.Organization
		if rows.Scan(&o.ID, &o.Name, &o.CreatedAt, &o.MemberCount) == nil {
			orgs = append(orgs, o)
		}
	}
	return orgs, nil
}

func (s *Store) CreateOrganization(name string) (*domain.Organization, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("Name der Organisation ist erforderlich")
	}
	org := &domain.Organization{ID: domain.NewID("org"), Name: name, CreatedAt: domain.NowISO()}
	if _, err := s.db.Exec(`INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)`, org.ID, org.Name, org.CreatedAt); err != nil {
		return nil, err
	}
	return org, nil
}

func (s *Store) RenameOrganization(orgID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("Name der Organisation ist erforderlich")
	}
	res, err := s.db.Exec(`UPDATE organizations SET name = ? WHERE id = ?`, name, orgID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("Organisation nicht gefunden")
	}
	return nil
}

// DeleteOrganization removes the organization; its members end up without one and lose what they
// shared with each other.
func (s *Store) DeleteOrganization(orgID string) error {
	if _, err := s.db.Exec(`UPDATE users SET organization_id = '' WHERE organization_id = ?`, orgID); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM organizations WHERE id = ?`, orgID); err != nil {
		return err
	}
	s.pruneSharingNow()
	return nil
}

// SetUserOrganization moves a user into an organization ("" = none). Leaving one drops the user's
// groups, shares and task assignments there.
func (s *Store) SetUserOrganization(userID, orgID string) error {
	orgID = strings.TrimSpace(orgID)
	if orgID != "" {
		var n int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM organizations WHERE id = ?`, orgID).Scan(&n)
		if n == 0 {
			return errors.New("Organisation nicht gefunden")
		}
	}
	res, err := s.db.Exec(`UPDATE users SET organization_id = ? WHERE id = ?`, orgID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("Benutzer nicht gefunden")
	}
	s.pruneSharingNow()
	return nil
}
