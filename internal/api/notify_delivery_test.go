package api

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Bundled notifications on every channel: a channel that got a digest is not sent it again when another
// fails, only the failed one is tried again (up to notifyMaxAttempts runs), and a channel with nothing to
// deliver to is not retried.
func TestNotificationRetryOnlyOnFailedChannel(t *testing.T) {
	srv, _ := notifyServer(t)
	store := srv.store
	router := srv.Router()
	bench := newAlarmBench(srv)
	srv.notifyDiscordHook = func(url, heading string, items []notifyItem) error {
		return bench.record("discord", url, heading, itemTexts(items))
	}
	srv.notifyWebhookHook = func(url, heading string, items []notifyItem) error {
		return bench.record("webhook", url, heading, itemTexts(items))
	}
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	bob, bobToken := newTestUser(t, store, "bob@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	if _, err := store.AddTaskListShare(list.ID, "user", bob.ID, "editor", owner.ID); err != nil {
		t.Fatal(err)
	}
	body := `{"discordWebhookUrl":"https://discord.com/api/webhooks/1/abc","customWebhookUrl":"https://hooks.example.com/mindsift",` +
		`"notificationSettings":{"events":{"assigned":{"email":true,"discord":true,"webhook":true,"push":true}}}}`
	if rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", bobToken, body, ""); rec.Code != http.StatusOK {
		t.Fatalf("saving the settings: %d %s", rec.Code, rec.Body.String())
	}
	assign := func(title string) {
		t.Helper()
		task, _ := store.CreateThoughtWithDetails(owner.ID, title, "normal", "manual", "", list.ID, "todo", "")
		if rec := sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"assignees":["`+bob.ID+`"]}`, ""); rec.Code != http.StatusOK {
			t.Fatalf("assign: %d %s", rec.Code, rec.Body.String())
		}
	}
	run := 0
	flush := func() {
		run++
		srv.flushNotifications(time.Now().Add(time.Duration(10+run) * time.Minute))
	}
	texts := func(channel string) []string {
		var out []string
		for _, s := range bench.sent {
			if s.channel == channel {
				out = append(out, s.text)
			}
		}
		return out
	}
	queued := func() int {
		t.Helper()
		q, err := store.QueuedNotifications(bob.ID)
		if err != nil {
			t.Fatal(err)
		}
		return len(q)
	}

	// 1. The mail fails once while Discord, webhook and push get through: the next run sends only the
	// mail, a later one nothing more
	bench.fail["email"] = errors.New("smtp: connection refused")
	assign("Keller aufräumen")
	flush()
	if bench.count("email") != 0 || bench.count("discord") != 1 || bench.count("webhook") != 1 || bench.count("push") != 1 {
		t.Fatalf("first run: %+v", bench.sent)
	}
	if queued() != 1 {
		t.Fatalf("the event waits for the mail")
	}
	delete(bench.fail, "email")
	flush()
	flush()
	for _, ch := range []string{"email", "discord", "webhook", "push"} {
		if n := bench.count(ch); n != 1 {
			t.Errorf("%s: want 1 delivery, got %d (%+v)", ch, n, bench.sent)
		}
	}
	if got := texts("email"); len(got) != 1 || !strings.Contains(got[0], "Keller aufräumen") {
		t.Fatalf("mail after the retry: %+v", got)
	}
	if queued() != 0 {
		t.Fatalf("nothing left in the queue after the retry")
	}

	// 2. A new event while Discord waits for a retry: Discord gets both in the next run, the others only
	// the new one
	bench.reset()
	bench.fail["discord"] = errors.New("HTTP Status 502")
	assign("Rasen mähen")
	flush()
	delete(bench.fail, "discord")
	assign("Hecke schneiden")
	flush()
	if got := texts("discord"); len(got) != 1 || !strings.Contains(got[0], "Rasen mähen") || !strings.Contains(got[0], "Hecke schneiden") {
		t.Fatalf("discord gets both: %+v", got)
	}
	for _, ch := range []string{"email", "webhook", "push"} {
		got := texts(ch)
		if len(got) != 2 || !strings.Contains(got[0], "Rasen mähen") || strings.Contains(got[1], "Rasen mähen") || !strings.Contains(got[1], "Hecke schneiden") {
			t.Errorf("%s: each event once: %+v", ch, got)
		}
	}

	// 3. A channel that keeps failing: dropped after notifyMaxAttempts runs, the others went out once
	bench.reset()
	bench.fail["webhook"] = errors.New("HTTP Status 500")
	assign("Fenster putzen")
	for i := 0; i < notifyMaxAttempts+2; i++ {
		flush()
	}
	if bench.count("webhook") != 0 || bench.count("email") != 1 || bench.count("discord") != 1 || bench.count("push") != 1 {
		t.Fatalf("while the webhook keeps failing: %+v", bench.sent)
	}
	if queued() != 0 {
		t.Fatalf("dropped after %d attempts", notifyMaxAttempts)
	}
	delete(bench.fail, "webhook")

	// 4. Push chosen but no device: the other channels once, nothing waits for push
	bench.reset()
	srv.notifyPushHook = func(string, pushMessage) error { return errNoPushDevice }
	assign("Blumen gießen")
	flush()
	if queued() != 0 {
		t.Fatalf("nothing to retry without a device")
	}
	flush()
	if bench.count("email") != 1 || bench.count("discord") != 1 || bench.count("webhook") != 1 || bench.count("push") != 0 {
		t.Fatalf("without a device: %+v", bench.sent)
	}
}

func itemTexts(items []notifyItem) string {
	lines := make([]string, 0, len(items))
	for _, it := range items {
		lines = append(lines, it.text)
	}
	return strings.Join(lines, "\n")
}
