package storage

import (
	"errors"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func (s *Store) UpdateTagPageNote(userID, tag, content string) (string, error) {
	cleanTag := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(tag), "#"))
	if cleanTag == "" {
		return "", errors.New("tag name required")
	}
	now := domain.NowISO()
	_, err := s.db.Exec(
		`INSERT INTO tag_pages (user_id, tag, content, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, tag) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
		userID, cleanTag, content, now,
	)
	if err != nil {
		return "", err
	}
	return now, nil
}

func (s *Store) GetWorkspaceTags(userID string) ([]domain.TagSummary, error) {
	rows, err := s.db.Query(
		`SELECT t.tag, COUNT(DISTINCT t.document_id || ':' || t.block_id) as count
		 FROM block_tags t
		 JOIN documents d ON t.document_id = d.id
		 LEFT JOIN doc_shares s ON s.doc_id = d.id AND s.user_id = ?
		 LEFT JOIN (
		     SELECT dts2.doc_id
		     FROM doc_team_shares dts2
		     JOIN team_members tm ON tm.team_id = dts2.team_id
		     WHERE tm.user_id = ?
		 ) dts ON d.id = dts.doc_id
		 LEFT JOIN workspace_shared_folders wsf ON d.shared_folder_id = wsf.id
		 LEFT JOIN (
		     SELECT wfs2.folder_id
		     FROM workspace_folder_shares wfs2
		     WHERE (wfs2.target_type = 'user' AND wfs2.target_id = ?)
		        OR (wfs2.target_type = 'team' AND wfs2.target_id IN (SELECT team_id FROM team_members WHERE user_id = ?))
		 ) wfs ON d.shared_folder_id = wfs.folder_id
		 WHERE (d.user_id = ? OR s.user_id = ? OR dts.doc_id IS NOT NULL OR (wsf.id IS NOT NULL AND (wsf.owner_id = ? OR wfs.folder_id IS NOT NULL)))
		   AND d.is_archived = 0
		 GROUP BY t.tag
		 ORDER BY count DESC, t.tag ASC`,
		userID, userID, userID, userID, userID, userID, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]domain.TagSummary, 0)
	seen := make(map[string]bool)
	for rows.Next() {
		var ts domain.TagSummary
		if err := rows.Scan(&ts.Tag, &ts.Count); err == nil {
			results = append(results, ts)
			seen[ts.Tag] = true
		}
	}
	_ = rows.Close()

	// Also include tags that have a non-empty tag_pages note even if not currently used in a block
	pageRows, err := s.db.Query(
		`SELECT tag FROM tag_pages WHERE user_id = ? AND TRIM(content) != '' ORDER BY tag ASC`,
		userID,
	)
	if err == nil {
		for pageRows.Next() {
			var t string
			if err := pageRows.Scan(&t); err == nil && t != "" && !seen[t] {
				results = append(results, domain.TagSummary{Tag: t, Count: 0})
				seen[t] = true
			}
		}
		_ = pageRows.Close()
	}

	return results, nil
}

func (s *Store) GetTagDetails(userID, tag string) (*domain.TagDetails, error) {
	cleanTag := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(tag), "#"))
	if cleanTag == "" {
		return &domain.TagDetails{Tag: "", Documents: []domain.TagDocumentGroup{}, TotalMatches: 0}, nil
	}

	var noteContent, noteUpdatedAt string
	_ = s.db.QueryRow(
		`SELECT content, updated_at FROM tag_pages WHERE user_id = ? AND tag = ?`,
		userID, cleanTag,
	).Scan(&noteContent, &noteUpdatedAt)

	rows, err := s.db.Query(
		`SELECT t.block_id, d.id, d.title, d.icon, d.folder_path, d.blocks_json, d.updated_at, d.user_id,
		        COALESCE(u.display_name, '') as owner_name,
		        COALESCE(s.permission, dts.permission, wfs.permission, '') as shared_permission
		 FROM block_tags t
		 JOIN documents d ON t.document_id = d.id
		 LEFT JOIN users u ON d.user_id = u.id
		 LEFT JOIN doc_shares s ON s.doc_id = d.id AND s.user_id = ?
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
		 WHERE (d.user_id = ? OR s.user_id = ? OR dts.doc_id IS NOT NULL OR (wsf.id IS NOT NULL AND (wsf.owner_id = ? OR wfs.folder_id IS NOT NULL)))
		   AND t.tag = ?
		   AND d.is_archived = 0
		 ORDER BY d.updated_at DESC`,
		userID, userID, userID, userID, userID, userID, userID, cleanTag,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type rawMatch struct {
		blockID          string
		docID            string
		title            string
		icon             string
		folderPath       string
		blocksJSON       string
		updatedAt        string
		docUserID        string
		ownerName        string
		sharedPermission string
	}

	var rawMatches []rawMatch
	for rows.Next() {
		var rm rawMatch
		if err := rows.Scan(&rm.blockID, &rm.docID, &rm.title, &rm.icon, &rm.folderPath, &rm.blocksJSON, &rm.updatedAt, &rm.docUserID, &rm.ownerName, &rm.sharedPermission); err == nil {
			rawMatches = append(rawMatches, rm)
		}
	}
	_ = rows.Close()

	// Group rawMatches by docID
	docMap := make(map[string][]rawMatch)
	var docOrder []string
	for _, rm := range rawMatches {
		if _, exists := docMap[rm.docID]; !exists {
			docOrder = append(docOrder, rm.docID)
		}
		docMap[rm.docID] = append(docMap[rm.docID], rm)
	}

	totalMatches := 0
	docGroups := make([]domain.TagDocumentGroup, 0, len(docOrder))

	for _, docID := range docOrder {
		matches := docMap[docID]
		first := matches[0]

		blocks := s.loadDocBlocks(first.docID, first.blocksJSON)

		blockIdxMap := make(map[string]int, len(blocks))
		for i, b := range blocks {
			blockIdxMap[b.ID] = i
		}

		matchedBlocks := make([]domain.MatchedTagBlock, 0)
		processedBlockIDs := make(map[string]bool)

		for _, m := range matches {
			if processedBlockIDs[m.blockID] {
				continue
			}
			idx, ok := blockIdxMap[m.blockID]
			if !ok {
				continue
			}
			rootBlock := blocks[idx]
			processedBlockIDs[rootBlock.ID] = true

			children := make([]domain.DocumentBlock, 0)
			rootLevel := rootBlock.Level
			for i := idx + 1; i < len(blocks); i++ {
				if blocks[i].Level > rootLevel {
					children = append(children, blocks[i])
					processedBlockIDs[blocks[i].ID] = true
				} else {
					break
				}
			}

			matchedBlocks = append(matchedBlocks, domain.MatchedTagBlock{
				RootBlock: rootBlock,
				Children:  children,
			})
			totalMatches++
		}

		if len(matchedBlocks) == 0 {
			continue
		}

		isOwner := first.docUserID == userID
		permission := "read"
		if isOwner {
			permission = "owner"
		} else if first.sharedPermission != "" {
			permission = first.sharedPermission
		}

		docGroups = append(docGroups, domain.TagDocumentGroup{
			DocID:         first.docID,
			Title:         first.title,
			Icon:          first.icon,
			FolderPath:    first.folderPath,
			UpdatedAt:     first.updatedAt,
			IsOwner:       isOwner,
			Permission:    permission,
			OwnerName:     first.ownerName,
			MatchedBlocks: matchedBlocks,
		})
	}

	return &domain.TagDetails{
		Tag:           cleanTag,
		NoteContent:   noteContent,
		NoteUpdatedAt: noteUpdatedAt,
		Documents:     docGroups,
		TotalMatches:  totalMatches,
	}, nil
}
