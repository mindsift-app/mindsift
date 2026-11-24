package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
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

// shareOrganization reports whether two people are members of at least one common organization.
func (s *Store) shareOrganization(a, b string) bool {
	var n int
	logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM organization_members ma JOIN organization_members mb ON mb.org_id = ma.org_id
		WHERE ma.user_id = ? AND mb.user_id = ?`, a, b).Scan(&n))
	return n > 0
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
		logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, targetID).Scan(&n))
		return n > 0
	case SharingPrivate:
		return false
	}
	return s.shareOrganization(viewerID, targetID)
}

// CanShareWith reports whether owner may share something with a user or group: users must be visible,
// groups must have owner as a member. Sharing is only ever done by the owner of the shared item.
func (s *Store) CanShareWith(ownerID, targetType, targetID string) bool {
	if s.SharingMode() == SharingPrivate {
		return false
	}
	if targetType == "team" {
		var n int
		logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM team_members WHERE team_id = ? AND user_id = ?`, targetID, ownerID).Scan(&n))
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
			 WHERE id = ? OR id IN (SELECT mb.user_id FROM organization_members ma
			   JOIN organization_members mb ON mb.org_id = ma.org_id WHERE ma.user_id = ?)
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
	if err := rows.Err(); err != nil {
		return []domain.User{}, err
	}
	return users, nil
}

// sharingAccessCTE is everyone's access through sharing: a row per resource ('d:' note, 'f:' shared
// folder, 't:' task list, 'l:' list, 'g:' group, each with its id) and person (owner, the people it is
// shared with, directly or through a group, and the members of a group).
const sharingAccessCTE = `
WITH access(res, uid) AS (
	SELECT 'd:' || doc_id, user_id FROM doc_shares
	UNION SELECT 'd:' || s.doc_id, tm.user_id FROM doc_team_shares s JOIN team_members tm ON tm.team_id = s.team_id
	UNION SELECT 'd:' || d.id, d.user_id FROM documents d
		WHERE d.id IN (SELECT doc_id FROM doc_shares UNION SELECT doc_id FROM doc_team_shares)
	UNION SELECT 'f:' || id, owner_id FROM workspace_shared_folders
	UNION SELECT 'f:' || folder_id, target_id FROM workspace_folder_shares WHERE target_type = 'user'
	UNION SELECT 'f:' || s.folder_id, tm.user_id FROM workspace_folder_shares s JOIN team_members tm ON tm.team_id = s.target_id
		WHERE s.target_type = 'team'
	UNION SELECT 't:' || task_list_id, target_id FROM task_list_shares WHERE target_type = 'user'
	UNION SELECT 't:' || s.task_list_id, tm.user_id FROM task_list_shares s JOIN team_members tm ON tm.team_id = s.target_id
		WHERE s.target_type = 'team'
	UNION SELECT 't:' || id, user_id FROM task_lists WHERE id IN (SELECT task_list_id FROM task_list_shares)
	UNION SELECT 'l:' || list_id, target_id FROM list_shares WHERE target_type = 'user'
	UNION SELECT 'l:' || s.list_id, tm.user_id FROM list_shares s JOIN team_members tm ON tm.team_id = s.target_id
		WHERE s.target_type = 'team'
	UNION SELECT 'l:' || id, user_id FROM lists WHERE id IN (SELECT list_id FROM list_shares)
	UNION SELECT 'g:' || team_id, user_id FROM team_members
)
`

// connectedSQL lists everyone who works on something together with the user (?): people with access to
// the same shared note, shared folder, task list or list, and members of the same groups. Their names
// may show wherever they appear together, without making them findable.
const connectedSQL = sharingAccessCTE +
	`SELECT DISTINCT b.uid FROM access a JOIN access b ON b.res = a.res WHERE a.uid = ? AND b.uid != a.uid`

