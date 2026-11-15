package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// --- TASK LISTS ---

// defaultColumnNames: the German names of the standard columns (translated through the catalogs)
var defaultColumnNames = map[string]string{
	"todo":        "Zu erledigen",
	"in_progress": "In Bearbeitung",
	"waiting":     "Wartet auf andere",
	"done":        "Erledigt",
}

// LocalizeColumns names the standard columns in lang as long as they still carry their standard name in
// any language: a list created in English shows "Zu erledigen" to someone using German, and the boards of
// lists created in different languages share their columns. Renamed columns stay as they are.
func LocalizeColumns(cols []domain.KanbanColumn, lang string) []domain.KanbanColumn {
	out := make([]domain.KanbanColumn, len(cols))
	for i, c := range cols {
		out[i] = c
		de, ok := defaultColumnNames[c.ID]
		if !ok {
			continue
		}
		name := strings.TrimSpace(c.Name)
		for _, l := range i18n.Supported {
			if strings.EqualFold(name, i18n.T(l, de)) {
				out[i].Name = i18n.T(lang, de)
				break
			}
		}
	}
	return out
}

// defaultColumns: the board of a new task list, named in lang
func defaultColumns(lang string) []domain.KanbanColumn {
	return []domain.KanbanColumn{
		{ID: "todo", Name: i18n.T(lang, "Zu erledigen")},
		{ID: "in_progress", Name: i18n.T(lang, "In Bearbeitung"), Color: "accent"},
		{ID: "waiting", Name: i18n.T(lang, "Wartet auf andere"), Color: "amber"},
		{ID: "done", Name: i18n.T(lang, "Erledigt"), IsDone: true, Color: "emerald"},
	}
}

