package storage

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestNextDueDate(t *testing.T) {
	at := func(day string) time.Time {
		d, _ := time.Parse("2006-01-02", day)
		return d.Add(15 * time.Hour)
	}
	cases := []struct{ due, rule, today, want string }{
		// On time or early: one interval after the due date
		{"2026-10-30", "daily", "2026-10-29", "2026-10-31"},
		{"2026-10-30", "weekly", "2026-10-29", "2026-11-06"},
		{"2026-01-31", "monthly", "2026-01-20", "2026-02-28"},
		{"2026-03-15", "monthly", "2026-03-15", "2026-04-15"},
		{"2028-02-29", "yearly", "2028-02-01", "2029-02-28"},
		{"", "weekly", "2026-10-29", "2026-11-05"},
		{"2026-01-31T07:15", "monthly", "2026-01-31", "2026-02-28T07:15"},
		{"2026-10-30T23:30", "daily", "2026-10-29", "2026-10-31T23:30"},
		// Late: missed dates are skipped, the next one lies after the day it was done
		{"2026-11-21", "daily", "2026-11-23", "2026-11-24"}, // due Saturday, done Monday: Tuesday
		{"2026-11-21T08:00", "daily", "2026-11-23", "2026-11-24T08:00"},
		{"2026-11-02", "weekly", "2026-11-20", "2026-11-23"},  // stays on Monday
		{"2026-11-02", "weekly", "2026-11-23", "2026-11-30"},  // done on its weekday: next week
		{"2026-01-31", "monthly", "2026-04-10", "2026-04-30"}, // day 31 kept, April has 30
		{"2026-01-31", "monthly", "2026-04-30", "2026-05-31"},
		{"2024-02-29", "yearly", "2026-03-01", "2027-02-28"},
		// Weekdays: Monday to Friday
		{"2026-11-20", "weekdays", "2026-11-20", "2026-11-23"}, // Friday -> Monday
		{"2026-11-18", "weekdays", "2026-11-17", "2026-11-19"}, // early: the weekday after its date
		{"2026-11-20", "weekdays", "2026-11-23", "2026-11-24"}, // Friday's, done Monday: Tuesday
		{"2026-11-21", "weekdays", "2026-11-21", "2026-11-23"}, // set on a Saturday: Monday
		{"", "weekdays", "2026-11-21", "2026-11-23"},
	}
	for _, c := range cases {
		if got := NextDueDate(c.due, c.rule, at(c.today)); got != c.want {
			t.Errorf("NextDueDate(%q, %s, done %s) = %s, want %s", c.due, c.rule, c.today, got, c.want)
		}
	}
}

// Without a due date the next one counts from today in the server's time zone
func TestNextDueDateCountsFromTheServersDay(t *testing.T) {
	instant := time.Date(2026, 11, 13, 23, 30, 0, 0, time.UTC) // 14 November in Tokyo, 13th in Los Angeles
	for zone, want := range map[string]string{"UTC": "2026-11-14", "Asia/Tokyo": "2026-11-15", "America/Los_Angeles": "2026-11-14"} {
		loc, _ := time.LoadLocation(zone)
		clock.UseInTest(t, loc)
		if got := NextDueDate("", "daily", instant); got != want {
			t.Errorf("%s: NextDueDate = %s, want %s", zone, got, want)
		}
		// A date that is set does not depend on the zone
		if got := NextDueDate("2026-11-20T23:30", "daily", instant); got != "2026-11-21T23:30" {
			t.Errorf("%s: with a date: %s", zone, got)
		}
	}
}

