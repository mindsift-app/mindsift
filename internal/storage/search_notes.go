package storage

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
	"github.com/mindsift-app/mindsift/internal/drawing"
)

// noteSearchRow: one note or bullet found by the search, with what the results show of it.
type noteSearchRow struct {
	docID, blockID, snip, title, icon, content, typ string
	score                                           float64
	rid                                             int64
}

// sqlNoteSearchHits: matches of the full-text index (arguments: query, JSON array of visible note ids,
// limit), joined by key to the notes and bullets. Notes have negative keys in the index (their title),
// bullets positive ones (their text). A bullet is found through idx_blocks_fts_cover (migration 53),
// which holds everything the query reads of it, so no row of blocks is read for a match.
const sqlNoteSearchHits = `
		WITH m AS (
			SELECT rowid AS rid, bm25(documents_fts, 10.0, 1.0) AS score
			FROM documents_fts WHERE documents_fts MATCH ?
		), allowed AS (SELECT value AS id FROM json_each(?))
		SELECT m.rid, m.score, COALESCE(b.document_id, d.id), COALESCE(b.id, '')
		FROM m
		LEFT JOIN blocks b ON m.rid > 0 AND b.fts_rowid = m.rid AND b.deleted = 0
		LEFT JOIN documents d ON m.rid < 0 AND d.fts_rowid = m.rid
		WHERE COALESCE(b.document_id, d.id) IN (SELECT id FROM allowed)
		ORDER BY m.score ASC
		LIMIT ?`

// searchVisibleNotes finds the best matches among the notes the user can see (optionally below a folder):
//  1. matches and bm25 scores from the full-text index alone, joined by key to the notes and bullets
//     of the visible notes, cut to the limit — no text is read for rows that are not shown;
//  2. snippets only for these hits;
//  3. the text and type of the matched bullets.
func (s *Store) searchVisibleNotes(ctx context.Context, userID, ftsQuery, folder string, limit int) ([]noteSearchRow, error) {
	docs, err := s.getDocuments(ctx, userID, false)
	if err != nil {
		return nil, err
	}
	folder = strings.Trim(folder, "/")
	type meta struct{ title, icon string }
	visible := make(map[string]meta, len(docs))
	ids := make([]string, 0, len(docs))
	for i := range docs {
		d := &docs[i]
		if d.IsArchived {
			continue
		}
		if folder != "" && d.FolderPath != folder && !strings.HasPrefix(d.FolderPath, folder+"/") {
			continue
		}
		visible[d.ID] = meta{d.Title, d.Icon}
		ids = append(ids, d.ID)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	idsJSON, _ := json.Marshal(ids)

	rows, err := s.db.QueryContext(ctx, sqlNoteSearchHits, ftsQuery, string(idsJSON), limit)
	if err != nil {
		return nil, err
	}
	var found []noteSearchRow
	var rids []int64
	var blockIDs []string
	for rows.Next() {
		var r noteSearchRow
		if err := rows.Scan(&r.rid, &r.score, &r.docID, &r.blockID); err != nil {
			_ = rows.Close()
			return nil, err
		}
		m := visible[r.docID]
		r.title, r.icon = m.title, m.icon
		found = append(found, r)
		rids = append(rids, r.rid)
		if r.blockID != "" {
			blockIDs = append(blockIDs, r.blockID)
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()
	if len(found) == 0 {
		return nil, nil
	}

	// 2. Snippets for the hits shown only. "+rowid": a plain rowid IN hands each key to FTS5 as its own
	// lookup, which ran the whole match once per hit (40 hits: 40 to 90 ms instead of about 5)
	ridsJSON, _ := json.Marshal(rids)
	snips := make(map[int64]string, len(rids))
	srows, err := s.db.QueryContext(ctx, `
		SELECT rowid, snippet(documents_fts, -1, '<mark>', '</mark>', '…', 14)
		FROM documents_fts WHERE documents_fts MATCH ? AND +rowid IN (SELECT value FROM json_each(?))`,
		ftsQuery, string(ridsJSON))
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var rid int64
		var snip string
		if err := srows.Scan(&rid, &snip); err != nil {
			_ = srows.Close()
			return nil, err
		}
		snips[rid] = snip
	}
	logDBErr(srows.Err())
	_ = srows.Close()

	// 3. Text and type of the matched bullets
	type blockText struct{ content, typ string }
	texts := map[string]blockText{}
	if len(blockIDs) > 0 {
		bidsJSON, _ := json.Marshal(blockIDs)
		brows, err := s.db.QueryContext(ctx, `SELECT id, content, type FROM blocks WHERE id IN (SELECT value FROM json_each(?))`, string(bidsJSON))
		if err != nil {
			return nil, err
		}
		for brows.Next() {
			var id string
			var t blockText
			if err := brows.Scan(&id, &t.content, &t.typ); err != nil {
				_ = brows.Close()
				return nil, err
			}
			texts[id] = t
		}
		logDBErr(brows.Err())
		_ = brows.Close()
	}

	for i := range found {
		r := &found[i]
		r.snip = snips[r.rid]
		if t, ok := texts[r.blockID]; ok {
			r.content, r.typ = t.content, t.typ
			if r.typ == drawing.BlockType {
				r.content = strings.Join(drawing.Texts(r.content), " · ")
			}
			if r.typ == "table" {
				r.content = blockfmt.TableText(r.content)
			}
		}
	}
	return found, nil
}
