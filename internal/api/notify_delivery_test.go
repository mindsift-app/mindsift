package api

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
)

// Bundled notifications on every channel: a channel that got a digest is not sent it again when another
// fails, only the failed one is tried again (up to notifyMaxAttempts runs), and a channel with nothing to
// deliver to is not retried.
func TestNotificationRetryOnlyOnFailedChannel(t *testing.T) {
	t.Parallel()
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
		srv.flushNotifications(time.Now().Add(time.Duration(10+run)*time.Minute), nil)
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

// The daily summary on every channel: a channel that failed is tried again in the next runs within the
// summary's window, alone; one that keeps failing is given up at the end of the window, and push without
// a device is not retried.
func TestDailySummaryRetryOnlyOnFailedChannel(t *testing.T) {
	t.Parallel()
	srv, _ := notifyServer(t)
	store := srv.store
	router := srv.Router()
	bench := newAlarmBench(srv)
	srv.notifyDiscordHook = func(url, heading string, items []notifyItem) error {
		return bench.record("discord", url, heading, itemTexts(items))
	}
	tries := map[string]int{} // attempts per channel, failed ones included
	srv.notifyWebhookHook = func(url, heading string, items []notifyItem) error {
		tries["webhook"]++
		return bench.record("webhook", url, heading, itemTexts(items))
	}
	srv.notifyEmailHook = func(to, subject, text, html string) error {
		tries["email"]++
		return bench.record("email", to, subject, text)
	}
	me, token := newTestUser(t, store, "morgen@example.com")
	body := `{"discordWebhookUrl":"https://discord.com/api/webhooks/1/abc","customWebhookUrl":"https://hooks.example.com/mindsift",` +
		`"notificationSettings":{"dailySummary":{"enabled":true,"time":"07:00","email":true,"discord":true,"webhook":true,"push":true}}}`
	if rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", token, body, ""); rec.Code != http.StatusOK {
		t.Fatalf("saving the settings: %d %s", rec.Code, rec.Body.String())
	}
	if ds := store.NotificationSettingsOf(me.ID).DailySummary; !ds.Enabled || !ds.Email || !ds.Discord || !ds.Webhook || !ds.Push {
		t.Fatalf("stored summary settings: %+v", ds)
	}
	th, _ := store.CreateThoughtWithDetails(me.ID, "Steuererklärung abgeben", "normal", "manual", "2026-12-01", "", "todo", "")
	if _, err := store.UpdateThoughtTriage(me.ID, th.ID, "keep", "task", "", "2026-12-01", ""); err != nil {
		t.Fatal(err)
	}
	at := func(day, hour, min int) time.Time { return time.Date(2026, 12, day, hour, min, 0, 0, clock.Location()) }
	counts := func(want map[string]int) {
		t.Helper()
		for _, ch := range []string{"email", "discord", "webhook", "push"} {
			if n := bench.count(ch); n != want[ch] {
				t.Errorf("%s: want %d deliveries, got %d (%+v)", ch, want[ch], n, bench.sent)
			}
		}
	}

	// 1. The mail fails at 07:00 while Discord, webhook and push get through: the retry waits 5 minutes,
	// then sends only the mail, later runs nothing more
	bench.fail["email"] = errors.New("smtp: connection refused")
	srv.sendDailySummaries(at(1, 7, 0), nil)
	counts(map[string]int{"discord": 1, "webhook": 1, "push": 1})
	delete(bench.fail, "email")
	for m := 1; m < 5; m++ {
		srv.sendDailySummaries(at(1, 7, m), nil)
	}
	counts(map[string]int{"discord": 1, "webhook": 1, "push": 1})
	srv.sendDailySummaries(at(1, 7, 5), nil)
	srv.sendDailySummaries(at(1, 7, 10), nil)
	srv.sendDailySummaries(at(1, 7, 40), nil)
	counts(map[string]int{"email": 1, "discord": 1, "webhook": 1, "push": 1})
	for _, s := range bench.sent {
		if s.channel == "email" && (!strings.Contains(s.text, "Steuererklärung abgeben") || !strings.Contains(s.text, "Guten Morgen")) {
			t.Fatalf("mail after the retry: %q", s.text)
		}
	}

	// 2. The webhook keeps failing: with a run every minute it is tried every 5 minutes within the window
	// (6 times), given up after 07:30; the others went out once
	bench.reset()
	clear(tries)
	bench.fail["webhook"] = errors.New("HTTP Status 500")
	for m := 0; m < 30; m++ {
		srv.sendDailySummaries(at(2, 7, m), nil)
	}
	if retry, claimed := store.DailySummaryRetry(me.ID, "2026-12-02"); !claimed || len(retry) != 1 || retry[0] != "webhook" {
		t.Fatalf("within the window the webhook waits: %v %v", retry, claimed)
	}
	if tries["webhook"] != 6 {
		t.Errorf("webhook attempts in the window: want 6, got %d", tries["webhook"])
	}
	srv.sendDailySummaries(at(2, 7, 30), nil)
	if retry, _ := store.DailySummaryRetry(me.ID, "2026-12-02"); len(retry) != 0 {
		t.Fatalf("given up after the window: %v", retry)
	}
	delete(bench.fail, "webhook")
	srv.sendDailySummaries(at(2, 7, 31), nil)
	counts(map[string]int{"email": 1, "discord": 1, "push": 1})

	// 3. Push chosen but no device: the other channels once, nothing waits for push
	bench.reset()
	srv.notifyPushHook = func(string, pushMessage) error { return errNoPushDevice }
	srv.sendDailySummaries(at(3, 7, 0), nil)
	if retry, claimed := store.DailySummaryRetry(me.ID, "2026-12-03"); !claimed || len(retry) != 0 {
		t.Fatalf("nothing to retry without a device: %v %v", retry, claimed)
	}
	srv.sendDailySummaries(at(3, 7, 1), nil)
	counts(map[string]int{"email": 1, "discord": 1, "webhook": 1})

	// 4. Chosen time 23:50, the window runs past midnight: the retries of the 4th go on after the day
	// changed, the mail of the 4th arrives at 00:00, and the summary of the 5th still goes out at 23:50
	body = `{"notificationSettings":{"dailySummary":{"enabled":true,"time":"23:50","email":true}}}`
	if rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", token, body, ""); rec.Code != http.StatusOK {
		t.Fatalf("saving the settings: %d %s", rec.Code, rec.Body.String())
	}
	bench.reset()
	clear(tries)
	bench.fail["email"] = errors.New("smtp: connection refused")
	srv.sendDailySummaries(at(4, 23, 49), nil)
	srv.sendDailySummaries(at(4, 23, 50), nil)
	srv.sendDailySummaries(at(4, 23, 52), nil)
	srv.sendDailySummaries(at(4, 23, 55), nil)
	if tries["email"] != 2 {
		t.Fatalf("attempts before midnight: want 2, got %d", tries["email"])
	}
	delete(bench.fail, "email")
	srv.sendDailySummaries(at(4, 23, 59), nil)
	srv.sendDailySummaries(at(5, 0, 0), nil)
	srv.sendDailySummaries(at(5, 0, 5), nil)
	srv.sendDailySummaries(at(5, 12, 0), nil)
	counts(map[string]int{"email": 1})
	if retry, claimed := store.DailySummaryRetry(me.ID, "2026-12-04"); !claimed || len(retry) != 0 {
		t.Fatalf("the summary of the 4th after midnight: %v %v", retry, claimed)
	}
	srv.sendDailySummaries(at(5, 23, 50), nil)
	counts(map[string]int{"email": 2})

	// 5. The mail keeps failing past midnight: tried every 5 minutes until 00:20, then given up
	bench.reset()
	clear(tries)
	bench.fail["email"] = errors.New("smtp: connection refused")
	for m := 50; m < 60; m++ {
		srv.sendDailySummaries(at(6, 23, m), nil)
	}
	for m := 0; m < 20; m++ {
		srv.sendDailySummaries(at(7, 0, m), nil)
	}
	if retry, claimed := store.DailySummaryRetry(me.ID, "2026-12-06"); !claimed || len(retry) != 1 || retry[0] != "email" {
		t.Fatalf("until 00:20 the mail of the 6th waits: %v %v", retry, claimed)
	}
	if tries["email"] != 6 {
		t.Errorf("mail attempts in the window past midnight: want 6, got %d", tries["email"])
	}
	srv.sendDailySummaries(at(7, 0, 20), nil)
	if retry, _ := store.DailySummaryRetry(me.ID, "2026-12-06"); len(retry) != 0 {
		t.Fatalf("given up at the end of the window past midnight: %v", retry)
	}
	delete(bench.fail, "email")
	srv.sendDailySummaries(at(7, 0, 25), nil)
	srv.sendDailySummaries(at(7, 23, 49), nil)
	if tries["email"] != 6 {
		t.Errorf("nothing more after giving up: %d attempts", tries["email"])
	}
}