func TestRepeatingTaskSpawnsItsSuccessor(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "recur.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	tl, _ := store.CreateTaskList(anna.ID, "", "", "Haushalt", "", "")
	_, _ = store.AddTaskListShare(tl.ID, "user", ben.ID, "editor", anna.ID)

	var pushed []*domain.Thought
	store.OnTaskCreated = func(th *domain.Thought) { pushed = append(pushed, th) }

	task, _ := store.CreateThoughtWithDetails(anna.ID, "Müll rausbringen #haushalt", "high", "manual", "2099-11-02", tl.ID, "todo", "Gelbe Tonne")
	_, _ = store.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "2099-11-02", tl.ID)
	subs := []domain.SubTask{{ID: "s1", Title: "Tüten", IsCompleted: true}}
	_, _ = store.UpdateThoughtDetails(anna.ID, task.ID, nil, nil, nil, nil, nil, nil, nil, &subs, nil)
	_, _ = store.SetTaskAssignees(anna.ID, task.ID, []string{ben.ID})
	if err := store.SetTaskRecurrence(anna.ID, task.ID, "weekly"); err != nil {
		t.Fatalf("SetTaskRecurrence: %v", err)
	}
	if err := store.SetTaskRecurrence(anna.ID, task.ID, "stündlich"); err == nil {
		t.Errorf("unknown rule must be rejected")
	}

	done := true
	if _, err := store.UpdateThoughtDetails(ben.ID, task.ID, nil, &done, nil, nil, nil, nil, nil, nil, nil); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if len(pushed) != 1 {
		t.Fatalf("expected one successor pushed live, got %d", len(pushed))
	}
	next := pushed[0]
	if next.Content != "Müll rausbringen #haushalt" || next.Priority != "high" || next.Notes != "Gelbe Tonne" ||
		next.DueDate != "2099-11-09" || next.Recurrence != "weekly" || next.IsCompleted || next.TaskListID != tl.ID ||
		next.KanbanStatus != "todo" || len(next.Subtasks) != 1 || next.Subtasks[0].IsCompleted ||
		len(next.Assignees) != 1 || next.Assignees[0] != ben.ID || next.UserID != anna.ID {
		t.Errorf("successor wrong: %+v", next)
	}
	if orig, _ := store.GetThoughtByID(anna.ID, task.ID); !orig.IsCompleted {
		t.Errorf("the completed task stays completed for the history")
	}

	// Re-opening (an undone tick) removes the untouched successor, completing again spawns a fresh one:
	// one open successor in the end
	var removed []string
	store.OnTaskRemoved = func(th *domain.Thought) { removed = append(removed, th.ID) }
	open := false
	_, _ = store.UpdateThoughtDetails(anna.ID, task.ID, nil, &open, nil, nil, nil, nil, nil, nil, nil)
	_, _ = store.UpdateThoughtDetails(anna.ID, task.ID, nil, &done, nil, nil, nil, nil, nil, nil, nil)
	if len(removed) != 1 || removed[0] != next.ID || len(pushed) != 2 {
		t.Fatalf("re-completing: removed %v, %d spawned", removed, len(pushed))
	}
	if got := store.openSuccessors(task.ID); len(got) != 1 || got[0] != pushed[1].ID {
		t.Fatalf("open successors after re-completing: %v", got)
	}
	next = pushed[1]

	// Dragging the successor into "done" on the Kanban board repeats as well
	status := "done"
	if err := store.ReorderTasks(tl.ID, []domain.ThoughtReorderItem{{ID: next.ID, SortOrder: 0, KanbanStatus: &status}}); err != nil {
		t.Fatalf("ReorderTasks: %v", err)
	}
	if len(pushed) != 3 || pushed[2].DueDate != "2099-11-16" {
		t.Fatalf("Kanban completion should spawn the next week, got %+v", pushed)
	}

	// A task without rule never repeats
	plain, _ := store.CreateThoughtWithDetails(anna.ID, "Einmalig", "normal", "manual", "", tl.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(anna.ID, plain.ID, "keep", "task", "", "", tl.ID)
	_, _ = store.UpdateThoughtDetails(anna.ID, plain.ID, nil, &done, nil, nil, nil, nil, nil, nil, nil)
	if len(pushed) != 3 {
		t.Errorf("non-repeating task must not spawn")
	}
}

func TestAlarmResetsOnNewDueDateOrReopen(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "alarm.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	u, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	task, _ := store.CreateThoughtWithDetails(u.ID, "Zahnarzt", "normal", "manual", "2026-10-30 14:30", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(u.ID, task.ID, "keep", "task", "", "", "")
	sent := func() bool {
		th, _ := store.GetThoughtByID(u.ID, task.ID)
		return th.AlarmSent
	}
	if th, _ := store.GetThoughtByID(u.ID, task.ID); th.DueDate != "2026-10-30T14:30" {
		t.Fatalf("due date not normalized: %q", th.DueDate)
	}

	_ = store.MarkTaskAlarmSent(task.ID, u.ID, ReminderLeadTime)
	same := "2026-10-30T14:30"
	_, _ = store.UpdateThoughtDetails(u.ID, task.ID, nil, nil, &same, nil, nil, nil, nil, nil, nil)
	if !sent() {
		t.Errorf("unchanged due date must not re-arm the alarm")
	}
	later := "2026-10-31T08:00"
	_, _ = store.UpdateThoughtDetails(u.ID, task.ID, nil, nil, &later, nil, nil, nil, nil, nil, nil)
	if sent() {
		t.Errorf("new due date must re-arm the alarm")
	}

	_ = store.MarkTaskAlarmSent(task.ID, u.ID, ReminderLeadTime)
	done, open := true, false
	_, _ = store.UpdateThoughtDetails(u.ID, task.ID, nil, &done, nil, nil, nil, nil, nil, nil, nil)
	if !sent() {
		t.Errorf("completing keeps the flag")
	}
	_, _ = store.UpdateThoughtDetails(u.ID, task.ID, nil, &open, nil, nil, nil, nil, nil, nil, nil)
	if sent() {
		t.Errorf("reopening must re-arm the alarm")
	}
}

