package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// --- THOUGHTS & TRIAGE ---

func (s *Store) CreateThought(userID, content, priority, source, dueDate string) (*domain.Thought, error) {
	return s.CreateThoughtWithDetails(userID, content, priority, source, dueDate, "", "todo", "")
}

func (s *Store) CreateThoughtWithDetails(userID, content, priority, source, dueDate, taskListID, kanbanStatus, notes string) (*domain.Thought, error) {
	content = strings.TrimSpace(content)
	dueDate = domain.NormalizeDue(dueDate)
	if content == "" {
		return nil, errors.New("content cannot be empty")
	}
	if priority == "" {
		priority = "normal"
	}
	if source == "" {
		source = "manual"
	}
	if kanbanStatus == "" {
		kanbanStatus = "todo"
	}
	if err := s.ensureTaskListWritable(userID, taskListID); err != nil {
		return nil, err
	}

	tags := domain.ExtractTags(content)
	if strings.EqualFold(source, "voice") {
		hasDiktat := false
		for _, tag := range tags {
			if strings.EqualFold(tag, "diktat") {
				hasDiktat = true
				break
			}
		}
		if !hasDiktat {
			tags = append(tags, "diktat")
		}
	}
	if strings.EqualFold(source, "webhook") {
		hasWebhook := false
		for _, tag := range tags {
			if strings.EqualFold(tag, "webhook") {
				hasWebhook = true
				break
			}
		}
		if !hasWebhook {
			tags = append(tags, "webhook")
		}
	}
	tagsJSON, _ := json.Marshal(tags)

	t := &domain.Thought{
		ID:           domain.NewID("th"),
		UserID:       userID,
		Content:      content,
		Tags:         tags,
		Priority:     priority,
		Source:       source,
		Status:       domain.StatusInbox,
		DueDate:      dueDate,
		TaskListID:   taskListID,
		KanbanStatus: kanbanStatus,
		Notes:        notes,
		CreatedAt:    domain.NowISO(),
	}

	_, err := s.db.Exec(
		`INSERT INTO thoughts (id, user_id, content, tags, priority, source, status, is_completed, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, subtasks)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, ?, '[]')`,
		t.ID, t.UserID, t.Content, string(tagsJSON), t.Priority, t.Source, string(t.Status), t.DueDate, t.TaskListID, t.KanbanStatus, t.Notes, t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	t.Subtasks = []domain.SubTask{}
	return t, nil
}

func scanThought(rows interface {
	Scan(dest ...any) error
}) (*domain.Thought, error) {
	t := &domain.Thought{}
	var tagsStr, subtasksStr, statusStr string
	var isCompleted, alarmSent, sortOrder int
	var origin originDest
	err := rows.Scan(
		&t.ID, &t.UserID, &t.Content, &tagsStr, &t.Priority, &t.Source,
		&statusStr, &isCompleted, &t.ConvertedType, &t.ConvertedRefID,
		&t.DueDate, &t.TaskListID, &t.KanbanStatus, &t.Notes, &alarmSent,
		&t.CreatedAt, &t.TriagedAt, &subtasksStr, &sortOrder, &t.Recurrence,
		&origin.createdVia, &origin.createdKey, &origin.changedVia, &origin.changedKey, &origin.changedAt,
	)
	if err != nil {
		return nil, err
	}
	t.SortOrder = sortOrder
	t.Origin = origin.result()
	t.Status = domain.ThoughtStatus(statusStr)
	t.IsCompleted = isCompleted != 0
	t.AlarmSent = alarmSent != 0
	if t.KanbanStatus == "" {
		if t.IsCompleted {
			t.KanbanStatus = "done"
		} else {
			t.KanbanStatus = "todo"
		}
	}
	t.Tags = []string{}
	_ = json.Unmarshal([]byte(tagsStr), &t.Tags)
	if t.ConvertedType == "document_block" && strings.Contains(t.ConvertedRefID, ":") {
		parts := strings.SplitN(t.ConvertedRefID, ":", 2)
		t.DocID = parts[0]
		t.BlockID = parts[1]
	}
	t.Assignees = []string{}
	t.Subtasks = []domain.SubTask{}
	if subtasksStr != "" && subtasksStr != "null" {
		_ = json.Unmarshal([]byte(subtasksStr), &t.Subtasks)
	}
	return t, nil
}

func (s *Store) accessibleTaskListIDsQuery() string {
	return accessibleTaskListsSQL
}

func (s *Store) GetThoughtByID(userID, thoughtID string) (*domain.Thought, error) {
	row := s.db.QueryRow(
		`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, `+originColumns("")+`
		 FROM thoughts WHERE id = ? AND (user_id = ? OR task_list_id IN (`+s.accessibleTaskListIDsQuery()+`))`,
		thoughtID, userID, userID, userID, userID,
	)
	t, err := scanThought(row)
	if err != nil {
		return nil, err
	}
	t.Assignees = s.getTaskAssignees(t.ID)
	return t, nil
}

func (s *Store) GetThoughts(userID, statusFilter string, limit int) ([]domain.Thought, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var rows *sql.Rows
	var err error

	if statusFilter != "" && statusFilter != "all" {
		rows, err = s.db.Query(
			`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, `+originColumns("")+`
			 FROM thoughts WHERE user_id = ? AND status = ?
			 ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, sort_order ASC, created_at DESC LIMIT ?`,
			userID, statusFilter, limit,
		)
	} else {
		rows, err = s.db.Query(
			`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, `+originColumns("")+`
			 FROM thoughts WHERE user_id = ?
			 ORDER BY sort_order ASC, created_at DESC LIMIT ?`,
			userID, limit,
		)
	}
	if err != nil {
		return nil, err
	}

	result := make([]domain.Thought, 0)
	for rows.Next() {
		t, err := scanThought(rows)
		if err == nil {
			result = append(result, *t)
		}
	}
	_ = rows.Close()
	return result, nil
}

func (s *Store) GetTasks(userID string, taskListID string) ([]domain.Thought, error) {
	var rows *sql.Rows
	var err error
	if taskListID != "" {
		rows, err = s.db.Query(
			`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, `+originColumns("")+`
			 FROM thoughts
			 WHERE (user_id = ? OR task_list_id IN (`+s.accessibleTaskListIDsQuery()+`))
			   AND task_list_id = ?
			   AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))
			 ORDER BY is_completed ASC, sort_order ASC, created_at DESC`,
			userID, userID, userID, userID, taskListID,
		)
	} else {
		rows, err = s.db.Query(
			`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, `+originColumns("")+`
			 FROM thoughts
			 WHERE (user_id = ? OR task_list_id IN (`+s.accessibleTaskListIDsQuery()+`))
			   AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))
			 ORDER BY is_completed ASC, sort_order ASC, created_at DESC`,
			userID, userID, userID, userID,
		)
	}
	if err != nil {
		return nil, err
	}

	result := make([]domain.Thought, 0)
	for rows.Next() {
		t, err := scanThought(rows)
		if err == nil {
			result = append(result, *t)
		}
	}
	_ = rows.Close()
	s.attachTaskAssignees(result)
	return result, nil
}

func (s *Store) ReorderTasks(taskListID string, items []domain.ThoughtReorderItem) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var completed []string // tasks that move into "done" now (repeating ones spawn their successor)
	for _, it := range items {
		if it.KanbanStatus != nil && *it.KanbanStatus != "" {
			isCompleted := 0
			if isDoneColumn(tx, it.ID, *it.KanbanStatus) {
				isCompleted = 1
				var was int
				_ = tx.QueryRow(`SELECT is_completed FROM thoughts WHERE id = ?`, it.ID).Scan(&was)
				if was == 0 {
					completed = append(completed, it.ID)
				}
			}
			// Only a reopened task (done -> open) gets its due alarm again. A Kanban move sends every task
			// of the touched columns, so resetting all open ones re-sent "due today" for each of them.
			// (is_completed in the CASE is still the value before this UPDATE.)
			_, err = tx.Exec(
				`UPDATE thoughts SET sort_order = ?, kanban_status = ?, is_completed = ?,
				 alarm_sent = CASE WHEN ? = 0 AND is_completed = 1 THEN 0 ELSE alarm_sent END,
				 alarm_failures = CASE WHEN ? = 0 AND is_completed = 1 THEN 0 ELSE alarm_failures END WHERE id = ?`,
				it.SortOrder, *it.KanbanStatus, isCompleted, isCompleted, isCompleted, it.ID,
			)
		} else {
			_, err = tx.Exec(
				`UPDATE thoughts SET sort_order = ? WHERE id = ?`,
				it.SortOrder, it.ID,
			)
		}
		if err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	for _, id := range completed {
		s.spawnNextOccurrence(id)
	}
	return nil
}

// isDoneColumn: whether a Kanban column completes the task: the column of the task's list marked as done
// (its ID may be anything), else the default ID "done".
func isDoneColumn(q interface {
	QueryRow(query string, args ...any) *sql.Row
}, taskID, column string) bool {
	var raw string
	_ = q.QueryRow(`SELECT COALESCE(tl.columns, '') FROM thoughts t LEFT JOIN task_lists tl ON tl.id = t.task_list_id WHERE t.id = ?`, taskID).Scan(&raw)
	var cols []domain.KanbanColumn
	if raw != "" && json.Unmarshal([]byte(raw), &cols) == nil && len(cols) > 0 {
		for _, c := range cols {
			if c.ID == column {
				return c.IsDone
			}
		}
	}
	return column == "done"
}

// UpdateThoughtTriage handles swipe left (discard), swipe right (keep), restore, and conversion to task/document/list_item
func (s *Store) UpdateThoughtTriage(userID, thoughtID, action, convertTo, targetListID, dueDate, taskListID string) (*domain.Thought, error) {
	thought, err := s.GetThoughtByID(userID, thoughtID)
	if err != nil {
		return nil, err
	}

	now := domain.NowISO()
	newStatus := domain.StatusKept
	convertedType := thought.ConvertedType
	convertedRefID := thought.ConvertedRefID
	dueDate = domain.NormalizeDue(dueDate)
	if dueDate == "" {
		dueDate = thought.DueDate
	}
	if err := s.ensureTaskListWritable(userID, thought.TaskListID); err != nil {
		return nil, err
	}
	if taskListID == "" {
		taskListID = thought.TaskListID
	} else if err := s.ensureTaskListWritable(userID, taskListID); err != nil {
		return nil, err
	}

	switch action {
	case "discard":
		newStatus = domain.StatusDiscarded
	case "restore":
		newStatus = domain.StatusInbox
	case "keep":
		newStatus = domain.StatusKept
		if convertTo == "task" {
			newStatus = domain.StatusConverted
			convertedType = "task"
		} else if convertTo == "document" {
			isTask := thought.Status == domain.StatusKept || (thought.Status == domain.StatusConverted && thought.ConvertedType == "task")
			// A task already linked to a note keeps that note; no second one
			if isTask && thought.ConvertedType == "document_block" && thought.DocID != "" {
				if doc, err := s.GetDocumentByID(userID, thought.DocID); err == nil && doc != nil {
					return thought, nil
				}
			}
			newStatus = domain.StatusConverted
			convertedType = "document"
			title := thought.Content
			if len(title) > 72 {
				title = title[:72] + "…"
			}
			blocks := make([]domain.DocumentBlock, 0)

			// 17. Wenn ich eine Aufgabe zu einer Notiz mache, muss die erste Zeile das "To-Do" noch mal als "To-Do" enthalten, auch wenn es schon in der Überschrift steht. Wenn es vorher schon abgehakt war, dann den Zustand natürlich übernehmen.
			blocks = append(blocks, domain.DocumentBlock{
				ID:      domain.NewID("blk"),
				Type:    "todo",
				Content: thought.Content,
				Checked: thought.IsCompleted,
				Level:   0,
			})

			// 17a. Die anderen Details aus der Aufgabe sollen natürlich ebenfalls übernommen werden (Notizen, Subtasks, Fälligkeit/Priorität).
			// Due date and priority right under the checkbox, above the description and the subtasks
			var metaItems []string
			if thought.DueDate != "" {
				metaItems = append(metaItems, "Fällig: "+domain.HumanDue(thought.DueDate))
			}
			if thought.Priority != "" && thought.Priority != "normal" {
				metaItems = append(metaItems, "Priorität: "+domain.PriorityLabel(thought.Priority))
			}
			if len(metaItems) > 0 {
				blocks = append(blocks, domain.DocumentBlock{
					ID:      domain.NewID("blk"),
					Type:    "bullet",
					Content: strings.Join(metaItems, " • "),
					Level:   1,
				})
			}
			if strings.TrimSpace(thought.Notes) != "" {
				blocks = append(blocks, domain.DocumentBlock{
					ID:      domain.NewID("blk"),
					Type:    "bullet",
					Content: strings.TrimSpace(thought.Notes),
					Level:   1,
				})
			}
			if len(thought.Subtasks) > 0 {
				for i, st := range thought.Subtasks {
					id := domain.NewID("blk")
					blocks = append(blocks, domain.DocumentBlock{
						ID:      id,
						Type:    "todo",
						Content: st.Title,
						Checked: st.IsCompleted,
						Level:   1,
					})
					// A task stays linked: its subtasks are tied to these checkboxes (task_doc_sync.go)
					if isTask {
						thought.Subtasks[i].BlockID = id
					}
				}
			}
			if len(blocks) == 1 {
				blocks = append(blocks, domain.DocumentBlock{
					ID:      domain.NewID("blk"),
					Type:    "bullet",
					Content: "",
					Level:   0,
				})
			}
			doc, err := s.CreateDocument(userID, "", title, "🗒️", "", blocks, thought.Tags, false)
			if err == nil && doc != nil {
				convertedRefID = doc.ID
				// A task stays in its list and becomes the note's first checkbox (same link as a task made
				// from a note block); a thought from the inbox turns into the note
				if isTask {
					newStatus = domain.StatusKept
					convertedType = "document_block"
					convertedRefID = doc.ID + ":" + blocks[0].ID
					subsJSON, _ := json.Marshal(thought.Subtasks)
					_, _ = s.db.Exec(`UPDATE thoughts SET subtasks = ? WHERE id = ?`, string(subsJSON), thought.ID)
				}
			}
		} else if convertTo == "list_item" && targetListID != "" {
			// Same rule as adding an item in the list itself: owner or editor
			if err := s.EnsureListItemsWritable(userID, targetListID, ""); err != nil {
				return nil, err
			}
			newStatus = domain.StatusConverted
			convertedType = "list_item"
			item, err := s.CreateListItem(targetListID, thought.Content, "", "", 0, userID)
			if err == nil && item != nil {
				convertedRefID = item.ID
				s.copyOriginToListItem(thought.ID, item.ID)
			}
		}
	default:
		return nil, fmt.Errorf("invalid triage action: %s", action)
	}

	_, err = s.db.Exec(
		`UPDATE thoughts
		 SET status = ?, converted_type = ?, converted_ref_id = ?, due_date = ?, task_list_id = ?, triaged_at = ?,
		     alarm_sent = CASE WHEN due_date != ? THEN 0 ELSE alarm_sent END,
		     alarm_failures = CASE WHEN due_date != ? THEN 0 ELSE alarm_failures END
		 WHERE id = ? AND user_id = ?`,
		string(newStatus), convertedType, convertedRefID, dueDate, taskListID, now, dueDate, dueDate, thoughtID, userID,
	)
	if err != nil {
		return nil, err
	}
	if taskListID != thought.TaskListID {
		s.PruneTaskAssignees()
	}

	return s.GetThoughtByID(userID, thoughtID)
}

func (s *Store) UpdateThoughtDetails(userID, thoughtID string, content *string, isCompleted *bool, dueDate *string, priority *string, taskListID *string, kanbanStatus *string, notes *string, subtasks *[]domain.SubTask, tags *[]string) (*domain.Thought, error) {
	thought, err := s.GetThoughtByID(userID, thoughtID)
	if err != nil {
		return nil, err
	}
	wasCompleted := thought.IsCompleted
	oldDue := thought.DueDate
	if err := s.ensureTaskListWritable(userID, thought.TaskListID); err != nil {
		return nil, err
	}
	if taskListID != nil && *taskListID != thought.TaskListID {
		if err := s.ensureTaskListWritable(userID, *taskListID); err != nil {
			return nil, err
		}
	}

	if content != nil {
		thought.Content = strings.TrimSpace(*content)
		thought.Tags = domain.ExtractTags(thought.Content)
	}
	if tags != nil {
		thought.Tags = *tags
	}
	if isCompleted != nil {
		thought.IsCompleted = *isCompleted
		if *isCompleted {
			thought.KanbanStatus = "done"
		} else if thought.KanbanStatus == "done" {
			thought.KanbanStatus = "todo"
		}
	}
	if dueDate != nil {
		thought.DueDate = domain.NormalizeDue(*dueDate)
	}
	if priority != nil {
		p := strings.ToLower(strings.TrimSpace(*priority))
		if p == "" || p == "none" {
			p = "normal"
		}
		thought.Priority = p
	}
	if taskListID != nil {
		thought.TaskListID = *taskListID
	}
	if kanbanStatus != nil && *kanbanStatus != "" {
		thought.KanbanStatus = *kanbanStatus
		if isCompleted == nil {
			if *kanbanStatus == "done" {
				thought.IsCompleted = true
			} else {
				thought.IsCompleted = false
			}
		}
	}
	if notes != nil {
		thought.Notes = *notes
	}
	if subtasks != nil {
		thought.Subtasks = keepSubtaskLinks(thought.Subtasks, *subtasks)
	}

	tagsJSON, _ := json.Marshal(thought.Tags)
	subtasksJSON, _ := json.Marshal(thought.Subtasks)
	completedInt := 0
	if thought.IsCompleted {
		completedInt = 1
	}

	_, err = s.db.Exec(
		`UPDATE thoughts SET content = ?, tags = ?, is_completed = ?, due_date = ?, priority = ?, task_list_id = ?, kanban_status = ?, notes = ?, subtasks = ? WHERE id = ?`,
		thought.Content, string(tagsJSON), completedInt, thought.DueDate, thought.Priority, thought.TaskListID, thought.KanbanStatus, thought.Notes, string(subtasksJSON), thoughtID,
	)
	if err != nil {
		return nil, err
	}
	// A new due date or a reopened task gets its alarm again
	if thought.DueDate != oldDue || (wasCompleted && !thought.IsCompleted) {
		if _, err := s.db.Exec(`UPDATE thoughts SET alarm_sent = 0, alarm_failures = 0 WHERE id = ?`, thoughtID); err != nil {
			return nil, err
		}
		thought.AlarmSent = false
	}
	if taskListID != nil {
		s.PruneTaskAssignees()
		thought.Assignees = s.getTaskAssignees(thoughtID)
	}
	if !wasCompleted && thought.IsCompleted {
		s.spawnNextOccurrence(thoughtID)
	}
	return thought, nil
}

// DeleteThought: a task goes to the task trash (task_trash.go); anything else (a thought from the inbox
// or the triage trash) is deleted for good.
func (s *Store) DeleteThought(userID, thoughtID string) error {
	thought, err := s.GetThoughtByID(userID, thoughtID)
	if err != nil {
		return err
	}
	if err := s.ensureTaskListWritable(userID, thought.TaskListID); err != nil {
		return err
	}
	// Tasks as in completedTaskSQL: kept, or converted into a task
	if thought.Status == domain.StatusKept || (thought.Status == domain.StatusConverted && thought.ConvertedType == "task") {
		return s.trashTask(thought.ID, userID)
	}
	_, err = s.db.Exec(`DELETE FROM thoughts WHERE id = ?`, thought.ID)
	return err
}

// migrateAgentMark: released in v0.29.0; agent_mark is superseded by the origin columns (migrateOrigin)
// and only read once to carry old marks over
func (s *Store) migrateAgentMark() error {
	if err := s.addColumnIfMissing("thoughts", "agent_mark", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return s.addColumnIfMissing("list_items", "agent_mark", "TEXT NOT NULL DEFAULT ''")
}

func (s *Store) PurgeDiscardedThoughts(userID string) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM thoughts WHERE user_id = ? AND status = 'discarded'`, userID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *Store) CreateTaskFromDocBlock(userID, docID, blockID, content string, checked bool) (*domain.Thought, error) {
	// Linking changes the block (its tick follows the task), so edit rights are needed
	if !CanEditDoc(s.DocRole(userID, docID)) {
		return nil, fmt.Errorf("keine Schreibberechtigung für dieses Dokument (nur Lesezugriff)")
	}
	t, err := s.CreateThoughtWithDetails(userID, content, "normal", "manual", "", "", "todo", "")
	if err != nil {
		return nil, err
	}
	t.ConvertedType = "document_block"
	t.ConvertedRefID = docID + ":" + blockID
	t.DocID = docID
	t.BlockID = blockID
	t.IsCompleted = checked
	t.Status = domain.StatusKept
	doneInt := 0
	if checked {
		doneInt = 1
		t.KanbanStatus = "done"
	}
	if _, err := s.db.Exec(`UPDATE thoughts SET converted_type = 'document_block', converted_ref_id = ?, is_completed = ?, kanban_status = ?, status = 'kept' WHERE id = ?`,
		t.ConvertedRefID, doneInt, t.KanbanStatus, t.ID); err != nil {
		return nil, err
	}

	s.SetBlockChecked(userID, docID, blockID, checked)
	return t, nil
}

// SyncDocBlockAndTask ticks the block a task was created from when the task is completed (or reopened).
// Returns the note ID if the block changed, so the caller can notify its viewers.
func (s *Store) SyncDocBlockAndTask(userID, taskID string, isCompleted bool) string {
	t, err := s.GetThoughtByID(userID, taskID)
	if err != nil || t == nil || t.ConvertedType != "document_block" || !strings.Contains(t.ConvertedRefID, ":") {
		return ""
	}
	docID, blockID, _ := strings.Cut(t.ConvertedRefID, ":")
	if s.SetBlockChecked(userID, docID, blockID, isCompleted) {
		return docID
	}
	return ""
}

// UnlinkTaskFromDocBlock removes the link between a task and its note block; both stay. The block's
// task ID is derived from this link (docTaskLinks), so nothing in the note itself needs to change.
func (s *Store) UnlinkTaskFromDocBlock(userID, taskID string) error {
	t, err := s.GetThoughtByID(userID, taskID)
	if err != nil || t == nil {
		return err
	}
	if err := s.ensureTaskListWritable(userID, t.TaskListID); err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE thoughts SET converted_type = '', converted_ref_id = '' WHERE id = ?`, taskID)
	return err
}