func TestDailySummarySlotAcrossMidnight(t *testing.T) {
	t.Parallel()
	loc := clock.Location()
	cases := []struct {
		now     time.Time
		chosen  string
		wantDay string
		wantAt  string
	}{
		{time.Date(2026, 12, 4, 7, 10, 0, 0, loc), "07:00", "2026-12-04", "07:00"},
		{time.Date(2026, 12, 4, 6, 59, 0, 0, loc), "07:00", "", ""}, // yesterday's window ended the same day
		{time.Date(2026, 12, 4, 23, 55, 0, 0, loc), "23:50", "2026-12-04", "23:50"},
		{time.Date(2026, 12, 5, 0, 10, 0, 0, loc), "23:50", "2026-12-04", "23:50"},
		{time.Date(2026, 12, 5, 9, 0, 0, 0, loc), "23:50", "2026-12-04", "23:50"},  // over: only gives up leftovers
		{time.Date(2026, 12, 5, 0, 10, 0, 0, loc), "23:30", "2026-12-04", "23:30"}, // ends at midnight: gives up there
		{time.Date(2026, 12, 5, 0, 10, 0, 0, loc), "23:29", "", ""},
		{time.Date(2027, 1, 1, 0, 5, 0, 0, loc), "23:45", "2026-12-31", "23:45"},
	}
	for _, c := range cases {
		day, at, ok := dailySummarySlot(c.now, c.chosen)
		if c.wantDay == "" {
			if ok {
				t.Errorf("%s with %s: want no slot, got %s %s", c.now.Format("2006-01-02 15:04"), c.chosen, day, at)
			}
			continue
		}
		if !ok || day != c.wantDay || at.Format("15:04") != c.wantAt || at.Format("2006-01-02") != c.wantDay {
			t.Errorf("%s with %s: want %s %s, got %s %s %v", c.now.Format("2006-01-02 15:04"), c.chosen, c.wantDay, c.wantAt, day, at, ok)
		}
	}
}
