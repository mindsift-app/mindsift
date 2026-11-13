package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Restructuring notes: turn a bullet with its children into a note of its own, and merge one note into
// another. Both change the affected notes through the normal operation log, so open editors follow
// live, and nothing is lost: an extracted branch lives on in the new note, a merged note goes to the
// trash and the merge can be undone.

var (
	ErrBlockNotFound = errors.New("Punkt nicht gefunden")
	ErrBranchLocked  = errors.New("Jemand anderes bearbeitet gerade einen Punkt in diesem Ast. Bitte kurz warten.")
	ErrMergeSelf     = errors.New("Eine Notiz kann nicht mit sich selbst zusammengeführt werden")
	ErrAlreadyNote   = errors.New("Dieser Punkt verweist schon auf eine eigene Notiz")
	ErrMergeNotOwner = errors.New("Zusammenführen geht nur mit eigenen Notizen als Quelle")
	ErrNotNoteLink   = errors.New("Dieser Punkt ist kein Link auf eine Notiz")
	ErrLinkedMissing = errors.New("Die verlinkte Notiz gibt es nicht (mehr)")
	ErrInlineOwner   = errors.New("Zurückholen geht nur mit eigenen Notizen")
	ErrMoveSelf      = errors.New("Der Punkt ist schon in dieser Notiz")
)

// readCollabDoc loads the current state of a note outside of a change.
func (s *Store) readCollabDoc(docID string) (*collab.Doc, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	doc, _, err := loadCollabDoc(tx, docID)
	return doc, err
}

var (
	titlePrefixRe = regexp.MustCompile(`^(\s*(-|\*|#{1,6}|\[[ xX]?\])\s+)+`)
	titleTagRe    = regexp.MustCompile(`(^|\s)#[\p{L}0-9_-]+`)
	// A bullet that is only a link (with hashtags); noteLinkOnly checks that it is not one to a single
	// bullet (left behind by moving a branch)
	noteLinkOnlyRe = regexp.MustCompile(`^\s*\[\[([^\]]+)\]\](\s+#[\p{L}0-9_-]+)*\s*$`)
)

// Bullet types whose text can name a note; a drawing, picture, code or table cannot
var titleBlockTypes = map[string]bool{
	"": true, "text": true, "paragraph": true, "bullet": true, "numbered": true, "todo": true,
	"h1": true, "h2": true, "h3": true, "callout": true, "warning": true, "error": true,
}

// branchTitle makes a note title from a bullet's text (without hashtags and links); bullets without
// usable text give "Neue Notiz".
func branchTitle(lang string, b *collab.Block) string {
	t := ""
	if titleBlockTypes[b.Type] {
		first := titlePrefixRe.ReplaceAllString(strings.SplitN(b.Content, "\n", 2)[0], "")
		t = strings.TrimSpace(titleTagRe.ReplaceAllString(first, ""))
		t = strings.NewReplacer("[[", "", "]]", "").Replace(t)
		if r := []rune(t); len(r) > 120 {
			t = strings.TrimSpace(string(r[:119])) + "…"
		}
	}
	if t == "" {
		t = i18n.T(lang, "Neue Notiz")
	}
	return t
}

// titleFrom: the note title is base or base made unique by uniqueTitle
func titleFrom(title, base string) bool {
	title, base = strings.ToLower(strings.TrimSpace(title)), strings.ToLower(base)
	if title == base {
		return true
	}
	rest, ok := strings.CutPrefix(title, base+" (")
	if !ok || !strings.HasSuffix(rest, ")") {
		return false
	}
	_, err := strconv.Atoi(strings.TrimSuffix(rest, ")"))
	return err == nil
}

// uniqueTitle appends " (2)", " (3)" … when the user already has a note of that name, so the wiki link
// points to exactly one note.
func (s *Store) uniqueTitle(userID, title string) string {
	docs, _ := s.GetDocuments(userID)
	taken := map[string]bool{}
	for _, d := range docs {
		taken[strings.ToLower(d.Title)] = true
	}
	candidate := title
	for n := 2; taken[strings.ToLower(candidate)]; n++ {
		candidate = fmt.Sprintf("%s (%d)", title, n)
	}
	return candidate
}

func countTopLevel(flat []collab.FlatBlock) int {
	n := 0
	for _, b := range flat {
		if b.Level == 0 {
			n++
		}
	}
	return n
}

