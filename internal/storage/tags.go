package storage

import (
	"errors"
	"sort"
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
	// Only the notes the person can see (sqlVisibleDocIDs), not every note of the server; a hashtag is
	// in block_tags once per bullet (key tag, block_id) and every note is in visible once, so COUNT(*)
	// counts the bullets
	rows, err := s.db.Query(
		`WITH visible(id) AS (`+sqlVisibleDocIDs+`)
		 SELECT t.tag, COUNT(*) AS count
		 FROM visible
		 CROSS JOIN documents d ON d.id = visible.id
		 CROSS JOIN block_tags t ON t.document_id = d.id
		 WHERE d.is_archived = 0
		 GROUP BY t.tag
		 ORDER BY count DESC, t.tag ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]domain.TagSummary, 0)
	seen := make(map[string]bool)
	for rows.Next() {
		var ts domain.TagSummary
		if err := rows.Scan(&ts.Tag, &ts.Count); !dbFailed(err) {
			results = append(results, ts)
			seen[ts.Tag] = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
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
			if err := pageRows.Scan(&t); !dbFailed(err) && t != "" && !seen[t] {
				results = append(results, domain.TagSummary{Tag: t, Count: 0})
				seen[t] = true
			}
		}
		logDBErr(pageRows.Err())
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
	logDBErr(s.db.QueryRow(
		`SELECT content, updated_at FROM tag_pages WHERE user_id = ? AND tag = ?`,
		userID, cleanTag,
	).Scan(&noteContent, &noteUpdatedAt))

	// The candidates first (sqlVisibleDocIDs), then their bullets with the hashtag (idx_block_tags_doc_tag),
	// instead of checking every note of the server that has it. The permission comes from DocRole below,
	// the same rule as everywhere else (the best of all shares, the owner of a shared folder owns its notes).
	rows, err := s.db.Query(
		`WITH visible(id) AS (`+sqlVisibleDocIDs+`)
		 SELECT t.block_id, d.id, d.title, d.icon, d.folder_path, d.blocks_json, d.updated_at, d.user_id,
		        COALESCE(u.display_name, '') as owner_name
		 FROM visible
		 CROSS JOIN documents d ON d.id = visible.id
		 CROSS JOIN block_tags t ON t.document_id = d.id AND t.tag = ?2
		 LEFT JOIN users u ON d.user_id = u.id
		 WHERE d.is_archived = 0
		 ORDER BY d.updated_at DESC, d.rowid`,
		userID, cleanTag,
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
	}

	var rawMatches []rawMatch
	for rows.Next() {
		var rm rawMatch
		if err := rows.Scan(&rm.blockID, &rm.docID, &rm.title, &rm.icon, &rm.folderPath, &rm.blocksJSON, &rm.updatedAt, &rm.docUserID, &rm.ownerName); !dbFailed(err) {
			rawMatches = append(rawMatches, rm)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
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

		// In the order of the note: a tagged bullet below another tagged one is then shown under it,
		// not once more on its own before it (the rows come in index order, not note order)
		sort.SliceStable(matches, func(i, j int) bool {
			a, okA := blockIdxMap[matches[i].blockID]
			b, okB := blockIdxMap[matches[j].blockID]
			return okA && (!okB || a < b)
		})
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

		// As the note list shows it: owner, write (editor) or read (viewer)
		role := s.DocRole(userID, first.docID)
		if role == "" {
			continue
		}
		isOwner := role == DocRoleOwner
		permission := "read"
		switch role {
		case DocRoleOwner:
			permission = "owner"
		case DocRoleEditor:
			permission = "write"
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
