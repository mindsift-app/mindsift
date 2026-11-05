package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// SearchHit represents a single ranked match across documents, tasks/thoughts, and lists.
type SearchHit struct {
	Type    string  `json:"type"` // "document", "thought", "list_item"
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	Snippet string  `json:"snippet"`
	Score   float64 `json:"score,omitempty"`
	DocID   string  `json:"docId,omitempty"`
	BlockID string  `json:"blockId,omitempty"`
	ListID  string  `json:"listId,omitempty"`
	Icon    string  `json:"icon,omitempty"`
	// Bullets: their raw text, and (with SearchOptions.Context) the text of the bullet before and after
	Content string `json:"content,omitempty"`
	Before  string `json:"before,omitempty"`
	After   string `json:"after,omitempty"`
}

// SearchOptions narrow the global search; the zero value searches everything like before.
type SearchOptions struct {
	Type  string // "" (all), "document", "thought" or "list_item"
	Limit int    // hits per kind; 0 = 40, at most 200
	// Tasks: status open|done, task list ("personal" = without list), priority, due today|overdue|week
	TaskStatus, TaskListID, Priority, Due string
	Today                                 string // YYYY-MM-DD in the server's time zone, for Due
	Folder                                string // notes in this folder or below
	ListID, ItemStatus                    string // list items: list, open|done
	// Context: text of the bullets before and after a bullet hit (large search view). It needs the note's
	// block tree, so it is only loaded on request
	Context bool
}

// errSkip marks a part of the search that was not asked for.
var errSkip = errors.New("skipped")

// SearchTypes are the kinds a search can be narrowed to.
var SearchTypes = []string{"document", "thought", "list_item"}

// SearchResults encapsulates all results for backwards-compatible API serialization.
type SearchResults struct {
	Thoughts  []domain.Thought  `json:"thoughts"`
	Documents []domain.Document `json:"documents"`
	ListItems []domain.ListItem `json:"listItems"`
	Hits      []SearchHit       `json:"hits"`
	// Counts: hits per kind in this answer (at most the limit each)
	Counts map[string]int `json:"counts"`
}

var wordTokenRegex = regexp.MustCompile(`[\p{L}\p{N}]+`)

// PrepareFTSQuery extracts valid words from user input and formats them as prefix match tokens.
// E.g. "einkau" -> `"einkau"*`, "Hello World!" -> `"Hello"* "World"*`.
func PrepareFTSQuery(raw string) string {
	matches := wordTokenRegex.FindAllString(strings.TrimSpace(raw), -1)
	if len(matches) == 0 {
		return ""
	}
	tokens := make([]string, 0, len(matches))
	for _, m := range matches {
		clean := strings.ReplaceAll(m, `"`, `""`)
		tokens = append(tokens, fmt.Sprintf(`"%s"*`, clean))
	}
	return strings.Join(tokens, " ")
}

