package storage

import (
	"database/sql"
	"errors"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// migrateSecretCopies gives every note its own copy of the hidden values its bullets show from other
// notes (migration 46): until now a bullet copied or moved into another note kept pointing to the value
// of its note of origin. source_id records which value a copy was made from (secretGate).
func (s *Store) migrateSecretCopies() error {
	if err := s.addColumnIfMissing("note_secrets", "source_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	beyond, err := secretsBeyondRefCap(s.db)
	if err != nil {
		return err
	}
	res, err := s.splitCrossNoteSecrets(beyond)
	if err != nil {
		return err
	}
	if res.Copied+res.Replaced > 0 {
		slog.Info("Hidden values shown in other notes copied into those notes", "notes", len(res.Notes),
			"copied", res.Copied, "placeholders", res.Replaced)
	}
	if res.Unreadable > 0 {
		slog.Warn("Hidden values shown in other notes cannot be decrypted (SECRETS_KEY or secrets.key changed?); "+
			"their references stay as they are and the hourly cleanup copies them once the key is right again", "references", res.Unreadable)
	}
	return nil
}

// SecretSplit is what one pass of splitCrossNoteSecrets did.
type SecretSplit struct {
	Notes      []string // notes whose bullets changed
	Copied     int      // copies made
	Replaced   int      // references replaced by the placeholder
	Unreadable int      // references kept because their value did not open
}

// splitCrossNoteSecrets gives every live bullet holding a value of another note a copy of its own,
// through secretGate as if the bullet's last writer wrote it now (the note's owner when that account is
// gone): a copy where they may read the value's note, the placeholder where not. Migration 46 splits
// the references of older versions with it. The hourly sweep runs it too, for references kept while
// their value did not open (SECRETS_KEY wrong at the time) or a gate ran out of copies, and for bullets
// that undo brings back from before the update. beyond is secretsBeyondRefCap of all notes.
func (s *Store) splitCrossNoteSecrets(beyond map[string][]string) (SecretSplit, error) {
	var res SecretSplit
	docs, err := s.notesWithForeignSecrets(beyond)
	if err != nil {
		return res, err
	}
	users := map[string]bool{}
	for _, docID := range docs {
		changed, err := s.splitNoteSecrets(docID, users, &res)
		if err != nil {
			return res, err
		}
		if changed {
			res.Notes = append(res.Notes, docID)
		}
	}
	return res, nil
}

// notesWithForeignSecrets: the notes with a live bullet holding a value of another note, sorted; found
// through block_refs and, for bullets at maxBlockRefs, in beyond.
func (s *Store) notesWithForeignSecrets(beyond map[string][]string) ([]string, error) {
	rows, err := s.db.Query(sqlNotesWithForeignSecrets)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			_ = rows.Close()
			return nil, err
		}
		set[d] = true
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, err
	}
	if len(beyond) > 0 {
		ids := make([]string, 0, len(beyond))
		for id := range beyond {
			ids = append(ids, id)
		}
		known, err := s.secretsByID(ids)
		if err != nil {
			return nil, err
		}
		for id, docs := range beyond {
			if sec, ok := known[id]; ok {
				for _, d := range docs {
					if d != sec.DocumentID {
						set[d] = true
					}
				}
			}
		}
	}
	out := make([]string, 0, len(set))
	for d := range set {
		out = append(out, d)
	}
	sort.Strings(out)
	return out, nil
}

