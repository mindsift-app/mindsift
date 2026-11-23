package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// --- THOUGHTS & TRIAGE ---

func (s *Store) CreateThought(userID, content, priority, source, dueDate string) (*domain.Thought, error) {
	return s.CreateThoughtWithDetails(userID, content, priority, source, dueDate, "", "todo", "")
}

func (s *Store) CreateThoughtWithDetails(userID, content, priority, source, dueDate, taskListID, kanbanStatus, notes string) (*domain.Thought, error) {
	t, err := s.newThought(userID, content, priority, source, dueDate, taskListID, kanbanStatus, notes)
	if err != nil {
		return nil, err
	}
	if err := insertThought(s.db, t); err != nil {
		return nil, err
	}
	return t, nil
}

// CreateTask creates a task as CreateThoughtWithDetails followed by UpdateThoughtTriage (keep, task)
// did, but with one write instead of three: the row goes in as a task, and in a task list more than one
// person can see, the creator is assigned to it in the same transaction (as the server's assignCreator
// did afterwards). members: everyone who can see the list (GetTaskListUserIDs), nil without one.
// Under load each separate write waited its turn for the database's write lock, which made creating a
// task the slowest request (load test 2026-11-15).
//
// plan (may be nil) gives the notifications about the new task from it and the list's members; it runs
// before the transaction and what it returns is stored in it, with the task. Returns the task as stored,
// the members and the center entries as stored (in plan's order).
func (s *Store) CreateTask(userID, content, priority, source, dueDate, taskListID, notes string, plan func(t *domain.Thought, members []string) ([]CenterAdd, []QueuedAdd)) (*domain.Thought, []string, []CenterEntry, error) {
	t, err := s.newThought(userID, content, priority, source, dueDate, taskListID, "todo", notes)
	if err != nil {
		return nil, nil, nil, err
	}
	t.Status = domain.StatusConverted
	t.ConvertedType = "task"
	t.TriagedAt = t.CreatedAt
	t.Assignees = []string{}
	t.Reminders = []int{}
	var members []string
	if taskListID != "" {
		members = s.GetTaskListUserIDs(taskListID)
		if len(members) > 1 {
			t.Assignees = []string{userID}
		}
	}
	var center []CenterAdd
	var queue []QueuedAdd
	if plan != nil {
		center, queue = plan(t, members)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, nil, nil, err
	}
	defer tx.Rollback()
	if err := insertThought(tx, t); err != nil {
		return nil, nil, nil, err
	}
	if len(t.Assignees) > 0 {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, ?)`, t.ID, userID, domain.NowISO()); err != nil {
			return nil, nil, nil, err
		}
	}
	added, err := storeNotificationsTx(tx, center, queue)
	if err != nil {
		return nil, nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, nil, err
	}
	// As stored (the same reads UpdateThoughtTriage answered with)
	created, err := s.GetThoughtByID(userID, t.ID)
	if err != nil {
		return nil, nil, nil, err
	}
	return created, members, added, nil
}

// newThought checks the input of a new thought and builds it (tags from the text and the source); the
// caller inserts it with insertThought.
func (s *Store) newThought(userID, content, priority, source, dueDate, taskListID, kanbanStatus, notes string) (*domain.Thought, error) {
	content = strings.TrimSpace(content)
	dueDate = domain.NormalizeDue(dueDate)
	if content == "" {
		return nil, errors.New("'content' darf nicht leer sein")
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
		Subtasks:     []domain.SubTask{},
	}
	return t, nil
}

// execer is *sql.DB or *sql.Tx for statements that may run inside a transaction or alone.
type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

// insertThought stores a thought built by newThought (status, converted_type and triaged_at as set on it).
func insertThought(db execer, t *domain.Thought) error {
	tagsJSON, _ := json.Marshal(t.Tags)
	_, err := db.Exec(
		`INSERT INTO thoughts (id, user_id, content, tags, priority, source, status, is_completed, converted_type, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?, '[]')`,
		t.ID, t.UserID, t.Content, string(tagsJSON), t.Priority, t.Source, string(t.Status), t.ConvertedType, t.DueDate, t.TaskListID, t.KanbanStatus, t.Notes, t.CreatedAt, t.TriagedAt,
	)
	return err
}

func scanThought(rows interface {
	Scan(dest ...any) error
}) (*domain.Thought, error) {
	t := &domain.Thought{}
	var tagsStr, subtasksStr, statusStr, remindersStr string
	var isCompleted, alarmSent, sortOrder int
	var origin originDest
	// The four columns declared without NOT NULL: a row from outside the app (an import, a hand-made
	// INSERT) may hold NULL there, and a plain string would fail the whole row, so the task vanished
	var convertedType, convertedRefID, dueDate, triagedAt sql.NullString
	err := rows.Scan(
		&t.ID, &t.UserID, &t.Content, &tagsStr, &t.Priority, &t.Source,
		&statusStr, &isCompleted, &convertedType, &convertedRefID,
		&dueDate, &t.TaskListID, &t.KanbanStatus, &t.Notes, &alarmSent,
		&t.CreatedAt, &triagedAt, &subtasksStr, &sortOrder, &t.Recurrence, &remindersStr,
		&origin.createdVia, &origin.createdKey, &origin.changedVia, &origin.changedKey, &origin.changedAt,
	)
	if err != nil {
		return nil, err
	}
	t.ConvertedType, t.ConvertedRefID = convertedType.String, convertedRefID.String
	t.DueDate, t.TriagedAt = dueDate.String, triagedAt.String
	t.SortOrder = sortOrder
	t.Reminders = domain.ParseReminders(remindersStr)
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

// visibleTaskRowidsSQL selects the rowids of every task a user can see: own tasks and the tasks of
// accessible task lists (the rule of GetTasks), as two index searches (idx_thoughts_user_status and
// idx_thoughts_list_sort). Written as "user_id = ? OR task_list_id IN (…)", the planner went by the
// average number of thoughts per person in sqlite_stat1 and read the whole table for everyone once one
// person had many tasks. Callers still name the task condition (status, converted_type); the status
// below only narrows the own tasks to candidates. It takes the user ID four times (visibleTaskArgs).
const visibleTaskRowidsSQL = `SELECT rowid FROM thoughts WHERE user_id = ? AND status IN ('kept', 'converted')
		 UNION ALL
		 SELECT rowid FROM thoughts WHERE task_list_id IN (` + accessibleTaskListsSQL + `)`

func visibleTaskArgs(userID string) []any {
	return append([]any{userID}, accessibleTaskListArgs(userID)...)
}

func (s *Store) GetThoughtByID(userID, thoughtID string) (*domain.Thought, error) {
	row := s.db.QueryRow(
		`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, reminders, `+originColumns("")+`
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
			`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, reminders, `+originColumns("")+`
			 FROM thoughts WHERE user_id = ? AND status = ?
			 ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, sort_order ASC, created_at DESC LIMIT ?`,
			userID, statusFilter, limit,
		)
	} else {
		rows, err = s.db.Query(
			`SELECT id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, reminders, `+originColumns("")+`
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
		if !dbFailed(err) {
			result = append(result, *t)
		}
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, err
	}
	return result, nil
}

// GetTasks returns the tasks of one task list or, without one, every task the user can see (own tasks and
// those of accessible lists, through visibleTaskRowidsSQL).
func (s *Store) GetTasks(userID string, taskListID string) ([]domain.Thought, error) {
	return s.QueryTasks(userID, TaskQuery{TaskListID: taskListID})
}

// TaskQuery narrows QueryTasks; the zero value asks for every visible task in list order.
type TaskQuery struct {
	// TaskListID: only the tasks of this list
	TaskListID string
	// Status: "open" (not completed), "done", or "" / "all" for both
	Status string
	// Conditions on the due day (the first ten characters of due_date, YYYY-MM-DD): due on DueOn, before
	// DueBefore, on or before DueUntil. Each one set leaves out tasks without a due date.
	DueOn, DueBefore, DueUntil string
	// DueFirst: tasks with a due date first, the earliest on top, then the rest; equal ones in list order
	DueFirst bool
	// Limit: at most this many tasks (0: all)
	Limit int
}

// QueryTasks returns the tasks GetTasks would, narrowed and ordered in SQL as q says, so only the tasks
// asked for are read with their assignees. List order: open before completed, then sort_order, newest
// first; rowid as the last key keeps equal tasks in one order whichever plan SQLite picks (the order of a
// table scan, mostly the order they were added in).
func (s *Store) QueryTasks(userID string, q TaskQuery) ([]domain.Thought, error) {
	query, args := taskQuerySQL(`id, user_id, content, tags, priority, source, status, is_completed, converted_type, converted_ref_id, due_date, task_list_id, kanban_status, notes, alarm_sent, created_at, triaged_at, subtasks, sort_order, recurrence, reminders, `+originColumns(""), userID, q)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}

	result := make([]domain.Thought, 0)
	for rows.Next() {
		t, err := scanThought(rows)
		if !dbFailed(err) {
			result = append(result, *t)
		}
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, err
	}
	s.attachTaskAssignees(result)
	return result, nil
}

// taskQuerySQL: the query of QueryTasks for the given columns, with its arguments.
func taskQuerySQL(columns, userID string, q TaskQuery) (string, []any) {
	var where string
	var args []any
	if q.TaskListID != "" {
		// One list: its index (idx_thoughts_list_sort) narrows by itself
		where = `task_list_id = ? AND (user_id = ? OR task_list_id IN (` + accessibleTaskListsSQL + `))`
		args = append([]any{q.TaskListID}, visibleTaskArgs(userID)...)
	} else {
		where = `rowid IN (` + visibleTaskRowidsSQL + `)`
		args = visibleTaskArgs(userID)
	}
	where += ` AND (status = 'kept' OR (status = 'converted' AND converted_type = 'task'))`
	switch q.Status {
	case "open":
		where += ` AND is_completed = 0`
	case "done":
		where += ` AND is_completed != 0`
	}
	for _, c := range []struct{ op, day string }{{"=", q.DueOn}, {"<", q.DueBefore}, {"<=", q.DueUntil}} {
		if c.day != "" {
			where += ` AND COALESCE(due_date, '') != '' AND substr(due_date, 1, 10) ` + c.op + ` ?`
			args = append(args, c.day)
		}
	}
	order := `is_completed ASC, sort_order ASC, created_at DESC, rowid`
	if q.DueFirst {
		order = `COALESCE(due_date, '') = '', COALESCE(due_date, ''), ` + order
	}
	query := `SELECT ` + columns + ` FROM thoughts WHERE ` + where + ` ORDER BY ` + order
	if q.Limit > 0 {
		query += ` LIMIT ?`
		args = append(args, q.Limit)
	}
	return query, args
}

// UpdateThoughtTriage handles swipe left (discard), swipe right (keep), restore, and conversion to task/document/list_item
func (s *Store) UpdateThoughtTriage(userID, thoughtID, action, convertTo, targetListID, dueDate, taskListID string) (*domain.Thought, error) {
	thought, err := s.GetThoughtByID(userID, thoughtID)
	if err != nil {
		return nil, err
	}

	now := domain.NowISO()
	var newStatus domain.ThoughtStatus
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
	}
	if taskListID != thought.TaskListID {
		if err := s.ensureTaskListWritable(userID, taskListID); err != nil {
			return nil, err
		}
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
			title := FirstLineTitle(thought.Content)
			blocks := make([]domain.DocumentBlock, 0)

			// A task turned into a note starts with the task itself as a checkbox, even though it is the title too,
			// ticked if the task was done
			blocks = append(blocks, domain.DocumentBlock{
				ID:      domain.NewID("blk"),
				Type:    "todo",
				Content: thought.Content,
				Checked: thought.IsCompleted,
				Level:   0,
			})

			// The task's other details come along as well (notes, subtasks, due date, priority)
			// Due date and priority right under the checkbox, above the description and the subtasks
			var metaItems []string
			lang := s.MessageLanguage(userID)
			if thought.DueDate != "" {
				metaItems = append(metaItems, i18n.T(lang, "Fällig: {due}", "due", domain.HumanDue(lang, thought.DueDate)))
			}
			if thought.Priority != "" && thought.Priority != "normal" {
				metaItems = append(metaItems, i18n.T(lang, "Priorität: {priority}", "priority", domain.PriorityLabel(lang, thought.Priority)))
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
					s.execLogged(`UPDATE thoughts SET subtasks = ? WHERE id = ?`, string(subsJSON), thought.ID)
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
		s.pruneTaskAssigneesOf(thoughtID)
	}

	return s.GetThoughtByID(userID, thoughtID)
}

// UpdateThoughtDetails changes a task; nil fields stay as they are (see UpdateTask).
func (s *Store) UpdateThoughtDetails(userID, thoughtID string, content *string, isCompleted *bool, dueDate *string, priority *string, taskListID *string, kanbanStatus *string, notes *string, subtasks *[]domain.SubTask, tags *[]string) (*domain.Thought, error) {
	before, err := s.GetThoughtByID(userID, thoughtID)
	if err != nil {
		return nil, err
	}
	t, _, err := s.UpdateTask(userID, before, ThoughtPatch{Content: content, IsCompleted: isCompleted, DueDate: dueDate, Priority: priority,
		TaskListID: taskListID, KanbanStatus: kanbanStatus, Notes: notes, Subtasks: subtasks, Tags: tags}, nil)
	return t, err
}

// ThoughtPatch is a partial change of a task for UpdateTask; nil fields stay as they are.
type ThoughtPatch struct {
	Content, DueDate, Priority, TaskListID, KanbanStatus, Notes *string
	IsCompleted                                                 *bool
	Subtasks                                                    *[]domain.SubTask
	// SubtasksBase: the subtasks Subtasks was made from (what the task view showed). With it, Subtasks is
	// merged into the stored ones (MergeSubtasks) instead of replacing them, so a change made meanwhile
	// elsewhere (the note, another task view) stays.
	SubtasksBase *[]domain.SubTask
	Tags         *[]string
	// StatusAt: when the person ticked the task, un-ticked it or moved it to another column (zero: now),
	// e.g. on a phone that was offline and sends it later. A change of the status is skipped when
	// somebody changed it after that (UpdateTask).
	StatusAt time.Time
}

// taskStatus is a task's status as stored: completed, its Kanban column and when either last changed
// (thoughts.status_changed_at, doneTimeLayout; empty: not since migration 65), with its list and that
// list's stored columns (nil: none) for working out the column of a plain tick.
type taskStatus struct {
	done      bool
	column    string
	changedAt string
	listID    string
	columns   []domain.KanbanColumn
}

func (s *Store) taskStatus(taskID string) (taskStatus, error) {
	var st taskStatus
	var done int
	var cols string
	err := s.db.QueryRow(`SELECT t.is_completed, t.kanban_status, t.status_changed_at, t.task_list_id, COALESCE(tl.columns, '')
		FROM thoughts t LEFT JOIN task_lists tl ON tl.id = t.task_list_id WHERE t.id = ?`, taskID).Scan(&done, &st.column, &st.changedAt, &st.listID, &cols)
	st.done = done != 0
	if cols != "" {
		_ = json.Unmarshal([]byte(cols), &st.columns)
	}
	if st.column == "" {
		st.column = "todo"
		if st.done {
			st.column = "done"
		}
	}
	return st, err
}

// statusTime is thoughts.status_changed_at for a change made at (zero or in the future: now).
func statusTime(at time.Time) string {
	now := time.Now().UTC()
	if at.IsZero() || at.After(now) {
		at = now
	}
	return at.UTC().Format(doneTimeLayout)
}

// NotifyPlan gives the notifications about a change from the task's new state (center entries and queued
// events as for StoreNotifications). UpdateTask and CreateTask call it before their transaction, so it may
// read the database, and store what it returns in the transaction of the change.
type NotifyPlan func(t *domain.Thought) ([]CenterAdd, []QueuedAdd)

// UpdateTask applies a patch to a task as GetThoughtByID read it for userID (before, which stays as it
// is; the caller compares it with the result) and writes it in one transaction together with plan's
// notifications: a change and what it tells others used to wait twice for the database's write lock.
// Returns the new state and the center entries as stored, in plan's order.
//
// A change of the status (isCompleted, kanbanStatus) states the wanted state, never a toggle, and is
// compared with the status as stored right now, not with before: it is written only if
//   - the task is not in that state already (ticked: completed, whatever its done column; with a column:
//     that column and completion), so two people ticking the same task leave it ticked, and
//   - nobody changed the status after p.StatusAt (thoughts.status_changed_at): an older change sent late
//     by a phone that was offline does not undo a newer one. The last one to change it wins, by when
//     they did it, not by when it reached the server.
//
// Otherwise the task keeps its status (the other fields of the patch are written all the same), and a
// repeating task gets its next occurrence only on a real change from open to done.
func (s *Store) UpdateTask(userID string, before *domain.Thought, p ThoughtPatch, plan NotifyPlan) (*domain.Thought, []CenterEntry, error) {
	thought := before.Clone()
	wasCompleted := thought.IsCompleted
	statusPatch := p.IsCompleted != nil || (p.KanbanStatus != nil && *p.KanbanStatus != "")
	var stored taskStatus
	if statusPatch {
		var err error
		if stored, err = s.taskStatus(thought.ID); err != nil {
			return nil, nil, err // sql.ErrNoRows: deleted meanwhile
		}
		thought.IsCompleted, thought.KanbanStatus = stored.done, stored.column
		wasCompleted = stored.done
	}
	oldDue := thought.DueDate
	if err := s.ensureTaskListWritable(userID, thought.TaskListID); err != nil {
		return nil, nil, err
	}
	moved := p.TaskListID != nil && *p.TaskListID != thought.TaskListID
	if moved {
		if err := s.ensureTaskListWritable(userID, *p.TaskListID); err != nil {
			return nil, nil, err
		}
	}

	if p.Content != nil {
		thought.Content = strings.TrimSpace(*p.Content)
		thought.Tags = domain.ExtractTags(thought.Content)
	}
	if p.Tags != nil {
		thought.Tags = *p.Tags
	}
	// The columns of the list the task ends up in: a plain tick goes to its last column marked as done, a
	// reopened task to its first open column, and a column alone completes the task if it is marked as done
	var cols []domain.KanbanColumn
	if statusPatch {
		cols = stored.columns
		if p.TaskListID != nil && *p.TaskListID != stored.listID {
			cols = s.listColumns(*p.TaskListID)
		}
	}
	if p.IsCompleted != nil {
		thought.IsCompleted = *p.IsCompleted
		thought.KanbanStatus = statusColumn(cols, *p.IsCompleted, thought.KanbanStatus)
	}
	if p.DueDate != nil {
		thought.DueDate = domain.NormalizeDue(*p.DueDate)
	}
	if p.Priority != nil {
		pr := strings.ToLower(strings.TrimSpace(*p.Priority))
		if pr == "" || pr == "none" {
			pr = "normal"
		}
		thought.Priority = pr
	}
	if p.TaskListID != nil {
		thought.TaskListID = *p.TaskListID
	}
	if p.KanbanStatus != nil && *p.KanbanStatus != "" {
		thought.KanbanStatus = *p.KanbanStatus
		if p.IsCompleted == nil {
			thought.IsCompleted = doneColumn(cols, *p.KanbanStatus)
		}
	}
	if p.Notes != nil {
		thought.Notes = *p.Notes
	}
	if p.Subtasks != nil && p.SubtasksBase != nil {
		// Merged once more inside the transaction with the subtasks as stored then; this result is for plan
		thought.Subtasks = MergeSubtasks(*p.SubtasksBase, *p.Subtasks, thought.Subtasks)
	} else if p.Subtasks != nil {
		thought.Subtasks = keepSubtaskLinks(thought.Subtasks, *p.Subtasks)
	}
	// Moved to another list: assignees without access to it go (the same rule as pruneTaskAssigneesOf
	// below, worked out here so plan sees the new state)
	if moved {
		allowed := map[string]bool{}
		for _, id := range s.GetTaskListUserIDs(thought.TaskListID) {
			allowed[id] = true
		}
		kept := []string{}
		for _, id := range thought.Assignees {
			if thought.TaskListID != "" && allowed[id] {
				kept = append(kept, id)
			}
		}
		thought.Assignees = kept
	}

	statusStamp := ""
	if statusPatch {
		same := thought.IsCompleted == stored.done
		if p.KanbanStatus != nil && *p.KanbanStatus != "" {
			same = same && thought.KanbanStatus == stored.column
		}
		statusStamp = statusTime(p.StatusAt)
		if same || stored.changedAt > statusStamp {
			// Already so, or changed by somebody later: the status stays as stored
			statusPatch = false
			thought.IsCompleted, thought.KanbanStatus = stored.done, stored.column
		}
	}

	// A new due date or a reopened task gets its alarm again (in the same statement)
	rearm := thought.DueDate != oldDue || (wasCompleted && !thought.IsCompleted)
	if rearm {
		thought.AlarmSent = false
	}
	// Only the fields of the patch are written: the task is read before the transaction, and writing the
	// others from that read would undo a change made meanwhile (a to-do of a linked note ticked while the
	// task is renamed, ReconcileDocTaskLinks). RETURNING gives the state as stored, those changes included.
	sets := []string{"alarm_sent = CASE WHEN ? THEN 0 ELSE alarm_sent END", "alarm_failures = CASE WHEN ? THEN 0 ELSE alarm_failures END"}
	args := []any{rearm, rearm}
	set := func(col string, v any) {
		sets = append(sets, col+" = ?")
		args = append(args, v)
	}
	if p.Content != nil {
		set("content", thought.Content)
	}
	if p.Content != nil || p.Tags != nil {
		tagsJSON, _ := json.Marshal(thought.Tags)
		set("tags", string(tagsJSON))
	}
	if statusPatch {
		// Guarded once more in the statement: a status change stored since it was read above and made after
		// StatusAt stays (the trigger of migration 65 stamps changes that do not set the time themselves)
		guarded := func(col string, v any) {
			sets = append(sets, col+" = CASE WHEN status_changed_at <= ? THEN ? ELSE "+col+" END")
			args = append(args, statusStamp, v)
		}
		guarded("is_completed", boolInt(thought.IsCompleted))
		guarded("kanban_status", thought.KanbanStatus)
		guarded("status_changed_at", statusStamp)
	}
	if p.DueDate != nil {
		set("due_date", thought.DueDate)
	}
	if p.Priority != nil {
		set("priority", thought.Priority)
	}
	if p.TaskListID != nil {
		set("task_list_id", thought.TaskListID)
	}
	if p.Notes != nil {
		set("notes", thought.Notes)
	}
	subtasksArg := -1
	if p.Subtasks != nil {
		subtasksJSON, _ := json.Marshal(thought.Subtasks)
		set("subtasks", string(subtasksJSON))
		subtasksArg = len(args) - 1
	}
	var center []CenterAdd
	var queue []QueuedAdd
	if plan != nil {
		center, queue = plan(thought)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()
	if subtasksArg >= 0 && p.SubtasksBase != nil {
		// The transaction holds the write lock, so this is the state the merge writes over
		var raw string
		if err := tx.QueryRow(`SELECT subtasks FROM thoughts WHERE id = ?`, thought.ID).Scan(&raw); err != nil {
			return nil, nil, err // sql.ErrNoRows: deleted meanwhile
		}
		var stored []domain.SubTask
		_ = json.Unmarshal([]byte(raw), &stored)
		subtasksJSON, _ := json.Marshal(MergeSubtasks(*p.SubtasksBase, *p.Subtasks, stored))
		args[subtasksArg] = string(subtasksJSON)
	}
	var tagsStr, subtasksStr string
	var completed int
	if err := tx.QueryRow(
		`UPDATE thoughts SET `+strings.Join(sets, ", ")+` WHERE id = ?
		 RETURNING content, tags, is_completed, COALESCE(due_date, ''), priority, task_list_id, kanban_status, notes, subtasks`,
		append(args, thought.ID)...,
	).Scan(&thought.Content, &tagsStr, &completed, &thought.DueDate, &thought.Priority, &thought.TaskListID, &thought.KanbanStatus, &thought.Notes, &subtasksStr); err != nil {
		return nil, nil, err // sql.ErrNoRows: deleted meanwhile
	}
	thought.IsCompleted = completed != 0
	if thought.KanbanStatus == "" {
		thought.KanbanStatus = "todo"
		if thought.IsCompleted {
			thought.KanbanStatus = "done"
		}
	}
	thought.Tags = []string{}
	_ = json.Unmarshal([]byte(tagsStr), &thought.Tags)
	thought.Subtasks = []domain.SubTask{}
	if subtasksStr != "" && subtasksStr != "null" {
		_ = json.Unmarshal([]byte(subtasksStr), &thought.Subtasks)
	}
	if moved {
		if err := pruneTaskAssignees(tx, thought.ID); err != nil {
			return nil, nil, err
		}
	}
	added, err := storeNotificationsTx(tx, center, queue)
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	if !wasCompleted && thought.IsCompleted && thought.Recurrence != "" {
		s.spawnNextOccurrence(thought.ID)
	} else if wasCompleted && !thought.IsCompleted && thought.Recurrence != "" {
		s.dropUntouchedSuccessor(thought.ID)
	}
	return thought, added, nil
}

// DeleteThought: a task goes to the task trash (task_trash.go); anything else (a thought from the inbox
// or the triage trash) is deleted for good.
func (s *Store) DeleteThought(userID, thoughtID string) error {
	thought, err := s.GetThoughtByID(userID, thoughtID)
	if err != nil {
		return err
	}
	_, err = s.DeleteTask(userID, thought, nil)
	return err
}

// DeleteTask is DeleteThought for a thought as GetThoughtByID read it for userID, in one transaction
// together with plan's notifications (planned from the thought before it begins) and forgetting the
// task's watchers: deleting and telling others used to wait for the database's write lock three times.
// Returns the center entries as stored, in plan's order.
func (s *Store) DeleteTask(userID string, thought *domain.Thought, plan NotifyPlan) ([]CenterEntry, error) {
	if err := s.ensureTaskListWritable(userID, thought.TaskListID); err != nil {
		return nil, err
	}
	var stmts []sqlStmt
	// Tasks as in completedTaskSQL: kept, or converted into a task
	if thought.Status == domain.StatusKept || (thought.Status == domain.StatusConverted && thought.ConvertedType == "task") {
		var err error
		if stmts, err = s.trashTaskStmts(thought.ID, userID); err != nil {
			return nil, err
		}
	} else {
		stmts = []sqlStmt{stmt(`DELETE FROM thoughts WHERE id = ?`, thought.ID)}
	}
	var center []CenterAdd
	var queue []QueuedAdd
	if plan != nil {
		center, queue = plan(thought)
	}
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
	if _, err := tx.Exec(`DELETE FROM task_watchers WHERE task_id = ?`, thought.ID); err != nil {
		return nil, err
	}
	added, err := storeNotificationsTx(tx, center, queue)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return added, nil
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

// --- ALARMS ---

type DueTaskAlarm struct {
	TaskID string
	// Reminder: the task's own reminder in minutes before the due date, or ReminderLeadTime for the
	// person's lead time; NotifyBeforeMinutes holds the minutes that apply either way
	Reminder            int
	UserID              string
	Title               string
	Notes               string
	DueDate             string
	Priority            string
	UserEmail           string
	UserName            string
	AlarmChannels       []string
	DiscordWebhookURL   string
	CustomWebhookURL    string
	NotifyBeforeMinutes int
	// Delivered: the channels that got this alarm already in an earlier run (the others are tried again)
	Delivered []string
}
