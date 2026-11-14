package storage

import (
	"log/slog"
	"strings"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// A copy is a copy: every reference {{secret:<id>}} in a note points to a hidden value of that note
// (Doku/sharing-and-permissions.md, "Hidden Values in Shared Notes"). Content that brings a reference
// to a value of another note goes through secretGate wherever it comes in: editor sync and MCP
// operations (ApplyDocOps), new notes (createDocument: the API, MCP, extracting a branch, imports and
// restores), moving a branch or merging notes on the server, and a task's title carried into its note.
// When the writer may read the note the value belongs to, the target note gets a value of its own with
// the same text (opened and sealed again under a new id, which the seal binds as additional data) and
// the reference is rewritten to it; otherwise the reference becomes a placeholder, as mediaGate does
// for files. The rewritten content is what the change stores, so editors get it through the note's
// log like any other change; an editor that sends the old reference again (its text field still shows
// it) gets the same copy, not another one (ownCopyOf).
//
// A reference stays as it is when there is nothing to copy (no such value: deleted, or from another
// server), when the value does not open (SECRETS_KEY changed) or when the gate ran out of copies. No
// note reveals a value of another note, so such a reference shows nothing there; the hourly sweep
// copies it later (splitCrossNoteSecrets).

// maxSecretCopies: values one gate creates at most (one sync request, one new note, one moved branch).
// Each costs a decryption, an encryption and a row; a real paste brings a few.
const maxSecretCopies = 1000

// secretLookupChunk: ids per query when the gate reads the values a content refers to
const secretLookupChunk = 500

// maxSecretLookups: different references one gate looks up at most; a request full of made-up ids costs a
// few queries, not one per id. References beyond stay as they are (nothing to reveal outside their note).
const maxSecretLookups = 4 * secretLookupChunk

type secretGate struct {
	s       *Store
	userID  string
	docID   string            // the note the content goes into
	to      map[string]string // reference id → id written instead (the same id: kept, "": placeholder)
	read    map[string]bool   // note id → userID may read it
	copies  int               // copies left (-1: no limit, the sweep's split)
	lookups int               // references it may still look up (-1: no limit)
	quiet   bool              // the sweep's split: values that do not open are counted, not logged one by one
	// frozen: the gate runs inside the change's transaction and must not query (one connection, see
	// Doku/database.md); every id it meets there was prepared before, any other stays as it is
	frozen bool
	lang   string

	created    []string // copies this gate stored
	denied     int      // references replaced by the placeholder
	unreadable int      // values that did not open, references kept
}

func (s *Store) newSecretGate(userID, docID string) *secretGate {
	return &secretGate{s: s, userID: userID, docID: docID, to: map[string]string{}, read: map[string]bool{},
		copies: maxSecretCopies, lookups: maxSecretLookups}
}

// mayRead: the writer may read the note (the trash too, for its owner: a merged or inlined note goes
// there right away).
func (g *secretGate) mayRead(docID string) bool {
	ok, seen := g.read[docID]
	if !seen {
		ok = g.s.DocRole(g.userID, docID) != ""
		g.read[docID] = ok
	}
	return ok
}

// prepare decides for every reference in the contents not seen yet what it is written as, copying
// values where needed. The values are read in a few queries for all contents together, and the copies
// stored in one transaction.
func (g *secretGate) prepare(contents ...string) {
	if g.frozen {
		return
	}
	var ids []string
	seen := map[string]bool{}
	for _, c := range contents {
		if !strings.Contains(c, "{{secret:") {
			continue
		}
		for _, m := range SecretRefRe.FindAllStringSubmatch(c, -1) {
			if _, done := g.to[m[1]]; !done && !seen[m[1]] {
				seen[m[1]] = true
				ids = append(ids, m[1])
			}
		}
	}
	if len(ids) == 0 {
		return
	}
	if g.lookups >= 0 {
		if len(ids) > g.lookups {
			for _, id := range ids[g.lookups:] {
				g.to[id] = id
			}
			ids = ids[:g.lookups]
		}
		g.lookups -= len(ids)
	}
	rows, err := g.s.secretsByID(ids)
	if err != nil {
		logDBErr(err)
		for _, id := range ids {
			g.to[id] = id
		}
		return
	}
	var copies []NoteSecret
	for _, id := range ids {
		r, ok := rows[id]
		switch {
		case !ok || r.DocumentID == g.docID:
			g.to[id] = id
		case !g.mayRead(r.DocumentID):
			g.to[id] = ""
			// Read now: a frozen gate writes the placeholder without querying
			if g.lang == "" {
				g.lang = g.s.MessageLanguage(g.userID)
			}
		default:
			g.to[id] = g.copyOf(r, &copies)
		}
	}
	if len(copies) == 0 {
		return
	}
	if err := g.s.insertSecrets(copies); err != nil {
		// The references stay; the sweep copies them later
		slog.Error("Storing copies of hidden values failed", "doc_id", g.docID, "error", err)
		for _, c := range copies {
			g.to[c.SourceID] = c.SourceID
		}
		return
	}
	for _, c := range copies {
		g.created = append(g.created, c.ID)
	}
}

// copyOf returns the id the reference to r is written with in the gate's note: a copy the note has
// already, or a new one added to copies.
func (g *secretGate) copyOf(r NoteSecret, copies *[]NoteSecret) string {
	plain, err := OpenValue(g.s.secretsKey, r.ID, r.Ciphertext)
	if err != nil {
		g.unreadable++
		if g.quiet {
			return r.ID
		}
		slog.Warn("A hidden value copied into another note cannot be decrypted (SECRETS_KEY or secrets.key changed?); the reference stays and shows nothing there",
			"id", r.ID, "doc_id", g.docID)
		return r.ID
	}
	if id := g.s.ownCopyOf(g.docID, r, plain); id != "" {
		return id
	}
	if g.copies == 0 {
		return r.ID
	}
	id := NewSecretID()
	sealed, err := SealValue(g.s.secretsKey, id, plain)
	if err != nil {
		slog.Error("Copying a hidden value failed", "id", r.ID, "error", err)
		return r.ID
	}
	if g.copies > 0 {
		g.copies--
	}
	*copies = append(*copies, NoteSecret{ID: id, DocumentID: g.docID, CreatedBy: g.userID, SourceID: r.ID, Ciphertext: sealed})
	return id
}

// clean returns the content with every reference written as prepare decided (preparing what it has not
// seen yet, unless frozen); changed is false when everything stays.
func (g *secretGate) clean(content string) (out string, changed bool) {
	if !strings.Contains(content, "{{secret:") {
		return content, false
	}
	g.prepare(content)
	out = SecretRefRe.ReplaceAllStringFunc(content, func(ref string) string {
		id := ref[len("{{secret:") : len(ref)-len("}}")]
		to, ok := g.to[id]
		if !ok || to == id {
			return ref
		}
		changed = true
		if to == "" {
			g.denied++
			return g.placeholderFor(ref)
		}
		return secretRef(to)
	})
	return out, changed
}

// placeholderFor: the placeholder, or nothing where it is longer than the reference (an old short id),
// so a bullet never grows (as mediaGate.placeholderFor).
func (g *secretGate) placeholderFor(ref string) string {
	if g.lang == "" {
		g.lang = g.s.MessageLanguage(g.userID)
	}
	if p := i18n.T(g.lang, "(versteckter Wert nicht übernommen)"); len(p) <= len(ref) {
		return p
	}
	return ""
}

// cleanBlocks applies clean to bullets (copied on the first change, the caller's list stays).
func (g *secretGate) cleanBlocks(blocks []domain.DocumentBlock) []domain.DocumentBlock {
	contents := make([]string, len(blocks))
	for i, b := range blocks {
		contents[i] = b.Content
	}
	g.prepare(contents...)
	out := blocks
	copied := false
	for i, b := range blocks {
		content, changed := g.clean(b.Content)
		if !changed {
			continue
		}
		if !copied {
			out = append([]domain.DocumentBlock(nil), blocks...)
			copied = true
		}
		out[i].Content = content
	}
	return out
}

// cleanOps applies clean to inserted and changed bullets (copied on the first change).
func (g *secretGate) cleanOps(ops []collab.Op) []collab.Op {
	var contents []string
	for _, op := range ops {
		if op.Content != nil && (op.Kind == collab.OpInsert || op.Kind == collab.OpSetContent) {
			contents = append(contents, *op.Content)
		}
	}
	g.prepare(contents...)
	out := ops
	copied := false
	for i, op := range ops {
		if op.Content == nil || (op.Kind != collab.OpInsert && op.Kind != collab.OpSetContent) {
			continue
		}
		content, changed := g.clean(*op.Content)
		if !changed {
			continue
		}
		if !copied {
			out = append([]collab.Op(nil), ops...)
			copied = true
		}
		out[i].Content = &content
	}
	return out
}

// discard deletes the copies the gate stored, for content that was not written after all (a new note
// that could not be created).
func (g *secretGate) discard() {
	for _, id := range g.created {
		g.s.execLogged(`DELETE FROM note_secrets WHERE id = ?`, id)
	}
	g.created = nil
}

// secretsByID reads the values with the given ids (unknown ones are missing from the map).
func (s *Store) secretsByID(ids []string) (map[string]NoteSecret, error) {
	out := make(map[string]NoteSecret, len(ids))
	for start := 0; start < len(ids); start += secretLookupChunk {
		chunk := ids[start:min(start+secretLookupChunk, len(ids))]
		args := make([]any, len(chunk))
		for i, id := range chunk {
			args[i] = id
		}
		rows, err := s.db.Query(`SELECT id, document_id, created_by, source_id, ciphertext FROM note_secrets WHERE id IN (?`+
			strings.Repeat(", ?", len(chunk)-1)+`)`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var n NoteSecret
			if err := rows.Scan(&n.ID, &n.DocumentID, &n.CreatedBy, &n.SourceID, &n.Ciphertext); err != nil {
				_ = rows.Close()
				return nil, err
			}
			out[n.ID] = n
		}
		err = rows.Err()
		_ = rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

// ownCopyOf: a value of the note docID with the same text as r that was copied from r, or that r was
// copied from (a branch moved back). Writing the same reference into a note again then gives the copy
// it has, not one more: an editor resends the text its field shows until the cursor leaves the bullet,
// a task's title keeps the reference it was made with.
func (s *Store) ownCopyOf(docID string, r NoteSecret, plain string) string {
	rows, err := s.db.Query(`SELECT id, ciphertext FROM note_secrets WHERE document_id = ? AND (source_id = ? OR id = ?)
		ORDER BY created_at DESC LIMIT 8`, docID, r.ID, r.SourceID)
	if dbFailed(err) {
		return ""
	}
	var candidates []NoteSecret
	for rows.Next() {
		var c NoteSecret
		if !dbFailed(rows.Scan(&c.ID, &c.Ciphertext)) {
			candidates = append(candidates, c)
		}
	}
	logDBErr(rows.Err())
	_ = rows.Close()
	for _, c := range candidates {
		if v, err := OpenValue(s.secretsKey, c.ID, c.Ciphertext); err == nil && v == plain {
			return c.ID
		}
	}
	return ""
}

// insertSecrets stores copies made by a gate in one transaction.
func (s *Store) insertSecrets(list []NoteSecret) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ins, err := tx.Prepare(`INSERT INTO note_secrets (id, document_id, created_by, source_id, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer ins.Close()
	now := domain.NowISO()
	for _, n := range list {
		if _, err := ins.Exec(n.ID, n.DocumentID, n.CreatedBy, n.SourceID, n.Ciphertext, now, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}
