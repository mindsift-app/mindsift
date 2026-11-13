package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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
	rows, err := s.db.Query(
		`SELECT id, task_list_id, target_type, target_id, permission, created_at
		 FROM task_list_shares WHERE task_list_id = ? ORDER BY created_at ASC`,
		taskListID,
	)
	if err != nil {
		return []domain.TaskListShare{}, err
	}
	defer rows.Close()

	shares := make([]domain.TaskListShare, 0)
	for rows.Next() {
		var sh domain.TaskListShare
		if err := rows.Scan(&sh.ID, &sh.TaskListID, &sh.TargetType, &sh.TargetID, &sh.Permission, &sh.CreatedAt); !dbFailed(err) {
			shares = append(shares, sh)
		}
	}
	if err := rows.Err(); err != nil {
		return []domain.TaskListShare{}, err
	}
	for i := range shares {
		if shares[i].TargetType == "team" {
			logDBErr(s.db.QueryRow(`SELECT name FROM teams WHERE id = ?`, shares[i].TargetID).Scan(&shares[i].TargetName))
		} else {
			logDBErr(s.db.QueryRow(`SELECT display_name, email, avatar_url FROM users WHERE id = ?`, shares[i].TargetID).Scan(&shares[i].TargetName, &shares[i].Email, &shares[i].AvatarURL))
		}
	}
	return shares, nil
}

// queryUserIDs runs a query returning a single user_id column and collects the distinct IDs.
func (s *Store) queryUserIDs(query string, args ...any) []string {
	rows, err := s.db.Query(query, args...)
	if dbFailed(err) {
		return []string{}
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
	logDBErr(rows.Err())
	return ids
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

func (s *Store) getMembersForTaskList(tl *domain.TaskList) []domain.TaskListMember {
	memberMap := make(map[string]domain.TaskListMember)

	// 1. Owner
	var ownerName, ownerEmail, ownerAvatar string
	logDBErr(s.db.QueryRow(`SELECT display_name, email, avatar_url FROM users WHERE id = ?`, tl.UserID).Scan(&ownerName, &ownerEmail, &ownerAvatar))
	memberMap[tl.UserID] = domain.TaskListMember{
		UserID:      tl.UserID,
		DisplayName: ownerName,
		Email:       ownerEmail,
		AvatarURL:   ownerAvatar,
		Role:        "owner",
	}

	// 2. From task_list_shares
	for _, sh := range tl.Shares {
		switch sh.TargetType {
		case "team":
			rows, err := s.db.Query(
				`SELECT u.id, u.display_name, u.email, u.avatar_url FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ?`,
				sh.TargetID,
			)
			if err == nil {
				for rows.Next() {
					var m domain.TaskListMember
					if err := rows.Scan(&m.UserID, &m.DisplayName, &m.Email, &m.AvatarURL); !dbFailed(err) {
						m.Role = "member"
						memberMap[m.UserID] = m
					}
				}
				logDBErr(rows.Err())
				_ = rows.Close()
			}
		case "user":
			var m domain.TaskListMember
			if err := s.db.QueryRow(`SELECT id, display_name, email, avatar_url FROM users WHERE id = ?`, sh.TargetID).Scan(&m.UserID, &m.DisplayName, &m.Email, &m.AvatarURL); err == nil {
				m.Role = "member"
				memberMap[m.UserID] = m
			}
		}
	}

	result := make([]domain.TaskListMember, 0, len(memberMap))
	for _, m := range memberMap {
		result = append(result, m)
	}
	return result
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

	for i := range list {
		list[i].Members = make([]domain.TaskListMember, 0)
		list[i].Shares = make([]domain.TaskListShare, 0)

		logDBErr(s.db.QueryRow(
			`SELECT COUNT(*) FROM thoughts WHERE task_list_id = ? AND is_completed = 0 AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))`,
			list[i].ID,
		).Scan(&list[i].TasksCount))
		logDBErr(s.db.QueryRow(`SELECT display_name FROM users WHERE id = ?`, list[i].UserID).Scan(&list[i].OwnerName))

		shares, _ := s.GetTaskListShares(list[i].ID)
		list[i].Shares = shares
		list[i].Permission = s.GetTaskListPermission(userID, list[i].ID)
		list[i].Members = s.getMembersForTaskList(&list[i])
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
	logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE task_list_id = ? AND is_completed = 0 AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))`, tl.ID).Scan(&tl.TasksCount))
	logDBErr(s.db.QueryRow(`SELECT display_name FROM users WHERE id = ?`, tl.UserID).Scan(&tl.OwnerName))
	shares, _ := s.GetTaskListShares(tl.ID)
	tl.Shares = shares
	tl.Permission = s.GetTaskListPermission(userID, tl.ID)
	tl.Members = s.getMembersForTaskList(&tl)
	return &tl, nil
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
