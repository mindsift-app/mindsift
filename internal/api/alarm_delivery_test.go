package api

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// alarmBench records what the alarms of checkAlarms deliver on every channel; fail makes a channel
// fail until it is cleared.
type alarmBench struct {
	mu   sync.Mutex
	sent []sentNote
	fail map[string]error
}

func (b *alarmBench) record(channel, to, subject, text string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.fail[channel]; err != nil {
		return err
	}
	b.sent = append(b.sent, sentNote{channel: channel, to: to, subject: subject, text: text})
	return nil
}

// count: how many deliveries a channel had so far
func (b *alarmBench) count(channel string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := 0
	for _, s := range b.sent {
		if s.channel == channel {
			n++
		}
	}
	return n
}

func (b *alarmBench) reset() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sent, b.fail = nil, map[string]error{}
}

func newAlarmBench(srv *Server) *alarmBench {
	b := &alarmBench{fail: map[string]error{}}
	srv.notifyEmailHook = func(to, subject, text, html string) error { return b.record("email", to, subject, text) }
	srv.notifyPushHook = func(userID string, msg pushMessage) error { return b.record("push", userID, msg.Title, msg.Body) }
	srv.webhookOutHook = func(channel, url string, payload map[string]any) error {
		text := ""
		if channel == "webhook" {
			text, _ = payload["title"].(string)
		}
		return b.record(channel, url, "", text)
	}
	return b
}