// ConnectedUserIDs lists everyone connected to the user through something shared (connectedSQL): the
// people whose shares, groups or member lists change when the account goes.
func (s *Store) ConnectedUserIDs(userID string) ([]string, error) {
	rows, err := s.db.Query(connectedSQL, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// GetDirectory returns the people whose names the viewer may see: with search on everyone the viewer
// may share with (Findable), plus everyone connected through something shared, sorted by name.
func (s *Store) GetDirectory(viewerID string, search bool) ([]domain.PublicUser, error) {
	findable := map[string]bool{}
	if search && s.SharingMode() != SharingPrivate {
		visible, err := s.GetDiscoverableUsers(viewerID)
		if err != nil {
			return nil, err
		}
		for _, u := range visible {
			if u.ID != viewerID && u.IsActive {
				findable[u.ID] = true
			}
		}
	}
	rows, err := s.db.Query(connectedSQL, viewerID)
	if err != nil {
		return nil, err
	}
	ids := []string{viewerID}
	seen := map[string]bool{viewerID: true}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	_ = rows.Close()
	for id := range findable {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	all, err := s.GetAllUsers()
	if err != nil {
		return nil, err
	}
	out := make([]domain.PublicUser, 0, len(ids))
	for _, u := range all {
		if seen[u.ID] {
			p := domain.ToPublicUser(u)
			p.Findable = findable[u.ID]
			out = append(out, p)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return strings.ToLower(out[i].DisplayName) < strings.ToLower(out[j].DisplayName)
	})
	return out, nil
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
		`(%[1]s = %[2]s OR EXISTS (SELECT 1 FROM organization_members ma JOIN organization_members mb ON mb.org_id = ma.org_id
		  WHERE ma.user_id = %[1]s AND mb.user_id = %[2]s))`, a, b)
}

// PruneSharing removes everything that is no longer allowed under mode: group memberships across
// organizations, shares with people the owner cannot see, and shares with groups the owner is not in.
// Task assignments follow via PruneTaskAssignees. With dryRun nothing changes and only the number of
// affected memberships and shares is returned (used to warn before tightening the mode).
func (s *Store) PruneSharing(mode string, dryRun bool) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	affected, err := s.pruneSharingTx(tx, mode, nil)
	if err != nil || dryRun {
		return affected, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	s.PruneTaskAssignees()
	return affected, nil
}

// PruneSharingPeople is PruneSharing that also returns the people the removal concerns (pruneSharingTx),
// so the server tells only them.
func (s *Store) PruneSharingPeople(mode string) (int64, []string, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()
	who := map[string]bool{}
	affected, err := s.pruneSharingTx(tx, mode, who)
	if err != nil {
		return 0, nil, err
	}
	people, err := sharingPeopleTx(tx, who)
	if err != nil {
		return 0, nil, err
	}
	if err := tx.Commit(); err != nil {
		return 0, nil, err
	}
	s.PruneTaskAssignees()
	return affected, people, nil
}

// pruneSharingTx removes inside tx what mode no longer allows and returns how many shares and group
// memberships that were. With who it also collects, before each removal, what the removed rows
// concern: the resource ("d:<note>", "g:<group>", ... as in sharingAccessCTE) and the people (owner,
// the person or the group members it was shared with, the member who left a group); sharingPeopleTx
// turns that into people.
func (s *Store) pruneSharingTx(tx *sql.Tx, mode string, who map[string]bool) (int64, error) {
	mode = NormalizeSharingMode(mode)
	// each removal with the query of what it concerns: rows of (resource, person, person)
	type removal struct{ del, concerns string }
	var removals []removal
	switch mode {
	case SharingPrivate:
		removals = append(removals, removal{`DELETE FROM team_members`,
			`SELECT 'g:' || team_id, user_id, NULL FROM team_members`})
	case SharingOrganizations:
		// A group belongs to one organization (teams.org_id); its members must be in it
		cond := `NOT EXISTS (SELECT 1 FROM organization_members m
			WHERE m.user_id = team_members.user_id AND m.org_id = (SELECT org_id FROM teams WHERE id = team_members.team_id))`
		removals = append(removals, removal{`DELETE FROM team_members WHERE ` + cond,
			`SELECT 'g:' || team_id, user_id, NULL FROM team_members WHERE ` + cond})
	}

	type shareTable struct{ table, res, owner, userCol, teamCol string }
	tables := []shareTable{
		{"doc_shares", "'d:' || doc_shares.doc_id", "(SELECT user_id FROM documents WHERE id = doc_shares.doc_id)", "doc_shares.user_id", ""},
		{"doc_team_shares", "'d:' || doc_team_shares.doc_id", "(SELECT user_id FROM documents WHERE id = doc_team_shares.doc_id)", "", "doc_team_shares.team_id"},
		{"task_list_shares", "'t:' || task_list_shares.task_list_id", "(SELECT user_id FROM task_lists WHERE id = task_list_shares.task_list_id)", "task_list_shares.target_id", "task_list_shares.target_id"},
		{"list_shares", "'l:' || list_shares.list_id", "(SELECT user_id FROM lists WHERE id = list_shares.list_id)", "list_shares.target_id", "list_shares.target_id"},
		{"workspace_folder_shares", "'f:' || workspace_folder_shares.folder_id", "(SELECT owner_id FROM workspace_shared_folders WHERE id = workspace_folder_shares.folder_id)", "workspace_folder_shares.target_id", "workspace_folder_shares.target_id"},
	}
	for _, t := range tables {
		hasType := t.userCol != "" && t.teamCol != ""
		if t.userCol != "" {
			cond := "NOT " + visibleSQL(mode, t.owner, t.userCol)
			if hasType {
				cond = "target_type = 'user' AND " + cond
			}
			removals = append(removals, removal{fmt.Sprintf(`DELETE FROM %s WHERE %s`, t.table, cond),
				fmt.Sprintf(`SELECT %s, %s, %s FROM %s WHERE %s`, t.res, t.owner, t.userCol, t.table, cond)})
		}
		if t.teamCol != "" {
			cond := fmt.Sprintf(`NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = %s AND user_id = %s)`, t.teamCol, t.owner)
			if hasType {
				cond = "target_type = 'team' AND " + cond
			}
			removals = append(removals, removal{fmt.Sprintf(`DELETE FROM %s WHERE %s`, t.table, cond),
				fmt.Sprintf(`SELECT %s, %s, tm.user_id FROM %s LEFT JOIN team_members tm ON tm.team_id = %s WHERE %s`,
					t.res, t.owner, t.table, t.teamCol, cond)})
		}
	}

	var affected int64
	for _, r := range removals {
		if who != nil {
			if err := collectConcerned(tx, r.concerns, who); err != nil {
				return 0, fmt.Errorf("prune sharing: %w", err)
			}
		}
		res, err := tx.Exec(r.del)
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
	return affected, nil
}

// collectConcerned adds what the rows of q (resource, person, person; persons may be NULL) concern to
// who: resources as "res:<key>", people as "uid:<id>".
func collectConcerned(tx *sql.Tx, q string, who map[string]bool) error {
	rows, err := tx.Query(q)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var res string
		var a, b sql.NullString
		if err := rows.Scan(&res, &a, &b); err != nil {
			return err
		}
		who["res:"+res] = true
		for _, p := range []sql.NullString{a, b} {
			if p.Valid && p.String != "" {
				who["uid:"+p.String] = true
			}
		}
	}
	return rows.Err()
}

// sharingPeopleTx turns what pruneSharingTx collected into people: those named, and everyone who still
// has access to one of the resources (they see its member list change).
func sharingPeopleTx(tx *sql.Tx, who map[string]bool) ([]string, error) {
	people := map[string]bool{}
	var resources []string
	for k := range who {
		if id, ok := strings.CutPrefix(k, "uid:"); ok {
			people[id] = true
		} else if res, ok := strings.CutPrefix(k, "res:"); ok {
			resources = append(resources, res)
		}
	}
	if len(resources) > 0 {
		raw, err := json.Marshal(resources)
		if err != nil {
			return nil, err
		}
		rows, err := tx.Query(sharingAccessCTE+`SELECT DISTINCT uid FROM access WHERE res IN (SELECT value FROM json_each(?))`, string(raw))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return nil, err
			}
			people[id] = true
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	out := make([]string, 0, len(people))
	for id := range people {
		out = append(out, id)
	}
	sort.Strings(out)
	return out, nil
}

// pruneSharingNow applies the current mode after a membership or organization change.
func (s *Store) pruneSharingNow() {
	if _, err := s.PruneSharing(s.SharingMode(), false); err != nil {
		slog.Error("Applying the sharing mode failed", "error", err)
	}
}

// pruneSharingNowPeople is pruneSharingNow that returns the people the removal concerns
// (PruneSharingPeople); none when nothing was removed or it failed (logged).
func (s *Store) pruneSharingNowPeople() []string {
	_, people, err := s.PruneSharingPeople(s.SharingMode())
	if err != nil {
		slog.Error("Applying the sharing mode failed", "error", err)
	}
	return people
}

// --- ORGANIZATIONS (managed by server admins and user managers) ---

// migrateOrganizationMembers: a person can belong to several organizations (organization_members
// replaces users.organization_id); invites can name several. Invites never make admins any more.
func (s *Store) migrateOrganizationMembers() error {
	if err := s.addColumnIfMissing("user_invites", "organization_ids", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return s.execInTx(
		stmt(`CREATE TABLE IF NOT EXISTS organization_members (
			org_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (org_id, user_id)
		)`),
		stmt(`CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id)`),
		stmt(`INSERT OR IGNORE INTO organization_members (org_id, user_id, created_at)
			SELECT organization_id, id, ? FROM users WHERE organization_id IN (SELECT id FROM organizations)`, domain.NowISO()),
		stmt(`UPDATE users SET organization_id = ''`),
		stmt(`UPDATE user_invites SET organization_ids = organization_id WHERE organization_id IN (SELECT id FROM organizations)`),
		stmt(`UPDATE user_invites SET organization_id = '', role = 'member'`),
	)
}

func (s *Store) GetOrganizations() ([]domain.Organization, error) {
	rows, err := s.db.Query(
		`SELECT o.id, o.name, o.created_at, (SELECT COUNT(*) FROM organization_members m WHERE m.org_id = o.id)
		 FROM organizations o ORDER BY o.name COLLATE NOCASE`,
	)
	if err != nil {
		return []domain.Organization{}, err
	}
	defer rows.Close()
	orgs := make([]domain.Organization, 0)
	for rows.Next() {
		var o domain.Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.CreatedAt, &o.MemberCount); err != nil {
			return []domain.Organization{}, err
		}
		orgs = append(orgs, o)
	}
	return orgs, rows.Err()
}

// ErrOrganizationNameTaken: another organization has this name (compared trimmed and case-insensitively).
var ErrOrganizationNameTaken = i18n.NewError("Eine Organisation mit diesem Namen gibt es schon")

// organizationNameTaken: an organization other than exceptID has name, trimmed and compared without
// regard to case (in Go, so umlauts count as well). Organizations are few; duplicates from before the
// check stay as they are.
func (s *Store) organizationNameTaken(name, exceptID string) (bool, error) {
	rows, err := s.db.Query(`SELECT id, name FROM organizations`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, other string
		if err := rows.Scan(&id, &other); err != nil {
			return false, err
		}
		if id != exceptID && strings.EqualFold(strings.TrimSpace(other), name) {
			return true, nil
		}
	}
	return false, rows.Err()
}

// CreateOrganization refuses a name another organization has (ErrOrganizationNameTaken).
func (s *Store) CreateOrganization(name string) (*domain.Organization, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("Name der Organisation ist erforderlich")
	}
	if taken, err := s.organizationNameTaken(name, ""); err != nil {
		return nil, err
	} else if taken {
		return nil, ErrOrganizationNameTaken
	}
	org := &domain.Organization{ID: domain.NewID("org"), Name: name, CreatedAt: domain.NowISO()}
	if _, err := s.db.Exec(`INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)`, org.ID, org.Name, org.CreatedAt); err != nil {
		return nil, err
	}
	return org, nil
}

// RenameOrganization refuses a name another organization has; the own name in other case is fine.
func (s *Store) RenameOrganization(orgID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("Name der Organisation ist erforderlich")
	}
	if taken, err := s.organizationNameTaken(name, orgID); err != nil {
		return err
	} else if taken {
		return ErrOrganizationNameTaken
	}
	res, err := s.db.Exec(`UPDATE organizations SET name = ? WHERE id = ?`, name, orgID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrOrganizationNotFound
	}
	return nil
}

