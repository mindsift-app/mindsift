package storage

import (
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// Migration 44: the text of a note is stored once. Before, 17.8 MB of note text made the database grow
// by about 220 MB: besides the bullets (blocks) every change wrote the whole note three more times into
// its documents row (blocks_json, markdown_cache, content), the log (doc_ops) kept the full text of every
// change for 7 or 30 days, and the search index kept a copy of its own. Now:
//   - documents keeps no text: the flat block list, markdown and plain text are built from blocks when
//     a note is read; the old columns stay empty ('[]', '', '');
//   - doc_ops keeps the texts as references and deltas (doclog.go);
//   - documents_fts reads the text from the bullets and titles instead of keeping a copy (noteSearchSQL).
// The step converts existing databases: notes that only had blocks_json get their bullets, the log is
// rewritten into the new form, the search index is built anew, and the database is compacted once
// (VACUUM) when that frees a good part of the file.

func (s *Store) migrateNoteStorage() error {
	for _, q := range []string{
		"ALTER TABLE doc_ops ADD COLUMN content_ref INTEGER NOT NULL DEFAULT 0;",
		// The text entries of a bullet that refer to the next one (doclog.go); the queries name the
		// condition literally, so the planner takes the partial index
		"CREATE INDEX IF NOT EXISTS idx_doc_ops_text ON doc_ops(doc_id, block_id, seq) WHERE content_ref != 0;",
		"ALTER TABLE blocks ADD COLUMN fts_rowid INTEGER;",
		"ALTER TABLE documents ADD COLUMN fts_rowid INTEGER;",
	} {
		if err := s.execSchemaStatement(q); err != nil {
			return err
		}
	}
	if err := s.convertBlocksJSONNotes(); err != nil {
		return err
	}
	if err := s.compactDocLogs(); err != nil {
		return err
	}
	// The copies in documents; a note whose blocks_json could not be converted keeps it (loadDocBlocks
	// still reads it then)
	if _, err := s.db.Exec(`UPDATE documents SET blocks_json = '[]', markdown_cache = '', content = ''
		WHERE (blocks_json != '[]' OR markdown_cache != '' OR content != '')
		  AND (blocks_json IN ('', '[]') OR EXISTS (SELECT 1 FROM blocks b WHERE b.document_id = documents.id))`); err != nil {
		return err
	}
	if err := s.rebuildNoteSearch(); err != nil {
		return err
	}
	s.vacuumIfWorthwhile()
	return nil
}

// hasNoteStorageColumns: the columns of migration 44 exist, so notes can be written in the new form.
func (s *Store) hasNoteStorageColumns() (bool, error) {
	for _, c := range [][2]string{{"doc_ops", "content_ref"}, {"blocks", "fts_rowid"}, {"documents", "fts_rowid"}} {
		if ok, err := s.columnExists(c[0], c[1]); err != nil || !ok {
			return false, err
		}
	}
	return true, nil
}

// convertBlocksJSONNotes gives notes that only have blocks_json (very old ones, or a save that failed)
// their bullets, the way loadDocBlocks did on reading them.
func (s *Store) convertBlocksJSONNotes() error {
	rows, err := s.db.Query(`SELECT d.id, d.user_id, d.blocks_json FROM documents d
		WHERE d.blocks_json NOT IN ('', '[]') AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.document_id = d.id)`)
	if err != nil {
		return err
	}
	type legacyNote struct{ id, userID, blocksJSON string }
	var notes []legacyNote
	for rows.Next() {
		var n legacyNote
		if err := rows.Scan(&n.id, &n.userID, &n.blocksJSON); err != nil {
			_ = rows.Close()
			return err
		}
		notes = append(notes, n)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = rows.Close()
	for _, n := range notes {
		var blocks []domain.DocumentBlock
		if err := json.Unmarshal([]byte(n.blocksJSON), &blocks); err != nil || len(blocks) == 0 {
			continue
		}
		if err := s.saveDocBlocks(n.id, n.userID, blocks); err != nil {
			slog.Warn("A note's old block list could not be converted; it stays as it is", "doc_id", n.id, "error", err)
		}
	}
	return nil
}

// compactDocLogs rewrites the log of every note into the form of doclog.go. Per bullet the newest text
// entry refers to the bullet, the ones before it become deltas; a bullet whose newest entry does not
// match its current text keeps its entries complete. One transaction per note.
func (s *Store) compactDocLogs() error {
	rows, err := s.db.Query(`SELECT DISTINCT doc_id FROM doc_ops`)
	if err != nil {
		return err
	}
	var docIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return err
		}
		docIDs = append(docIDs, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = rows.Close()
	for _, docID := range docIDs {
		if err := s.compactDocLog(docID); err != nil {
			return fmt.Errorf("log of %s: %w", docID, err)
		}
	}
	return nil
}

func (s *Store) compactDocLog(docID string) error {
	unlock := lockDoc(docID)
	defer unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Done already (an earlier attempt of this migration stopped after this note)
	var done int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM doc_ops WHERE doc_id = ? AND content_ref != 0`, docID).Scan(&done); err != nil {
		return err
	}
	if done > 0 {
		return nil
	}
	rows, err := tx.Query(`SELECT seq, payload FROM doc_ops WHERE doc_id = ? AND kind IN (?, ?) ORDER BY seq ASC`,
		docID, collab.OpInsert, collab.OpSetContent)
	if err != nil {
		return err
	}
	type textEntry struct {
		seq int64
		e   collab.Effect
	}
	byBlock := map[string][]textEntry{}
	for rows.Next() {
		var te textEntry
		var payload string
		if err := rows.Scan(&te.seq, &payload); err != nil {
			_ = rows.Close()
			return err
		}
		if json.Unmarshal([]byte(payload), &te.e) != nil || te.e.BlockID == "" {
			continue // left as it is
		}
		byBlock[te.e.BlockID] = append(byBlock[te.e.BlockID], te)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = rows.Close()

	current, _, err := loadCollabDoc(tx, docID)
	if err != nil {
		return err
	}
	for blockID, list := range byBlock {
		b, ok := current.Blocks[blockID]
		if !ok || list[len(list)-1].e.Content != b.Content {
			continue // the newest entry would not give back the bullet's text: keep them complete
		}
		for i := len(list) - 1; i >= 0; i-- {
			se := storedEffect{Effect: list[i].e}
			mode := logTextBlock
			if i < len(list)-1 {
				d := makeTextDelta(list[i+1].e.Content, list[i].e.Content)
				se.Delta, mode = &d, logTextDelta
			}
			se.Content = ""
			payload, _ := json.Marshal(se)
			if _, err := tx.Exec(`UPDATE doc_ops SET payload = ?, content_ref = ? WHERE doc_id = ? AND seq = ?`,
				string(payload), mode, docID, list[i].seq); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// liveBlock: a bullet the search finds (not deleted). row is "" or a prefix like "new.".
func liveBlock(row string) string {
	return row + `deleted = 0 AND (` + row + `deleted_at = '' OR ` + row + `deleted_at IS NULL)`
}

// noteSearchSQL creates documents_fts as an index without a copy of the text (FTS5 external content).
// Its rows are those of the view documents_fts_source: the titles of notes outside the trash and the
// live bullets, with the text the search sees (blockSearchText). FTS5 reads the text there when it
// builds a snippet. A row's key is stored with it: blocks.fts_rowid (1, 2, …) for a bullet,
// documents.fts_rowid (-1, -2, …) for a title, so it does not depend on rowids. The triggers hand the
// index every change together with the values it was given before: FTS5 needs exactly those to take
// a row out. A change to the indexed text (blockSearchText) therefore needs the index rebuilt
// (INSERT INTO documents_fts(documents_fts) VALUES('rebuild')), as rebuildNoteSearch does.
func noteSearchSQL() []string {
	oldLive, newLive := liveBlock("old."), liveBlock("new.")
	return []string{
		`DROP TRIGGER IF EXISTS trg_documents_ai`,
		`DROP TRIGGER IF EXISTS trg_documents_au`,
		`DROP TRIGGER IF EXISTS trg_documents_ad`,
		`DROP TRIGGER IF EXISTS trg_blocks_ai`,
		`DROP TRIGGER IF EXISTS trg_blocks_au`,
		`DROP TRIGGER IF EXISTS trg_blocks_ad`,
		`DROP TABLE IF EXISTS documents_fts`,
		`DROP VIEW IF EXISTS documents_fts_source`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_fts_rowid ON blocks(fts_rowid)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_fts_rowid ON documents(fts_rowid)`,
		// Beyond keys given already (an earlier attempt, a later step that wrote notes), so none repeats
		`UPDATE blocks SET fts_rowid = rowid + (SELECT COALESCE(MAX(fts_rowid), 0) FROM blocks) WHERE fts_rowid IS NULL`,
		`UPDATE documents SET fts_rowid = -rowid + (SELECT COALESCE(MIN(fts_rowid), 0) FROM documents) WHERE fts_rowid IS NULL`,
		`CREATE VIEW documents_fts_source AS
			SELECT d.fts_rowid AS rid, d.id AS doc_id, '' AS block_id, d.title AS title, '' AS content
			FROM documents d WHERE d.is_archived = 0 AND d.fts_rowid IS NOT NULL
			UNION ALL
			SELECT b.fts_rowid, b.document_id, b.id, '', ` + blockSearchText("b.") + `
			FROM blocks b WHERE ` + liveBlock("b.") + ` AND b.fts_rowid IS NOT NULL`,
		`CREATE VIRTUAL TABLE documents_fts USING fts5(
			doc_id UNINDEXED,
			block_id UNINDEXED,
			title,
			content,
			content='documents_fts_source',
			content_rowid='rid',
			tokenize='unicode61'
		)`,
		// A new note gets the next free negative key
		`CREATE TRIGGER trg_documents_ai AFTER INSERT ON documents BEGIN
			UPDATE documents SET fts_rowid = (SELECT COALESCE(MIN(fts_rowid), 0) - 1 FROM documents)
			WHERE rowid = new.rowid AND fts_rowid IS NULL;
			INSERT INTO documents_fts(rowid, doc_id, block_id, title, content)
			SELECT d.fts_rowid, d.id, '', d.title, '' FROM documents d WHERE d.rowid = new.rowid AND d.is_archived = 0;
		END`,
		`CREATE TRIGGER trg_documents_au AFTER UPDATE OF title, is_archived ON documents
		WHEN old.title IS NOT new.title OR old.is_archived IS NOT new.is_archived BEGIN
			INSERT INTO documents_fts(documents_fts, rowid, doc_id, block_id, title, content)
			SELECT 'delete', old.fts_rowid, old.id, '', old.title, '' WHERE old.is_archived = 0 AND old.fts_rowid IS NOT NULL;
			INSERT INTO documents_fts(rowid, doc_id, block_id, title, content)
			SELECT new.fts_rowid, new.id, '', new.title, '' WHERE new.is_archived = 0 AND new.fts_rowid IS NOT NULL;
		END`,
		`CREATE TRIGGER trg_documents_ad AFTER DELETE ON documents BEGIN
			INSERT INTO documents_fts(documents_fts, rowid, doc_id, block_id, title, content)
			SELECT 'delete', old.fts_rowid, old.id, '', old.title, '' WHERE old.is_archived = 0 AND old.fts_rowid IS NOT NULL;
		END`,
		// A new bullet without a key (persistDocState brings one along) gets the next free one
		`CREATE TRIGGER trg_blocks_ai AFTER INSERT ON blocks BEGIN
			UPDATE blocks SET fts_rowid = (SELECT COALESCE(MAX(fts_rowid), 0) + 1 FROM blocks)
			WHERE rowid = new.rowid AND fts_rowid IS NULL;
			INSERT INTO documents_fts(rowid, doc_id, block_id, title, content)
			SELECT COALESCE(new.fts_rowid, (SELECT fts_rowid FROM blocks WHERE rowid = new.rowid)), new.document_id, new.id, '',
			       ` + blockSearchText("new.") + `
			WHERE ` + newLive + `;
		END`,
		// Only when the searched text or whether the bullet is live changes (not for ticks, folding, moves)
		`CREATE TRIGGER trg_blocks_au AFTER UPDATE OF content, type, deleted, deleted_at, document_id ON blocks
		WHEN old.content IS NOT new.content OR old.type IS NOT new.type OR old.document_id IS NOT new.document_id
		  OR (` + oldLive + `) IS NOT (` + newLive + `) BEGIN
			INSERT INTO documents_fts(documents_fts, rowid, doc_id, block_id, title, content)
			SELECT 'delete', old.fts_rowid, old.document_id, old.id, '', ` + blockSearchText("old.") + `
			WHERE ` + oldLive + ` AND old.fts_rowid IS NOT NULL;
			INSERT INTO documents_fts(rowid, doc_id, block_id, title, content)
			SELECT new.fts_rowid, new.document_id, new.id, '', ` + blockSearchText("new.") + `
			WHERE ` + newLive + ` AND new.fts_rowid IS NOT NULL;
		END`,
		`CREATE TRIGGER trg_blocks_ad AFTER DELETE ON blocks BEGIN
			INSERT INTO documents_fts(documents_fts, rowid, doc_id, block_id, title, content)
			SELECT 'delete', old.fts_rowid, old.document_id, old.id, '', ` + blockSearchText("old.") + `
			WHERE ` + oldLive + ` AND old.fts_rowid IS NOT NULL;
		END`,
		`INSERT INTO documents_fts(documents_fts) VALUES('rebuild')`,
	}
}

// rebuildNoteSearch replaces the search index of notes (with its copy of the text) by the one of
// noteSearchSQL and fills it, in one transaction.
func (s *Store) rebuildNoteSearch() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range noteSearchSQL() {
		if _, err := tx.Exec(q); err != nil {
			return fmt.Errorf("%w (%.80s)", err, q)
		}
	}
	return tx.Commit()
}

