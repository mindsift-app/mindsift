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
// One query for all tasks of the note (it used to be one per task, on every sync).
func (s *Store) docSubtaskLinks(mainLinks map[string]string) map[string]string {
	out := map[string]string{}
	if len(mainLinks) == 0 {
		return out
	}
	rows, err := s.db.Query(`SELECT id, subtasks FROM thoughts WHERE id IN (SELECT value FROM json_each(?))`, linkedTaskIDsJSON(mainLinks))
	if dbFailed(err) {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var taskID, raw string
		if dbFailed(rows.Scan(&taskID, &raw)) {
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
	logDBErr(rows.Err())
	return out
}

// linkedTaskIDsJSON: the task ids of a note's links (block → task) as a JSON array for json_each.
func linkedTaskIDsJSON(links map[string]string) string {
	ids := make([]string, 0, len(links))
	for _, id := range links {
		ids = append(ids, id)
	}
	raw, _ := json.Marshal(ids)
	return string(raw)
}

// linkedTasks loads the tasks of a note's links (block → task) in one query, without access check.
func (s *Store) linkedTasks(links map[string]string) (map[string]*domain.Thought, error) {
	rows, err := s.db.Query(
		`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, reminders, `+originColumns("")+`
		 FROM thoughts WHERE id IN (SELECT value FROM json_each(?))`, linkedTaskIDsJSON(links))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]*domain.Thought, len(links))
	for rows.Next() {
		t, err := scanThought(rows)
		if err != nil {
			return nil, err
		}
		out[t.ID] = t
	}
	return out, rows.Err()
}

