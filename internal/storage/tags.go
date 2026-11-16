package storage

import (
	"encoding/json"
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
	// counts the bullets. One row per hashtag and note: the sidebar filters the folder tree by the notes.
	rows, err := s.db.Query(
		`WITH visible(id) AS (`+sqlVisibleDocIDs+`)
		 SELECT t.tag, d.id, COUNT(*) AS count
		 FROM visible
		 CROSS JOIN documents d ON d.id = visible.id
		 CROSS JOIN block_tags t ON t.document_id = d.id
		 WHERE d.is_archived = 0
		 GROUP BY t.tag, d.id`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]domain.TagSummary, 0)
	byTag := make(map[string]int) // hashtag: index in results
	for rows.Next() {
		var tag, docID string
		var count int
		if err := rows.Scan(&tag, &docID, &count); dbFailed(err) {
			continue
		}
		i, ok := byTag[tag]
		if !ok {
			i = len(results)
			byTag[tag] = i
			results = append(results, domain.TagSummary{Tag: tag, DocIDs: []string{}})
		}
		results[i].Count += count
		results[i].DocIDs = append(results[i].DocIDs, docID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	_ = rows.Close()
	for i := range results {
		sort.Strings(results[i].DocIDs)
	}
	sort.Slice(results, func(i, j int) bool {
		if results[i].Count != results[j].Count {
			return results[i].Count > results[j].Count
		}
		return results[i].Tag < results[j].Tag
	})

	// Also include tags that have a non-empty tag_pages note even if not currently used in a block
	pageRows, err := s.db.Query(
		`SELECT tag FROM tag_pages WHERE user_id = ? AND TRIM(content) != '' ORDER BY tag ASC`,
		userID,
	)
	if err == nil {
		for pageRows.Next() {
			var t string
			if err := pageRows.Scan(&t); !dbFailed(err) && t != "" {
				if _, used := byTag[t]; used {
					continue
				}
				byTag[t] = len(results)
				results = append(results, domain.TagSummary{Tag: t, Count: 0, DocIDs: []string{}})
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
		 SELECT t.block_id, d.id, d.title, d.icon, d.folder_path, d.updated_at, d.user_id,
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
		blockID    string
		docID      string
		title      string
		icon       string
		folderPath string
		updatedAt  string
		docUserID  string
		ownerName  string
	}

	var rawMatches []rawMatch
	for rows.Next() {
		var rm rawMatch
		if err := rows.Scan(&rm.blockID, &rm.docID, &rm.title, &rm.icon, &rm.folderPath, &rm.updatedAt, &rm.docUserID, &rm.ownerName); !dbFailed(err) {
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

	// Only the matched bullets and their subtrees are read with their text (tagMatchBlocks), not the
	// whole notes (a hashtag row belongs to a bullet in the table, so every note has its bullets there)
	tagged := make(map[string][]string, len(docOrder))
	for _, docID := range docOrder {
		for _, m := range docMap[docID] {
			tagged[docID] = append(tagged[docID], m.blockID)
		}
	}
	found, err := s.tagMatchBlocks(tagged)
	if err != nil {
		return nil, err
	}

	totalMatches := 0
	docGroups := make([]domain.TagDocumentGroup, 0, len(docOrder))

	for _, docID := range docOrder {
		matches := docMap[docID]
		first := matches[0]

		matchedBlocks := found[docID]
		totalMatches += len(matchedBlocks)
		if len(matchedBlocks) == 0 {
			continue
		}

		// As the note list shows it: owner, write (editor) or read (viewer). An own note outside the trash
		// (the query reads only those) is the owner's without asking DocRole, which reads two more rows.
		role := DocRoleOwner
		if first.docUserID != userID {
			role = s.DocRole(userID, first.docID)
		}
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

// cutTagMatches cuts the tagged bullets and their children out of a note's flat list (loadDocBlocks), in
// the order of the note: a tagged bullet below another tagged one is shown under it, not once more on its
// own. Rows of bullets the note does not show are skipped.
func cutTagMatches(blocks []domain.DocumentBlock, tagged []string) []domain.MatchedTagBlock {
	idx := make(map[string]int, len(blocks))
	for i, b := range blocks {
		idx[b.ID] = i
	}
	roots := make([]int, 0, len(tagged))
	for _, id := range tagged {
		if i, ok := idx[id]; ok {
			roots = append(roots, i)
		}
	}
	sort.Ints(roots)
	out := make([]domain.MatchedTagBlock, 0)
	next := 0 // flat index up to which bullets are shown already
	for _, i := range roots {
		if i < next {
			continue
		}
		root := blocks[i]
		end := i + 1
		for end < len(blocks) && blocks[end].Level > root.Level {
			end++
		}
		out = append(out, domain.MatchedTagBlock{RootBlock: root, Children: append([]domain.DocumentBlock{}, blocks[i+1:end]...)})
		next = end
	}
	return out
}

// tagMatchBlocks is cutTagMatches for several notes (note to its tagged bullets) without loading whole
// notes: the order and depth of the bullets come from the structure columns alone (parent_id, order_key;
// siblings ordered as collab.Doc.Flatten orders them), then only the matched bullets and their subtrees
// are read with their text, and the task links (as DocTaskLinks gives them) only of the tasks made from
// bullets of these notes. A note without live bullets is left out.
func (s *Store) tagMatchBlocks(tagged map[string][]string) (map[string][]domain.MatchedTagBlock, error) {
	out := map[string][]domain.MatchedTagBlock{}
	if len(tagged) == 0 {
		return out, nil
	}
	docIDs := make([]string, 0, len(tagged))
	for id := range tagged {
		docIDs = append(docIDs, id)
	}
	docsJSON, _ := json.Marshal(docIDs)

	type node struct{ id, orderKey string }
	children := map[string]map[string][]node{} // note, parent: children
	rows, err := s.db.Query(`SELECT document_id, id, COALESCE(parent_id, ''), COALESCE(order_key, '') FROM blocks
		WHERE document_id IN (SELECT value FROM json_each(?)) AND deleted = 0`, string(docsJSON))
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var docID, id, parent, key string
		if err := rows.Scan(&docID, &id, &parent, &key); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if children[docID] == nil {
			children[docID] = map[string][]node{}
		}
		children[docID][parent] = append(children[docID][parent], node{id, key})
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	// The skeleton of each note in display order (id, depth, position as flatDocumentBlocks numbers
	// it), cut like a loaded note
	var need []string
	for docID, byParent := range children {
		for _, list := range byParent {
			sort.Slice(list, func(i, j int) bool {
				if list[i].orderKey != list[j].orderKey {
					return list[i].orderKey < list[j].orderKey
				}
				return list[i].id < list[j].id
			})
		}
		var flat []domain.DocumentBlock
		var walk func(parent string, level int)
		walk = func(parent string, level int) {
			for _, c := range byParent[parent] {
				flat = append(flat, domain.DocumentBlock{ID: c.id, DocumentID: docID, Level: level, Position: float64((len(flat) + 1) * 1000)})
				walk(c.id, level+1)
			}
		}
		walk("", 0)
		if len(flat) == 0 {
			continue
		}
		cut := cutTagMatches(flat, tagged[docID])
		out[docID] = cut
		for _, m := range cut {
			need = append(need, m.RootBlock.ID)
			for _, c := range m.Children {
				need = append(need, c.ID)
			}
		}
	}
	if len(need) == 0 {
		return out, nil
	}

	type text struct {
		typ, content, lang string
		checked, collapsed bool
	}
	texts := make(map[string]text, len(need))
	needJSON, _ := json.Marshal(need)
	rows, err = s.db.Query(`SELECT id, type, content, checked, collapsed, lang FROM blocks
		WHERE id IN (SELECT value FROM json_each(?))`, string(needJSON))
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var t text
		var chk, col int
		if err := rows.Scan(&id, &t.typ, &t.content, &chk, &col, &t.lang); err != nil {
			_ = rows.Close()
			return nil, err
		}
		t.checked, t.collapsed = chk != 0, col != 0
		texts[id] = t
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	links, subLinks, err := s.tagTaskLinks(string(docsJSON))
	if err != nil {
		return nil, err
	}
	fill := func(b *domain.DocumentBlock) {
		t := texts[b.ID]
		b.Type, b.Content, b.Checked, b.Lang, b.Collapsed = t.typ, t.content, t.checked, t.lang, t.collapsed
		if l := links[b.DocumentID]; len(l) > 0 {
			b.TaskID = l[b.ID]
			b.SubtaskOf = subLinks[b.DocumentID][b.ID]
		}
	}
	for _, cut := range out {
		for i := range cut {
			fill(&cut[i].RootBlock)
			for j := range cut[i].Children {
				fill(&cut[i].Children[j])
			}
		}
	}
	return out, nil
}

// tagTaskLinks is DocTaskLinks for several notes (JSON array of ids) in one query: per note the bullets
// linked to a task (bullet to task) and those tied to a subtask of one (bullet to the task of the subtask).
func (s *Store) tagTaskLinks(docsJSON string) (tasks, subtasks map[string]map[string]string, err error) {
	tasks, subtasks = map[string]map[string]string{}, map[string]map[string]string{}
	// sqlTasksOfNoteBlocks per note: a range over idx_thoughts_doc_block
	rows, err := s.db.Query(`SELECT d.value, t.id, t.converted_ref_id, t.subtasks
		FROM json_each(?) d CROSS JOIN thoughts t
		WHERE t.converted_type = 'document_block' AND t.converted_ref_id >= d.value || ':' AND t.converted_ref_id < d.value || ';'
		ORDER BY d.value, t.converted_ref_id, t.rowid`, docsJSON)
	if err != nil {
		return nil, nil, err
	}
	type linked struct{ blockID, taskID, subtasks string }
	byDoc := map[string][]linked{}
	for rows.Next() {
		var docID, taskID, ref, subs string
		if err := rows.Scan(&docID, &taskID, &ref, &subs); err != nil {
			_ = rows.Close()
			return nil, nil, err
		}
		if _, blockID, ok := strings.Cut(ref, ":"); ok {
			if tasks[docID] == nil {
				tasks[docID] = map[string]string{}
			}
			tasks[docID][blockID] = taskID
			byDoc[docID] = append(byDoc[docID], linked{blockID, taskID, subs})
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, nil, err
	}
	_ = rows.Close()
	for docID, list := range byDoc {
		sub := map[string]string{}
		for _, l := range list {
			if tasks[docID][l.blockID] != l.taskID {
				continue // two tasks on one bullet: only the one the bullet shows counts (docSubtaskLinks)
			}
			var subs []domain.SubTask
			_ = json.Unmarshal([]byte(l.subtasks), &subs)
			for _, st := range subs {
				if st.BlockID != "" {
					sub[st.BlockID] = l.taskID
				}
			}
		}
		subtasks[docID] = sub
	}
	return tasks, subtasks, nil
}