// ErrOrganizationNotFound is returned for an unknown organization id.
var ErrOrganizationNotFound = errors.New("Organisation nicht gefunden")

// DeleteOrganization removes the organization; its members lose what they shared with each other
// unless another organization still connects them. Its groups go with it. Returns the people whose
// shares or groups changed (PruneSharingPeople), none when nothing went.
func (s *Store) DeleteOrganization(orgID string) ([]string, error) {
	if err := s.execInTx(
		stmt(`DELETE FROM organization_members WHERE org_id = ?`, orgID),
		stmt(`DELETE FROM organizations WHERE id = ?`, orgID),
	); err != nil {
		return nil, err
	}
	return s.pruneSharingNowPeople(), nil
}

func (s *Store) organizationExists(orgID string) bool {
	var n int
	logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM organizations WHERE id = ?`, orgID).Scan(&n))
	return n > 0
}

// AddOrganizationMember puts a user into an organization (no-op when already a member).
func (s *Store) AddOrganizationMember(orgID, userID string) error {
	_, err := s.JoinOrganization(orgID, userID)
	return err
}

// JoinOrganization is AddOrganizationMember that tells whether the user was new in the organization
// (false: already a member, nothing changed).
func (s *Store) JoinOrganization(orgID, userID string) (bool, error) {
	if !s.organizationExists(orgID) {
		return false, ErrOrganizationNotFound
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, userID).Scan(&n); err != nil {
		return false, err
	}
	if n == 0 {
		return false, errors.New("Benutzer nicht gefunden")
	}
	res, err := s.db.Exec(`INSERT OR IGNORE INTO organization_members (org_id, user_id, created_at) VALUES (?, ?, ?)`,
		orgID, userID, domain.NowISO())
	if err != nil {
		return false, err
	}
	added, _ := res.RowsAffected()
	return added > 0, nil
}

// RemoveOrganizationMember takes a user out of an organization. Shares, groups and task assignments
// that depended on it go, unless another common organization keeps them allowed. Returns the people
// whose shares or groups changed (PruneSharingPeople), none when nothing went.
func (s *Store) RemoveOrganizationMember(orgID, userID string) ([]string, error) {
	if _, err := s.db.Exec(`DELETE FROM organization_members WHERE org_id = ? AND user_id = ?`, orgID, userID); err != nil {
		return nil, err
	}
	return s.pruneSharingNowPeople(), nil
}

// RemoveOrganizationMemberImpact counts what RemoveOrganizationMember would take away (shares and
// group memberships), without changing anything.
func (s *Store) RemoveOrganizationMemberImpact(orgID, userID string) (int64, error) {
	mode := s.SharingMode() // before the transaction: it holds the only connection it may use
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM organization_members WHERE org_id = ? AND user_id = ?`, orgID, userID); err != nil {
		return 0, err
	}
	return s.pruneSharingTx(tx, mode, nil)
}

