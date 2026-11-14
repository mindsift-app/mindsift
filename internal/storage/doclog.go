package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/mindsift-app/mindsift/internal/collab"
)

// How doc_ops stores the text of bullets (migration 44). An effect that sets a bullet's text (insert,
// set_content) used to carry the whole text, so every change kept another copy of the bullet for the
// retention period of the log: typing in a long bullet stored it again with every sync. Now the column
// content_ref says where the text of an entry is:
//
//   - logTextFull (0): in the payload, as before. Other kinds, entries written before migration 44 and
//     entries of bullets that compaction purged for good.
//   - logTextBlock (1): the newest text entry of a bullet stores no text; it is the bullet's current
//     text (blocks.content). Nothing else changes that column, so the two cannot drift apart.
//   - logTextDelta (2): when a newer text entry of the bullet arrives, the previous one becomes a delta
//     against the newer text: the bytes both share at the start and at the end, and what stood in
//     between. Typing changes a few characters, so the entry keeps those instead of the whole bullet.
//
// The delta of an entry is always relative to the next newer text entry of the same bullet in the same
// note, whatever form that one has. The log is only ever cut from the old end (CompactDocs), so that
// entry is still there. Reading the log puts every text back: clients get exactly the effects as
// before. If that fails (it should not), the reader asks the client to reload the snapshot instead.
const (
	logTextFull  = 0
	logTextBlock = 1
	logTextDelta = 2
)

// errLogText: a text of the log could not be put back together.
var errLogText = errors.New("log entry text cannot be restored")

// textDelta describes an older text by the newer one: newer[:Prefix] + Middle + newer[len-Suffix:].
// MiddleBytes takes the place of Middle for a part that is not valid UTF-8 (JSON would change it).
type textDelta struct {
	Prefix      int    `json:"p"`
	Suffix      int    `json:"s"`
	Middle      string `json:"m,omitempty"`
	MiddleBytes []byte `json:"mb,omitempty"`
}

// storedEffect is the payload of a log entry: the effect, plus the delta of an entry in delta form.
type storedEffect struct {
	collab.Effect
	Delta *textDelta `json:"delta,omitempty"`
}

// setsText: effects of this kind carry the full text of their bullet.
func setsText(kind string) bool { return kind == collab.OpInsert || kind == collab.OpSetContent }

// makeTextDelta describes older as a change of newer. The cuts lie on character boundaries of both texts.
func makeTextDelta(newer, older string) textDelta {
	n := min(len(newer), len(older))
	p := 0
	for p < n && newer[p] == older[p] {
		p++
	}
	for p > 0 && ((p < len(newer) && !utf8.RuneStart(newer[p])) || (p < len(older) && !utf8.RuneStart(older[p]))) {
		p--
	}
	s := 0
	for s < n-p && newer[len(newer)-1-s] == older[len(older)-1-s] {
		s++
	}
	for s > 0 && (!utf8.RuneStart(newer[len(newer)-s]) || !utf8.RuneStart(older[len(older)-s])) {
		s--
	}
	d := textDelta{Prefix: p, Suffix: s}
	if mid := older[p : len(older)-s]; utf8.ValidString(mid) {
		d.Middle = mid
	} else {
		d.MiddleBytes = []byte(mid)
	}
	return d
}

// apply gives the older text back from the newer one.
func (d textDelta) apply(newer string) (string, error) {
	if d.Prefix < 0 || d.Suffix < 0 || d.Prefix+d.Suffix > len(newer) {
		return "", errLogText
	}
	mid := d.Middle
	if d.MiddleBytes != nil {
		mid = string(d.MiddleBytes)
	}
	return newer[:d.Prefix] + mid + newer[len(newer)-d.Suffix:], nil
}

// logTexts follows the text of each bullet through one batch of effects, starting from the note as it
// was before the batch.
type logTexts struct {
	before *collab.Doc
	now    map[string]string
}

func newLogTexts(before *collab.Doc) *logTexts {
	return &logTexts{before: before, now: map[string]string{}}
}

// text is the bullet's text before the next effect; false for a bullet that did not exist.
func (t *logTexts) text(blockID string) (string, bool) {
	if s, ok := t.now[blockID]; ok {
		return s, true
	}
	if b, ok := t.before.Blocks[blockID]; ok {
		return b.Content, true
	}
	return "", false
}