func (s *Store) SyncTaskFromBlockCheck(userID, taskID string, checked bool) {
	if taskID == "" {
		return
	}
	doneInt := 0
	kanban := "todo"
	if checked {
		doneInt = 1
		kanban = "done"
	}
	res, _ := s.db.Exec(`UPDATE thoughts SET is_completed = ?, kanban_status = ?, alarm_sent = CASE WHEN ? = 0 THEN 0 ELSE alarm_sent END,
		 alarm_failures = CASE WHEN ? = 0 THEN 0 ELSE alarm_failures END
		 WHERE id = ? AND user_id = ? AND is_completed != ?`, doneInt, kanban, doneInt, doneInt, taskID, userID, doneInt)
	if checked && res != nil {
		if n, _ := res.RowsAffected(); n > 0 {
			s.spawnNextOccurrence(taskID)
		}
	}
}

// --- ALARMS ---

type DueTaskAlarm struct {
	TaskID              string
	UserID              string
	Title               string
	Notes               string
	DueDate             string
	Priority            string
	UserEmail           string
	UserName            string
	AlarmChannels       []string
	AlarmEmail          string
	DiscordWebhookURL   string
	CustomWebhookURL    string
	NotifyBeforeMinutes int
}

func (s *Store) GetDueTasksForAlarm() ([]DueTaskAlarm, error) {
	rows, err := s.db.Query(
		`SELECT t.id, t.user_id, t.content, t.notes, t.due_date, t.priority,
		        u.email, u.display_name, u.alarm_channels, u.alarm_email, u.discord_webhook_url, u.custom_webhook_url, u.notify_before_minutes
		 FROM thoughts t
		 JOIN users u ON u.id = t.user_id
		 WHERE (t.status = 'kept' OR (t.status = 'converted' AND t.converted_type = 'task'))
		   AND t.is_completed = 0
		   AND t.alarm_sent = 0
		   AND t.due_date != ''
		   AND u.is_active = 1`,
	)
	if err != nil {
		return []DueTaskAlarm{}, err
	}
	defer rows.Close()

	alarms := make([]DueTaskAlarm, 0)
	for rows.Next() {
		var a DueTaskAlarm
		var channelsRaw string
		if err := rows.Scan(
			&a.TaskID, &a.UserID, &a.Title, &a.Notes, &a.DueDate, &a.Priority,
			&a.UserEmail, &a.UserName, &channelsRaw, &a.AlarmEmail, &a.DiscordWebhookURL, &a.CustomWebhookURL, &a.NotifyBeforeMinutes,
		); err == nil {
			a.AlarmChannels = parseAlarmChannels(channelsRaw)
			if a.AlarmEmail == "" {
				a.AlarmEmail = a.UserEmail
			}
			alarms = append(alarms, a)
		}
	}
	return alarms, nil
}

func (s *Store) MarkTaskAlarmSent(taskID string) error {
	_, err := s.db.Exec(`UPDATE thoughts SET alarm_sent = 1, alarm_failures = 0 WHERE id = ?`, taskID)
	return err
}

// MaxAlarmFailures: after this many runs in which no channel delivered, the alarm is given up instead of
// being retried every minute. A new due date or reopening the task starts over.
const MaxAlarmFailures = 3

// RecordTaskAlarmFailure counts a run without any successful channel and reports whether the alarm was
// given up now.
func (s *Store) RecordTaskAlarmFailure(taskID string) (gaveUp bool, err error) {
	var failures int
	err = s.db.QueryRow(`UPDATE thoughts SET alarm_failures = alarm_failures + 1,
		alarm_sent = CASE WHEN alarm_failures + 1 >= ? THEN 1 ELSE alarm_sent END
		WHERE id = ? RETURNING alarm_failures`, MaxAlarmFailures, taskID).Scan(&failures)
	return err == nil && failures >= MaxAlarmFailures, err
}