func toDocumentBlock(b collab.FlatBlock, level int, pos int) domain.DocumentBlock {
	return domain.DocumentBlock{
		ID: domain.NewID("blk"), Type: b.Type, Content: b.Content, Level: level, Position: float64(pos + 1),
		Checked: b.Props.Checked, Collapsed: b.Props.Collapsed, Lang: b.Props.Lang,
	}
}

func foreignLeaseIn(ids []string, a collab.Actor, leases collab.LeaseView) bool {
	if leases == nil {
		return false
	}
	for _, id := range ids {
		if holder, ok := leases.HolderOf(id); ok && holder != a.ClientID {
			return true
		}
	}
	return false
}

// ExtractBranch creates a new note from a bullet with its children, named after the bullet, in the same
// folder and shared like the original. The bullet stays the note's first bullet (its hashtags with it). The original note is not changed here: the editor replaces the branch
// by the returned link itself, as an ordinary own edit (no clash with unsent typing, undo works).
func (s *Store) ExtractBranch(userID, docID, blockID string, a collab.Actor, leases collab.LeaseView) (*domain.Document, string, error) {
	source, err := s.GetDocumentByID(userID, docID)
	if err != nil {
		return nil, "", err
	}
	state, err := s.readCollabDoc(docID)
	if err != nil {
		return nil, "", err
	}
	flat := state.Flatten()
	start := -1
	for i, b := range flat {
		if b.ID == blockID {
			start = i
			break
		}
	}
	if start < 0 {
		return nil, "", ErrBlockNotFound
	}
	root := flat[start]
	if _, ok := noteLinkOnly(root.Content); ok {
		return nil, "", ErrAlreadyNote
	}
	blocks := []domain.DocumentBlock{toDocumentBlock(root, 0, 0)}
	ids := []string{root.ID}
	for i := start + 1; i < len(flat) && flat[i].Level > root.Level; i++ {
		blocks = append(blocks, toDocumentBlock(flat[i], flat[i].Level-root.Level, len(blocks)))
		ids = append(ids, flat[i].ID)
	}
	if foreignLeaseIn(ids, a, leases) {
		return nil, "", ErrBranchLocked
	}

	title := s.uniqueTitle(userID, branchTitle(s.MessageLanguage(userID), root.Block))
	created, err := s.CreateDocument(userID, "", title, "🗒️", source.FolderPath, blocks, nil, false)
	if err != nil {
		return nil, "", err
	}
	s.copyShares(userID, source, created.ID)
	return created, noteLink(title, created.ID, ""), nil
}

// UndoExtract puts a note created by ExtractBranch into the trash (only its creator may).
func (s *Store) UndoExtract(userID, docID string) error {
	doc, err := s.GetDocumentByID(userID, docID)
	if err != nil {
		return err
	}
	if !doc.IsOwner {
		return ErrMergeNotOwner
	}
	if doc.IsArchived {
		return nil
	}
	return s.trashDocument(userID, docID)
}

// StillLinkedError: the note to bring back is linked from other notes as well
type StillLinkedError struct {
	Title string
	Count int
}

func (e *StillLinkedError) Error() string { return e.Localize(i18n.Fallback) }

func (e *StillLinkedError) Localize(lang string) string {
	return i18n.T(lang, "„{title}“ ist noch in {count} weiteren Notiz(en) verlinkt; diese Links würden ins Leere zeigen. Bitte dort zuerst entfernen.", "title", e.Title, "count", strconv.Itoa(e.Count))
}

// InlineResult: what the editor puts back in place of the link bullet
type InlineResult struct {
	SourceID string `json:"sourceId"`
	// Text of the bullet: the note's title, hashtags of the link kept
	Content string `json:"content"`
	// A note made by ExtractBranch: its first bullet, which takes the link bullet's place (type and
	// props included); Content is then that bullet's text
	Head *domain.DocumentBlock `json:"head,omitempty"`
	// The note's blocks with fresh ids; level 0 = directly below the bullet
	Blocks []domain.DocumentBlock `json:"blocks"`
}

