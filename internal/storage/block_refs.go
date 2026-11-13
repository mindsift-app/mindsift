package storage

import (
	"database/sql"
	"regexp"
	"sort"
	"strings"
)

// References from bullets to other records, so "which bullets show file X" or "which notes hold secret
// Y" is an index lookup instead of a substring search over every block (block_refs, migration 41).
//
// The table mirrors block content: persistDocState rewrites a block's rows when its references change
// (the one place that inserts and updates blocks), the trigger trg_blocks_refs_ad drops them with the
// block (tombstone purge, deleting a note or an account), and the migration fills it from the blocks
// already there. Tombstones keep their rows: the media cleanup counts deleted bullets too (undo), the
// queries that only want live bullets join blocks for deleted = 0.

const (
	refMedia  = "media"  // ref_id: id of a media row (![caption](media:med_…))
	refSecret = "secret" // ref_id: id of a note_secrets row ({{secret:…}})
)

// The lookups through block_refs; TestBlockRefQueriesUseIndexes checks their query plans.
const (
	// Notes with a bullet (deleted ones too) showing the file: who may read it (MediaReferencedIn)
	sqlDocsWithMedia = `SELECT DISTINCT document_id FROM block_refs WHERE kind = 'media' AND ref_id = ?`
	// Files older than the grace time no bullet points to (UnreferencedMedia)
	sqlUnreferencedMedia = `SELECT id, doc_id, owner_id, kind, mime, size, source_url, created_at FROM media m
		WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM block_refs r WHERE r.kind = 'media' AND r.ref_id = m.id)`
	// Files shown in a person's own notes (MediaOfUser)
	sqlMediaOfUser = `SELECT DISTINCT m.id, m.doc_id, m.owner_id, m.kind, m.mime, m.size, m.source_url, m.created_at
		FROM documents d JOIN block_refs r ON r.document_id = d.id AND r.kind = 'media'
		JOIN media m ON m.id = r.ref_id WHERE d.user_id = ?`
	// A live bullet of the note shows the file (DocShowsMedia); arguments media id, note id
	sqlDocShowsMedia = `SELECT COUNT(*) FROM block_refs r JOIN blocks b ON b.id = r.block_id
		WHERE r.kind = 'media' AND r.ref_id = ? AND r.document_id = ? AND b.deleted = 0`
	// A live bullet of the note holds the secret (DocReferencesSecret); arguments secret id, note id
	sqlDocHoldsSecret = `SELECT COUNT(*) FROM block_refs r JOIN blocks b ON b.id = r.block_id
		WHERE r.kind = 'secret' AND r.ref_id = ? AND r.document_id = ? AND b.deleted = 0`
	// Notes with a live bullet holding the secret (docsReferencingSecret)
	sqlDocsHoldingSecret = `SELECT DISTINCT r.document_id FROM block_refs r JOIN blocks b ON b.id = r.block_id
		WHERE r.kind = 'secret' AND r.ref_id = ? AND b.deleted = 0`
	// Deleting a note for good: its secrets go, unless a live bullet of another note holds them (hardDeleteDocument)
	sqlDeleteSecretsHeldNowhereElse = `DELETE FROM note_secrets WHERE document_id = ? AND NOT EXISTS (
		SELECT 1 FROM block_refs r JOIN blocks b ON b.id = r.block_id
		WHERE r.kind = 'secret' AND r.ref_id = note_secrets.id AND r.document_id != note_secrets.document_id AND b.deleted = 0)`
)

// mediaIDRe finds every file a block points to, wherever in the content (image and audio bullets, but
// also a reference pasted into text); the id is the media id format of domain.NewID.
var mediaIDRe = regexp.MustCompile(`media:(med_[0-9a-f]+)`)

type blockRef struct{ kind, id string }

