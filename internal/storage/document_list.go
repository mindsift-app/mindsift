package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// The note list without bullets (GetDocumentList) and what the app asks for instead of reading the
// bullets of every note: the counts per note, the to-dos of all notes and single bullets.

// listBlocks: the bullets and plain text of a note for getDocuments, or none for the note list.
func (s *Store) listBlocks(docID, blocksJSON string, withBlocks bool) ([]domain.DocumentBlock, string) {
	if !withBlocks {
		return []domain.DocumentBlock{}, ""
	}
	blocks := s.loadDocBlocks(docID, blocksJSON)
	return blocks, docPlainText(blocks)
}

// docIDsJSON: the note ids as a JSON array for `IN (SELECT value FROM json_each(?))`, one parameter
// however many notes there are.
func docIDsJSON(docs []domain.Document) string {
	ids := make([]string, len(docs))
	for i := range docs {
		ids[i] = docs[i].ID
	}
	b, _ := json.Marshal(ids)
	return string(b)
}

// An open to-do counts when it has text, as the app counts them.
const sqlOpenTodo = `b.type = 'todo' AND b.checked = 0 AND TRIM(b.content) != ''`

// The list's counts, each over all listed notes (?: the note ids as JSON) and only from indexes where
// they can: no bullet text leaves the database, and none is read for a bullet that is not an open to-do.
// INDEXED BY, because SQLite's statistics can make it pick an index over all bullets of a note.
const (
	// sqlListOpenTodos: open to-dos per note, through the partial index of migration 50 (only open
	// to-dos have an entry; their text is read for the TRIM).
	sqlListOpenTodos = `SELECT b.document_id, COUNT(*) FROM blocks b INDEXED BY idx_blocks_open_todo
		WHERE b.document_id IN (SELECT value FROM json_each(?)) AND b.deleted = 0 AND ` + sqlOpenTodo + `
		GROUP BY b.document_id`
	// sqlListTagCounts: bullets per hashtag and note, from the covering index idx_block_tags_doc_tag
	// (migration 51) alone, in its order. block_tags holds the hashtags of live, shown bullets of the
	// note only: it is rewritten from them whenever a bullet of the note changes (docsync.go), the other
	// writer checks each bullet (indexDocBlockTags), and migration 51 removed older rows of other ones.
	// Joining every row to blocks to check that again cost about three times as much.
	sqlListTagCounts = `SELECT document_id, tag, COUNT(*) FROM block_tags
		WHERE document_id IN (SELECT value FROM json_each(?))
		GROUP BY document_id, tag`
	// sqlListTagOpenTodos: open to-dos (with or without text) per hashtag and note, from the open to-dos
	// to their hashtags (idx_block_tags_block, migration 51); CROSS JOIN keeps that order.
	sqlListTagOpenTodos = `SELECT bt.document_id, bt.tag, COUNT(*) FROM blocks b INDEXED BY idx_blocks_open_todo
		CROSS JOIN block_tags bt ON bt.block_id = b.id AND bt.document_id = b.document_id
		WHERE b.document_id IN (SELECT value FROM json_each(?)) AND b.type = 'todo' AND b.checked = 0 AND b.deleted = 0
		GROUP BY bt.document_id, bt.tag`
)

// attachListStats fills OpenTodos, TagCounts and TagOpenTodos of the notes with three grouped queries
// over all of them (not one per note), on q.
func attachListStats(q docQueryer, docs []domain.Document) error {
	if len(docs) == 0 {
		return nil
	}
	byID := make(map[string]*domain.Document, len(docs))
	for i := range docs {
		byID[docs[i].ID] = &docs[i]
	}
	ids := docIDsJSON(docs)

	if err := scanListCounts(q, sqlListOpenTodos, ids, false, func(d *domain.Document, _ string, n int) {
		d.OpenTodos = n
	}, byID); err != nil {
		return err
	}
	if err := scanListCounts(q, sqlListTagCounts, ids, true, func(d *domain.Document, tag string, n int) {
		if d.TagCounts == nil {
			d.TagCounts = map[string]int{}
			d.TagOpenTodos = map[string]int{}
		}
		d.TagCounts[tag] = n
		d.TagOpenTodos[tag] = 0
	}, byID); err != nil {
		return err
	}
	return scanListCounts(q, sqlListTagOpenTodos, ids, true, func(d *domain.Document, tag string, n int) {
		if _, ok := d.TagOpenTodos[tag]; ok {
			d.TagOpenTodos[tag] = n
		}
	}, byID)
}

// scanListCounts runs one query of attachListStats and hands each row (note id, the tag when withTag,
// count) to set, for the notes in byID.
func scanListCounts(q docQueryer, query, ids string, withTag bool, set func(d *domain.Document, tag string, n int), byID map[string]*domain.Document) error {
	rows, err := q.Query(query, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var docID, tag string
		var n int
		dest := []any{&docID, &n}
		if withTag {
			dest = []any{&docID, &tag, &n}
		}
		if err := rows.Scan(dest...); err != nil {
			return err
		}
		if d := byID[docID]; d != nil {
			set(d, tag, n)
		}
	}
	return rows.Err()
}