// InlineNote is the way back from ExtractBranch: for a bullet that is only a link to an own note, it
// returns that note's blocks and puts the note into the trash. Like ExtractBranch it does not change
// the note with the bullet; the editor inserts the blocks itself as an own edit (undo works). Refused
// while other notes link to the note as well, since those links would point to nothing.
func (s *Store) InlineNote(userID, docID, blockID string) (*InlineResult, error) {
	state, err := s.readCollabDoc(docID)
	if err != nil {
		return nil, err
	}
	var content string
	found := false
	for _, b := range state.Flatten() {
		if b.ID == blockID {
			content, found = b.Content, true
			break
		}
	}
	if !found {
		return nil, ErrBlockNotFound
	}
	link, ok := noteLinkOnly(content)
	if !ok {
		return nil, ErrNotNoteLink
	}
	docs, err := s.GetDocuments(userID)
	if err != nil {
		return nil, err
	}
	linked := s.resolveWikiLink(link, docs, docID)
	if linked == nil {
		return nil, ErrLinkedMissing
	}
	if !linked.IsOwner {
		return nil, ErrInlineOwner
	}
	backlinks, err := s.GetBacklinks(userID, linked.ID)
	if err != nil {
		return nil, err
	}
	others := 0
	for _, bl := range backlinks {
		if bl.DocID != docID {
			others++
		}
	}
	if others > 0 {
		return nil, &StillLinkedError{Title: linked.Title, Count: others}
	}
	source, err := s.readCollabDoc(linked.ID)
	if err != nil {
		return nil, err
	}
	flat := source.Flatten()
	rest := strings.TrimSpace(wikiTokenRe.ReplaceAllString(content, ""))
	res := &InlineResult{SourceID: linked.ID, Content: strings.TrimSpace(linked.Title + " " + rest), Blocks: []domain.DocumentBlock{}}
	// Made by ExtractBranch (one top bullet that names the note): that bullet takes the link's place
	// again instead of the title, so it does not show twice
	if countTopLevel(flat) == 1 && titleFrom(linked.Title, branchTitle(s.MessageLanguage(userID), flat[0].Block)) {
		head := toDocumentBlock(flat[0], 0, 0)
		res.Head = &head
		res.Content = head.Content
		for _, tag := range strings.Fields(rest) {
			if !strings.Contains(head.Content, tag) {
				res.Content = strings.TrimSpace(res.Content + " " + tag)
			}
		}
		for _, b := range flat[1:] {
			res.Blocks = append(res.Blocks, toDocumentBlock(b, b.Level-1, len(res.Blocks)))
		}
	} else {
		for _, b := range flat {
			res.Blocks = append(res.Blocks, toDocumentBlock(b, b.Level, len(res.Blocks)))
		}
	}
	if err := s.trashDocument(userID, linked.ID); err != nil {
		return nil, err
	}
	return res, nil
}

// copyShares gives the new note the direct and team shares of the source; when someone else owns the
// source, that owner may edit the new note as well (the branch was theirs to read before).
func (s *Store) copyShares(userID string, source *domain.Document, newDocID string) {
	// A share that cannot be copied leaves the new note with fewer readers, never with more
	failed := func(err error) {
		if err != nil {
			slog.Warn("Copying a share to the new note failed", "doc_id", newDocID, "error", err)
		}
	}
	shares, err := s.GetDocShares(source.ID)
	failed(err)
	for _, sh := range shares {
		switch {
		case sh.TargetType == "team":
			_, err = s.CreateDocTeamShare(userID, newDocID, sh.TargetID, sh.Permission)
			failed(err)
		case sh.UserID != "" && sh.UserID != userID:
			_, err = s.CreateDocShare(userID, newDocID, sh.UserID, sh.Permission)
			failed(err)
		}
	}
	if source.UserID != "" && source.UserID != userID {
		_, err = s.CreateDocShare(userID, newDocID, source.UserID, "write")
		failed(err)
	}
}

// MergeResult tells the client what to undo.
type MergeResult struct {
	TargetID    string `json:"targetId"`
	SourceID    string `json:"sourceId"`
	SourceTitle string `json:"sourceTitle"`
	HeadingID   string `json:"headingId"`
}