// blockRefsOf returns the references in a block's content, sorted and without duplicates.
func blockRefsOf(content string) []blockRef {
	hasMedia, hasSecret := strings.Contains(content, "media:"), strings.Contains(content, "{{secret:")
	if !hasMedia && !hasSecret {
		return nil
	}
	seen := map[blockRef]bool{}
	var refs []blockRef
	add := func(r blockRef) {
		if !seen[r] {
			seen[r] = true
			refs = append(refs, r)
		}
	}
	if hasMedia {
		for _, m := range mediaIDRe.FindAllStringSubmatch(content, -1) {
			add(blockRef{refMedia, m[1]})
		}
	}
	if hasSecret {
		for _, m := range SecretRefRe.FindAllStringSubmatch(content, -1) {
			add(blockRef{refSecret, m[1]})
		}
	}
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].kind != refs[j].kind {
			return refs[i].kind < refs[j].kind
		}
		return refs[i].id < refs[j].id
	})
	return refs
}

func sameRefs(a, b []blockRef) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// writeBlockRefs replaces the rows of one block of docID. A block id that belongs to another note
// (the upsert in persistDocState leaves such a block alone) gets no rows here either.
func writeBlockRefs(tx *sql.Tx, docID, blockID string, refs []blockRef) error {
	if _, err := tx.Exec(`DELETE FROM block_refs WHERE block_id = ? AND document_id = ?`, blockID, docID); err != nil {
		return err
	}
	for _, r := range refs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO block_refs (block_id, document_id, kind, ref_id)
			SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM blocks WHERE id = ? AND document_id = ?)`,
			blockID, docID, r.kind, r.id, blockID, docID); err != nil {
			return err
		}
	}
	return nil
}

// migrateBlockRefs creates block_refs and fills it from the blocks there are (migration 41).
func (s *Store) migrateBlockRefs() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`CREATE TABLE IF NOT EXISTS block_refs (
			block_id TEXT NOT NULL,
			document_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			ref_id TEXT NOT NULL,
			PRIMARY KEY (block_id, kind, ref_id)
		) WITHOUT ROWID`,
		// Who points at a record (media cleanup, read rights of a file, notes holding a secret)
		`CREATE INDEX IF NOT EXISTS idx_block_refs_ref ON block_refs(kind, ref_id, document_id)`,
		// What a note points at (files of a person's notes, a note's own secrets)
		`CREATE INDEX IF NOT EXISTS idx_block_refs_doc ON block_refs(document_id, kind, ref_id)`,
		`CREATE TRIGGER IF NOT EXISTS trg_blocks_refs_ad AFTER DELETE ON blocks BEGIN
			DELETE FROM block_refs WHERE block_id = old.id;
		END`,
	} {
		if _, err := tx.Exec(q); err != nil {
			return err
		}
	}
	if err := fillBlockRefs(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// fillBlockRefs rebuilds block_refs from the content of all blocks. Only blocks that can hold a
// reference are read; their rows are collected first and written after the read is closed (one
// connection, see Doku/database.md).
func fillBlockRefs(tx *sql.Tx) error {
	if _, err := tx.Exec(`DELETE FROM block_refs`); err != nil {
		return err
	}
	type row struct {
		blockID, docID string
		ref            blockRef
	}
	rows, err := tx.Query(`SELECT id, document_id, content FROM blocks
		WHERE instr(content, 'media:') > 0 OR instr(content, '{{secret:') > 0`)
	if err != nil {
		return err
	}
	var all []row
	for rows.Next() {
		var id, docID, content string
		if err := rows.Scan(&id, &docID, &content); err != nil {
			_ = rows.Close()
			return err
		}
		for _, r := range blockRefsOf(content) {
			all = append(all, row{id, docID, r})
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()
	ins, err := tx.Prepare(`INSERT OR IGNORE INTO block_refs (block_id, document_id, kind, ref_id) VALUES (?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer ins.Close()
	for _, r := range all {
		if _, err := ins.Exec(r.blockID, r.docID, r.ref.kind, r.ref.id); err != nil {
			return err
		}
	}
	return nil
}