// A Kanban move sends every task of the touched columns: only a task that goes from done back to open
// may get its due alarm again, the others must not be notified a second time
func TestKanbanMoveKeepsSentAlarms(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "kanban-alarm.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	u, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	tl, _ := store.CreateTaskList(u.ID, "", "", "Haushalt", "🏠", "")
	task, _ := store.CreateThoughtWithDetails(u.ID, "Heizung entlüften", "normal", "manual", "2026-10-31 09:00", tl.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(u.ID, task.ID, "keep", "task", "", "", tl.ID)
	sent := func() bool {
		th, _ := store.GetThoughtByID(u.ID, task.ID)
		return th.AlarmSent
	}
	move := func(status string) {
		if err := store.ReorderTasks(tl.ID, []domain.ThoughtReorderItem{{ID: task.ID, SortOrder: 0, KanbanStatus: &status}}); err != nil {
			t.Fatalf("ReorderTasks: %v", err)
		}
	}

	_ = store.MarkTaskAlarmSent(task.ID, u.ID, ReminderLeadTime)
	move("in_progress")
	move("todo")
	if !sent() {
		t.Errorf("moving an open task between columns must not re-arm its alarm")
	}
	move("done")
	if !sent() {
		t.Errorf("completing keeps the flag")
	}
	move("todo")
	if sent() {
		t.Errorf("reopening via the board must re-arm the alarm")
	}
}

func TestAlarmGivesUpAfterThreeFailedRuns(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "alarmfail.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	u, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	task, _ := store.CreateThoughtWithDetails(u.ID, "Webhook kaputt", "normal", "manual", "2026-10-30", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(u.ID, task.ID, "keep", "task", "", "", "")
	pending := func() bool {
		alarms, _ := store.GetDueTasksForAlarm()
		for _, a := range alarms {
			if a.TaskID == task.ID {
				return true
			}
		}
		return false
	}

	for run := 1; run <= MaxAlarmFailures; run++ {
		gaveUp, err := store.RecordTaskAlarmFailure(task.ID, u.ID, ReminderLeadTime)
		if err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
		if gaveUp != (run == MaxAlarmFailures) || pending() == (run == MaxAlarmFailures) {
			t.Fatalf("run %d: gaveUp=%v pending=%v", run, gaveUp, pending())
		}
	}

	// A new due date gets three fresh attempts
	later := "2026-11-02"
	_, _ = store.UpdateThoughtDetails(u.ID, task.ID, nil, nil, &later, nil, nil, nil, nil, nil, nil)
	if !pending() {
		t.Fatalf("new due date must re-arm the alarm")
	}
	if gaveUp, _ := store.RecordTaskAlarmFailure(task.ID, u.ID, ReminderLeadTime); gaveUp {
		t.Errorf("failure counter must start over after a new due date")
	}
	// Success clears the counter
	_ = store.MarkTaskAlarmSent(task.ID, u.ID, ReminderLeadTime)
	if failures := store.taskAlarmFailures(task.ID, u.ID); failures != 0 {
		t.Errorf("successful alarm should reset failures, got %d", failures)
	}
}

// Repeat rules go out and come back in the Obsidian Tasks form ("🔁 every weekday")
func TestRecurrenceMarkdownRoundTrip(t *testing.T) {
	for rule := range recurrenceEvery {
		line := taskMarkdownLine(domain.Thought{Content: "Zeitung holen", Recurrence: rule})
		got := parseTaskFile(line + "\n")
		if len(got) != 1 || got[0].recurrence != rule || got[0].content != "Zeitung holen" {
			t.Errorf("%s: %q came back as %+v", rule, line, got)
		}
	}
}