func (s *Store) CreateTaskList(userID, spaceID, teamID, title, icon, color string, columns ...[]domain.KanbanColumn) (*domain.TaskList, error) {
	lang := s.MessageLanguage(userID)
	if strings.TrimSpace(title) == "" {
		title = i18n.T(lang, "Meine Aufgaben")
	}
	if icon == "" {
		icon = "📋"
	}
	if color == "" {
		color = "#2563eb"
	}
	cols := defaultColumns(lang)
	if len(columns) > 0 && len(columns[0]) > 0 {
		cols = columns[0]
	}
	colsJSON, _ := json.Marshal(cols)
	now := domain.NowISO()
	tl := &domain.TaskList{
		ID:        domain.NewID("tkl"),
		UserID:    userID,
		SpaceID:   spaceID,
		Title:     strings.TrimSpace(title),
		Icon:      icon,
		Color:     color,
		Columns:   cols,
		CreatedAt: now,
		UpdatedAt: now,
		IsOwner:   true,
	}
	_, err := s.db.Exec(
		`INSERT INTO task_lists (id, user_id, space_id, title, icon, color, columns, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		tl.ID, tl.UserID, tl.SpaceID, tl.Title, tl.Icon, tl.Color, string(colsJSON), tl.CreatedAt, tl.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if teamID != "" && s.CanShareWith(userID, "team", teamID) {
		if _, err := s.AddTaskListShare(tl.ID, "team", teamID, "editor", userID); err != nil {
			return nil, err
		}
	}
	return s.GetTaskListByID(userID, tl.ID)
}

// ErrTaskListReadOnly is returned when a user with viewer permission tries to modify a task list or its tasks.
var ErrTaskListReadOnly = errors.New("Keine Schreibrechte für diese Aufgabenliste (nur Lesen)")

// ErrAssigneeNoAccess is returned when a task should be assigned to someone who cannot see its list.
var ErrAssigneeNoAccess = errors.New("Aufgaben können nur Personen mit Zugriff auf die Liste zugewiesen werden")

// GetTaskListPermission returns "owner", "editor", "viewer" or "" (no access) for the given user.
func (s *Store) GetTaskListPermission(userID, listID string) string {
	var ownerID string
	if err := s.db.QueryRow(`SELECT user_id FROM task_lists WHERE id = ?`, listID).Scan(&ownerID); err != nil {
		logDBErr(err)
		return ""
	}
	if ownerID == userID {
		return "owner"
	}
	rows, err := s.db.Query(
		`SELECT permission FROM task_list_shares
		 WHERE task_list_id = ? AND (
		    (target_type = 'user' AND target_id = ?)
		    OR (target_type = 'team' AND target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		 )`,
		listID, userID, userID,
	)
	perm := ""
	if err == nil {
		for rows.Next() {
			var p string
			if !dbFailed(rows.Scan(&p)) {
				if p == "viewer" {
					if perm == "" {
						perm = "viewer"
					}
				} else {
					perm = "editor"
				}
			}
		}
		logDBErr(rows.Err())
		_ = rows.Close()
	}
	return perm
}

func (s *Store) CanEditTaskList(userID, listID string) bool {
	p := s.GetTaskListPermission(userID, listID)
	return p == "owner" || p == "editor"
}

// ensureTaskListWritable returns ErrTaskListReadOnly if the list is set and the user may not modify it.
func (s *Store) ensureTaskListWritable(userID, listID string) error {
	if listID == "" || s.CanEditTaskList(userID, listID) {
		return nil
	}
	return ErrTaskListReadOnly
}

func (s *Store) AddTaskListShare(taskListID, targetType, targetID, permission, createdBy string) (*domain.TaskListShare, error) {
	if targetType != "team" && targetType != "user" {
		return nil, errors.New("ungültiger Freigabetyp")
	}
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return nil, errors.New("Ziel-ID erforderlich")
	}
	if permission != "viewer" {
		permission = "editor"
	}
	if !s.CanShareWith(createdBy, targetType, targetID) {
		return nil, ErrTargetNotFound
	}
	now := domain.NowISO()
	share := &domain.TaskListShare{
		ID:         domain.NewID("tls"),
		TaskListID: taskListID,
		TargetType: targetType,
		TargetID:   targetID,
		Permission: permission,
		CreatedAt:  now,
	}
	_, err := s.db.Exec(
		`INSERT INTO task_list_shares (id, task_list_id, target_type, target_id, permission, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(task_list_id, target_type, target_id) DO UPDATE SET created_at = excluded.created_at, permission = excluded.permission`,
		share.ID, share.TaskListID, share.TargetType, share.TargetID, share.Permission, share.CreatedAt, createdBy,
	)
	if err != nil {
		return nil, err
	}
	logDBErr(s.db.QueryRow(`SELECT id, created_at FROM task_list_shares WHERE task_list_id = ? AND target_type = ? AND target_id = ?`,
		taskListID, targetType, targetID).Scan(&share.ID, &share.CreatedAt))

	if targetType == "team" {
		logDBErr(s.db.QueryRow(`SELECT name FROM teams WHERE id = ?`, targetID).Scan(&share.TargetName))
	} else {
		logDBErr(s.db.QueryRow(`SELECT display_name, email FROM users WHERE id = ?`, targetID).Scan(&share.TargetName, &share.Email))
	}
	return share, nil
}

func (s *Store) RemoveTaskListShare(taskListID, shareIDOrTargetID string) error {
	_, err := s.db.Exec(
		`DELETE FROM task_list_shares WHERE task_list_id = ? AND (id = ? OR target_id = ?)`,
		taskListID, shareIDOrTargetID, shareIDOrTargetID,
	)
	s.PruneTaskAssignees()
	return err
}

func (s *Store) GetTaskListShares(taskListID string) ([]domain.TaskListShare, error) {
	byList, err := taskListSharesOf(s.db, []string{taskListID})
	if err != nil {
		return []domain.TaskListShare{}, err
	}
	if sh := byList[taskListID]; sh != nil {
		return sh, nil
	}
	return []domain.TaskListShare{}, nil
}

// taskListSharesOf returns the shares of several task lists with one query, per list by creation time,
// each with the name of its team or person (and the person's address and picture).
func taskListSharesOf(q docQueryer, listIDs []string) (map[string][]domain.TaskListShare, error) {
	out := map[string][]domain.TaskListShare{}
	if len(listIDs) == 0 {
		return out, nil
	}
	idsJSON, _ := json.Marshal(listIDs)
	rows, err := q.Query(
		`SELECT s.id, s.task_list_id, s.target_type, s.target_id, s.permission, s.created_at,
		        COALESCE(CASE WHEN s.target_type = 'team' THEN t.name ELSE u.display_name END, ''),
		        COALESCE(u.email, ''), COALESCE(u.avatar_url, '')
		 FROM task_list_shares s
		 LEFT JOIN teams t ON s.target_type = 'team' AND t.id = s.target_id
		 LEFT JOIN users u ON s.target_type != 'team' AND u.id = s.target_id
		 WHERE s.task_list_id IN (SELECT value FROM json_each(?))
		 ORDER BY s.task_list_id, s.created_at ASC, s.rowid`,
		string(idsJSON),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var sh domain.TaskListShare
		if err := rows.Scan(&sh.ID, &sh.TaskListID, &sh.TargetType, &sh.TargetID, &sh.Permission, &sh.CreatedAt,
			&sh.TargetName, &sh.Email, &sh.AvatarURL); !dbFailed(err) {
			out[sh.TaskListID] = append(out[sh.TaskListID], sh)
		}
	}
	return out, rows.Err()
}

// queryUserIDs runs a query returning a single user_id column and collects the distinct IDs.
func (s *Store) queryUserIDs(query string, args ...any) []string {
	ids, err := userIDsOf(s.db, query, args...)
	logDBErr(err)
	if ids == nil {
		return []string{}
	}
	return ids
}

// userIDsOf is queryUserIDs on a connection or transaction, with the error.
func userIDsOf(q docQueryer, query string, args ...any) ([]string, error) {
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	seen := make(map[string]bool)
	for rows.Next() {
		var id string
		if !dbFailed(rows.Scan(&id)) && id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, rows.Err()
}

// accessibleTaskListsSQL selects the IDs of every task list a user can see: own lists and lists shared
// with the user directly or through a group. It takes the user ID three times (accessibleTaskListArgs).
// This is the one definition of task list access for reading; GetTaskListPermission adds the role.
const accessibleTaskListsSQL = `SELECT id FROM task_lists
		 WHERE user_id = ?
		    OR id IN (
		        SELECT task_list_id FROM task_list_shares
		        WHERE (target_type = 'user' AND target_id = ?)
		           OR (target_type = 'team' AND target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		    )`

func accessibleTaskListArgs(userID string) []any {
	return []any{userID, userID, userID}
}

// taskListAccessSQL selects every user ID with access to a task list: owner, direct shares and members of
// shared groups. %[1]s is the list ID expression ("?" or a correlated column).
const taskListAccessSQL = `SELECT user_id FROM task_lists WHERE id = %[1]s
		 UNION SELECT target_id FROM task_list_shares WHERE task_list_id = %[1]s AND target_type = 'user'
		 UNION SELECT tm.user_id FROM team_members tm
		       WHERE tm.team_id IN (SELECT target_id FROM task_list_shares WHERE task_list_id = %[1]s AND target_type = 'team')`

func (s *Store) getTaskAssignees(taskID string) []string {
	ids := s.queryUserIDs(`SELECT user_id FROM task_assignees WHERE task_id = ? ORDER BY created_at ASC`, taskID)
	return ids
}

// attachTaskAssignees fills Assignees for a batch of tasks with a single query.
func (s *Store) attachTaskAssignees(tasks []domain.Thought) {
	if len(tasks) == 0 {
		return
	}
	idx := make(map[string]int, len(tasks))
	placeholders := make([]string, 0, len(tasks))
	args := make([]any, 0, len(tasks))
	for i := range tasks {
		idx[tasks[i].ID] = i
		placeholders = append(placeholders, "?")
		args = append(args, tasks[i].ID)
	}
	rows, err := s.db.Query(
		`SELECT task_id, user_id FROM task_assignees WHERE task_id IN (`+strings.Join(placeholders, ",")+`) ORDER BY created_at ASC`,
		args...,
	)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var taskID, uid string
		if !dbFailed(rows.Scan(&taskID, &uid)) {
			if i, ok := idx[taskID]; ok {
				tasks[i].Assignees = append(tasks[i].Assignees, uid)
			}
		}
	}
	logDBErr(rows.Err())
}

// SetTaskAssignees replaces the assignees of a task. Only editors of the task's list may assign, and only
// people who can see the list are accepted.
func (s *Store) SetTaskAssignees(userID, taskID string, assignees []string) ([]string, error) {
	thought, err := s.GetThoughtByID(userID, taskID)
	if err != nil {
		return nil, err
	}
	if thought.TaskListID == "" {
		if len(assignees) > 0 {
			return nil, ErrAssigneeNoAccess
		}
		return []string{}, nil
	}
	if !s.CanEditTaskList(userID, thought.TaskListID) {
		return nil, ErrTaskListReadOnly
	}
	allowed := make(map[string]bool)
	for _, id := range s.GetTaskListUserIDs(thought.TaskListID) {
		allowed[id] = true
	}
	clean := make([]string, 0, len(assignees))
	seen := make(map[string]bool)
	for _, id := range assignees {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if !allowed[id] {
			return nil, ErrAssigneeNoAccess
		}
		seen[id] = true
		clean = append(clean, id)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	keep := make([]any, 0, len(clean)+1)
	keep = append(keep, taskID)
	ph := make([]string, 0, len(clean))
	for _, id := range clean {
		keep = append(keep, id)
		ph = append(ph, "?")
	}
	delQuery := `DELETE FROM task_assignees WHERE task_id = ?`
	if len(ph) > 0 {
		delQuery += ` AND user_id NOT IN (` + strings.Join(ph, ",") + `)`
	}
	if _, err := tx.Exec(delQuery, keep...); err != nil {
		return nil, err
	}
	now := domain.NowISO()
	for _, id := range clean {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, ?)`, taskID, id, now); err != nil {
			return nil, err
		}
	}
	// An alarm sent before alarms were kept per person no longer stands for everyone: new assignees get it
	if _, err := tx.Exec(`DELETE FROM task_alarms_sent WHERE task_id = ? AND user_id = ?`, taskID, alarmSentToAll); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.getTaskAssignees(taskID), nil
}

// PruneTaskAssignees drops every assignment whose user can no longer see the task's list (share removed,
// left the team, team deleted, task moved to another list or out of any list). Called after each change
// that can take access away, so assignments never outlive permissions.
func (s *Store) PruneTaskAssignees() {
	_, err := s.db.Exec(
		`DELETE FROM task_assignees WHERE rowid IN (
		    SELECT ta.rowid FROM task_assignees ta
		    LEFT JOIN thoughts t ON t.id = ta.task_id
		    WHERE t.id IS NULL OR t.task_list_id = ''
		       OR ta.user_id NOT IN (` + fmt.Sprintf(taskListAccessSQL, "t.task_list_id") + `)
		 )`,
	)
	if err != nil {
		slog.Error("Cleaning up assignees failed", "error", err)
	}
}

// pruneTaskAssigneesOf is PruneTaskAssignees for one task, after a change that only concerns it (moved to
// another list or out of any, restored, created as the next occurrence). The whole table, checked row
// by row against the access of its list, was read for each of those before.
func (s *Store) pruneTaskAssigneesOf(taskID string) {
	if err := pruneTaskAssignees(s.db, taskID); err != nil {
		slog.Error("Cleaning up assignees failed", "task_id", taskID, "error", err)
	}
}

// pruneTaskAssignees removes the assignees of a task who cannot see its list (any longer).
func pruneTaskAssignees(db execer, taskID string) error {
	_, err := db.Exec(
		`DELETE FROM task_assignees WHERE task_id = ? AND rowid IN (
		    SELECT ta.rowid FROM task_assignees ta
		    LEFT JOIN thoughts t ON t.id = ta.task_id
		    WHERE ta.task_id = ? AND (t.id IS NULL OR t.task_list_id = ''
		       OR ta.user_id NOT IN (`+fmt.Sprintf(taskListAccessSQL, "t.task_list_id")+`))
		 )`, taskID, taskID,
	)
	return err
}

// GetTaskListUserIDs returns every user who can see the task list: owner, direct shares and members of shared teams.
func (s *Store) GetTaskListUserIDs(listID string) []string {
	if listID == "" {
		return []string{}
	}
	return s.queryUserIDs(fmt.Sprintf(taskListAccessSQL, "?"), listID, listID, listID)
}

// GetSharedFolderUserIDs returns the owner of a shared workspace folder and everyone it is shared with.
func (s *Store) GetSharedFolderUserIDs(folderID string) []string {
	if folderID == "" {
		return []string{}
	}
	return s.queryUserIDs(
		`SELECT owner_id FROM workspace_shared_folders WHERE id = ?
		 UNION SELECT target_id FROM workspace_folder_shares WHERE folder_id = ? AND target_type = 'user'
		 UNION SELECT tm.user_id FROM team_members tm
		       WHERE tm.team_id IN (SELECT target_id FROM workspace_folder_shares WHERE folder_id = ? AND target_type = 'team')`,
		folderID, folderID, folderID,
	)
}

// attachTaskListDetails fills the open task count, owner name, shares, the user's permission and the
// members of the lists with five queries over all of them (it used to be about eight per list, and
// GET /task-lists was the slowest request under load). Members: the owner first, then everyone the list
// is shared with, directly or through a team, by name.
func (s *Store) attachTaskListDetails(userID string, lists []domain.TaskList) error {
	if len(lists) == 0 {
		return nil
	}
	ids := make([]string, len(lists))
	for i := range lists {
		ids[i] = lists[i].ID
	}
	idsJSON, _ := json.Marshal(ids)

	// 1. Open tasks per list
	counts := map[string]int{}
	rows, err := s.db.Query(
		`SELECT task_list_id, COUNT(*) FROM thoughts
		 WHERE task_list_id IN (SELECT value FROM json_each(?)) AND is_completed = 0
		   AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))
		 GROUP BY task_list_id`,
		string(idsJSON),
	)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var n int
		if !dbFailed(rows.Scan(&id, &n)) {
			counts[id] = n
		}
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return err
	}

	// 2. Shares
	shares, err := taskListSharesOf(s.db, ids)
	if err != nil {
		return err
	}

	// 3. The user's teams, for the permission (as GetTaskListPermission: any editor share wins)
	myTeams := map[string]bool{}
	for _, id := range s.queryUserIDs(`SELECT team_id FROM team_members WHERE user_id = ?`, userID) {
		myTeams[id] = true
	}

	// 4. Owners and directly shared people, 5. members of the shared teams
	type person struct{ name, email, avatar string }
	people := map[string]person{}
	var userIDs, teamIDs []string
	for i := range lists {
		userIDs = append(userIDs, lists[i].UserID)
		for _, sh := range shares[lists[i].ID] {
			switch sh.TargetType {
			case "team":
				teamIDs = append(teamIDs, sh.TargetID)
			case "user":
				userIDs = append(userIDs, sh.TargetID)
			}
		}
	}
	usersJSON, _ := json.Marshal(userIDs)
	rows, err = s.db.Query(`SELECT id, display_name, email, avatar_url FROM users WHERE id IN (SELECT value FROM json_each(?))`, string(usersJSON))
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var p person
		if !dbFailed(rows.Scan(&id, &p.name, &p.email, &p.avatar)) {
			people[id] = p
		}
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return err
	}
	teamMembers := map[string][]string{}
	if len(teamIDs) > 0 {
		teamsJSON, _ := json.Marshal(teamIDs)
		rows, err = s.db.Query(
			`SELECT tm.team_id, u.id, u.display_name, u.email, u.avatar_url
			 FROM team_members tm JOIN users u ON u.id = tm.user_id
			 WHERE tm.team_id IN (SELECT value FROM json_each(?))`,
			string(teamsJSON),
		)
		if err != nil {
			return err
		}
		for rows.Next() {
			var teamID, id string
			var p person
			if !dbFailed(rows.Scan(&teamID, &id, &p.name, &p.email, &p.avatar)) {
				people[id] = p
				teamMembers[teamID] = append(teamMembers[teamID], id)
			}
		}
		err = rows.Err()
		_ = rows.Close()
		if err != nil {
			return err
		}
	}

	for i := range lists {
		tl := &lists[i]
		tl.TasksCount = counts[tl.ID]
		owner := people[tl.UserID]
		tl.OwnerName = owner.name
		tl.Shares = shares[tl.ID]
		if tl.Shares == nil {
			tl.Shares = make([]domain.TaskListShare, 0)
		}

		perm := ""
		if tl.UserID == userID {
			perm = "owner"
		}
		seen := map[string]bool{tl.UserID: true}
		others := make([]domain.TaskListMember, 0)
		add := func(id string) {
			p, ok := people[id]
			if !ok || seen[id] {
				return
			}
			seen[id] = true
			others = append(others, domain.TaskListMember{UserID: id, DisplayName: p.name, Email: p.email, AvatarURL: p.avatar, Role: "member"})
		}
		for _, sh := range tl.Shares {
			mine := false
			switch sh.TargetType {
			case "team":
				mine = myTeams[sh.TargetID]
				for _, id := range teamMembers[sh.TargetID] {
					add(id)
				}
			case "user":
				mine = sh.TargetID == userID
				add(sh.TargetID)
			}
			if mine && perm != "owner" {
				if sh.Permission != "viewer" {
					perm = "editor"
				} else if perm == "" {
					perm = "viewer"
				}
			}
		}
		sort.SliceStable(others, func(a, b int) bool {
			na, nb := strings.ToLower(others[a].DisplayName), strings.ToLower(others[b].DisplayName)
			if na != nb {
				return na < nb
			}
			return others[a].UserID < others[b].UserID
		})
		tl.Members = append([]domain.TaskListMember{{UserID: tl.UserID, DisplayName: owner.name, Email: owner.email, AvatarURL: owner.avatar, Role: "owner"}}, others...)
		tl.Permission = perm
	}
	return nil
}