// The whole way of a task alarm: the channels saved in the settings as the app saves them, each chosen
// channel delivered once, the subject and text of each, a failed channel tried again without the others
// going out twice, a pause, the channels left off, and a channel that is not set up.
func TestTaskAlarmDeliveryOnEveryChannel(t *testing.T) {
	t.Parallel()
	srv, store, _ := setupTestServer(t)
	srv.cfg.SMTPHost = "smtp.example.com" // a mail server is set up (the hook takes the mail)
	router := srv.Router()
	bench := newAlarmBench(srv)
	owner, token := newTestUser(t, store, "anna@example.com")

	// Saved like the alarm settings in the app (Kontoeinstellungen → Alarme): every channel for due tasks
	saveChannels := func(due string, paused bool) {
		t.Helper()
		body := `{"discordWebhookUrl":"https://discord.com/api/webhooks/1/abc","customWebhookUrl":"https://hooks.example.com/mindsift",` +
			`"notifyBeforeMinutes":30,"notificationSettings":{"paused":` + map[bool]string{true: "true", false: "false"}[paused] +
			`,"events":{"due":` + due + `}}}`
		if rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", token, body, ""); rec.Code != http.StatusOK {
			t.Fatalf("saving the alarm settings: %d %s", rec.Code, rec.Body.String())
		}
	}
	saveChannels(`{"email":true,"discord":true,"webhook":true,"push":true}`, false)
	if set := store.NotificationSettingsOf(owner.ID); !set.Events.Due.Email || !set.Events.Due.Push || !set.Events.Due.Discord || !set.Events.Due.Webhook {
		t.Fatalf("stored channels: %+v", set.Events.Due)
	}

	newTask := func(title, due string) *domain.Thought {
		t.Helper()
		task, err := store.CreateThoughtWithDetails(owner.ID, title, "high", "manual", due, "", "todo", "")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = store.UpdateThoughtTriage(owner.ID, task.ID, "keep", "task", "", due, "")
		return task
	}
	at := func(day, hour, min int) time.Time { return time.Date(2026, 12, day, hour, min, 0, 0, clock.Location()) }

	// 1. Due at 14:00, lead time 30 minutes: nothing before 13:30, then every channel exactly once
	newTask("Zahnarzt anrufen", "2026-12-01T14:00")
	srv.checkAlarms(at(1, 13, 29))
	if len(bench.sent) != 0 {
		t.Fatalf("before the lead time: %+v", bench.sent)
	}
	srv.checkAlarms(at(1, 13, 30))
	srv.checkAlarms(at(1, 13, 31))
	for _, ch := range []string{"email", "push", "discord", "webhook"} {
		if n := bench.count(ch); n != 1 {
			t.Errorf("%s: want 1 delivery, got %d (%+v)", ch, n, bench.sent)
		}
	}
	for _, s := range bench.sent {
		switch s.channel {
		case "email":
			if s.to != "anna@example.com" || s.subject != "⏰ Fällig: Zahnarzt anrufen" || !strings.Contains(s.text, "Zahnarzt anrufen") {
				t.Errorf("mail: %+v", s)
			}
		case "push":
			if s.to != owner.ID || s.subject != "⏰ Aufgabe fällig" || !strings.HasPrefix(s.text, "Zahnarzt anrufen – ") {
				t.Errorf("push: %+v", s)
			}
		case "discord":
			if s.to != "https://discord.com/api/webhooks/1/abc" {
				t.Errorf("discord: %+v", s)
			}
		case "webhook":
			if s.to != "https://hooks.example.com/mindsift" || s.text != "Zahnarzt anrufen" {
				t.Errorf("webhook: %+v", s)
			}
		}
	}

	// 1b. Without a mail server the mail cannot go out: it counts as failed (logged, tried again), the
	// other channels are not held back and not sent twice
	bench.reset()
	srv.cfg.SMTPHost = ""
	newTask("Kein Mailserver", "2026-12-01T18:00")
	srv.checkAlarms(at(1, 17, 30))
	srv.checkAlarms(at(1, 17, 31))
	if bench.count("email") != 0 || bench.count("push") != 1 {
		t.Fatalf("without a mail server: %+v", bench.sent)
	}
	srv.cfg.SMTPHost = "smtp.example.com"
	srv.checkAlarms(at(1, 17, 32))
	if bench.count("email") != 1 || bench.count("push") != 1 {
		t.Fatalf("mail server back within the retries: %+v", bench.sent)
	}

	// 2. The mail server fails while push gets through: the mail is tried again in the next run, the
	// push is not sent a second time
	bench.reset()
	bench.fail["email"] = errors.New("smtp: connection refused")
	newTask("Steuer abgeben", "2026-12-02T10:00")
	srv.checkAlarms(at(2, 9, 30))
	if bench.count("push") != 1 || bench.count("email") != 0 {
		t.Fatalf("first run: %+v", bench.sent)
	}
	delete(bench.fail, "email")
	srv.checkAlarms(at(2, 9, 31))
	srv.checkAlarms(at(2, 9, 32))
	if bench.count("email") != 1 || bench.count("push") != 1 || bench.count("discord") != 1 || bench.count("webhook") != 1 {
		t.Fatalf("after the retry every channel once: %+v", bench.sent)
	}

	// 3. A channel that keeps failing is given up after storage.MaxAlarmFailures runs
	bench.reset()
	bench.fail["email"] = errors.New("smtp: 550 mailbox unavailable")
	tyres := newTask("Reifen wechseln", "2026-12-03T10:00")
	for i := 0; i < storage.MaxAlarmFailures+2; i++ {
		srv.checkAlarms(at(3, 9, 30+i))
	}
	if bench.count("push") != 1 {
		t.Fatalf("push once while the mail keeps failing: %+v", bench.sent)
	}
	if n := bench.count("discord"); n != 1 {
		t.Fatalf("discord once: %d", n)
	}
	alarms, _ := store.GetDueTasksForAlarm()
	for _, a := range alarms {
		if a.TaskID == tyres.ID {
			t.Fatalf("given up after %d runs, nothing left: %+v", storage.MaxAlarmFailures, a)
		}
	}

	// 4. Push chosen but no device: skipped, the mail still goes out, nothing is retried
	bench.reset()
	srv.notifyPushHook = func(string, pushMessage) error { return errNoPushDevice }
	newTask("Blumen gießen", "2026-12-04T10:00")
	srv.checkAlarms(at(4, 9, 30))
	srv.checkAlarms(at(4, 9, 31))
	if bench.count("email") != 1 || bench.count("push") != 0 {
		t.Fatalf("without a device: %+v", bench.sent)
	}
	srv.notifyPushHook = func(userID string, msg pushMessage) error { return bench.record("push", userID, msg.Title, msg.Body) }

	// 5. Only e-mail chosen: no other channel, and the early reminder names itself in the subject
	bench.reset()
	saveChannels(`{"email":true,"discord":false,"webhook":false,"push":false}`, false)
	early := newTask("Geburtstag Mama", "2026-12-20")
	if _, err := store.SetTaskReminders(owner.ID, early.ID, []int{1440}); err != nil {
		t.Fatal(err)
	}
	srv.checkAlarms(at(19, 9, 0))
	if len(bench.sent) != 1 || bench.sent[0].channel != "email" || bench.sent[0].subject != "🔔 Erinnerung: Geburtstag Mama" {
		t.Fatalf("e-mail only, early reminder: %+v", bench.sent)
	}

	// 6. Paused: nothing goes out (the bell still gets it), and resuming does not send it late
	bench.reset()
	saveChannels(`{"email":true,"discord":true,"webhook":true,"push":true}`, true)
	newTask("Müll rausbringen", "2026-12-05T10:00")
	srv.checkAlarms(at(5, 9, 30))
	if len(bench.sent) != 0 {
		t.Fatalf("paused: %+v", bench.sent)
	}

	// 7. The mail address is the account's: a person without one (username only) gets the other channels
	bench.reset()
	ben, err := store.CreateUserWithUsername("", "ben", "hash", "Ben", "member")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetNotificationSettings(ben.ID, domain.NotificationSettings{Events: domain.NotificationEvents{Due: domain.ChannelChoice{Email: true, Push: true}}}); err != nil {
		t.Fatal(err)
	}
	benTask, _ := store.CreateThoughtWithDetails(ben.ID, "Auto waschen", "normal", "manual", "2026-12-06T10:00", "", "todo", "")
	_, _ = store.UpdateThoughtTriage(ben.ID, benTask.ID, "keep", "task", "", "2026-12-06T10:00", "")
	srv.checkAlarms(at(6, 9, 30))
	srv.checkAlarms(at(6, 9, 31))
	if bench.count("push") != 1 || bench.count("email") != 0 {
		t.Fatalf("without a mail address: %+v", bench.sent)
	}
}