// MergeDocuments appends the source note to the end of the target: a heading with the source's title,
// its blocks below it. The source goes to the trash (it must belong to the user; the caller checks
// write access to the target).
func (s *Store) MergeDocuments(userID, sourceID, targetID string, a collab.Actor, leases collab.LeaseView) (*MergeResult, error) {
	if sourceID == targetID {
		return nil, ErrMergeSelf
	}
	source, err := s.GetDocumentByID(userID, sourceID)
	if err != nil {
		return nil, err
	}
	if !source.IsOwner {
		return nil, ErrMergeNotOwner
	}
	if source.IsArchived {
		return nil, ErrDocInTrash
	}
	state, err := s.readCollabDoc(sourceID)
	if err != nil {
		return nil, err
	}
	flat := state.Flatten()

	headingID := domain.NewID("blk")
	heading := strings.TrimSpace(source.Icon + " " + source.Title)
	lang := s.MessageLanguage(userID)
	if heading == "" {
		heading = i18n.T(lang, "Zusammengeführte Notiz")
	}
	heading += " (" + i18n.ShortDate(lang, clock.Now()) + ")"

	_, _, err = s.applyDocChange(targetID, a, leases, func(d *collab.Doc) []collab.Op {
		// After the last top-level block, deleted ones included, so keys never collide
		last := ""
		for _, b := range d.Blocks {
			if b.ParentID == "" && b.OrderKey > last {
				last = b.OrderKey
			}
		}
		key, err := collab.KeyBetween(last, "")
		if err != nil {
			return nil
		}
		root := ""
		ops := []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: headingID, ParentID: &root, OrderKey: key, Type: "h2", Content: &heading}}
		// Parents by level: the heading holds the source's top level
		parents := []string{headingID}
		lastKey := map[string]string{}
		for _, b := range flat {
			if b.Level+1 > len(parents) {
				continue // cannot happen with a flattened tree; guards against gaps
			}
			parents = parents[:b.Level+1]
			parent := parents[b.Level]
			k, err := collab.KeyBetween(lastKey[parent], "")
			if err != nil {
				return nil
			}
			lastKey[parent] = k
			id := domain.NewID("blk")
			content := b.Content
			props := collab.Props{Checked: b.Props.Checked, Collapsed: b.Props.Collapsed, Lang: b.Props.Lang}
			p := parent
			ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: id, ParentID: &p, OrderKey: k, Type: b.Type, Content: &content, Props: &props})
			parents = append(parents, id)
		}
		return ops
	})
	if err != nil {
		return nil, err
	}
	if err := s.trashDocument(userID, sourceID); err != nil {
		return nil, err
	}
	return &MergeResult{TargetID: targetID, SourceID: sourceID, SourceTitle: source.Title, HeadingID: headingID}, nil
}

// UndoMerge removes the appended section from the target and brings the source back from the trash.
func (s *Store) UndoMerge(userID string, m MergeResult, a collab.Actor, leases collab.LeaseView) error {
	if err := s.RestoreDocument(userID, m.SourceID); err != nil {
		return err
	}
	_, _, err := s.applyDocChange(m.TargetID, a, leases, func(d *collab.Doc) []collab.Op {
		if b, ok := d.Blocks[m.HeadingID]; !ok || b.Deleted {
			return nil
		}
		return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpDelete, BlockID: m.HeadingID}}
	})
	return err
}

// MoveResult tells the client where the branch went and what to undo.
type MoveResult struct {
	TargetID    string `json:"targetId"`
	TargetTitle string `json:"targetTitle"`
	// The branch's bullet in the target note
	RootID string `json:"rootId"`
	// New block ID in the target → old block ID in the source, for undo
	Moved map[string]string `json:"moved"`
}