func (s *Store) GetTaskLists(userID string) ([]domain.TaskList, error) {
	// Before the query: looking up the language needs a connection of its own, and holding the rows' one
	// meanwhile can use up the pool (deadlock under load)
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
		return []domain.TaskList{}, err
	}

	list := make([]domain.TaskList, 0)
	for rows.Next() {
		var tl domain.TaskList
		var colsJSON string
		if err := rows.Scan(&tl.ID, &tl.UserID, &tl.SpaceID, &tl.Title, &tl.Icon, &tl.Color, &colsJSON, &tl.CreatedAt, &tl.UpdatedAt); !dbFailed(err) {
			tl.IsOwner = (tl.UserID == userID)
			_ = json.Unmarshal([]byte(colsJSON), &tl.Columns)
			if len(tl.Columns) == 0 {
				tl.Columns = defaultCols
			}
			list = append(list, tl)
		}
	}
	if err := rows.Err(); err != nil {
		return []domain.TaskList{}, err
	}
	_ = rows.Close()

	if err := s.attachTaskListDetails(userID, list); err != nil {
		return []domain.TaskList{}, err
	}
	sortByListOrder(list, order, taskListID)
	return list, nil
}

func (s *Store) GetTaskListByID(userID, listID string) (*domain.TaskList, error) {
	var tl domain.TaskList
	var colsJSON string
	err := s.db.QueryRow(
		`SELECT id, user_id, space_id, title, icon, color, COALESCE(columns, '[]'), created_at, updated_at
		 FROM task_lists
		 WHERE id = ? AND id IN (`+accessibleTaskListsSQL+`)`,
		append([]any{listID}, accessibleTaskListArgs(userID)...)...,
	).Scan(&tl.ID, &tl.UserID, &tl.SpaceID, &tl.Title, &tl.Icon, &tl.Color, &colsJSON, &tl.CreatedAt, &tl.UpdatedAt)
	if err != nil {
		return nil, err
	}
	tl.IsOwner = (tl.UserID == userID)
	_ = json.Unmarshal([]byte(colsJSON), &tl.Columns)
	if len(tl.Columns) == 0 {
		tl.Columns = defaultColumns(s.MessageLanguage(userID))
	}
	one := []domain.TaskList{tl}
	if err := s.attachTaskListDetails(userID, one); err != nil {
		return nil, err
	}
	tl = one[0]
	return &tl, nil
}

