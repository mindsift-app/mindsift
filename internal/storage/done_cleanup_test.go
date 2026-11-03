package storage

import (
	"path/filepath"
	"testing"
	"time"
)

func doneTask(t *testing.T, s *Store, userID, listID, content, completedAt string) string {
	t.Helper()
	th, err := s.CreateThoughtWithDetails(userID, content, "normal", "manual", "", listID, "todo", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateThoughtTriage(userID, th.ID, "keep", "task", "", "", listID); err != nil {
		t.Fatal(err)
	}
	done := true
	if _, err := s.UpdateThoughtDetails(userID, th.ID, nil, &done, nil, nil, nil, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if completedAt != "" {
		_, _ = s.db.Exec(`UPDATE thoughts SET completed_at = ? WHERE id = ?`, completedAt, th.ID)
	}
	return th.ID
}

func exists(s *Store, id string) bool {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM thoughts WHERE id = ?`, id).Scan(&n)
	return n == 1
}

// Completing a task stamps completed_at, reopening clears it (trigger, whichever path changes the task).
func TestCompletedAtFollowsCompletion(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "done.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	id := doneTask(t, s, anna.ID, "", "Filter wechseln", "")
	var at string
	_ = s.db.QueryRow(`SELECT completed_at FROM thoughts WHERE id = ?`, id).Scan(&at)
	if _, err := time.Parse("2006-01-02T15:04:05Z", at); err != nil {
		t.Fatalf("completed_at not set on completion: %q", at)
	}
	open := false
	_, _ = s.UpdateThoughtDetails(anna.ID, id, nil, &open, nil, nil, nil, nil, nil, nil, nil)
	_ = s.db.QueryRow(`SELECT completed_at FROM thoughts WHERE id = ?`, id).Scan(&at)
	if at != "" {
		t.Fatalf("reopening should clear completed_at: %q", at)
	}
}

// The delay of the list owner (or the user for personal tasks) decides; 0 keeps everything.
func TestPurgeExpiredDoneTasks(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "purge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	openSharing(t, s)
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := s.CreateUser("ben@example.com", "hash", "Ben", "member")
	if s.DoneRetentionDays(anna.ID) != 30 {
		t.Fatalf("default delay should be 30 days")
	}
	_ = s.SetDoneRetentionDays(ben.ID, 0) // Ben keeps everything
	if err := s.SetDoneRetentionDays(ben.ID, 12); err == nil {
		t.Fatal("only the offered delays are allowed")
	}
	shared, _ := s.CreateTaskList(anna.ID, "", "", "Haushalt", "", "")
	if _, err := s.AddTaskListShare(shared.ID, "user", ben.ID, "editor", anna.ID); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 12, 15, 0, 30, 0, 0, time.UTC)
	oldAnna := doneTask(t, s, anna.ID, "", "alt", "2026-11-10T08:00:00Z")      // 35 days → gone
	freshAnna := doneTask(t, s, anna.ID, "", "frisch", "2026-11-20T08:00:00Z") // 25 days → stays
	oldBen := doneTask(t, s, ben.ID, "", "Ben alt", "2026-01-01T08:00:00Z")    // Ben: never
	benInAnnasList := doneTask(t, s, ben.ID, shared.ID, "in Annas Liste", "2026-11-01T08:00:00Z")
	openTask, _ := s.CreateThoughtWithDetails(anna.ID, "offen", "normal", "manual", "", "", "todo", "")

	deleted, err := s.PurgeExpiredDoneTasks(now, true)
	if err != nil {
		t.Fatal(err)
	}
	if exists(s, oldAnna) || !exists(s, freshAnna) || !exists(s, oldBen) || exists(s, benInAnnasList) || !exists(s, openTask.ID) {
		t.Fatalf("wrong tasks purged: %+v", deleted)
	}
	if len(deleted) != 2 {
		t.Fatalf("expected 2 deleted, got %d", len(deleted))
	}
	// Edge: exactly at the limit nothing happens yet
	edge := doneTask(t, s, anna.ID, "", "Grenze", "2026-11-15T00:30:00Z")
	_, _ = s.PurgeExpiredDoneTasks(now, true)
	if !exists(s, edge) {
		t.Fatal("a task completed exactly 30 days ago stays until the limit has passed")
	}
}

// "Erledigte leeren" only deletes what the user may delete.
func TestClearDoneTasks(t *testing.T) {
	s, err := NewStore(filepath.Join(t.TempDir(), "clear.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	openSharing(t, s)
	anna, _ := s.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := s.CreateUser("ben@example.com", "hash", "Ben", "member")
	readOnly, _ := s.CreateTaskList(anna.ID, "", "", "Nur lesen", "", "")
	_, _ = s.AddTaskListShare(readOnly.ID, "user", ben.ID, "viewer", anna.ID)
	annaDone := doneTask(t, s, anna.ID, readOnly.ID, "Annas erledigt", "")
	benDone := doneTask(t, s, ben.ID, "", "Bens erledigt", "")

	if _, err := s.ClearDoneTasks(ben.ID, readOnly.ID); err == nil {
		t.Fatal("a viewer must not clear a list")
	}
	deleted, err := s.ClearDoneTasks(ben.ID, "")
	if err != nil || len(deleted) != 1 || exists(s, benDone) || !exists(s, annaDone) {
		t.Fatalf("Ben should only clear his own: %+v %v", deleted, err)
	}
	if deleted, _ := s.ClearDoneTasks(anna.ID, readOnly.ID); len(deleted) != 1 || exists(s, annaDone) {
		t.Fatalf("owner clears her list: %+v", deleted)
	}
}
