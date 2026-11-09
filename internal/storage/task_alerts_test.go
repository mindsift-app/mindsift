package storage

import (
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// Due alarms in a shared list go to the assignees, or to every member who did not mute the list when
// nobody is assigned; each person is marked separately, a new due date re-arms all of them.
func TestDueAlarmRecipients(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "alerts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	sys, _ := store.GetSystemSettings()
	sys.SharingMode = SharingOpen
	_ = store.UpdateSystemSettings(sys)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")
	cleo, _ := store.CreateUser("cleo@example.com", "hash", "Cleo", "member")
	list, _ := store.CreateTaskList(anna.ID, "", "", "Haushalt", "🏠", "")
	for _, u := range []string{ben.ID, cleo.ID} {
		if _, err := store.AddTaskListShare(list.ID, "user", u, "editor", anna.ID); err != nil {
			t.Fatal(err)
		}
	}
	task, _ := store.CreateThoughtWithDetails(anna.ID, "Fenster putzen", "normal", "manual", "2026-10-30", list.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "", list.ID)
	own, _ := store.CreateThoughtWithDetails(ben.ID, "Steuer", "normal", "manual", "2026-10-30", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(ben.ID, own.ID, "keep", "task", "", "", "")

	pending := func(taskID string) string {
		alarms, _ := store.GetDueTasksForAlarm()
		var who []string
		for _, a := range alarms {
			if a.TaskID == taskID {
				who = append(who, a.UserName)
			}
		}
		sort.Strings(who)
		return strings.Join(who, ",")
	}

	if got := pending(task.ID); got != "Anna,Ben,Cleo" {
		t.Fatalf("unassigned: every member, got %q", got)
	}
	if got := pending(own.ID); got != "Ben" {
		t.Fatalf("personal task: its owner, got %q", got)
	}
	// A muted list keeps quiet about unassigned tasks
	_ = store.SetTaskListMuted(cleo.ID, list.ID, true)
	if got := pending(task.ID); got != "Anna,Ben" {
		t.Fatalf("muted member left out, got %q", got)
	}
	// Assigned: only the assignee, even with the list muted
	_, _ = store.SetTaskAssignees(anna.ID, task.ID, []string{cleo.ID})
	if got := pending(task.ID); got != "Cleo" {
		t.Fatalf("assigned: only the assignee, got %q", got)
	}
	_, _ = store.SetTaskAssignees(anna.ID, task.ID, []string{})

	// Sent to one person: the others still wait; a new due date re-arms everyone
	_ = store.SetTaskListMuted(cleo.ID, list.ID, false)
	_ = store.MarkTaskAlarmSent(task.ID, ben.ID)
	if got := pending(task.ID); got != "Anna,Cleo" {
		t.Fatalf("after Ben got it, got %q", got)
	}
	later := "2026-11-02"
	_, _ = store.UpdateThoughtDetails(anna.ID, task.ID, nil, nil, &later, nil, nil, nil, nil, nil, nil)
	if got := pending(task.ID); got != "Anna,Ben,Cleo" {
		t.Fatalf("new due date re-arms everyone, got %q", got)
	}

	// Alarms sent before the update count as sent to everyone, until someone new is assigned
	_, _ = store.db.Exec(`INSERT INTO task_alarms_sent (task_id, user_id, sent) VALUES (?, ?, 1)`, task.ID, alarmSentToAll)
	if got := pending(task.ID); got != "" {
		t.Fatalf("old alarm stands for everyone, got %q", got)
	}
	_, _ = store.SetTaskAssignees(anna.ID, task.ID, []string{ben.ID})
	if got := pending(task.ID); got != "Ben" {
		t.Fatalf("new assignee gets the alarm, got %q", got)
	}
}

// Standard columns show in the language of whoever looks, as long as nobody renamed them
func TestLocalizeColumns(t *testing.T) {
	cols := defaultColumns("en")
	cols = append(cols, domain.KanbanColumn{ID: "review", Name: "Review"})
	cols[1].Name = "Doing" // renamed
	got := LocalizeColumns(cols, "de")
	want := []string{"Zu erledigen", "Doing", "Wartet auf andere", "Erledigt", "Review"}
	for i, w := range want {
		if got[i].Name != w {
			t.Errorf("column %d: got %q, want %q", i, got[i].Name, w)
		}
	}
	if it := LocalizeColumns(defaultColumns("de"), "it"); it[0].Name != "Da fare" || it[3].Name != "Fatto" {
		t.Errorf("German names should turn Italian: %+v", it)
	}
}