// splitNoteSecrets runs the bullets of one note that hold references through secretGate, per last
// writer, and writes what changed through the note's log (open editors follow, undo works). users
// caches which accounts exist. Returns whether a bullet changed.
func (s *Store) splitNoteSecrets(docID string, users map[string]bool, res *SecretSplit) (bool, error) {
	state, err := s.readCollabDoc(docID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var owner string
	if err := s.db.QueryRow(`SELECT user_id FROM documents WHERE id = ?`, docID).Scan(&owner); err != nil {
		return false, err
	}
	exists := func(id string) bool {
		ok, seen := users[id]
		if !seen {
			var n int
			logDBErr(s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, id).Scan(&n))
			ok = n > 0
			users[id] = ok
		}
		return ok
	}
	byWriter := map[string][]*collab.Block{}
	for _, b := range state.Blocks {
		if b.Deleted || !strings.Contains(b.Content, "{{secret:") {
			continue
		}
		w := b.UpdatedBy
		if w == "" || !exists(w) {
			w = owner
		}
		byWriter[w] = append(byWriter[w], b)
	}
	writers := make([]string, 0, len(byWriter))
	for w := range byWriter {
		writers = append(writers, w)
	}
	sort.Strings(writers)
	changed := false
	for _, w := range writers {
		g := s.newSecretGate(w, docID)
		g.copies, g.lookups, g.quiet = -1, -1, true
		blocks := byWriter[w]
		contents := make([]string, len(blocks))
		for i, b := range blocks {
			contents[i] = b.Content
		}
		g.prepare(contents...)
		next := map[string][2]string{} // block id → old, new content
		for _, b := range blocks {
			if out, ok := g.clean(b.Content); ok {
				next[b.ID] = [2]string{b.Content, out}
			}
		}
		res.Unreadable += g.unreadable
		if len(next) == 0 {
			continue
		}
		applied := 0
		_, _, err := s.applyDocChange(docID, collab.Actor{UserID: w, ClientID: collab.ServerHolder}, nil, func(d *collab.Doc) []collab.Op {
			var ops []collab.Op
			for id, c := range next {
				// Only where nobody typed in the meantime; the next sweep looks again
				if b := d.Blocks[id]; b != nil && !b.Deleted && b.Content == c[0] {
					text := c[1]
					ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: id, BaseVersion: b.Version, Content: &text})
				}
			}
			applied = len(ops)
			return ops
		})
		if err != nil {
			return changed, err
		}
		res.Copied += len(g.created)
		res.Replaced += g.denied
		changed = changed || applied > 0
	}
	return changed, nil
}

// SecretSweep is what one pass of SweepSecrets did.
type SecretSweep struct {
	Split                       SecretSplit
	Orphaned, Restored, Deleted int
}

// SweepSecrets first gives bullets still holding values of other notes copies of their own
// (splitCrossNoteSecrets), then marks secrets no live bullet of their own note holds any more, clears
// the mark when one holds it again (undo, restoring a deleted bullet; a note in the trash keeps holding
// its values) and deletes secrets marked SecretOrphanDays ago.
func (s *Store) SweepSecrets(now time.Time) (SecretSweep, error) {
	var res SecretSweep
	beyond, err := secretsBeyondRefCap(s.db)
	if err != nil {
		return res, err
	}
	if res.Split, err = s.splitCrossNoteSecrets(beyond); err != nil {
		return res, err
	}
	if len(res.Split.Notes) > 0 {
		if beyond, err = secretsBeyondRefCap(s.db); err != nil {
			return res, err
		}
	}

	type row struct {
		id, docID, orphanedAt string
		held                  bool
	}
	rows, err := s.db.Query(sqlSecretsHeldAtHome)
	if err != nil {
		return res, err
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.docID, &r.orphanedAt, &r.held); err != nil {
			_ = rows.Close()
			return res, err
		}
		all = append(all, r)
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return res, err
	}

	nowISO := now.UTC().Format(time.RFC3339)
	cutoff := now.UTC().AddDate(0, 0, -SecretOrphanDays).Format(time.RFC3339)
	for _, r := range all {
		home := r.held || slices.Contains(beyond[r.id], r.docID)
		switch {
		case home:
			if r.orphanedAt != "" {
				_, err = s.db.Exec(`UPDATE note_secrets SET orphaned_at = '' WHERE id = ?`, r.id)
				res.Restored++
			}
		case r.orphanedAt == "":
			_, err = s.db.Exec(`UPDATE note_secrets SET orphaned_at = ? WHERE id = ?`, nowISO, r.id)
			res.Orphaned++
		case r.orphanedAt < cutoff:
			_, err = s.db.Exec(`DELETE FROM note_secrets WHERE id = ?`, r.id)
			res.Deleted++
		}
		if err != nil {
			return res, err
		}
	}
	return res, nil
}
