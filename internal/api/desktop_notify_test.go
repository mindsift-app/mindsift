package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// fakeNotifier stands in for the desktop app's shell (no D-Bus, no toasts in tests); fail makes Notify fail.
type fakeNotifier struct {
	mu   sync.Mutex
	got  []DesktopNotification
	fail error
}

func (f *fakeNotifier) Notify(n DesktopNotification) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail != nil {
		return f.fail
	}
	f.got = append(f.got, n)
	return nil
}

func (f *fakeNotifier) shown() []DesktopNotification {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]DesktopNotification(nil), f.got...)
}

func (f *fakeNotifier) setFail(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fail = err
}

func desktopSignIn(t *testing.T, router http.Handler) (string, domain.User) {
	t.Helper()
	var res struct {
		Token string      `json:"token"`
		User  domain.User `json:"user"`
	}
	if err := json.Unmarshal(desktopSession(t, router, desktopTestOrigin).Body.Bytes(), &res); err != nil || res.Token == "" {
		t.Fatalf("desktop session: %v", err)
	}
	return res.Token, res.User
}

func newDueTask(t *testing.T, store *storage.Store, userID, title, due string) *domain.Thought {
	t.Helper()
	task, err := store.CreateThoughtWithDetails(userID, title, "normal", "manual", due, "", "todo", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateThoughtTriage(userID, task.ID, "keep", "task", "", due, ""); err != nil {
		t.Fatal(err)
	}
	return task
}

// A local instance of the desktop app: the capability follows the shell's notifier, a new account alarms
// through the system's notifications, and a task alarm reaches the notifier once, with the task to open,
// a failed one again in the next run.
func TestDesktopNotificationsForAlarms(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	router := srv.Router()

	if caps, _ := authStatusOf(t, router)["capabilities"].(map[string]any); caps["desktopNotify"] != false {
		t.Fatalf("desktopNotify without the shell's notifier: %v", caps["desktopNotify"])
	}
	fake := &fakeNotifier{}
	srv.SetDesktopNotifier(fake)
	if caps, _ := authStatusOf(t, router)["capabilities"].(map[string]any); caps["desktopNotify"] != true || caps["push"] != false {
		t.Fatalf("capabilities with the notifier: desktopNotify %v, push %v", caps["desktopNotify"], caps["push"])
	}

	_, me := desktopSignIn(t, router)
	set := store.NotificationSettingsOf(me.ID)
	if due := set.Events.Due; !due.Desktop || due.Email || due.Discord || due.Webhook || due.Push {
		t.Errorf("task alarms of a new local instance: %+v, want only the system's notifications", due)
	}
	if ds := set.DailySummary; ds.Enabled || !ds.Desktop || ds.Email {
		t.Errorf("daily summary of a new local instance: %+v, want off, through the system's notifications", ds)
	}

	at := func(day, hour, min int) time.Time { return time.Date(2026, 12, day, hour, min, 0, 0, clock.Location()) }
	task := newDueTask(t, store, me.ID, "Zahnarzt anrufen", "2026-12-01T14:00")
	srv.checkAlarms(at(1, 13, 29)) // lead time 30 minutes
	if got := fake.shown(); len(got) != 0 {
		t.Fatalf("before the alarm time: %+v", got)
	}
	srv.checkAlarms(at(1, 13, 30))
	srv.checkAlarms(at(1, 13, 31))
	got := fake.shown()
	if len(got) != 1 {
		t.Fatalf("want one notification, got %+v", got)
	}
	if n := got[0]; n.Title != "⏰ Aufgabe fällig" || !strings.HasPrefix(n.Body, "Zahnarzt anrufen – ") || n.TaskID != task.ID || n.Tag != "task-"+task.ID {
		t.Errorf("notification: %+v", n)
	}

	// The system refuses (no notification service): tried again in the next run, then once
	fake.setFail(errors.New("org.freedesktop.Notifications not available"))
	newDueTask(t, store, me.ID, "Steuer abgeben", "2026-12-02T10:00")
	srv.checkAlarms(at(2, 9, 30))
	if n := len(fake.shown()); n != 1 {
		t.Fatalf("failed notification counted as shown: %d", n)
	}
	fake.setFail(nil)
	srv.checkAlarms(at(2, 9, 31))
	srv.checkAlarms(at(2, 9, 32))
	if got := fake.shown(); len(got) != 2 || !strings.HasPrefix(got[1].Body, "Steuer abgeben") {
		t.Fatalf("after the retry: %+v", got)
	}

	// Without the notifier (the shell took it away) the channel is not set up: skipped, not retried
	srv.SetDesktopNotifier(nil)
	newDueTask(t, store, me.ID, "Blumen gießen", "2026-12-03T10:00")
	srv.checkAlarms(at(3, 9, 30))
	srv.SetDesktopNotifier(fake)
	srv.checkAlarms(at(3, 9, 31))
	if n := len(fake.shown()); n != 2 {
		t.Fatalf("an alarm without a notifier must not come later: %d", n)
	}
}

// The test button and the daily summary go through the notifier too.
func TestDesktopNotificationTestAndSummary(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopWindows, nil)
	router := srv.Router()
	token, me := desktopSignIn(t, router)

	if rec := postJSON(t, router, "/api/v1/auth/alarms/test", token, `{"channel":"desktop"}`); rec.Code != http.StatusForbidden {
		t.Errorf("test without a notifier: %d %s, want 403", rec.Code, rec.Body.String())
	}
	fake := &fakeNotifier{}
	srv.SetDesktopNotifier(fake)
	if rec := postJSON(t, router, "/api/v1/auth/alarms/test", token, `{"channel":"desktop"}`); rec.Code != http.StatusOK {
		t.Fatalf("test: %d %s", rec.Code, rec.Body.String())
	}
	if got := fake.shown(); len(got) != 1 || got[0].Title != "Test-Alarm von MindSift" || got[0].TaskID != "" {
		t.Fatalf("test notification: %+v", got)
	}
	fake.setFail(errors.New("toast refused"))
	if rec := postJSON(t, router, "/api/v1/auth/alarms/test", token, `{"channel":"desktop"}`); rec.Code != http.StatusBadGateway {
		t.Errorf("refused test: %d, want 502", rec.Code)
	}
	fake.setFail(nil)

	n := store.NotificationSettingsOf(me.ID)
	n.DailySummary.Enabled = true
	if err := store.SetNotificationSettings(me.ID, n); err != nil {
		t.Fatal(err)
	}
	newDueTask(t, store, me.ID, "Steuererklärung abgeben", "2026-12-01")
	srv.sendDailySummaries(time.Date(2026, 12, 1, 7, 1, 0, 0, clock.Location()), nil)
	srv.sendDailySummaries(time.Date(2026, 12, 1, 7, 2, 0, 0, clock.Location()), nil)
	got := fake.shown()
	if len(got) != 2 || !strings.Contains(got[1].Body, "Steuererklärung abgeben") {
		t.Fatalf("daily summary: %+v", got)
	}
}

// Settings saved once stay as they are at the next start; a normal server takes no notifier.
func TestDesktopNotificationDefaultsKeepSavedSettings(t *testing.T) {
	store, dbPath := freshStore(t)
	srv := startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	_, me := desktopSignIn(t, srv.Router())
	n := store.NotificationSettingsOf(me.ID)
	n.Events.Due = domain.ChannelChoice{Discord: true}
	if err := store.SetNotificationSettings(me.ID, n); err != nil {
		t.Fatal(err)
	}
	srv.Close()
	startDesktop(t, store, dbPath, config.DesktopLinux, nil)
	if due := store.NotificationSettingsOf(me.ID).Events.Due; due.Desktop || !due.Discord {
		t.Errorf("saved channels after a restart: %+v", due)
	}

	server, _, _ := setupTestServer(t)
	server.SetDesktopNotifier(&fakeNotifier{})
	if server.can(capDesktopNotify) || server.notifyDesktop(DesktopNotification{Title: "x"}) == nil {
		t.Error("a normal server must not take the desktop app's notifier")
	}
}
