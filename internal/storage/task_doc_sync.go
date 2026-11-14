package storage

import (
	"encoding/json"
	"strings"

	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// A task linked to a note checkbox ("Erweitert") stays in step with it in both directions: tick and
// title. Its subtasks belong to the link as well: each subtask is tied 1:1 to one checkbox of the same
// note (SubTask.BlockID), wherever that checkbox is moved. New subtasks of the task appear as
// checkboxes right under the main checkbox; new checkboxes directly one level under the main checkbox
// become subtasks. Deleting is never mirrored: a deleted checkbox only loses its link, a deleted
// subtask leaves its checkbox in the note.

// docSubtaskLinks maps checkbox IDs of a note to the task whose subtask they are.
func (s *Store) docSubtaskLinks(docID string, mainLinks map[string]string) map[string]string {
	out := map[string]string{}
	for _, taskID := range mainLinks {
		var raw string
		if err := s.db.QueryRow(`SELECT subtasks FROM thoughts WHERE id = ?`, taskID).Scan(&raw); err != nil {
			logDBErr(err)
			continue
		}
		var subs []domain.SubTask
		_ = json.Unmarshal([]byte(raw), &subs)
		for _, st := range subs {
			if st.BlockID != "" {
				out[st.BlockID] = taskID
			}
		}
	}
	return out
}

// DocTaskLinks returns the note's checkboxes linked to a task (block → task) and those linked as a
// subtask (block → task of the subtask), for the editor's badges.
func (s *Store) DocTaskLinks(docID string) (tasks, subtasks map[string]string) {
	tasks = s.docTaskLinks(docID)
	return tasks, s.docSubtaskLinks(docID, tasks)
}

// reconcileSubtasks brings the subtasks of the task linked to mainID in line with the note: linked
// checkboxes give tick and title, gone or no longer checkbox blocks lose their link, new checkboxes
// directly under the main checkbox become subtasks (an unlinked subtask with the same title is linked
// instead of adding a duplicate). taken are checkboxes linked elsewhere (other tasks).
func reconcileSubtasks(d *collab.Doc, mainID string, subs []domain.SubTask, taken map[string]bool) ([]domain.SubTask, bool) {
	changed := false
	out := make([]domain.SubTask, len(subs))
	copy(out, subs)
	linked := map[string]bool{}
	for i := range out {
		id := out[i].BlockID
		if id == "" {
			continue
		}
		b, ok := d.Blocks[id]
		if !ok || b.Deleted || b.Type != "todo" {
			out[i].BlockID = ""
			changed = true
			continue
		}
		linked[id] = true
		if b.Props.Checked != out[i].IsCompleted {
			out[i].IsCompleted = b.Props.Checked
			changed = true
		}
		if title := strings.TrimSpace(b.Content); title != "" && title != out[i].Title {
			out[i].Title = title
			changed = true
		}
	}
	for _, child := range d.Children(mainID) {
		if child.Deleted || child.Type != "todo" || linked[child.ID] || taken[child.ID] {
			continue
		}
		title := strings.TrimSpace(child.Content)
		if title == "" {
			continue // an empty checkbox that is being typed into becomes a subtask once it has text
		}
		adopted := false
		for i := range out {
			if out[i].BlockID == "" && out[i].Title == title {
				out[i].BlockID, out[i].IsCompleted = child.ID, child.Props.Checked
				adopted = true
				break
			}
		}
		if !adopted {
			out = append(out, domain.SubTask{ID: domain.NewID("st"), Title: title, IsCompleted: child.Props.Checked, CreatedAt: domain.NowISO(), BlockID: child.ID})
		}
		linked[child.ID] = true
		changed = true
	}
	return out, changed
}

// ReconcileDocTaskLinks brings tasks linked to blocks in line with the note after it changed: tick,
// title and subtasks. A deleted main checkbox unlinks the task and its subtasks (all of them stay).
// Returns the changed tasks as they were before (for the notifications about the change).
func (s *Store) ReconcileDocTaskLinks(docID string) []*domain.Thought {
	links := s.docTaskLinks(docID)
	if len(links) == 0 {
		return nil
	}
	d, _, err := loadCollabDoc(s.db, docID)
	if err != nil {
		logDBErr(err)
		return nil
	}
	taken := map[string]bool{}
	for blockID := range links {
		taken[blockID] = true
	}
	var changed []*domain.Thought
	for blockID, taskID := range links {
		t, err := s.GetThoughtByIDUnchecked(taskID)
		if err != nil || t == nil {
			continue
		}
		b, ok := d.Blocks[blockID]
		if !ok || b.Deleted {
			for i := range t.Subtasks {
				t.Subtasks[i].BlockID = ""
			}
			subsJSON, _ := json.Marshal(t.Subtasks)
			if _, err := s.db.Exec(`UPDATE thoughts SET converted_type = '', converted_ref_id = '', subtasks = ? WHERE id = ?`, string(subsJSON), taskID); err == nil {
				changed = append(changed, t)
			}
			continue
		}
		update := false
		content, done, kanban := t.Content, t.IsCompleted, t.KanbanStatus
		if b.Props.Checked != t.IsCompleted {
			done, update = b.Props.Checked, true
			kanban = "todo"
			if done {
				kanban = "done"
			}
		}
		if title := strings.TrimSpace(b.Content); title != "" && title != t.Content {
			content, update = title, true
		}
		// Subtask checkboxes of other tasks in this note are not adopted
		otherSubs := map[string]bool{}
		for id, owner := range s.docSubtaskLinks(docID, links) {
			if owner != taskID {
				otherSubs[id] = true
			}
		}
		for id := range taken {
			otherSubs[id] = true
		}
		subs, subsChanged := reconcileSubtasks(d, blockID, t.Subtasks, otherSubs)
		if !update && !subsChanged {
			continue
		}
		tagsJSON, _ := json.Marshal(domain.ExtractTags(content))
		subsJSON, _ := json.Marshal(subs)
		if content == t.Content {
			tagsJSON, _ = json.Marshal(t.Tags) // manual tags stay unless the title changed
		}
		if _, err := s.db.Exec(`UPDATE thoughts SET content = ?, tags = ?, is_completed = ?, kanban_status = ?, subtasks = ? WHERE id = ?`,
			content, string(tagsJSON), boolInt(done), kanban, string(subsJSON), taskID); err == nil {
			changed = append(changed, t)
		}
	}
	return changed
}

// SyncTaskToDoc carries a linked task's tick, title and subtasks into its note: linked checkboxes get
// tick and title, subtasks without a checkbox get one at the end of the main checkbox's children (or
// take over an unlinked checkbox there with the same text). Returns the note ID if it changed.
func (s *Store) SyncTaskToDoc(userID, taskID string) string {
	t, err := s.GetThoughtByIDUnchecked(taskID)
	if err != nil || t == nil || t.ConvertedType != "document_block" || !strings.Contains(t.ConvertedRefID, ":") {
		return ""
	}
	docID, mainID, _ := strings.Cut(t.ConvertedRefID, ":")
	subs := make([]domain.SubTask, len(t.Subtasks))
	copy(subs, t.Subtasks)
	// Titles become bullets: no references to files the person may not read (mediaGate). Files the
	// bullet shows already stay: whoever changes the task (a tick, another word) may not be able to read
	// the note, and dropping the owner's picture from the bullet would let media cleanup delete the file.
	// Every title is checked here, before the transaction: titleFor runs inside it and must not query
	// the database. Keeping files only allows more, so it finds every file and the placeholder's
	// language in the gate's memory (known, lang).
	gate := s.newMediaGate(userID, nil)
	_, _ = gate.clean(t.Content)
	titles := make([]string, len(subs))
	for i := range subs {
		titles[i], _ = gate.clean(subs[i].Title)
	}
	// Hidden values of other notes in a title become copies in this note (secretGate), prepared here as
	// well; the same reference carried in again gets the same copy. Frozen, it does not query any more.
	secrets := s.newSecretGate(userID, docID)
	secrets.prepare(append([]string{t.Content}, titles...)...)
	for i := range titles {
		titles[i], _ = secrets.clean(titles[i])
	}
	secrets.frozen = true
	titleFor := func(current, raw string) string {
		if raw == "" || strings.TrimSpace(current) == raw {
			return raw
		}
		gate.keep = map[string]bool{}
		for _, m := range mediaIDRe.FindAllStringSubmatch(current, -1) {
			gate.keep[m[1]] = true
		}
		out, _ := gate.clean(raw)
		gate.keep = nil
		out, _ = secrets.clean(out)
		return out
	}
	subsChanged := false
	a := collab.Actor{UserID: userID, ClientID: collab.ServerHolder}
	results, _, err := s.applyDocChange(docID, a, nil, func(d *collab.Doc) []collab.Op {
		main, ok := d.Blocks[mainID]
		if !ok || main.Deleted {
			return nil
		}
		var ops []collab.Op
		// setBlock: rawTitle is the task's or subtask's own title, gated against the bullet's content
		setBlock := func(b *collab.Block, checked bool, rawTitle string) {
			if b.Props.Checked != checked {
				c := checked
				ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetProps, BlockID: b.ID, Patch: &collab.PropsPatch{Checked: &c}})
			}
			if title := titleFor(b.Content, rawTitle); title != "" && strings.TrimSpace(b.Content) != title {
				text := title
				ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpSetContent, BlockID: b.ID, BaseVersion: b.Version, Content: &text})
			}
		}
		setBlock(main, t.IsCompleted, t.Content)

		used := map[string]bool{mainID: true}
		for _, st := range subs {
			if st.BlockID != "" {
				used[st.BlockID] = true
			}
		}
		lastKey := ""
		for _, c := range d.Children(mainID) {
			lastKey = c.OrderKey
		}
		for i := range subs {
			if b, ok := d.Blocks[subs[i].BlockID]; ok && subs[i].BlockID != "" {
				if !b.Deleted && b.Type == "todo" {
					setBlock(b, subs[i].IsCompleted, subs[i].Title)
				}
				continue
			}
			// Not in the note yet: take over an unlinked checkbox with the same text, else add one
			for _, c := range d.Children(mainID) {
				if !c.Deleted && c.Type == "todo" && !used[c.ID] && strings.TrimSpace(c.Content) == titles[i] {
					subs[i].BlockID, used[c.ID], subsChanged = c.ID, true, true
					setBlock(c, subs[i].IsCompleted, "")
					break
				}
			}
			if subs[i].BlockID != "" {
				continue
			}
			key, err := collab.KeyBetween(lastKey, "")
			if err != nil {
				continue
			}
			lastKey = key
			id := domain.NewID("blk")
			parent, title := mainID, titles[i]
			ops = append(ops, collab.Op{OpID: domain.NewID("op"), Kind: collab.OpInsert, BlockID: id, ParentID: &parent, OrderKey: key,
				Type: "todo", Content: &title, Props: &collab.Props{Checked: subs[i].IsCompleted}})
			subs[i].BlockID, used[id], subsChanged = id, true, true
		}
		return ops
	})
	if err != nil {
		return ""
	}
	if subsChanged {
		subsJSON, _ := json.Marshal(subs)
		s.execLogged(`UPDATE thoughts SET subtasks = ? WHERE id = ?`, string(subsJSON), taskID)
	}
	for _, r := range results {
		if r.Seq > 0 {
			return docID
		}
	}
	return ""
}

// keepSubtaskLinks: a client that saves subtasks without their checkbox link (an older state) keeps
// the links the server knows, matched by subtask ID.
func keepSubtaskLinks(before, after []domain.SubTask) []domain.SubTask {
	known := map[string]string{}
	for _, st := range before {
		if st.BlockID != "" {
			known[st.ID] = st.BlockID
		}
	}
	for i := range after {
		if after[i].BlockID == "" {
			after[i].BlockID = known[after[i].ID]
		}
	}
	return after
}