// GetDocumentListItem returns one note as GetDocumentList lists it: without bullets and plain text, with
// the counts. For the realtime events that keep the note lists current (DOC_CREATED, DOC_UPDATED).
func (s *Store) GetDocumentListItem(userID, docID string) (*domain.Document, error) {
	doc, err := s.getDocumentByID(userID, docID, false)
	if err != nil {
		return nil, err
	}
	one := []domain.Document{*doc}
	if err := attachListStats(s.db, one); err != nil {
		return nil, err
	}
	return &one[0], nil
}

// ListNoteTodos returns every to-do with text in the notes the user can see (not in the trash), in the
// order of the note list and, within a note, in the order the note shows its bullets (the tree: siblings
// by order key, as collab.Doc.Flatten). The order comes from the structure columns only, no text.
func (s *Store) ListNoteTodos(userID string) ([]domain.NoteTodo, error) {
	docs, err := s.getDocuments(context.Background(), userID, false)
	if err != nil {
		return nil, err
	}
	out := []domain.NoteTodo{}
	if len(docs) == 0 {
		return out, nil
	}
	docOrder := make(map[string]int, len(docs))
	for i := range docs {
		docOrder[docs[i].ID] = i
	}
	rows, err := s.db.Query(`SELECT b.document_id, b.id, b.content, b.checked FROM blocks b
		WHERE b.document_id IN (SELECT value FROM json_each(?)) AND b.deleted = 0
		  AND b.type = 'todo' AND TRIM(b.content) != ''`, docIDsJSON(docs))
	if err != nil {
		return nil, err
	}
	withTodos := map[string]bool{}
	for rows.Next() {
		var t domain.NoteTodo
		var checked int
		if err := rows.Scan(&t.DocID, &t.BlockID, &t.Content, &checked); err != nil {
			_ = rows.Close()
			return nil, err
		}
		t.Checked = checked != 0
		out = append(out, t)
		withTodos[t.DocID] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()
	if len(out) == 0 {
		return out, nil
	}

	// Display position of every live bullet of the notes with to-dos
	ids := make([]string, 0, len(withTodos))
	for id := range withTodos {
		ids = append(ids, id)
	}
	idsJSON, _ := json.Marshal(ids)
	type node struct{ id, orderKey string }
	children := map[string]map[string][]node{} // note → parent → children
	srows, err := s.db.Query(`SELECT document_id, id, COALESCE(parent_id, ''), COALESCE(order_key, '') FROM blocks
		WHERE document_id IN (SELECT value FROM json_each(?)) AND deleted = 0`, string(idsJSON))
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var docID, id, parent, key string
		if err := srows.Scan(&docID, &id, &parent, &key); err != nil {
			_ = srows.Close()
			return nil, err
		}
		if children[docID] == nil {
			children[docID] = map[string][]node{}
		}
		children[docID][parent] = append(children[docID][parent], node{id, key})
	}
	if err := srows.Err(); err != nil {
		_ = srows.Close()
		return nil, err
	}
	_ = srows.Close()
	position := map[string]int{} // bullet → position in its note
	for _, byParent := range children {
		for _, list := range byParent {
			sort.Slice(list, func(i, j int) bool {
				if list[i].orderKey != list[j].orderKey {
					return list[i].orderKey < list[j].orderKey
				}
				return list[i].id < list[j].id
			})
		}
		n := 0
		var walk func(parent string)
		walk = func(parent string) {
			for _, c := range byParent[parent] {
				position[c.id] = n
				n++
				walk(c.id)
			}
		}
		walk("")
	}
	// Bullets under a deleted parent are not shown (Flatten does not reach them)
	shown := out[:0]
	for _, t := range out {
		if _, ok := position[t.BlockID]; ok {
			shown = append(shown, t)
		}
	}
	sort.SliceStable(shown, func(i, j int) bool {
		if docOrder[shown[i].DocID] != docOrder[shown[j].DocID] {
			return docOrder[shown[i].DocID] < docOrder[shown[j].DocID]
		}
		return position[shown[i].BlockID] < position[shown[j].BlockID]
	})
	return shown, nil
}

// BlockInfo: one bullet as GET /blocks/{id} answers it.
type BlockInfo struct {
	DocumentID string `json:"documentId"`
	Content    string `json:"content"`
	Type       string `json:"type"`
}

// GetBlockForUser returns a live bullet when the user may read its note, else sql.ErrNoRows (the same
// answer for a bullet that does not exist and one of somebody else's note).
func (s *Store) GetBlockForUser(userID, blockID string) (*BlockInfo, error) {
	var b BlockInfo
	err := s.db.QueryRow(`SELECT document_id, content, type FROM blocks WHERE id = ? AND deleted = 0`, blockID).
		Scan(&b.DocumentID, &b.Content, &b.Type)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, sql.ErrNoRows
	}
	if err != nil {
		return nil, err
	}
	if s.DocRole(userID, b.DocumentID) == "" {
		return nil, sql.ErrNoRows
	}
	return &b, nil
}