// migrateSearchFTS creates the virtual FTS5 tables and synchronization triggers.
func (s *Store) migrateSearchFTS() {
	tables := []string{
		`CREATE VIRTUAL TABLE IF NOT EXISTS thoughts_fts USING fts5(
			thought_id UNINDEXED,
			content,
			notes,
			subtasks,
			tokenize='unicode61'
		);`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
			doc_id UNINDEXED,
			block_id UNINDEXED,
			title,
			content,
			tokenize='unicode61'
		);`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS list_items_fts USING fts5(
			item_id UNINDEXED,
			list_id UNINDEXED,
			content,
			category,
			tokenize='unicode61'
		);`,
	}

	for _, stmt := range tables {
		if _, err := s.db.Exec(stmt); err != nil {
			slog.Error("Failed to create FTS virtual table", "error", err, "statement", stmt)
		}
	}

	triggers := []string{
		// Thoughts triggers
		`CREATE TRIGGER IF NOT EXISTS trg_thoughts_ai AFTER INSERT ON thoughts BEGIN
			INSERT INTO thoughts_fts(thought_id, content, notes, subtasks)
			VALUES (new.id, new.content, new.notes, new.subtasks);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS trg_thoughts_au AFTER UPDATE ON thoughts BEGIN
			DELETE FROM thoughts_fts WHERE thought_id = old.id;
			INSERT INTO thoughts_fts(thought_id, content, notes, subtasks)
			VALUES (new.id, new.content, new.notes, new.subtasks);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS trg_thoughts_ad AFTER DELETE ON thoughts BEGIN
			DELETE FROM thoughts_fts WHERE thought_id = old.id;
		END;`,

		// Documents triggers
		`CREATE TRIGGER IF NOT EXISTS trg_documents_ai AFTER INSERT ON documents BEGIN
			INSERT INTO documents_fts(doc_id, block_id, title, content)
			VALUES (new.id, '', new.title, '');
		END;`,
		`CREATE TRIGGER IF NOT EXISTS trg_documents_au AFTER UPDATE OF title, is_archived ON documents BEGIN
			DELETE FROM documents_fts WHERE doc_id = old.id AND block_id = '';
			INSERT INTO documents_fts(doc_id, block_id, title, content)
			SELECT new.id, '', new.title, '' WHERE new.is_archived = 0;
		END;`,
		`CREATE TRIGGER IF NOT EXISTS trg_documents_ad AFTER DELETE ON documents BEGIN
			DELETE FROM documents_fts WHERE doc_id = old.id;
		END;`,

		// Blocks triggers (excluding tombstones/deleted blocks)
		`CREATE TRIGGER IF NOT EXISTS trg_blocks_ai AFTER INSERT ON blocks BEGIN
			INSERT INTO documents_fts(doc_id, block_id, title, content)
			SELECT new.document_id, new.id, '', new.content
			WHERE new.deleted = 0 AND (new.deleted_at = '' OR new.deleted_at IS NULL);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS trg_blocks_au AFTER UPDATE OF content, deleted, deleted_at, document_id ON blocks BEGIN
			DELETE FROM documents_fts WHERE doc_id = old.document_id AND block_id = old.id;
			INSERT INTO documents_fts(doc_id, block_id, title, content)
			SELECT new.document_id, new.id, '', new.content
			WHERE new.deleted = 0 AND (new.deleted_at = '' OR new.deleted_at IS NULL);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS trg_blocks_ad AFTER DELETE ON blocks BEGIN
			DELETE FROM documents_fts WHERE doc_id = old.document_id AND block_id = old.id;
		END;`,

		// List items triggers
		`CREATE TRIGGER IF NOT EXISTS trg_list_items_ai AFTER INSERT ON list_items BEGIN
			INSERT INTO list_items_fts(item_id, list_id, content, category)
			VALUES (new.id, new.list_id, new.content, new.category);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS trg_list_items_au AFTER UPDATE ON list_items BEGIN
			DELETE FROM list_items_fts WHERE item_id = old.id;
			INSERT INTO list_items_fts(item_id, list_id, content, category)
			VALUES (new.id, new.list_id, new.content, new.category);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS trg_list_items_ad AFTER DELETE ON list_items BEGIN
			DELETE FROM list_items_fts WHERE item_id = old.id;
		END;`,
	}

	for _, trg := range triggers {
		if _, err := s.db.Exec(trg); err != nil {
			slog.Error("Failed to create FTS trigger", "error", err, "statement", trg)
		}
	}

	s.backfillSearchFTS()
}

// backfillSearchFTS populates empty FTS indices once on startup.
func (s *Store) backfillSearchFTS() {
	var thoughtCount int
	_ = s.db.QueryRow(`SELECT count(*) FROM thoughts_fts`).Scan(&thoughtCount)
	if thoughtCount == 0 {
		_, err := s.db.Exec(`
			INSERT INTO thoughts_fts(thought_id, content, notes, subtasks)
			SELECT id, content, notes, subtasks FROM thoughts;
		`)
		if err != nil {
			slog.Error("Failed to backfill thoughts_fts", "error", err)
		}
	}

	var docCount int
	_ = s.db.QueryRow(`SELECT count(*) FROM documents_fts`).Scan(&docCount)
	if docCount == 0 {
		_, err := s.db.Exec(`
			INSERT INTO documents_fts(doc_id, block_id, title, content)
			SELECT id, '', title, '' FROM documents WHERE is_archived = 0;

			INSERT INTO documents_fts(doc_id, block_id, title, content)
			SELECT document_id, id, '', content FROM blocks
			WHERE deleted = 0 AND (deleted_at = '' OR deleted_at IS NULL);
		`)
		if err != nil {
			slog.Error("Failed to backfill documents_fts", "error", err)
		}
	}

	var listCount int
	_ = s.db.QueryRow(`SELECT count(*) FROM list_items_fts`).Scan(&listCount)
	if listCount == 0 {
		_, err := s.db.Exec(`
			INSERT INTO list_items_fts(item_id, list_id, content, category)
			SELECT id, list_id, content, category FROM list_items;
		`)
		if err != nil {
			slog.Error("Failed to backfill list_items_fts", "error", err)
		}
	}
}