// DocTaskLinks returns the note's checkboxes linked to a task (block → task) and those linked as a
// subtask (block → task of the subtask), for the editor's badges.
func (s *Store) DocTaskLinks(docID string) (tasks, subtasks map[string]string) {
	tasks = s.docTaskLinks(docID)
	return tasks, s.docSubtaskLinks(tasks)
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

// TaskReconciled is a task ReconcileDocTaskLinks brought in line with its note: as it was before and as
// it is now.
type TaskReconciled struct {
	Before, After *domain.Thought
}

// ReconcileDocTaskLinks brings tasks linked to blocks in line with the note after it changed: tick,
// title and subtasks. A deleted main checkbox unlinks the task and its subtasks (all of them stay).
// Returns the changed tasks before and after (for the notifications about the change).
func (s *Store) ReconcileDocTaskLinks(docID string) []TaskReconciled {
	changed, _ := s.ReconcileDocTaskLinksNotify(docID, nil)
	return changed
}

// ReconcileDocTaskLinksNotify is ReconcileDocTaskLinks that stores the notifications about the changes
// in the same transaction as the tasks (one write instead of two). The changes are worked out first;
// plan (may be nil) gives the notifications from them before the transaction begins, so it may read the
// database. Returns the changes and the center entries as stored, in plan's order.
func (s *Store) ReconcileDocTaskLinksNotify(docID string, plan func([]TaskReconciled) ([]CenterAdd, []QueuedAdd)) ([]TaskReconciled, []CenterEntry) {
	links := s.docTaskLinks(docID)
	if len(links) == 0 {
		return nil, nil
	}
	d, _, err := loadCollabDoc(s.db, docID)
	if err != nil {
		logDBErr(err)
		return nil, nil
	}
	taken := map[string]bool{}
	for blockID := range links {
		taken[blockID] = true
	}
	tasks, err := s.linkedTasks(links)
	if err != nil {
		logDBErr(err)
		return nil, nil
	}
	// Subtask checkboxes of the tasks in this note (checkbox → task), kept up to date as tasks change
	subLinks := map[string]string{}
	for _, t := range tasks {
		for _, st := range t.Subtasks {
			if st.BlockID != "" {
				subLinks[st.BlockID] = t.ID
			}
		}
	}
	var changed []TaskReconciled
	var stmts []sqlStmt
	for blockID, taskID := range links {
		t := tasks[taskID]
		if t == nil {
			continue
		}
		after := t.Clone()
		b, ok := d.Blocks[blockID]
		if !ok || b.Deleted {
			for i := range after.Subtasks {
				delete(subLinks, after.Subtasks[i].BlockID)
				after.Subtasks[i].BlockID = ""
			}
			after.ConvertedType, after.ConvertedRefID, after.DocID, after.BlockID = "", "", "", ""
			subsJSON, _ := json.Marshal(after.Subtasks)
			stmts = append(stmts, stmt(`UPDATE thoughts SET converted_type = '', converted_ref_id = '', subtasks = ? WHERE id = ?`, string(subsJSON), taskID))
			changed = append(changed, TaskReconciled{Before: t, After: after})
			continue
		}
		update := false
		if b.Props.Checked != t.IsCompleted {
			after.IsCompleted, update = b.Props.Checked, true
			after.KanbanStatus = "todo"
			if after.IsCompleted {
				after.KanbanStatus = "done"
			}
		}
		if title := strings.TrimSpace(b.Content); title != "" && title != t.Content {
			after.Content, update = title, true
			after.Tags = domain.ExtractTags(title) // manual tags stay unless the title changed
		}
		// Subtask checkboxes of other tasks in this note are not adopted
		otherSubs := map[string]bool{}
		for id, owner := range subLinks {
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
		for _, st := range t.Subtasks {
			delete(subLinks, st.BlockID)
		}
		for _, st := range subs {
			if st.BlockID != "" {
				subLinks[st.BlockID] = taskID
			}
		}
		after.Subtasks = subs
		tagsJSON, _ := json.Marshal(after.Tags)
		subsJSON, _ := json.Marshal(subs)
		stmts = append(stmts, stmt(`UPDATE thoughts SET content = ?, tags = ?, is_completed = ?, kanban_status = ?, subtasks = ? WHERE id = ?`,
			after.Content, string(tagsJSON), boolInt(after.IsCompleted), after.KanbanStatus, string(subsJSON), taskID))
		changed = append(changed, TaskReconciled{Before: t, After: after})
	}
	if len(changed) == 0 {
		return nil, nil
	}
	var center []CenterAdd
	var queue []QueuedAdd
	if plan != nil {
		center, queue = plan(changed)
	}
	added, err := s.storeTaskReconcile(stmts, center, queue)
	if err != nil {
		logDBErr(err)
		return nil, nil
	}
	return changed, added
}

// storeTaskReconcile writes the task updates of a reconcile and their notifications in one transaction.
func (s *Store) storeTaskReconcile(stmts []sqlStmt, center []CenterAdd, queue []QueuedAdd) ([]CenterEntry, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, st := range stmts {
		if _, err := tx.Exec(st.query, st.args...); err != nil {
			return nil, err
		}
	}
	added, err := storeNotificationsTx(tx, center, queue)
	if err != nil {
		return nil, err
	}
	return added, tx.Commit()
}

// SyncTaskToDoc carries a linked task's tick, title and subtasks into its note: linked checkboxes get
// tick and title, subtasks without a checkbox get one at the end of the main checkbox's children (or
// take over an unlinked checkbox there with the same text). Returns the note ID if it changed.
func (s *Store) SyncTaskToDoc(userID, taskID string) string {
	t, err := s.GetThoughtByIDUnchecked(taskID)
	if err != nil {
		return ""
	}
	return s.SyncTaskToDocFrom(userID, t)
}

// SyncTaskToDocFrom is SyncTaskToDoc with the task as it was just written (UpdateTask), not read again.
func (s *Store) SyncTaskToDocFrom(userID string, t *domain.Thought) string {
	if t == nil || t.ConvertedType != "document_block" || !strings.Contains(t.ConvertedRefID, ":") {
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
		s.execLogged(`UPDATE thoughts SET subtasks = ? WHERE id = ?`, string(subsJSON), t.ID)
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
