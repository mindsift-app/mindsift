package storage

import (
	"database/sql"
	"errors"
	"regexp"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// --- STANDALONE REALTIME LISTS & SHARING ---

func (s *Store) CreateList(userID, title, icon, listType string) (*domain.SharedList, error) {
	if strings.TrimSpace(title) == "" {
		return nil, errors.New("list title required")
	}
	if icon == "" {
		icon = "🛒"
	}
	if listType == "" {
		listType = "shopping"
	}
	now := domain.NowISO()
	lst := &domain.SharedList{
		ID:        domain.NewID("lst"),
		UserID:    userID,
		IsOwner:   true,
		Role:      "editor",
		Title:     strings.TrimSpace(title),
		Icon:      icon,
		ListType:  listType,
		Items:     []domain.ListItem{},
		Shares:    []domain.ListShare{},
		UpdatedAt: now,
		CreatedAt: now,
	}

	_, err := s.db.Exec(
		`INSERT INTO lists (id, user_id, title, icon, list_type, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		lst.ID, lst.UserID, lst.Title, lst.Icon, lst.ListType, lst.UpdatedAt, lst.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	_ = s.db.QueryRow(`SELECT display_name FROM users WHERE id = ?`, userID).Scan(&lst.OwnerName)
	return lst, nil
}

func (s *Store) AddListShare(currentUserID, listID, targetType, targetID, role string) (*domain.ListShare, error) {
	if targetType != "team" && targetType != "user" {
		return nil, errors.New("ungültiger Freigabetyp")
	}
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return nil, errors.New("Ziel-ID erforderlich")
	}
	if role != "viewer" && role != "editor" {
		role = "editor"
	}

	if targetType == "user" {
		var targetUser *domain.User
		if strings.HasPrefix(targetID, "usr_") {
			targetUser, _ = s.GetUserByID(targetID)
		}
		if targetUser == nil {
			targetUser, _ = s.GetUserByLogin(targetID)
		}
		if targetUser == nil {
			targetUser, _ = s.GetUserByEmail(targetID)
		}
		if targetUser == nil {
			return nil, ErrTargetNotFound
		}
		targetID = targetUser.ID
	}

	// Only the owner shares
	var ownerID string
	err := s.db.QueryRow(`SELECT user_id FROM lists WHERE id = ?`, listID).Scan(&ownerID)
	if err != nil {
		return nil, errors.New("liste nicht gefunden")
	}
	if ownerID != currentUserID {
		return nil, errors.New("nur der Eigentümer kann die Liste freigeben")
	}
	if !s.CanShareWith(currentUserID, targetType, targetID) {
		return nil, ErrTargetNotFound
	}

	now := domain.NowISO()
	share := &domain.ListShare{
		ID:         domain.NewID("lsh"),
		ListID:     listID,
		TargetType: targetType,
		TargetID:   targetID,
		Role:       role,
		CreatedBy:  currentUserID,
		CreatedAt:  now,
	}

	_, err = s.db.Exec(
		`INSERT INTO list_shares (id, list_id, target_type, target_id, role, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(list_id, target_type, target_id) DO UPDATE SET role = excluded.role`,
		share.ID, share.ListID, share.TargetType, share.TargetID, share.Role, share.CreatedBy, share.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	_ = s.db.QueryRow(`SELECT id, created_at FROM list_shares WHERE list_id = ? AND target_type = ? AND target_id = ?`,
		listID, targetType, targetID).Scan(&share.ID, &share.CreatedAt)

	if targetType == "team" {
		_ = s.db.QueryRow(`SELECT name FROM teams WHERE id = ?`, targetID).Scan(&share.TargetName)
	} else {
		_ = s.db.QueryRow(`SELECT display_name, email FROM users WHERE id = ?`, targetID).Scan(&share.TargetName, &share.Email)
	}
	return share, nil
}

func (s *Store) RemoveListShare(currentUserID, listID, shareIDOrTargetID string) error {
	var ownerID string
	err := s.db.QueryRow(`SELECT user_id FROM lists WHERE id = ?`, listID).Scan(&ownerID)
	if err != nil {
		return errors.New("liste nicht gefunden")
	}
	if ownerID != currentUserID {
		return errors.New("nur der Eigentümer kann Freigaben entfernen")
	}

	cleanTarget := strings.TrimSpace(shareIDOrTargetID)
	_, err = s.db.Exec(
		`DELETE FROM list_shares WHERE list_id = ? AND (id = ? OR target_id = ?)`,
		listID, cleanTarget, cleanTarget,
	)
	return err
}

func (s *Store) GetListShares(listID string) ([]domain.ListShare, error) {
	rows, err := s.db.Query(
		`SELECT id, list_id, target_type, target_id, role, created_by, created_at
		 FROM list_shares WHERE list_id = ? ORDER BY created_at ASC`,
		listID,
	)
	if err != nil {
		return []domain.ListShare{}, err
	}
	defer rows.Close()

	shares := make([]domain.ListShare, 0)
	for rows.Next() {
		var sh domain.ListShare
		if err := rows.Scan(&sh.ID, &sh.ListID, &sh.TargetType, &sh.TargetID, &sh.Role, &sh.CreatedBy, &sh.CreatedAt); err == nil {
			if sh.TargetType == "team" {
				_ = s.db.QueryRow(`SELECT name FROM teams WHERE id = ?`, sh.TargetID).Scan(&sh.TargetName)
			} else {
				_ = s.db.QueryRow(`SELECT display_name, email FROM users WHERE id = ?`, sh.TargetID).Scan(&sh.TargetName, &sh.Email)
			}
			shares = append(shares, sh)
		}
	}
	return shares, nil
}

func (s *Store) GetAllListsForUser(userID string) ([]domain.SharedList, error) {
	rows, err := s.db.Query(
		`SELECT DISTINCT l.id, l.user_id, l.title, l.icon, l.list_type, l.updated_at, l.created_at,
		        u.display_name,
		        CASE 
		            WHEN l.user_id = ? THEN 'owner'
		            WHEN ls.role IS NOT NULL THEN ls.role
		            ELSE 'editor'
		        END as effective_role
		 FROM lists l
		 LEFT JOIN users u ON u.id = l.user_id
		 LEFT JOIN list_shares ls ON ls.list_id = l.id AND (
		     (ls.target_type = 'user' AND ls.target_id = ?)
		     OR (ls.target_type = 'team' AND ls.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		 )
		 WHERE l.user_id = ?
		    OR ls.id IS NOT NULL
		 ORDER BY l.updated_at DESC`,
		userID, userID, userID, userID,
	)
	if err != nil {
		return nil, err
	}

	lists := make([]domain.SharedList, 0)
	for rows.Next() {
		var l domain.SharedList
		var ownerName sql.NullString
		var effectiveRole string
		if err := rows.Scan(&l.ID, &l.UserID, &l.Title, &l.Icon, &l.ListType, &l.UpdatedAt, &l.CreatedAt, &ownerName, &effectiveRole); err == nil {
			l.OwnerName = ownerName.String
			l.IsOwner = (l.UserID == userID)
			l.Role = effectiveRole
			lists = append(lists, l)
		}
	}
	_ = rows.Close()

	for i := range lists {
		lists[i].Items, _ = s.GetListItems(lists[i].ID)
		lists[i].Shares, _ = s.GetListShares(lists[i].ID)
		lists[i].Members = s.getListMembers(lists[i].ID, lists[i].UserID)
	}
	return lists, nil
}

func (s *Store) GetListByID(userID, listID string) (*domain.SharedList, error) {
	var l domain.SharedList
	var ownerName sql.NullString
	var effectiveRole string

	var query string
	var args []interface{}
	if userID == "" {
		query = `SELECT l.id, l.user_id, l.title, l.icon, l.list_type, l.updated_at, l.created_at,
		        u.display_name, 'owner' as effective_role
		 FROM lists l
		 LEFT JOIN users u ON u.id = l.user_id
		 WHERE l.id = ?`
		args = []interface{}{listID}
	} else {
		query = `SELECT l.id, l.user_id, l.title, l.icon, l.list_type, l.updated_at, l.created_at,
		        u.display_name,
		        CASE 
		            WHEN l.user_id = ? THEN 'owner'
		            WHEN ls.role IS NOT NULL THEN ls.role
		            ELSE 'editor'
		        END as effective_role
		 FROM lists l
		 LEFT JOIN users u ON u.id = l.user_id
		 LEFT JOIN list_shares ls ON ls.list_id = l.id AND (
		     (ls.target_type = 'user' AND ls.target_id = ?)
		     OR (ls.target_type = 'team' AND ls.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		 )
		 WHERE l.id = ? AND (
		     l.user_id = ?
		     OR ls.id IS NOT NULL
		 )`
		args = []interface{}{userID, userID, userID, listID, userID}
	}

	err := s.db.QueryRow(query, args...).Scan(&l.ID, &l.UserID, &l.Title, &l.Icon, &l.ListType, &l.UpdatedAt, &l.CreatedAt, &ownerName, &effectiveRole)
	if err != nil {
		return nil, err
	}
	l.OwnerName = ownerName.String
	l.IsOwner = (userID == "" || l.UserID == userID)
	l.Role = effectiveRole
	l.Items, _ = s.GetListItems(l.ID)
	l.Shares, _ = s.GetListShares(l.ID)
	l.Members = s.getListMembers(l.ID, l.UserID)
	return &l, nil
}

// getListMembers returns the owner and everyone a list is shared with (directly or via a team).
func (s *Store) getListMembers(listID, ownerID string) []domain.TaskListMember {
	members := make([]domain.TaskListMember, 0)
	rows, err := s.db.Query(
		`SELECT id, display_name, email, avatar_url FROM users WHERE id IN (
		    SELECT user_id FROM lists WHERE id = ?
		    UNION SELECT target_id FROM list_shares WHERE list_id = ? AND target_type = 'user'
		    UNION SELECT user_id FROM team_members WHERE team_id IN (SELECT target_id FROM list_shares WHERE list_id = ? AND target_type = 'team')
		 ) ORDER BY display_name`,
		listID, listID, listID,
	)
	if err != nil {
		return members
	}
	defer rows.Close()
	for rows.Next() {
		var m domain.TaskListMember
		if rows.Scan(&m.UserID, &m.DisplayName, &m.Email, &m.AvatarURL) == nil {
			m.Role = "member"
			if m.UserID == ownerID {
				m.Role = "owner"
			}
			members = append(members, m)
		}
	}
	return members
}

func (s *Store) DeleteList(userID, listID string) error {
	var ownerID string
	err := s.db.QueryRow(`SELECT user_id FROM lists WHERE id = ?`, listID).Scan(&ownerID)
	if err != nil {
		return errors.New("liste nicht gefunden")
	}
	if ownerID != userID {
		return errors.New("nur der Eigentümer kann die Liste löschen")
	}
	_, err = s.db.Exec(`DELETE FROM lists WHERE id = ?`, listID)
	return err
}

func (s *Store) GetListItems(listID string) ([]domain.ListItem, error) {
	rows, err := s.db.Query(
		`SELECT li.id, li.list_id, li.content, li.category, li.quantity, li.is_completed, li.completed_by, li.completed_by_name,
		        li.created_by, COALESCE(u.display_name, ''), li.sort_order, li.created_at, li.completed_at, `+originColumns("li.")+`
		 FROM list_items li LEFT JOIN users u ON u.id = li.created_by AND li.created_by != ''
		 WHERE li.list_id = ?
		 ORDER BY li.is_completed ASC, li.sort_order ASC, li.created_at DESC`,
		listID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.ListItem, 0)
	for rows.Next() {
		var it domain.ListItem
		var doneInt int
		var o originDest
		if err := rows.Scan(&it.ID, &it.ListID, &it.Content, &it.Category, &it.Quantity, &doneInt, &it.CompletedBy, &it.CompletedByName, &it.CreatedBy, &it.CreatedByName, &it.SortOrder, &it.CreatedAt, &it.CompletedAt, &o.createdVia, &o.createdKey, &o.changedVia, &o.changedKey, &o.changedAt); err == nil {
			it.IsCompleted = doneInt != 0
			it.Origin = o.result()
			items = append(items, it)
		}
	}
	return items, nil
}

func (s *Store) CreateListItem(listID, content, category, quantity string, sortOrder int, createdBy string) (*domain.ListItem, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, errors.New("item content cannot be empty")
	}

	category = strings.TrimSpace(category)
	// Auto-extract hashtag if category is empty
	if category == "" && strings.Contains(content, "#") {
		re := regexp.MustCompile(`#([\p{L}\p{N}_-]+)`)
		if m := re.FindStringSubmatch(content); len(m) > 1 {
			category = m[1]
			cleaned := strings.TrimSpace(re.ReplaceAllString(content, ""))
			if cleaned != "" {
				content = cleaned
			}
		}
	} else if category != "" {
		category = strings.TrimPrefix(category, "#")
	}

	now := domain.NowISO()
	it := &domain.ListItem{
		ID:          domain.NewID("itm"),
		ListID:      listID,
		Content:     content,
		Category:    category,
		Quantity:    strings.TrimSpace(quantity),
		IsCompleted: false,
		SortOrder:   sortOrder,
		CreatedBy:   createdBy,
		CreatedAt:   now,
	}
	if createdBy != "" {
		_ = s.db.QueryRow(`SELECT display_name FROM users WHERE id = ?`, createdBy).Scan(&it.CreatedByName)
	}

	_, err := s.db.Exec(
		`INSERT INTO list_items (id, list_id, content, category, quantity, is_completed, sort_order, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
		it.ID, it.ListID, it.Content, it.Category, it.Quantity, it.SortOrder, it.CreatedAt, it.CreatedBy,
	)
	if err != nil {
		return nil, err
	}

	_, _ = s.db.Exec(`UPDATE lists SET updated_at = ? WHERE id = ?`, now, listID)
	return it, nil
}

func (s *Store) ToggleListItem(itemID string, isCompleted bool, userID, userName string) (*domain.ListItem, error) {
	now := domain.NowISO()
	doneInt := 0
	completedAt := ""
	completedBy := ""
	completedByName := ""
	if isCompleted {
		doneInt = 1
		completedAt = now
		completedBy = userID
		completedByName = userName
	}

	_, err := s.db.Exec(
		`UPDATE list_items SET is_completed = ?, completed_by = ?, completed_by_name = ?, completed_at = ? WHERE id = ?`,
		doneInt, completedBy, completedByName, completedAt, itemID,
	)
	if err != nil {
		return nil, err
	}

	var it domain.ListItem
	var dInt int
	var o originDest
	err = s.db.QueryRow(
		`SELECT id, list_id, content, category, quantity, is_completed, completed_by, completed_by_name, sort_order, created_at, completed_at, `+originColumns("")+`
		 FROM list_items WHERE id = ?`,
		itemID,
	).Scan(&it.ID, &it.ListID, &it.Content, &it.Category, &it.Quantity, &dInt, &it.CompletedBy, &it.CompletedByName, &it.SortOrder, &it.CreatedAt, &it.CompletedAt,
		&o.createdVia, &o.createdKey, &o.changedVia, &o.changedKey, &o.changedAt)
	if err != nil {
		return nil, err
	}
	it.IsCompleted = dInt != 0
	it.Origin = o.result()
	_, _ = s.db.Exec(`UPDATE lists SET updated_at = ? WHERE id = ?`, now, it.ListID)
	return &it, nil
}

func (s *Store) UpdateListItem(itemID string, content *string, category *string, quantity *string) (*domain.ListItem, error) {
	now := domain.NowISO()
	var it domain.ListItem
	var dInt int
	var o originDest
	err := s.db.QueryRow(
		`SELECT id, list_id, content, category, quantity, is_completed, completed_by, completed_by_name, sort_order, created_at, completed_at, `+originColumns("")+`
		 FROM list_items WHERE id = ?`,
		itemID,
	).Scan(&it.ID, &it.ListID, &it.Content, &it.Category, &it.Quantity, &dInt, &it.CompletedBy, &it.CompletedByName, &it.SortOrder, &it.CreatedAt, &it.CompletedAt,
		&o.createdVia, &o.createdKey, &o.changedVia, &o.changedKey, &o.changedAt)
	if err != nil {
		return nil, err
	}
	it.IsCompleted = dInt != 0
	it.Origin = o.result()

	if content != nil {
		it.Content = *content
	}
	if category != nil {
		it.Category = *category
	}
	if quantity != nil {
		it.Quantity = *quantity
	}

	_, err = s.db.Exec(`UPDATE list_items SET content = ?, category = ?, quantity = ? WHERE id = ?`, it.Content, it.Category, it.Quantity, itemID)
	if err != nil {
		return nil, err
	}
	_, _ = s.db.Exec(`UPDATE lists SET updated_at = ? WHERE id = ?`, now, it.ListID)
	return &it, nil
}

// MoveListItem moves an item into another list, where it lands at the top like a new entry
// (content, category, quantity and checked state stay). Permissions are checked by the caller.
func (s *Store) MoveListItem(itemID, targetListID string) (*domain.ListItem, error) {
	var sourceListID string
	if err := s.db.QueryRow(`SELECT list_id FROM list_items WHERE id = ?`, itemID).Scan(&sourceListID); err != nil {
		return nil, ErrListNotFound
	}
	now := domain.NowISO()
	if _, err := s.db.Exec(`UPDATE list_items SET list_id = ?, sort_order = 0 WHERE id = ?`, targetListID, itemID); err != nil {
		return nil, err
	}
	_, _ = s.db.Exec(`UPDATE lists SET updated_at = ? WHERE id IN (?, ?)`, now, sourceListID, targetListID)

	var it domain.ListItem
	var dInt int
	var o originDest
	err := s.db.QueryRow(
		`SELECT li.id, li.list_id, li.content, li.category, li.quantity, li.is_completed, li.completed_by, li.completed_by_name,
		        li.created_by, COALESCE(u.display_name, ''), li.sort_order, li.created_at, li.completed_at, `+originColumns("li.")+`
		 FROM list_items li LEFT JOIN users u ON u.id = li.created_by AND li.created_by != ''
		 WHERE li.id = ?`,
		itemID,
	).Scan(&it.ID, &it.ListID, &it.Content, &it.Category, &it.Quantity, &dInt, &it.CompletedBy, &it.CompletedByName, &it.CreatedBy, &it.CreatedByName, &it.SortOrder, &it.CreatedAt, &it.CompletedAt, &o.createdVia, &o.createdKey, &o.changedVia, &o.changedKey, &o.changedAt)
	if err != nil {
		return nil, err
	}
	it.IsCompleted = dInt != 0
	it.Origin = o.result()
	return &it, nil
}

func (s *Store) DeleteListItem(itemID string) (string, error) {
	var listID string
	_ = s.db.QueryRow(`SELECT list_id FROM list_items WHERE id = ?`, itemID).Scan(&listID)
	_, err := s.db.Exec(`DELETE FROM list_items WHERE id = ?`, itemID)
	if listID != "" {
		_, _ = s.db.Exec(`UPDATE lists SET updated_at = ? WHERE id = ?`, domain.NowISO(), listID)
	}
	return listID, err
}

func (s *Store) ClearCompletedListItems(listID string) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM list_items WHERE list_id = ? AND is_completed = 1`, listID)
	if err != nil {
		return 0, err
	}
	_, _ = s.db.Exec(`UPDATE lists SET updated_at = ? WHERE id = ?`, domain.NowISO(), listID)
	return res.RowsAffected()
}

func (s *Store) ReorderListItems(listID string, items []domain.ListItemReorderItem) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, it := range items {
		if it.Category != nil && it.Content != nil {
			_, err = tx.Exec(
				`UPDATE list_items SET sort_order = ?, category = ?, content = ? WHERE id = ? AND list_id = ?`,
				it.SortOrder, *it.Category, *it.Content, it.ID, listID,
			)
		} else if it.Category != nil {
			_, err = tx.Exec(
				`UPDATE list_items SET sort_order = ?, category = ? WHERE id = ? AND list_id = ?`,
				it.SortOrder, *it.Category, it.ID, listID,
			)
		} else if it.Content != nil {
			_, err = tx.Exec(
				`UPDATE list_items SET sort_order = ?, content = ? WHERE id = ? AND list_id = ?`,
				it.SortOrder, *it.Content, it.ID, listID,
			)
		} else {
			_, err = tx.Exec(
				`UPDATE list_items SET sort_order = ? WHERE id = ? AND list_id = ?`,
				it.SortOrder, it.ID, listID,
			)
		}
		if err != nil {
			return err
		}
	}

	_, _ = tx.Exec(`UPDATE lists SET updated_at = ? WHERE id = ?`, domain.NowISO(), listID)
	return tx.Commit()
}

// ErrListNotFound: the list does not exist or the user has no access to it (deliberately the same).
var ErrListNotFound = errors.New("Liste nicht gefunden")

// ErrListReadOnly: the list is shared with the user as viewer.
var ErrListReadOnly = errors.New("Diese Liste ist für dich nur lesbar")

// ListRole is the user's role in a list: owner, editor, viewer or "" without access.
func (s *Store) ListRole(userID, listID string) string {
	var role string
	err := s.db.QueryRow(`
		SELECT CASE WHEN l.user_id = ? THEN 'owner'
		            WHEN MAX(CASE WHEN ls.role = 'editor' THEN 1 ELSE 0 END) = 1 THEN 'editor'
		            ELSE 'viewer' END
		FROM lists l
		LEFT JOIN list_shares ls ON ls.list_id = l.id AND (
		    (ls.target_type = 'user' AND ls.target_id = ?)
		    OR (ls.target_type = 'team' AND ls.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		)
		WHERE l.id = ? AND (l.user_id = ? OR ls.id IS NOT NULL)
		GROUP BY l.id`, userID, userID, userID, listID, userID).Scan(&role)
	if err != nil {
		return ""
	}
	return role
}

// EnsureListItemsWritable checks that the user may change the items of a list (owner or editor) and,
// if itemID is given, that the item belongs to that list.
func (s *Store) EnsureListItemsWritable(userID, listID, itemID string) error {
	switch s.ListRole(userID, listID) {
	case "":
		return ErrListNotFound
	case "viewer":
		return ErrListReadOnly
	}
	if itemID != "" {
		var n int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM list_items WHERE id = ? AND list_id = ?`, itemID, listID).Scan(&n)
		if n == 0 {
			return ErrListNotFound
		}
	}
	return nil
}