// TaskListTitle is the title of a task list the user can see ("" otherwise), without the details
// GetTaskListByID gathers (counts, shares, members).
func (s *Store) TaskListTitle(userID, listID string) string {
	var title string
	logDBErr(rowErr(s.db.QueryRow(`SELECT title FROM task_lists WHERE id = ? AND id IN (`+accessibleTaskListsSQL+`)`,
		append([]any{listID}, accessibleTaskListArgs(userID)...)...).Scan(&title)))
	return title
}

// TaskListColumns are the board columns of a task list the user can see, as GetTaskListByID gives them
// (the default columns in the user's language while the list has none); ok is false without access.
func (s *Store) TaskListColumns(userID, listID string) (cols []domain.KanbanColumn, ok bool) {
	var colsJSON string
	err := s.db.QueryRow(`SELECT COALESCE(columns, '[]') FROM task_lists WHERE id = ? AND id IN (`+accessibleTaskListsSQL+`)`,
		append([]any{listID}, accessibleTaskListArgs(userID)...)...).Scan(&colsJSON)
	if err != nil {
		logDBErr(rowErr(err))
		return nil, false
	}
	_ = json.Unmarshal([]byte(colsJSON), &cols)
	if len(cols) == 0 {
		cols = defaultColumns(s.MessageLanguage(userID))
	}
	return cols, true
}