// MoveBranch copies a bullet with its children to the end of another note (through the target's
// operation log, so open editors follow live) and moves the links of tasks and subtasks on these
// checkboxes along. Like ExtractBranch it does not change the source note: the editor removes the
// branch there itself as an own edit (Strg+Z works). The caller checks write access to both notes.
func (s *Store) MoveBranch(userID, sourceID, blockID, targetID string, a collab.Actor, sourceLeases, targetLeases collab.LeaseView) (*MoveResult, error) {
	if sourceID == targetID {
		return nil, ErrMoveSelf
	}
	target, err := s.GetDocumentByID(userID, targetID)
	if err != nil {
		return nil, err
	}
	if target.IsArchived {
		return nil, ErrDocInTrash
	}
	state, err := s.readCollabDoc(sourceID)
	if err != nil {
		return nil, err
	}
	flat := state.Flatten()
	start := -1
	for i, b := range flat {
		if b.ID == blockID {
			start = i
			break
		}
	}
	if start < 0 {
		return nil, ErrBlockNotFound
	}
	branch := []collab.FlatBlock{flat[start]}
	for i := start + 1; i < len(flat) && flat[i].Level > flat[start].Level; i++ {
		branch = append(branch, flat[i])
	}
	ids := make([]string, len(branch))
	for i, b := range branch {
		ids[i] = b.ID
	}
	if foreignLeaseIn(ids, a, sourceLeases) {
		return nil, ErrBranchLocked
	}

	moved := map[string]string{}
	rootID := ""
	_, _, err = s.applyDocChange(targetID, a, targetLeases, func(d *collab.Doc) []collab.Op {
		// After the last top-level block, deleted ones included, so keys never collide
		last := ""
		for _, b := range d.Blocks {
			if b.ParentID == "" && b.OrderKey > last {
				last = b.OrderKey
			}
		}
		lastKey := map[string]string{"": last}
		base := branch[0].Level
		parents := []string{""}
		var ops []collab.Op
		for _, b := range branch {
			level := b.Level - base
			if level+1 > len(parents) {
				continue // cannot happen with a flattened tree; guards against gaps
			}
			parents = parents[:level+1]
			parent := parents[level]
			k, err := collab.KeyBetween(lastKey[parent], "")
			if err != nil {
				return nil
			}
			lastKey[parent] = k
			id := domain.NewID("blk")
			content := b.Content
			props := collab.Props{Checked: b.Props.Checked, Collapsed: b.Props.Collapsed, Lang: b.Props.Lang}
			p := parent
			ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: id, ParentID: &p, OrderKey: k, Type: b.Type, Content: &content, Props: &props})
			parents = append(parents, id)
			moved[id] = b.ID
			if rootID == "" {
				rootID = id
			}
		}
		return ops
	})
	if err != nil {
		return nil, err
	}
	if rootID == "" {
		return nil, ErrBlockNotFound
	}
	s.relinkTaskBlocks(sourceID, targetID, moved)
	return &MoveResult{TargetID: targetID, TargetTitle: target.Title, RootID: rootID, Moved: moved}, nil
}

// relinkTaskBlocks points tasks and subtasks linked to checkboxes of note from at the matching
// checkboxes of note to (ids: block ID in to → block ID in from).
func (s *Store) relinkTaskBlocks(from, to string, ids map[string]string) {
	newOf := map[string]string{}
	for newID, oldID := range ids {
		newOf[oldID] = newID
	}
	for oldID, newID := range newOf {
		s.execLogged(`UPDATE thoughts SET converted_ref_id = ? WHERE converted_type = 'document_block' AND converted_ref_id = ?`,
			to+":"+newID, from+":"+oldID)
	}
	for blockID, taskID := range s.docTaskLinks(to) {
		if _, ok := ids[blockID]; !ok {
			continue
		}
		var raw string
		if err := s.db.QueryRow(`SELECT subtasks FROM thoughts WHERE id = ?`, taskID).Scan(&raw); err != nil {
			logDBErr(err)
			continue
		}
		var subs []domain.SubTask
		if json.Unmarshal([]byte(raw), &subs) != nil {
			continue
		}
		changed := false
		for i := range subs {
			if n, ok := newOf[subs[i].BlockID]; ok {
				subs[i].BlockID, changed = n, true
			}
		}
		if changed {
			subsJSON, _ := json.Marshal(subs)
			s.execLogged(`UPDATE thoughts SET subtasks = ? WHERE id = ?`, string(subsJSON), taskID)
		}
	}
}

// UndoMove removes a moved branch from the target note again and gives the task links back to the
// source note's checkboxes (which the editor brings back itself, as the undo of its own edit).
func (s *Store) UndoMove(sourceID string, m MoveResult, a collab.Actor, leases collab.LeaseView) error {
	_, _, err := s.applyDocChange(m.TargetID, a, leases, func(d *collab.Doc) []collab.Op {
		if b, ok := d.Blocks[m.RootID]; !ok || b.Deleted {
			return nil
		}
		return []collab.Op{{OpID: domain.NewID("op"), Kind: collab.OpDelete, BlockID: m.RootID}}
	})
	if err != nil {
		return err
	}
	back := map[string]string{}
	for newID, oldID := range m.Moved {
		back[oldID] = newID
	}
	s.relinkTaskBlocks(m.TargetID, sourceID, back)
	return nil
}

// DocHead is the newest log position of a note (to tell open editors to sync).
func (s *Store) DocHead(docID string) int64 {
	var head int64
	logDBErr(s.db.QueryRow(`SELECT head_seq FROM documents WHERE id = ?`, docID).Scan(&head))
	return head
}
