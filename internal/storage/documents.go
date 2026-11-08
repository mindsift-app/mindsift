package storage

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

func (s *Store) loadDocBlocks(docID string, fallbackJSON string) []domain.DocumentBlock {
	if d, _, err := loadCollabDoc(s.db, docID); err == nil && len(d.Blocks) > 0 {
		blocks := flatDocumentBlocks(docID, d)
		if links, subLinks := s.DocTaskLinks(docID); len(links) > 0 {
			for i := range blocks {
				blocks[i].TaskID = links[blocks[i].ID]
				blocks[i].SubtaskOf = subLinks[blocks[i].ID]
			}
		}
		return blocks
	}

	// Very old notes only stored blocks_json; convert them once
	blocks := make([]domain.DocumentBlock, 0)
	if fallbackJSON != "" && fallbackJSON != "[]" {
		_ = json.Unmarshal([]byte(fallbackJSON), &blocks)
		if len(blocks) > 0 {
			s.replaceDocBlocksInDB(docID, "", blocks, domain.NowISO())
			if d, _, err := loadCollabDoc(s.db, docID); err == nil {
				return flatDocumentBlocks(docID, d)
			}
		}
	}
	return blocks
}

// GetAuthorizedDocUsers returns all user IDs who have read/write/owner access to docID.
func (s *Store) GetAuthorizedDocUsers(docID string) ([]string, error) {
	userSet := make(map[string]bool)

	var ownerID, sharedFolderID string
	err := s.db.QueryRow(`SELECT user_id, shared_folder_id FROM documents WHERE id = ?`, docID).Scan(&ownerID, &sharedFolderID)
	if err != nil {
		return nil, err
	}
	if ownerID != "" {
		userSet[ownerID] = true
	}

	// Direct user shares
	uRows, err := s.db.Query(`SELECT user_id FROM doc_shares WHERE doc_id = ?`, docID)
	if err == nil {
		for uRows.Next() {
			var uid string
			if err := uRows.Scan(&uid); err == nil && uid != "" {
				userSet[uid] = true
			}
		}
		_ = uRows.Close()
	}

	// Team shares
	tRows, err := s.db.Query(`
		SELECT tm.user_id
		FROM doc_team_shares dts
		JOIN team_members tm ON tm.team_id = dts.team_id
		WHERE dts.doc_id = ?
	`, docID)
	if err == nil {
		for tRows.Next() {
			var uid string
			if err := tRows.Scan(&uid); err == nil && uid != "" {
				userSet[uid] = true
			}
		}
		_ = tRows.Close()
	}

	// Shared folder access
	if sharedFolderID != "" {
		sfUsers, err := s.GetAuthorizedSharedFolderUsers(sharedFolderID)
		if err == nil {
			for _, uid := range sfUsers {
				userSet[uid] = true
			}
		}
	}

	users := make([]string, 0, len(userSet))
	for uid := range userSet {
		users = append(users, uid)
	}
	return users, nil
}

// GetAuthorizedSharedFolderUsers returns all user IDs who have access to a shared folder.
func (s *Store) GetAuthorizedSharedFolderUsers(folderID string) ([]string, error) {
	userSet := make(map[string]bool)

	var ownerID string
	if err := s.db.QueryRow(`SELECT owner_id FROM workspace_shared_folders WHERE id = ?`, folderID).Scan(&ownerID); err == nil && ownerID != "" {
		userSet[ownerID] = true
	}

	rows, err := s.db.Query(`
		SELECT target_type, target_id FROM workspace_folder_shares WHERE folder_id = ?
	`, folderID)
	if err == nil {
		type shareTarget struct{ tType, tID string }
		var targets []shareTarget
		for rows.Next() {
			var st shareTarget
			if err := rows.Scan(&st.tType, &st.tID); err == nil {
				targets = append(targets, st)
			}
		}
		_ = rows.Close()

		for _, st := range targets {
			if st.tType == "user" && st.tID != "" {
				userSet[st.tID] = true
			} else if st.tType == "team" && st.tID != "" {
				mRows, err := s.db.Query(`SELECT user_id FROM team_members WHERE team_id = ?`, st.tID)
				if err == nil {
					for mRows.Next() {
						var uid string
						if err := mRows.Scan(&uid); err == nil && uid != "" {
							userSet[uid] = true
						}
					}
					_ = mRows.Close()
				}
			}
		}
	}

	users := make([]string, 0, len(userSet))
	for uid := range userSet {
		users = append(users, uid)
	}
	return users, nil
}