// OrganizationMemberIDs lists the members of an organization.
func (s *Store) OrganizationMemberIDs(orgID string) []string {
	rows, err := s.db.Query(`SELECT user_id FROM organization_members WHERE org_id = ?`, orgID)
	if dbFailed(err) {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var uid string
		if !dbFailed(rows.Scan(&uid)) {
			out = append(out, uid)
		}
	}
	return out
}

// OrganizationIDsOf maps every user to their organizations, sorted by name.
func (s *Store) OrganizationIDsOf() (map[string][]string, error) {
	rows, err := s.db.Query(`SELECT m.user_id, m.org_id FROM organization_members m
		JOIN organizations o ON o.id = m.org_id ORDER BY o.name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var uid, oid string
		if err := rows.Scan(&uid, &oid); err != nil {
			return nil, err
		}
		out[uid] = append(out[uid], oid)
	}
	return out, rows.Err()
}

// UserOrganizationIDs returns the organizations of one user, sorted by name.
func (s *Store) UserOrganizationIDs(userID string) []string {
	rows, err := s.db.Query(`SELECT m.org_id FROM organization_members m JOIN organizations o ON o.id = m.org_id
		WHERE m.user_id = ? ORDER BY o.name COLLATE NOCASE`, userID)
	if dbFailed(err) {
		return nil
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if !dbFailed(rows.Scan(&id)) {
			ids = append(ids, id)
		}
	}
	logDBErr(rows.Err())
	return ids
}

// UserOrganizations returns the user's organizations with their names, sorted by name.
func (s *Store) UserOrganizations(userID string) []domain.OrganizationRef {
	rows, err := s.db.Query(`SELECT o.id, o.name FROM organization_members m JOIN organizations o ON o.id = m.org_id
		WHERE m.user_id = ? ORDER BY o.name COLLATE NOCASE`, userID)
	if dbFailed(err) {
		return nil
	}
	defer rows.Close()
	out := []domain.OrganizationRef{}
	for rows.Next() {
		var o domain.OrganizationRef
		if !dbFailed(rows.Scan(&o.ID, &o.Name)) {
			out = append(out, o)
		}
	}
	logDBErr(rows.Err())
	return out
}

// IsOrganizationMember reports whether the user belongs to the organization.
func (s *Store) IsOrganizationMember(orgID, userID string) bool {
	var n int
	logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM organization_members WHERE org_id = ? AND user_id = ?`, orgID, userID).Scan(&n))
	return n > 0
}

// FitsTeamOrganization: in organization mode a group's members must belong to its organization.
func (s *Store) FitsTeamOrganization(teamID, userID string) bool {
	if s.SharingMode() != SharingOrganizations {
		return true
	}
	var orgID string
	logDBErr(s.db.QueryRow(`SELECT org_id FROM teams WHERE id = ?`, teamID).Scan(&orgID))
	return orgID != "" && s.IsOrganizationMember(orgID, userID)
}

// ValidOrganizationIDs keeps the known organization ids, without duplicates.
func (s *Store) ValidOrganizationIDs(ids []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] || !s.organizationExists(id) {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}