func (s *Store) UpdateTaskList(userID, listID string, title, icon, color, spaceID *string, columns *[]domain.KanbanColumn) (*domain.TaskList, error) {
	tl, err := s.GetTaskListByID(userID, listID)
	if err != nil {
		return nil, err
	}
	if tl.Permission == "viewer" {
		return nil, ErrTaskListReadOnly
	}
	if title != nil {
		tl.Title = strings.TrimSpace(*title)
	}
	if icon != nil && *icon != "" {
		tl.Icon = *icon
	}
	if color != nil && *color != "" {
		tl.Color = *color
	}
	if spaceID != nil {
		tl.SpaceID = *spaceID
	}
	if columns != nil {
		tl.Columns = *columns
	}
	tl.UpdatedAt = domain.NowISO()
	colsJSON, _ := json.Marshal(tl.Columns)
	_, err = s.db.Exec(
		`UPDATE task_lists SET title = ?, icon = ?, color = ?, space_id = ?, columns = ?, updated_at = ? WHERE id = ?`,
		tl.Title, tl.Icon, tl.Color, tl.SpaceID, string(colsJSON), tl.UpdatedAt, listID,
	)
	if err != nil {
		return nil, err
	}
	return s.GetTaskListByID(userID, listID)
}

func (s *Store) DeleteTaskList(userID, listID string) error {
	var owner string
	if err := s.db.QueryRow(`SELECT user_id FROM task_lists WHERE id = ?`, listID).Scan(&owner); err != nil || owner != userID {
		return errors.New("Aufgabenliste nicht gefunden")
	}
	// The tasks stay (as personal tasks of their owners), shares and the list go – all or nothing
	if err := s.execInTx(
		stmt(`UPDATE thoughts SET task_list_id = '' WHERE task_list_id = ?`, listID),
		// Its trashed tasks likewise land in their creators' own trash
		stmt(`UPDATE trashed_tasks SET task_list_id = '', owner_id = user_id WHERE task_list_id = ?`, listID),
		stmt(`DELETE FROM task_list_shares WHERE task_list_id = ?`, listID),
		stmt(`DELETE FROM task_list_mutes WHERE task_list_id = ?`, listID),
		stmt(`DELETE FROM task_lists WHERE id = ? AND user_id = ?`, listID, userID),
	); err != nil {
		return err
	}
	s.PruneTaskAssignees()
	return nil
}
