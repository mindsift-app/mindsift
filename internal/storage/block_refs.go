package storage

import (
	"database/sql"
	"fmt"
	"regexp"
	"slices"
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
		WHERE r.kind = 'media' AND r.ref_id = ? AND r.document_id = ? AND b.document_id = r.document_id AND b.deleted = 0`
	// Every secret with whether a live bullet of its own note holds it (SweepSecrets)
	sqlSecretsHeldAtHome = `SELECT s.id, s.document_id, s.orphaned_at, EXISTS (
		SELECT 1 FROM block_refs r JOIN blocks b ON b.id = r.block_id
		WHERE r.kind = 'secret' AND r.ref_id = s.id AND r.document_id = s.document_id
		AND b.document_id = r.document_id AND b.deleted = 0) FROM note_secrets s`
	// Notes with a live bullet holding a secret of another note (splitCrossNoteSecrets)
	sqlNotesWithForeignSecrets = `SELECT DISTINCT r.document_id FROM note_secrets s
		JOIN block_refs r ON r.kind = 'secret' AND r.ref_id = s.id AND r.document_id != s.document_id
		JOIN blocks b ON b.id = r.block_id WHERE b.document_id = r.document_id AND b.deleted = 0`
)

// mediaIDRe finds every file a block points to, wherever in the content (image and audio bullets, but
// also a reference pasted into text); the id is the media id format of domain.NewID.
var mediaIDRe = regexp.MustCompile(`media:(med_[0-9a-f]+)`)

type blockRef struct{ kind, id string }

// maxBlockRefs caps the references kept per bullet. A real bullet shows a file or two (an image, audio, a
// table with a few pictures); without a cap a single long bullet full of made-up "media:med_…" strings
// became thousands of rows, and one sync of such bullets held the write lock for half a minute and grew
// the database several times over (audit 2026-11-13, N1). References are not checked against media and
// note_secrets here on purpose: an import stores a note before its files.
//
// A bullet that really shows more files (an old table full of pictures) has some of them missing from
// block_refs. Where that would lose data, the bullets at the cap are read as well (mediaBeyondRefCap):
// before the media cleanup deletes a file and when a backup collects a person's files. Read rights and
// public pages go by block_refs alone; such a file stays readable through the note it was uploaded to.
const maxBlockRefs = 64

// sqlCappedBlocks: the bullets (deleted ones too) whose references reached maxBlockRefs, the only ones
// that can show a file block_refs does not list. It reads all of block_refs (not the text of bullets), so
// it runs only where a missed file costs data.
var sqlCappedBlocks = fmt.Sprintf(`SELECT b.document_id, b.content FROM blocks b
	WHERE b.id IN (SELECT block_id FROM block_refs GROUP BY block_id HAVING COUNT(*) >= %d)`, maxBlockRefs)

// mediaBeyondRefCap returns the files mentioned in bullets at the cap, each with the notes of those
// bullets; with userID only bullets of that person's own notes.
func (s *Store) mediaBeyondRefCap(userID string) (map[string][]string, error) {
	q, args := sqlCappedBlocks, []any{}
	if userID != "" {
		q += ` AND b.document_id IN (SELECT id FROM documents WHERE user_id = ?)`
		args = append(args, userID)
	}
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var docID, content string
		if err := rows.Scan(&docID, &content); err != nil {
			return nil, err
		}
		for _, m := range mediaIDRe.FindAllStringSubmatch(content, -1) {
			if docs := out[m[1]]; len(docs) == 0 || docs[len(docs)-1] != docID {
				out[m[1]] = append(docs, docID)
			}
		}
	}
	return out, rows.Err()
}

// secretsBeyondRefCap is mediaBeyondRefCap for hidden values: the secrets mentioned in live bullets at
// the cap, each with the notes of those bullets. A secret only such a bullet holds may have no
// block_refs row there: the secret sweep must neither delete it nor miss it when it belongs to another
// note (splitCrossNoteSecrets).
func secretsBeyondRefCap(q docQueryer) (map[string][]string, error) {
	rows, err := q.Query(sqlCappedBlocks + ` AND b.deleted = 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var d, content string
		if err := rows.Scan(&d, &content); err != nil {
			return nil, err
		}
		for _, m := range SecretRefRe.FindAllStringSubmatch(content, -1) {
			if docs := out[m[1]]; !slices.Contains(docs, d) {
				out[m[1]] = append(docs, d)
			}
		}
	}
	return out, rows.Err()
}

// blockRefsOf returns the references in a block's content (at most maxBlockRefs, in order of appearance),
// sorted and without duplicates.
func blockRefsOf(content string) []blockRef {
	hasMedia, hasSecret := strings.Contains(content, "media:"), strings.Contains(content, "{{secret:")
	if !hasMedia && !hasSecret {
		return nil
	}
	seen := map[blockRef]bool{}
	var refs []blockRef
	add := func(r blockRef) {
		if !seen[r] && len(refs) < maxBlockRefs {
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
	if len(refs) == 0 {
		return nil
	}
	var owned int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM blocks WHERE id = ? AND document_id = ?`, blockID, docID).Scan(&owned); err != nil {
		return err
	}
	if owned == 0 {
		return nil
	}
	// One statement for all rows of the block (at most maxBlockRefs, so 4 × 64 parameters)
	var sb strings.Builder
	sb.WriteString(`INSERT OR IGNORE INTO block_refs (block_id, document_id, kind, ref_id) VALUES `)
	args := make([]any, 0, 4*len(refs))
	for i, r := range refs {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString("(?, ?, ?, ?)")
		args = append(args, blockID, docID, r.kind, r.id)
	}
	_, err := tx.Exec(sb.String(), args...)
	return err
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
