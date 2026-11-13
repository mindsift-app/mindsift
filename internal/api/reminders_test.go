package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// Reminders of a task through the API: only the choices are accepted, an early reminder names the due
// date ("ist am … fällig") and each reminder lands in the bell once
func TestTaskRemindersAlarm(t *testing.T) {
	srv, sent := notifyServer(t)
	store := srv.store
	router := srv.Router()
	owner, token := newTestUser(t, store, "owner@example.com")
	task, _ := store.CreateThoughtWithDetails(owner.ID, "Geburtstag Mama", "normal", "manual", "2026-11-24", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(owner.ID, task.ID, "keep", "task", "", "2026-11-24", "")

	if rec := sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, token, `{"reminders":[45]}`, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("45 minutes is no choice: %d", rec.Code)
	}
	rec := sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, token, `{"reminders":[0,20160]}`, "")
	var got domain.Thought
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &got) != nil || domain.FormatReminders(got.Reminders) != "20160,0" {
		t.Fatalf("set reminders: %d %s", rec.Code, rec.Body.String())
	}

	dueEntries := func() []string {
		var texts []string
		for _, e := range getCenter(t, srv, token).Items {
			if e.Kind == "due" {
				texts = append(texts, e.Text)
			}
		}
		return texts
	}

	// Two weeks ahead at 09:00: the early reminder, once
	srv.checkAlarms(time.Date(2026, 11, 10, 9, 0, 0, 0, clock.Location()))
	srv.checkAlarms(time.Date(2026, 11, 10, 9, 1, 0, 0, clock.Location()))
	if texts := dueEntries(); len(texts) != 1 || texts[0] != "„Geburtstag Mama“ ist am 24.11.2026 fällig" {
		t.Fatalf("early reminder in the bell: %q", texts)
	}
	for _, n := range *sent {
		if n.channel == "email" && !strings.HasPrefix(n.subject, "🔔 Erinnerung: Geburtstag Mama") {
			t.Errorf("early reminder mail subject: %q", n.subject)
		}
	}
	// The lead time (30 min) no longer applies; on the day the second reminder comes
	srv.checkAlarms(time.Date(2026, 11, 24, 8, 45, 0, 0, clock.Location()))
	if texts := dueEntries(); len(texts) != 1 {
		t.Fatalf("nothing at the lead time: %q", texts)
	}
	srv.checkAlarms(time.Date(2026, 11, 24, 9, 0, 0, 0, clock.Location()))
	if texts := dueEntries(); len(texts) != 2 {
		t.Fatalf("reminder on the day: %q", texts)
	}
}