func (s *Store) CreateDocument(userID, spaceID, title, icon, folderPath string, blocks []domain.DocumentBlock, tags []string, isPinned bool) (*domain.Document, error) {
	if strings.TrimSpace(title) == "" {
		title = i18n.T(s.MessageLanguage(userID), "Unbenannte Notiz")
	}
	if icon == "" {
		icon = "🗒️"
	}
	if blocks == nil {
		blocks = []domain.DocumentBlock{
			{ID: domain.NewID("blk"), Type: "paragraph", Content: ""},
		}
	}
	tags = stripFolderTags(tags)

	var plainBuilder strings.Builder
	for _, b := range blocks {
		if b.Content != "" {
			plainBuilder.WriteString(b.Content)
			plainBuilder.WriteString("\n")
		}
	}

	blocksJSON, _ := json.Marshal(blocks)
	tagsJSON, _ := json.Marshal(tags)
	now := domain.NowISO()
	pinnedInt := 0
	if isPinned {
		pinnedInt = 1
	}

	cleanFolder := cleanFolderPath(folderPath)
	if cleanFolder == "." {
		cleanFolder = ""
	}

	mounts, _, _ := s.getUserFolderMounts(userID)
	var sharedFolderID, subFolderPath string
	if fID, sub, ok := matchMountPath(cleanFolder, mounts); ok {
		sharedFolderID = fID
		subFolderPath = sub
	}

	doc := &domain.Document{
		ID:             domain.NewID("doc"),
		UserID:         userID,
		SpaceID:        spaceID,
		Title:          strings.TrimSpace(title),
		Icon:           icon,
		Content:        plainBuilder.String(),
		Blocks:         blocks,
		Tags:           tags,
		FolderPath:     cleanFolder,
		IsPinned:       isPinned,
		SharedFolderID: sharedFolderID,
		SubFolderPath:  subFolderPath,
		IsSharedFolder: sharedFolderID != "",
		Permission:     "owner",
		IsOwner:        true,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	_, err := s.db.Exec(
		`INSERT INTO documents (id, user_id, space_id, title, icon, content, blocks_json, tags, folder_path, is_pinned, is_archived, created_at, updated_at, shared_folder_id, sub_folder_path)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
		doc.ID, doc.UserID, doc.SpaceID, doc.Title, doc.Icon, doc.Content, string(blocksJSON), string(tagsJSON), doc.FolderPath, pinnedInt, doc.CreatedAt, doc.UpdatedAt, doc.SharedFolderID, doc.SubFolderPath,
	)
	if err != nil {
		return nil, err
	}
	if isPinned {
		_, _ = s.db.Exec(`INSERT OR IGNORE INTO doc_pins (user_id, doc_id, created_at) VALUES (?, ?, ?)`, userID, doc.ID, doc.CreatedAt)
	}
	s.replaceDocBlocksInDB(doc.ID, userID, doc.Blocks, now)
	_ = s.indexDocBlockTags(doc.ID, doc.UserID, doc.Blocks)
	return doc, nil
}

// getUserFolderMounts returns map[folder_id]mount_path and map[folder_id]folder_name for all shared folders accessible to userID
func (s *Store) getUserFolderMounts(userID string) (map[string]string, map[string]string, error) {
	mounts := make(map[string]string)
	names := make(map[string]string)

	rows, err := s.db.Query(`
		SELECT f.id, f.name, COALESCE(m.mount_path, f.name) as mount_path
		FROM workspace_shared_folders f
		LEFT JOIN workspace_folder_mounts m ON m.folder_id = f.id AND m.user_id = ?
		LEFT JOIN workspace_folder_shares s ON s.folder_id = f.id AND (
			(s.target_type = 'user' AND s.target_id = ?) OR
			(s.target_type = 'team' AND s.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		)
		WHERE f.owner_id = ? OR s.id IS NOT NULL
		GROUP BY f.id
	`, userID, userID, userID, userID)
	if err != nil {
		return mounts, names, err
	}
	defer rows.Close()

	for rows.Next() {
		var fID, fName, mPath string
		if err := rows.Scan(&fID, &fName, &mPath); err == nil {
			names[fID] = fName
			if mPath == "" {
				mPath = fName
			}
			mounts[fID] = mPath
		}
	}
	return mounts, names, nil
}

// matchMountPath checks if folderPath falls within any mounted shared folder.
// Returns (sharedFolderID, relativeSubPath, isMatch).
// CheckCreateInFolder: new notes may go into own folders and into shared folders with write access.
func (s *Store) CheckCreateInFolder(userID, folderPath string) error {
	mounts, _, err := s.getUserFolderMounts(userID)
	if err != nil {
		return err
	}
	fID, _, ok := matchMountPath(folderPath, mounts)
	if !ok {
		return nil
	}
	sf, err := s.GetSharedFolderByID(userID, fID)
	if err != nil {
		return err
	}
	if sf.Permission != "owner" && sf.Permission != "write" && !sf.IsOwner {
		return i18n.NewError("Im geteilten Ordner „{folder}“ darfst du nur lesen", "folder", sf.Name)
	}
	return nil
}

func matchMountPath(folderPath string, mounts map[string]string) (string, string, bool) {
	clean := cleanFolderPath(folderPath)
	if clean == "." {
		clean = ""
	}
	if clean == "" {
		return "", "", false
	}

	var bestFolderID string
	var bestSubPath string
	var longestMountLen int = -1

	for fID, mPath := range mounts {
		cleanMount := cleanFolderPath(mPath)
		if cleanMount == "." {
			cleanMount = ""
		}
		if cleanMount == "" {
			continue
		}

		if clean == cleanMount {
			if len(cleanMount) > longestMountLen {
				longestMountLen = len(cleanMount)
				bestFolderID = fID
				bestSubPath = ""
			}
		} else if strings.HasPrefix(clean, cleanMount+"/") {
			sub := strings.TrimPrefix(clean, cleanMount+"/")
			if len(cleanMount) > longestMountLen {
				longestMountLen = len(cleanMount)
				bestFolderID = fID
				bestSubPath = sub
			}
		}
	}

	if longestMountLen >= 0 {
		return bestFolderID, bestSubPath, true
	}
	return "", "", false
}

func resolveDocumentPath(userID string, doc *domain.Document, mounts map[string]string, names map[string]string, userFolders map[string]string) {
	if doc.SharedFolderID != "" {
		mountPath, ok := mounts[doc.SharedFolderID]
		if !ok || mountPath == "" {
			mountPath = names[doc.SharedFolderID]
			if mountPath == "" {
				mountPath = "Geteilter Ordner"
			}
		}
		doc.IsSharedFolder = true
		if doc.SubFolderPath != "" {
			doc.FolderPath = mountPath + "/" + doc.SubFolderPath
		} else {
			doc.FolderPath = mountPath
		}
	} else {
		if uf, ok := userFolders[doc.ID]; ok {
			doc.FolderPath = uf
		} else if !doc.IsOwner {
			doc.FolderPath = ""
		}
	}
}

func scanDocument(rows interface {
	Scan(dest ...any) error
}) (*domain.Document, error) {
	d := &domain.Document{}
	var blocksStr, tagsStr string
	var isPinned, isArchived int
	err := rows.Scan(
		&d.ID, &d.UserID, &d.SpaceID, &d.Title, &d.Icon, &d.Content,
		&blocksStr, &tagsStr, &d.FolderPath, &isPinned, &isArchived, &d.CreatedAt, &d.UpdatedAt,
		&d.SharedFolderID, &d.SubFolderPath,
	)
	if err != nil {
		return nil, err
	}
	d.IsPinned = isPinned != 0
	d.IsArchived = isArchived != 0
	d.Blocks = []domain.DocumentBlock{}
	d.Tags = []string{}
	_ = json.Unmarshal([]byte(blocksStr), &d.Blocks)
	_ = json.Unmarshal([]byte(tagsStr), &d.Tags)
	d.Tags = stripFolderTags(d.Tags)
	return d, nil
}

func (s *Store) scanDocumentWithBlocks(rows interface {
	Scan(dest ...any) error
}) (*domain.Document, error) {
	d := &domain.Document{}
	var blocksStr, tagsStr string
	var isPinned, isArchived int
	err := rows.Scan(
		&d.ID, &d.UserID, &d.SpaceID, &d.Title, &d.Icon, &d.Content,
		&blocksStr, &tagsStr, &d.FolderPath, &isPinned, &isArchived, &d.CreatedAt, &d.UpdatedAt,
		&d.SharedFolderID, &d.SubFolderPath,
	)
	if err != nil {
		return nil, err
	}
	d.IsPinned = isPinned != 0
	d.IsArchived = isArchived != 0
	d.Tags = []string{}
	_ = json.Unmarshal([]byte(tagsStr), &d.Tags)
	d.Tags = stripFolderTags(d.Tags)
	d.Blocks = s.loadDocBlocks(d.ID, blocksStr)
	d.MarkdownCache = domain.CompileBlocksToMarkdown(d.Blocks)
	d.FolderID = d.FolderPath
	return d, nil
}

func (s *Store) GetDocuments(userID string) ([]domain.Document, error) {
	mounts, names, _ := s.getUserFolderMounts(userID)

	userFolders := make(map[string]string)
	ufRows, err := s.db.Query(`SELECT doc_id, folder_path FROM doc_user_folders WHERE user_id = ?`, userID)
	if err == nil {
		for ufRows.Next() {
			var did, fp string
			if err := ufRows.Scan(&did, &fp); err == nil {
				userFolders[did] = fp
			}
		}
		_ = ufRows.Close()
	}

	// 1. Fetch user's own documents (with per-user is_pinned from doc_pins)
	rows, err := s.db.Query(
		`SELECT d.id, d.user_id, d.space_id, d.title, d.icon, d.content, d.blocks_json, d.tags, d.folder_path,
		        CASE WHEN p.doc_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned,
		        d.is_archived, d.created_at, d.updated_at,
		        d.shared_folder_id, d.sub_folder_path
		 FROM documents d
		 LEFT JOIN doc_pins p ON p.doc_id = d.id AND p.user_id = ?
		 WHERE d.user_id = ? AND d.is_archived = 0
		 ORDER BY is_pinned DESC, d.updated_at DESC`,
		userID, userID,
	)
	if err != nil {
		return nil, err
	}

	type rawDocRow struct {
		doc       domain.Document
		blocksStr string
	}
	var ownRaw []rawDocRow
	for rows.Next() {
		d := domain.Document{}
		var blocksStr, tagsStr string
		var isPinned, isArchived int
		if err := rows.Scan(
			&d.ID, &d.UserID, &d.SpaceID, &d.Title, &d.Icon, &d.Content,
			&blocksStr, &tagsStr, &d.FolderPath, &isPinned, &isArchived, &d.CreatedAt, &d.UpdatedAt,
			&d.SharedFolderID, &d.SubFolderPath,
		); err == nil {
			d.IsPinned = isPinned != 0
			d.IsArchived = isArchived != 0
			d.Tags = []string{}
			_ = json.Unmarshal([]byte(tagsStr), &d.Tags)
			d.Tags = stripFolderTags(d.Tags)
			d.Permission = "owner"
			d.IsOwner = true
			resolveDocumentPath(userID, &d, mounts, names, userFolders)
			ownRaw = append(ownRaw, rawDocRow{doc: d, blocksStr: blocksStr})
		}
	}
	_ = rows.Close()

	docs := make([]domain.Document, 0, len(ownRaw))
	for _, r := range ownRaw {
		r.doc.Blocks = s.loadDocBlocks(r.doc.ID, r.blocksStr)
		docs = append(docs, r.doc)
	}

	// 2. Fetch documents shared with the user directly, via teams, or via shared folders
	sharedRows, err := s.db.Query(
		`SELECT d.id, d.user_id, d.space_id, d.title, d.icon, d.content, d.blocks_json, d.tags, d.folder_path,
		        CASE WHEN p.doc_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned,
		        d.is_archived, d.created_at, d.updated_at,
		        d.shared_folder_id, d.sub_folder_path,
		        CASE
		            WHEN wsf.owner_id = ? THEN 'owner'
		            WHEN COALESCE(s.permission, '') = 'write' OR COALESCE(dts.permission, '') = 'write' OR COALESCE(wfs.permission, '') = 'write' THEN 'write'
		            ELSE 'read'
		        END AS permission,
		        u.display_name
		 FROM documents d
		 JOIN users u ON d.user_id = u.id
		 LEFT JOIN doc_shares s ON d.id = s.doc_id AND s.user_id = ?
		 LEFT JOIN (
		     SELECT dts2.doc_id, dts2.permission
		     FROM doc_team_shares dts2
		     JOIN team_members tm ON tm.team_id = dts2.team_id
		     WHERE tm.user_id = ?
		 ) dts ON d.id = dts.doc_id
		 LEFT JOIN workspace_shared_folders wsf ON d.shared_folder_id = wsf.id
		 LEFT JOIN (
		     SELECT wfs2.folder_id, wfs2.permission
		     FROM workspace_folder_shares wfs2
		     WHERE (wfs2.target_type = 'user' AND wfs2.target_id = ?)
		        OR (wfs2.target_type = 'team' AND wfs2.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		 ) wfs ON d.shared_folder_id = wfs.folder_id
		 LEFT JOIN doc_pins p ON p.doc_id = d.id AND p.user_id = ?
		 WHERE d.is_archived = 0 AND d.user_id != ? AND (
		     s.user_id IS NOT NULL OR dts.doc_id IS NOT NULL OR wsf.owner_id = ? OR wfs.folder_id IS NOT NULL
		 )
		 GROUP BY d.id
		 ORDER BY is_pinned DESC, d.updated_at DESC`,
		userID, userID, userID, userID, userID, userID, userID, userID,
	)
	if err == nil {
		var sharedRaw []rawDocRow
		for sharedRows.Next() {
			d := domain.Document{}
			var blocksStr, tagsStr string
			var isPinned, isArchived int
			var perm, ownerName string
			if scanErr := sharedRows.Scan(
				&d.ID, &d.UserID, &d.SpaceID, &d.Title, &d.Icon, &d.Content,
				&blocksStr, &tagsStr, &d.FolderPath, &isPinned, &isArchived, &d.CreatedAt, &d.UpdatedAt,
				&d.SharedFolderID, &d.SubFolderPath,
				&perm, &ownerName,
			); scanErr == nil {
				d.IsPinned = isPinned != 0
				d.IsArchived = isArchived != 0
				d.Tags = []string{}
				_ = json.Unmarshal([]byte(tagsStr), &d.Tags)
				d.Tags = stripFolderTags(d.Tags)
				d.Permission = perm
				d.IsOwner = (perm == "owner")
				d.OwnerName = ownerName
				resolveDocumentPath(userID, &d, mounts, names, userFolders)
				sharedRaw = append(sharedRaw, rawDocRow{doc: d, blocksStr: blocksStr})
			}
		}
		_ = sharedRows.Close()

		for _, r := range sharedRaw {
			r.doc.Blocks = s.loadDocBlocks(r.doc.ID, r.blocksStr)
			docs = append(docs, r.doc)
		}
	}

	// 3. Attach shares to owned documents
	for i := range docs {
		if docs[i].IsOwner {
			if shares, err := s.GetDocShares(docs[i].ID); err == nil {
				docs[i].SharedWith = shares
			}
		}
	}

	return docs, nil
}

func (s *Store) GetDocumentByID(userID, docID string) (*domain.Document, error) {
	mounts, names, _ := s.getUserFolderMounts(userID)
	userFolders := make(map[string]string)
	var personalFp string
	if err := s.db.QueryRow(`SELECT folder_path FROM doc_user_folders WHERE user_id = ? AND doc_id = ?`, userID, docID).Scan(&personalFp); err == nil {
		userFolders[docID] = personalFp
	}

	// Try owned document first (with per-user is_pinned)
	row := s.db.QueryRow(
		`SELECT d.id, d.user_id, d.space_id, d.title, d.icon, d.content, d.blocks_json, d.tags, d.folder_path,
		        CASE WHEN p.doc_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned,
		        d.is_archived, d.created_at, d.updated_at,
		        d.shared_folder_id, d.sub_folder_path
		 FROM documents d
		 LEFT JOIN doc_pins p ON p.doc_id = d.id AND p.user_id = ?
		 WHERE d.id = ? AND (d.user_id = ? OR (d.is_archived = 1 AND d.archived_by = ?))`,
		userID, docID, userID, userID,
	)
	doc, err := s.scanDocumentWithBlocks(row)
	if err == nil {
		doc.Permission = "owner"
		doc.IsOwner = doc.UserID == userID
		if doc.IsArchived {
			doc.Permission = "read" // read-only while in the trash
		}
		resolveDocumentPath(userID, doc, mounts, names, userFolders)
		if shares, err := s.GetDocShares(doc.ID); err == nil {
			doc.SharedWith = shares
		}
		return doc, nil
	}

	// Try shared document (direct, via team, or via shared folder)
	sharedRow := s.db.QueryRow(
		`SELECT d.id, d.user_id, d.space_id, d.title, d.icon, d.content, d.blocks_json, d.tags, d.folder_path,
		        CASE WHEN p.doc_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned,
		        d.is_archived, d.created_at, d.updated_at,
		        d.shared_folder_id, d.sub_folder_path,
		        CASE
		            WHEN wsf.owner_id = ? THEN 'owner'
		            WHEN COALESCE(s.permission, '') = 'write' OR COALESCE(dts.permission, '') = 'write' OR COALESCE(wfs.permission, '') = 'write' THEN 'write'
		            ELSE 'read'
		        END AS permission,
		        u.display_name
		 FROM documents d
		 JOIN users u ON d.user_id = u.id
		 LEFT JOIN doc_shares s ON d.id = s.doc_id AND s.user_id = ?
		 LEFT JOIN (
		     SELECT dts2.doc_id, dts2.permission
		     FROM doc_team_shares dts2
		     JOIN team_members tm ON tm.team_id = dts2.team_id
		     WHERE tm.user_id = ?
		 ) dts ON d.id = dts.doc_id
		 LEFT JOIN workspace_shared_folders wsf ON d.shared_folder_id = wsf.id
		 LEFT JOIN (
		     SELECT wfs2.folder_id, wfs2.permission
		     FROM workspace_folder_shares wfs2
		     WHERE (wfs2.target_type = 'user' AND wfs2.target_id = ?)
		        OR (wfs2.target_type = 'team' AND wfs2.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		 ) wfs ON d.shared_folder_id = wfs.folder_id
		 LEFT JOIN doc_pins p ON p.doc_id = d.id AND p.user_id = ?
		 WHERE d.id = ? AND d.is_archived = 0 AND (s.user_id = ? OR dts.doc_id IS NOT NULL OR wsf.owner_id = ? OR wfs.folder_id IS NOT NULL)
		 LIMIT 1`,
		userID, userID, userID, userID, userID, userID, docID, userID, userID,
	)
	d := &domain.Document{}
	var blocksStr, tagsStr string
	var isPinned, isArchived int
	var perm, ownerName string
	err = sharedRow.Scan(
		&d.ID, &d.UserID, &d.SpaceID, &d.Title, &d.Icon, &d.Content,
		&blocksStr, &tagsStr, &d.FolderPath, &isPinned, &isArchived, &d.CreatedAt, &d.UpdatedAt,
		&d.SharedFolderID, &d.SubFolderPath,
		&perm, &ownerName,
	)
	if err != nil {
		return nil, err
	}
	d.IsPinned = isPinned != 0
	d.IsArchived = isArchived != 0
	d.Tags = []string{}
	_ = json.Unmarshal([]byte(tagsStr), &d.Tags)
	d.Tags = stripFolderTags(d.Tags)
	d.Blocks = s.loadDocBlocks(d.ID, blocksStr)
	d.Permission = perm
	d.IsOwner = (perm == "owner")
	d.OwnerName = ownerName
	resolveDocumentPath(userID, d, mounts, names, userFolders)
	if shares, err := s.GetDocShares(d.ID); err == nil {
		d.SharedWith = shares
	}
	return d, nil
}

func (s *Store) UpdateDocument(userID, docID string, title, icon, folderPath *string, isPinned *bool) (*domain.Document, error) {
	doc, err := s.GetDocumentByID(userID, docID)
	if err != nil {
		return nil, err
	}
	if doc.IsArchived {
		return nil, ErrDocInTrash
	}

	// Pins and folder placement are personal; title and icon need edit rights. The content (blocks) is
	// only changed through the operation log (POST /docs/{id}/sync).
	changesContent := title != nil || icon != nil
	if changesContent && !CanEditDoc(s.DocRole(userID, docID)) {
		return nil, fmt.Errorf("keine Schreibberechtigung für dieses Dokument (nur Lesezugriff)")
	}

	if isPinned != nil {
		doc.IsPinned = *isPinned
		pin := []sqlStmt{stmt(`DELETE FROM doc_pins WHERE user_id = ? AND doc_id = ?`, userID, docID)}
		if *isPinned {
			pin = []sqlStmt{stmt(`INSERT OR IGNORE INTO doc_pins (user_id, doc_id, created_at) VALUES (?, ?, ?)`, userID, docID, domain.NowISO())}
		}
		if doc.IsOwner {
			pin = append(pin, stmt(`UPDATE documents SET is_pinned = ? WHERE id = ?`, boolInt(*isPinned), docID))
		}
		if err := s.execInTx(pin...); err != nil {
			return nil, err
		}
	}

	if folderPath != nil {
		movedDoc, moveErr := s.MoveDocument(userID, docID, *folderPath)
		if moveErr != nil {
			return nil, moveErr
		}
		doc.FolderPath = movedDoc.FolderPath
		doc.SharedFolderID = movedDoc.SharedFolderID
		doc.SubFolderPath = movedDoc.SubFolderPath
		doc.IsSharedFolder = movedDoc.IsSharedFolder
	}

	if !changesContent {
		return doc, nil
	}
	if title != nil {
		doc.Title = strings.TrimSpace(*title)
		s.applyLegacyTitle(docID, userID, doc.Title)
	}
	if icon != nil {
		doc.Icon = *icon
	}
	doc.UpdatedAt = domain.NowISO()
	if _, err := s.db.Exec(`UPDATE documents SET icon = ?, updated_at = ? WHERE id = ?`, doc.Icon, doc.UpdatedAt, docID); err != nil {
		return nil, err
	}
	return s.GetDocumentByID(userID, docID)
}

func (s *Store) DeleteDocument(userID, docID string) error {
	doc, err := s.GetDocumentByID(userID, docID)
	if err != nil {
		return err
	}
	if !doc.IsOwner {
		// Collaborator removing their shared access
		if _, err := s.db.Exec(`DELETE FROM doc_user_folders WHERE user_id = ? AND doc_id = ?`, userID, docID); err != nil {
			return err
		}
		return s.DeleteDocShare(userID, docID, userID)
	}
	if doc.IsArchived {
		return s.hardDeleteDocument(docID)
	}
	return s.trashDocument(userID, docID)
}

func (s *Store) reindexAllDocBlockTags() error {
	rows, err := s.db.Query(`SELECT id, user_id, blocks_json FROM documents WHERE is_archived = 0`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type docInfo struct {
		id, userID, blocksJSON string
	}
	var docs []docInfo
	for rows.Next() {
		var d docInfo
		if err := rows.Scan(&d.id, &d.userID, &d.blocksJSON); err == nil {
			docs = append(docs, d)
		}
	}
	_ = rows.Close()

	for _, d := range docs {
		blocks := s.loadDocBlocks(d.id, d.blocksJSON)
		if len(blocks) > 0 {
			_ = s.indexDocBlockTags(d.id, d.userID, blocks)
		}
	}
	return nil
}

func (s *Store) indexDocBlockTags(docID, _ string, blocks []domain.DocumentBlock) error {
	_, _ = s.db.Exec(`DELETE FROM block_tags WHERE document_id = ?`, docID)
	if len(blocks) == 0 {
		return nil
	}

	stmt, err := s.db.Prepare(`INSERT OR IGNORE INTO block_tags (tag, document_id, block_id) VALUES (?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, b := range blocks {
		if b.Content == "" {
			continue
		}
		tags := domain.ExtractTags(b.Content)
		for _, tag := range tags {
			_, _ = stmt.Exec(tag, docID, b.ID)
		}
	}
	return nil
}

func (s *Store) GetDocShares(docID string) ([]domain.DocShare, error) {
	shares := make([]domain.DocShare, 0)

	// 1. Direct user shares
	uRows, err := s.db.Query(
		`SELECT s.id, s.doc_id, s.user_id, u.email, u.display_name, s.permission, s.created_by, s.created_at
		 FROM doc_shares s
		 JOIN users u ON s.user_id = u.id
		 WHERE s.doc_id = ?
		 ORDER BY s.created_at ASC`,
		docID,
	)
	if err == nil {
		for uRows.Next() {
			var sh domain.DocShare
			if err := uRows.Scan(&sh.ID, &sh.DocID, &sh.UserID, &sh.UserEmail, &sh.DisplayName, &sh.Permission, &sh.CreatedBy, &sh.CreatedAt); err == nil {
				sh.TargetType = "user"
				sh.TargetID = sh.UserID
				sh.TargetName = sh.DisplayName
				shares = append(shares, sh)
			}
		}
		_ = uRows.Close()
	}

	// 2. Team shares
	tRows, err := s.db.Query(
		`SELECT s.id, s.doc_id, s.team_id, t.name, s.permission, s.created_by, s.created_at
		 FROM doc_team_shares s
		 JOIN teams t ON s.team_id = t.id
		 WHERE s.doc_id = ?
		 ORDER BY s.created_at ASC`,
		docID,
	)
	if err == nil {
		for tRows.Next() {
			var sh domain.DocShare
			var teamID, teamName string
			if err := tRows.Scan(&sh.ID, &sh.DocID, &teamID, &teamName, &sh.Permission, &sh.CreatedBy, &sh.CreatedAt); err == nil {
				sh.TargetType = "team"
				sh.TargetID = teamID
				sh.TargetName = teamName
				sh.DisplayName = teamName
				shares = append(shares, sh)
			}
		}
		_ = tRows.Close()
	}

	return shares, nil
}

func (s *Store) CreateDocTeamShare(currentUserID, docID, teamID, permission string) (*domain.DocShare, error) {
	doc, err := s.GetDocumentByID(currentUserID, docID)
	if err != nil {
		return nil, err
	}
	if !doc.IsOwner {
		return nil, fmt.Errorf("nur der Eigentümer kann Freigaben verwalten")
	}

	cleanTeamID := strings.TrimSpace(teamID)
	var teamName string
	err = s.db.QueryRow(`SELECT name FROM teams WHERE id = ?`, cleanTeamID).Scan(&teamName)
	if err != nil || !s.CanShareWith(currentUserID, "team", cleanTeamID) {
		return nil, ErrTargetNotFound
	}

	permission = normalizeSharePermission(permission)

	now := domain.NowISO()
	shareID := domain.NewID("share")
	_, err = s.db.Exec(
		`INSERT INTO doc_team_shares (id, doc_id, team_id, permission, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(doc_id, team_id) DO UPDATE SET permission = excluded.permission`,
		shareID, docID, cleanTeamID, permission, now, currentUserID,
	)
	if err != nil {
		return nil, err
	}

	return &domain.DocShare{
		ID:          shareID,
		DocID:       docID,
		TargetType:  "team",
		TargetID:    cleanTeamID,
		TargetName:  teamName,
		DisplayName: teamName,
		Permission:  permission,
		CreatedBy:   currentUserID,
		CreatedAt:   now,
	}, nil
}

// normalizeSharePermission maps share roles from the API to the stored values: "write" (editor) or "read" (viewer).
func normalizeSharePermission(p string) string {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "write", "editor":
		return "write"
	}
	return "read"
}

func (s *Store) CreateDocShare(currentUserID, docID, targetUserIdentifier, permission string) (*domain.DocShare, error) {
	doc, err := s.GetDocumentByID(currentUserID, docID)
	if err != nil {
		return nil, err
	}
	if doc.IsArchived {
		return nil, ErrDocInTrash
	}
	if !doc.IsOwner {
		return nil, fmt.Errorf("nur der Eigentümer kann Freigaben verwalten")
	}

	cleanTarget := strings.TrimSpace(targetUserIdentifier)

	// If identifier looks like a team or is prefixed with team_, route to CreateDocTeamShare
	if strings.HasPrefix(cleanTarget, "team_") {
		return s.CreateDocTeamShare(currentUserID, docID, cleanTarget, permission)
	}

	permission = normalizeSharePermission(permission)

	// Resolve target user by ID, username, or Email
	var targetUser *domain.User
	if strings.HasPrefix(cleanTarget, "usr_") {
		targetUser, _ = s.GetUserByID(cleanTarget)
	}
	if targetUser == nil {
		targetUser, _ = s.GetUserByLogin(cleanTarget)
	}
	if targetUser == nil {
		targetUser, err = s.GetUserByID(cleanTarget)
	}
	if err != nil || targetUser == nil {
		// Check if it's a team ID that doesn't start with team_
		var tName string
		if s.db.QueryRow(`SELECT name FROM teams WHERE id = ?`, cleanTarget).Scan(&tName) == nil {
			return s.CreateDocTeamShare(currentUserID, docID, cleanTarget, permission)
		}
		return nil, ErrTargetNotFound
	}

	if targetUser.ID == doc.UserID {
		return nil, fmt.Errorf("dokument gehört bereits diesem Benutzer")
	}
	if !s.CanShareWith(currentUserID, "user", targetUser.ID) {
		return nil, ErrTargetNotFound
	}

	now := domain.NowISO()
	shareID := domain.NewID("share")
	_, err = s.db.Exec(
		`INSERT INTO doc_shares (id, doc_id, user_id, permission, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(doc_id, user_id) DO UPDATE SET permission = excluded.permission`,
		shareID, docID, targetUser.ID, permission, now, currentUserID,
	)
	if err != nil {
		return nil, err
	}

	return &domain.DocShare{
		ID:          shareID,
		DocID:       docID,
		TargetType:  "user",
		TargetID:    targetUser.ID,
		TargetName:  targetUser.DisplayName,
		UserID:      targetUser.ID,
		UserEmail:   targetUser.Email,
		DisplayName: targetUser.DisplayName,
		Permission:  permission,
		CreatedBy:   currentUserID,
		CreatedAt:   now,
	}, nil
}

func (s *Store) DeleteDocShare(currentUserID, docID, targetID string) error {
	doc, err := s.GetDocumentByID(currentUserID, docID)
	if err != nil {
		return err
	}
	// Only the owner manages shares; everyone else can only remove their own
	if !doc.IsOwner && currentUserID != targetID {
		return fmt.Errorf("keine Berechtigung zum Entfernen der Freigabe")
	}

	cleanTarget := strings.TrimSpace(targetID)
	// Try deleting team share first
	res, err := s.db.Exec(`DELETE FROM doc_team_shares WHERE doc_id = ? AND (id = ? OR team_id = ?)`, docID, cleanTarget, cleanTarget)
	if err == nil {
		if rows, _ := res.RowsAffected(); rows > 0 {
			return nil
		}
	}

	// Fallback to user share
	_, err = s.db.Exec(`DELETE FROM doc_shares WHERE doc_id = ? AND (id = ? OR user_id = ?)`, docID, cleanTarget, cleanTarget)
	return err
}

// GetCollaborators returns the active people the user can share with (everyone visible except the user).
func (s *Store) GetCollaborators(currentUserID string) ([]domain.User, error) {
	visible, err := s.GetDiscoverableUsers(currentUserID)
	if err != nil {
		return nil, err
	}
	users := make([]domain.User, 0, len(visible))
	for _, u := range visible {
		if u.ID != currentUserID && u.IsActive {
			users = append(users, u)
		}
	}
	return users, nil
}

// ClearIcon removes the icon of a note, task list or list (created on purpose without one; the create
// functions put in a default for an empty icon).
func (s *Store) ClearIcon(table, id string) error {
	switch table {
	case "documents", "task_lists", "lists":
	default:
		return fmt.Errorf("unknown table %q", table)
	}
	_, err := s.db.Exec(`UPDATE `+table+` SET icon = '' WHERE id = ?`, id)
	return err
}