// appendLogEntry writes one effect to the log. With textRefs (migration 44 has run) a text effect is
// stored without its text, and the bullet's previous text entry becomes a delta against it.
func appendLogEntry(tx *sql.Tx, docID string, seq int64, opID string, a collab.Actor, e collab.Effect, now string, texts *logTexts, textRefs bool) error {
	if !textRefs {
		payload, _ := json.Marshal(e)
		_, err := tx.Exec(
			`INSERT INTO doc_ops (doc_id, seq, op_id, user_id, client_id, kind, block_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			docID, seq, opID, a.UserID, a.ClientID, e.Kind, e.BlockID, string(payload), now)
		return err
	}
	mode := logTextFull
	stored := e
	if setsText(e.Kind) && e.BlockID != "" {
		if prev, ok := texts.text(e.BlockID); ok {
			if err := deltaPreviousText(tx, docID, e.BlockID, e.Content, prev); err != nil {
				return err
			}
		}
		texts.now[e.BlockID] = e.Content
		stored.Content = ""
		mode = logTextBlock
	}
	payload, _ := json.Marshal(stored)
	_, err := tx.Exec(
		`INSERT INTO doc_ops (doc_id, seq, op_id, user_id, client_id, kind, block_id, payload, content_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		docID, seq, opID, a.UserID, a.ClientID, e.Kind, e.BlockID, string(payload), mode, now)
	return err
}

// deltaPreviousText turns the bullet's newest text entry (if the log still has it) into a delta against
// the text that follows it.
func deltaPreviousText(tx *sql.Tx, docID, blockID, newer, older string) error {
	var seq int64
	var payload string
	err := tx.QueryRow(
		`SELECT seq, payload FROM doc_ops WHERE doc_id = ? AND block_id = ? AND content_ref != 0 AND content_ref = 1
		 ORDER BY seq DESC LIMIT 1`, docID, blockID).Scan(&seq, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var se storedEffect
	if err := json.Unmarshal([]byte(payload), &se); err != nil {
		return fmt.Errorf("log entry %d unreadable: %w", seq, err)
	}
	d := makeTextDelta(newer, older)
	se.Content, se.Delta = "", &d
	b, _ := json.Marshal(se)
	_, err = tx.Exec(`UPDATE doc_ops SET payload = ?, content_ref = ? WHERE doc_id = ? AND seq = ?`, string(b), logTextDelta, docID, seq)
	return err
}

// logRow is one entry as read from doc_ops, before its text is put back.
type logRow struct {
	entry   DocLogEntry
	mode    int
	delta   *textDelta
	current sql.NullString // the bullet's current text, for logTextBlock
}

// scanLogRows reads entries of the form (seq, op_id, user_id, client_id, payload, content_ref, current text).
func scanLogRows(rows *sql.Rows) ([]logRow, error) {
	defer rows.Close()
	var out []logRow
	for rows.Next() {
		var r logRow
		var payload string
		if err := rows.Scan(&r.entry.Seq, &r.entry.OpID, &r.entry.UserID, &r.entry.ClientID, &payload, &r.mode, &r.current); err != nil {
			return nil, err
		}
		var se storedEffect
		if err := json.Unmarshal([]byte(payload), &se); err != nil {
			return nil, fmt.Errorf("log entry %d unreadable: %w", r.entry.Seq, err)
		}
		r.entry.Effect, r.delta = se.Effect, se.Delta
		out = append(out, r)
	}
	return out, rows.Err()
}

// logSelect reads entries with the current text of the bullet next to those that refer to it.
const logSelect = `SELECT o.seq, o.op_id, o.user_id, o.client_id, o.payload, o.content_ref, b.content
	FROM doc_ops o LEFT JOIN blocks b ON o.content_ref = 1 AND b.id = o.block_id AND b.document_id = o.doc_id `

// readDocLog returns up to limit entries after since with their texts. Run it on one connection
// (readConsistent) or in a transaction: the later reads must see the same state. Without compact
// (before migration 44, which adds content_ref) every entry is complete.
func readDocLog(q docQueryer, docID string, since int64, limit int, compact bool) ([]DocLogEntry, error) {
	query := logSelect
	if !compact {
		query = `SELECT o.seq, o.op_id, o.user_id, o.client_id, o.payload, 0, NULL FROM doc_ops o `
	}
	rows, err := q.Query(query+`WHERE o.doc_id = ? AND o.seq > ? ORDER BY o.seq ASC LIMIT ?`, docID, since, limit)
	if err != nil {
		return nil, err
	}
	page, err := scanLogRows(rows)
	if err != nil {
		return nil, err
	}
	if err := restoreLogTexts(q, docID, page); err != nil {
		return nil, err
	}
	out := make([]DocLogEntry, len(page))
	for i := range page {
		out[i] = page[i].entry
	}
	return out, nil
}

// restoreLogTexts puts the texts back into rows (ascending seq), newest first: an entry in delta form
// takes the text of the next newer text entry of its bullet, from the rows or from the log after them.
func restoreLogTexts(q docQueryer, docID string, rows []logRow) error {
	if len(rows) == 0 {
		return nil
	}
	last := rows[len(rows)-1].entry.Seq
	next := map[string]string{} // bullet -> text of its next newer text entry
	for i := len(rows) - 1; i >= 0; i-- {
		r := &rows[i]
		e := &r.entry.Effect
		if !setsText(e.Kind) {
			continue
		}
		switch r.mode {
		case logTextFull:
		case logTextBlock:
			if !r.current.Valid {
				return fmt.Errorf("%w: entry %d, bullet %s missing", errLogText, r.entry.Seq, e.BlockID)
			}
			e.Content = r.current.String
		case logTextDelta:
			newer, ok := next[e.BlockID]
			if !ok {
				var err error
				if newer, err = textAfter(q, docID, e.BlockID, last); err != nil {
					return err
				}
			}
			if r.delta == nil {
				return fmt.Errorf("%w: entry %d has no delta", errLogText, r.entry.Seq)
			}
			text, err := r.delta.apply(newer)
			if err != nil {
				return fmt.Errorf("%w: entry %d", err, r.entry.Seq)
			}
			e.Content = text
		default:
			return fmt.Errorf("%w: entry %d of unknown form %d", errLogText, r.entry.Seq, r.mode)
		}
		next[e.BlockID] = e.Content
	}
	return nil
}

// textAfter is the text of the bullet's oldest text entry after seq. Those entries all refer to the
// bullet (a delta form is only ever followed by another entry that does), the newest to its current text.
func textAfter(q docQueryer, docID, blockID string, seq int64) (string, error) {
	rows, err := q.Query(logSelect+`WHERE o.doc_id = ? AND o.block_id = ? AND o.content_ref != 0 AND o.seq > ? ORDER BY o.seq ASC`,
		docID, blockID, seq)
	if err != nil {
		return "", err
	}
	chain, err := scanLogRows(rows)
	if err != nil {
		return "", err
	}
	if len(chain) == 0 {
		return "", fmt.Errorf("%w: nothing after entry %d of bullet %s", errLogText, seq, blockID)
	}
	if err := restoreLogTexts(q, docID, chain); err != nil {
		return "", err
	}
	return chain[0].entry.Effect.Content, nil
}

// materializeLogTexts writes the texts of a bullet's entries back into their payloads (logTextFull):
// before compaction purges the bullet, whose current text the newest of them refers to.
func materializeLogTexts(tx *sql.Tx, docID, blockID string) error {
	rows, err := tx.Query(logSelect+`WHERE o.doc_id = ? AND o.block_id = ? AND o.content_ref != 0 ORDER BY o.seq ASC`, docID, blockID)
	if err != nil {
		return err
	}
	chain, err := scanLogRows(rows)
	if err != nil {
		return err
	}
	if err := restoreLogTexts(tx, docID, chain); err != nil {
		return err
	}
	for _, r := range chain {
		payload, _ := json.Marshal(r.entry.Effect)
		if _, err := tx.Exec(`UPDATE doc_ops SET payload = ?, content_ref = ? WHERE doc_id = ? AND seq = ?`,
			string(payload), logTextFull, docID, r.entry.Seq); err != nil {
			return err
		}
	}
	return nil
}