// diskFreeOf is diskFree; tests replace it.
var diskFreeOf = diskFree

// vacuumIfWorthwhile compacts the database file once the conversion has freed a good part of it
// (at least 8 MB and a quarter of the file). SQLite keeps freed pages for reuse and does not shrink the
// file by itself. VACUUM writes the compacted database twice for a moment: as a temporary copy and, in
// WAL mode, once more into the WAL before the checkpoint; so up to about twice the size of the database.
// Without that much free space in the data directory (as far as the system tells) it is skipped with a
// line in the log. A failure only costs the space: the start goes on.
func (s *Store) vacuumIfWorthwhile() {
	var pageSize, pages, free int64
	if dbFailed(s.db.QueryRow(`PRAGMA page_size`).Scan(&pageSize)) ||
		dbFailed(s.db.QueryRow(`PRAGMA page_count`).Scan(&pages)) ||
		dbFailed(s.db.QueryRow(`PRAGMA freelist_count`).Scan(&free)) {
		return
	}
	if free*pageSize < 8<<20 || free*4 < pages {
		return
	}
	need := 2 * (pages - free) * pageSize
	if avail, ok := diskFreeOf(s.dataDir); ok && avail < need {
		slog.Warn("Not compacting the database: too little free disk space; the freed space stays for reuse",
			"needed_mb", need>>20, "available_mb", avail>>20)
		return
	}
	slog.Info("Compacting the database once after storing note text only once", "size_mb", pages*pageSize>>20, "free_mb", free*pageSize>>20)
	if _, err := s.db.Exec(`VACUUM`); err != nil {
		slog.Warn("Compacting the database failed; the space stays free for later use", "error", err)
		return
	}
	// VACUUM went through the WAL: write it back and empty it
	s.execLogged(`PRAGMA wal_checkpoint(TRUNCATE)`)
	var after int64
	if !dbFailed(s.db.QueryRow(`PRAGMA page_count`).Scan(&after)) {
		slog.Info("Database compacted", "size_mb", after*pageSize>>20)
	}
}
