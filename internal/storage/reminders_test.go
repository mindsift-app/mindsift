package storage

import (
	"path/filepath"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// A task's own reminders replace the lead time: one pending alarm per reminder, each marked separately,
// a new due date re-arms all of them, and the next occurrence of a repeating task keeps them
func TestTaskReminders(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "reminders.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	task, _ := store.CreateThoughtWithDetails(anna.ID, "Geburtstag Mama", "normal", "manual", "2026-11-24", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "2026-11-24", "")

	pending := func() map[int]int {
		alarms, _ := store.GetDueTasksForAlarm()
		out := map[int]int{}
		for _, a := range alarms {
			if a.TaskID == task.ID {
				out[a.Reminder] = a.NotifyBeforeMinutes
			}
		}
		return out
	}

	if got := pending(); len(got) != 1 || got[ReminderLeadTime] != 30 {
		t.Fatalf("without reminders: the lead time (30 min), got %v", got)
	}
	if _, err := store.SetTaskReminders(anna.ID, task.ID, []int{45}); err != ErrInvalidReminders {
		t.Fatalf("45 minutes is no choice: %v", err)
	}
	got, err := store.SetTaskReminders(anna.ID, task.ID, []int{0, 20160})
	if err != nil || domain.FormatReminders(got) != "20160,0" {
		t.Fatalf("SetTaskReminders: %v %v", got, err)
	}
	if th, _ := store.GetThoughtByID(anna.ID, task.ID); domain.FormatReminders(th.Reminders) != "20160,0" {
		t.Fatalf("stored reminders: %v", th.Reminders)
	}
	if got := pending(); len(got) != 2 || got[20160] != 20160 || got[0] != 0 {
		t.Fatalf("one alarm per reminder, no lead time: %v", got)
	}
	_ = store.MarkTaskAlarmSent(task.ID, anna.ID, 20160)
	if got := pending(); len(got) != 1 || got[0] != 0 {
		t.Fatalf("the early one sent, the one on the day waits: %v", got)
	}
	later := "2026-12-24"
	_, _ = store.UpdateThoughtDetails(anna.ID, task.ID, nil, nil, &later, nil, nil, nil, nil, nil, nil)
	if got := pending(); len(got) != 2 {
		t.Fatalf("a new due date re-arms every reminder: %v", got)
	}

	// The next occurrence keeps the reminders; trash and restore keep them too
	_ = store.SetTaskRecurrence(anna.ID, task.ID, "yearly")
	var next *domain.Thought
	store.OnTaskCreated = func(th *domain.Thought) { next = th }
	done := true
	_, _ = store.UpdateThoughtDetails(anna.ID, task.ID, nil, &done, nil, nil, nil, nil, nil, nil, nil)
	if next == nil || next.DueDate != "2027-12-24" || domain.FormatReminders(next.Reminders) != "20160,0" {
		t.Fatalf("successor: %+v", next)
	}
	if err := store.DeleteThought(anna.ID, next.ID); err != nil {
		t.Fatalf("to the trash: %v", err)
	}
	restored, err := store.RestoreTrashedTask(anna.ID, next.ID)
	if err != nil || domain.FormatReminders(restored.Reminders) != "20160,0" {
		t.Fatalf("restored: %+v %v", restored, err)
	}

	// Back to the lead time
	if got, _ := store.SetTaskReminders(anna.ID, task.ID, nil); len(got) != 0 {
		t.Fatalf("cleared: %v", got)
	}
}

// The migration keeps alarms already sent (as sent at the lead time) and the trigger that re-arms them
func TestReminderMigrationKeepsSentAlarms(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "migrate.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	task, _ := store.CreateThoughtWithDetails(anna.ID, "Steuer", "normal", "manual", "2026-10-30", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "2026-10-30", "")
	// The table as before migration 32, with one alarm sent
	if err := store.execInTx(
		stmt(`DROP TRIGGER IF EXISTS task_alarm_rearm`),
		stmt(`DROP TABLE task_alarms_sent`),
		stmt(`CREATE TABLE task_alarms_sent (task_id TEXT NOT NULL, user_id TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
			failures INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (task_id, user_id))`),
		stmt(`INSERT INTO task_alarms_sent (task_id, user_id, sent) VALUES (?, ?, 1)`, task.ID, anna.ID),
		stmt(`UPDATE thoughts SET alarm_sent = 1 WHERE id = ?`, task.ID),
	); err != nil {
		t.Fatal(err)
	}
	if err := store.migrateReminders(); err != nil {
		t.Fatalf("migrateReminders: %v", err)
	}
	if alarms, _ := store.GetDueTasksForAlarm(); len(alarms) != 0 {
		t.Fatalf("the sent alarm stays sent: %+v", alarms)
	}
	later := "2026-11-02"
	_, _ = store.UpdateThoughtDetails(anna.ID, task.ID, nil, nil, &later, nil, nil, nil, nil, nil, nil)
	if alarms, _ := store.GetDueTasksForAlarm(); len(alarms) != 1 || alarms[0].Reminder != ReminderLeadTime {
		t.Fatalf("a new due date re-arms it (trigger): %+v", alarms)
	}
}