// SearchGlobal executes an FTS5 full-text search across documents, thoughts/tasks and list items,
// filtering results strictly to what the user is authorized to view.
func (s *Store) SearchGlobal(userID, query string) (*SearchResults, error) {
	return s.Search(userID, query, SearchOptions{})
}

// Search is SearchGlobal with options: one kind only, more hits, filters per kind.
func (s *Store) Search(userID, query string, opts SearchOptions) (*SearchResults, error) {
	return s.SearchCtx(context.Background(), userID, query, opts)
}

// SearchCtx is Search with the request's context: a search the client has given up stops at once.
func (s *Store) SearchCtx(ctx context.Context, userID, query string, opts SearchOptions) (*SearchResults, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 40
	}
	if limit > 200 {
		limit = 200
	}
	want := func(kind string) bool { return opts.Type == "" || opts.Type == kind }
	ftsQuery := PrepareFTSQuery(query)
	res := &SearchResults{
		Thoughts:  make([]domain.Thought, 0),
		Documents: make([]domain.Document, 0),
		ListItems: make([]domain.ListItem, 0),
		Hits:      make([]SearchHit, 0),
		Counts:    map[string]int{},
	}

	if ftsQuery == "" {
		return res, nil
	}

	// 1. Search Documents and Blocks
	// Weights: 10.0 for title, 1.0 for block content
	docWhere, docArgs := "", []any{ftsQuery}
	if opts.Folder != "" {
		docWhere = ` AND (d.folder_path = ? OR d.folder_path LIKE ?)`
		docArgs = append(docArgs, opts.Folder, opts.Folder+"/%")
	}
	var docRows *sql.Rows
	var err error
	if want("document") {
		docRows, err = s.db.QueryContext(ctx, `
		SELECT f.doc_id, f.block_id,
		       snippet(documents_fts, -1, '<mark>', '</mark>', '…', 14) AS snip,
		       bm25(documents_fts, 10.0, 1.0) AS score,
		       d.title, d.icon, d.user_id, d.is_archived, COALESCE(b.content, '')
		FROM documents_fts f
		JOIN documents d ON d.id = f.doc_id
		LEFT JOIN blocks b ON f.block_id != '' AND b.id = f.block_id AND b.document_id = f.doc_id
		WHERE documents_fts MATCH ? AND d.is_archived = 0`+docWhere+`
		ORDER BY score ASC
		LIMIT `+strconv.Itoa(limit), docArgs...)
	}
	if want("document") && err == nil {
		// Read all rows first and close them: the access check and loading the note need connections of
		// their own, and holding the rows' one meanwhile can use up the pool (deadlock under load)
		type docRow struct {
			docID, blockID, snip, title, icon, content string
			score                                      float64
		}
		var found []docRow
		for docRows.Next() {
			var r docRow
			var ownerID string
			var isArchived int
			if scanErr := docRows.Scan(&r.docID, &r.blockID, &r.snip, &r.score, &r.title, &r.icon, &ownerID, &isArchived, &r.content); scanErr == nil {
				found = append(found, r)
			}
		}
		_ = docRows.Close()

		seenDocIDs := make(map[string]bool)
		docBlocks := map[string][]domain.DocumentBlock{}
		roles := map[string]string{}
		for _, r := range found {
			// Access check via DocRole
			role, checked := roles[r.docID]
			if !checked {
				role = s.DocRole(userID, r.docID)
				roles[r.docID] = role
			}
			if role == "" {
				continue
			}

			hitID := r.docID
			if r.blockID != "" {
				hitID = r.docID + ":" + r.blockID
			}

			res.Hits = append(res.Hits, SearchHit{
				Type:    "document",
				ID:      hitID,
				Title:   r.title,
				Snippet: r.snip,
				Score:   r.score,
				DocID:   r.docID,
				BlockID: r.blockID,
				Icon:    r.icon,
				Content: r.content,
			})

			// Only what the results show: loading every hit note in full was most of the search's work
			if !seenDocIDs[r.docID] {
				seenDocIDs[r.docID] = true
				res.Documents = append(res.Documents, domain.Document{ID: r.docID, Title: r.title, Icon: r.icon})
				if opts.Context && r.blockID != "" {
					if d, _, err := loadCollabDoc(connOrDB(ctx, s.db), r.docID); err == nil {
						docBlocks[r.docID] = flatDocumentBlocks(r.docID, d)
					}
				}
			}
		}
		// Context of a bullet: the bullets before and after it in the note
		for i := range res.Hits {
			h := &res.Hits[i]
			if h.Type != "document" || h.BlockID == "" {
				continue
			}
			blocks := docBlocks[h.DocID]
			for j, b := range blocks {
				if b.ID != h.BlockID {
					continue
				}
				if j > 0 {
					h.Before = blocks[j-1].Content
				}
				if j+1 < len(blocks) {
					h.After = blocks[j+1].Content
				}
				break
			}
		}
	}

	// 2. Search Thoughts & Tasks
	// Weights: 5.0 for content, 1.0 for notes, 1.0 for subtasks
	taskWhere, taskArgs := "", []any{}
	switch opts.TaskStatus {
	case "open":
		taskWhere += ` AND t.is_completed = 0 AND t.status != 'discarded'`
	case "done":
		taskWhere += ` AND t.is_completed = 1`
	}
	if opts.TaskListID == "personal" {
		taskWhere += ` AND t.task_list_id = ''`
	} else if opts.TaskListID != "" {
		taskWhere += ` AND t.task_list_id = ?`
		taskArgs = append(taskArgs, opts.TaskListID)
	}
	if opts.Priority != "" {
		taskWhere += ` AND t.priority = ?`
		taskArgs = append(taskArgs, opts.Priority)
	}
	if opts.Due != "" && opts.Today != "" {
		switch opts.Due {
		case "today":
			taskWhere += ` AND substr(t.due_date, 1, 10) = ?`
			taskArgs = append(taskArgs, opts.Today)
		case "overdue":
			taskWhere += ` AND t.due_date != '' AND substr(t.due_date, 1, 10) < ? AND t.is_completed = 0`
			taskArgs = append(taskArgs, opts.Today)
		case "week":
			taskWhere += ` AND t.due_date != '' AND substr(t.due_date, 1, 10) <= date(?, '+7 days') AND t.is_completed = 0`
			taskArgs = append(taskArgs, opts.Today)
		}
	}
	var thoughtRows *sql.Rows
	err = errSkip
	if want("thought") {
		thoughtRows, err = s.db.QueryContext(ctx, `
		SELECT f.thought_id,
		       snippet(thoughts_fts, -1, '<mark>', '</mark>', '…', 14) AS snip,
		       bm25(thoughts_fts, 5.0, 1.0, 1.0) AS score,
		       t.id, t.user_id, t.content, t.tags, t.priority, t.source, t.status,
		       t.is_completed, t.converted_type, t.converted_ref_id, t.due_date,
		       t.task_list_id, t.kanban_status, t.notes, t.alarm_sent, t.created_at,
		       t.triaged_at, t.subtasks, t.sort_order
		FROM thoughts_fts f
		JOIN thoughts t ON t.id = f.thought_id
		WHERE thoughts_fts MATCH ?
		  AND (t.user_id = ? OR t.task_list_id IN (`+s.accessibleTaskListIDsQuery()+`))`+taskWhere+`
		-- Open before completed, discarded thoughts last; within each by relevance
		ORDER BY t.status = 'discarded' ASC, t.is_completed ASC, score ASC
		LIMIT `+strconv.Itoa(limit),
			append([]any{ftsQuery, userID, userID, userID, userID}, taskArgs...)...)
	}
	if err == nil {
		for thoughtRows.Next() {
			var thoughtID, snip string
			var score float64
			var t domain.Thought
			var tagsStr, subtasksStr string
			var isCompleted, alarmSent int
			var triagedAt, dueDate, convertedType, convertedRefId sql.NullString
			if scanErr := thoughtRows.Scan(
				&thoughtID, &snip, &score,
				&t.ID, &t.UserID, &t.Content, &tagsStr, &t.Priority, &t.Source, &t.Status,
				&isCompleted, &convertedType, &convertedRefId, &dueDate,
				&t.TaskListID, &t.KanbanStatus, &t.Notes, &alarmSent, &t.CreatedAt,
				&triagedAt, &subtasksStr, &t.SortOrder,
			); scanErr == nil {
				t.IsCompleted = isCompleted != 0
				t.AlarmSent = alarmSent != 0
				t.DueDate = dueDate.String
				t.ConvertedType = convertedType.String
				t.ConvertedRefID = convertedRefId.String
				t.TriagedAt = triagedAt.String

				res.Hits = append(res.Hits, SearchHit{
					Type:    "thought",
					ID:      t.ID,
					Title:   t.Content,
					Snippet: snip,
					Score:   score,
				})
				res.Thoughts = append(res.Thoughts, t)
			}
		}
		_ = thoughtRows.Close()
	}

	// 3. Search List Items
	// Weights: 2.0 for content, 1.0 for category
	accessibleLists, _ := s.GetAllListsForUser(userID)
	accessibleListIDs := make(map[string]bool, len(accessibleLists))
	for _, l := range accessibleLists {
		accessibleListIDs[l.ID] = true
	}

	itemWhere, itemArgs := "", []any{ftsQuery}
	if opts.ListID != "" {
		itemWhere += ` AND li.list_id = ?`
		itemArgs = append(itemArgs, opts.ListID)
	}
	switch opts.ItemStatus {
	case "open":
		itemWhere += ` AND li.is_completed = 0`
	case "done":
		itemWhere += ` AND li.is_completed = 1`
	}
	if want("list_item") && len(accessibleListIDs) > 0 {
		itemRows, err := s.db.QueryContext(ctx, `
			SELECT f.item_id, f.list_id,
			       snippet(list_items_fts, -1, '<mark>', '</mark>', '…', 14) AS snip,
			       bm25(list_items_fts, 2.0, 1.0) AS score,
			       li.id, li.list_id, li.content, li.category, li.quantity,
			       li.is_completed, li.completed_by, li.completed_by_name,
			       li.sort_order, li.created_at, li.completed_at
			FROM list_items_fts f
			JOIN list_items li ON li.id = f.item_id
			WHERE list_items_fts MATCH ?`+itemWhere+`
			ORDER BY li.is_completed ASC, score ASC
			LIMIT `+strconv.Itoa(limit), itemArgs...)
		if err == nil {
			for itemRows.Next() {
				var itemID, listID, snip string
				var score float64
				var li domain.ListItem
				var isCompleted int
				if scanErr := itemRows.Scan(
					&itemID, &listID, &snip, &score,
					&li.ID, &li.ListID, &li.Content, &li.Category, &li.Quantity,
					&isCompleted, &li.CompletedBy, &li.CompletedByName,
					&li.SortOrder, &li.CreatedAt, &li.CompletedAt,
				); scanErr == nil {
					if !accessibleListIDs[listID] {
						continue
					}
					li.IsCompleted = isCompleted != 0

					res.Hits = append(res.Hits, SearchHit{
						Type:    "list_item",
						ID:      li.ID,
						Title:   li.Content,
						Snippet: snip,
						Score:   score,
						ListID:  listID,
					})
					res.ListItems = append(res.ListItems, li)
				}
			}
			_ = itemRows.Close()
		}
	}

	for _, h := range res.Hits {
		res.Counts[h.Type]++
	}
	return res, nil
}
