package api

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// slowOutage stands for a mail server or webhook host that does not answer: every attempt waits and then
// fails with a timeout, as the dialer would.
type slowOutage struct {
	mu    sync.Mutex
	down  bool
	calls int
	wait  time.Duration
}

func (o *slowOutage) try() error {
	o.mu.Lock()
	o.calls++
	down, wait := o.down, o.wait
	o.mu.Unlock()
	if !down {
		return nil
	}
	time.Sleep(wait)
	return &net.OpError{Op: "dial", Net: "tcp", Err: os.ErrDeadlineExceeded}
}

func (o *slowOutage) set(down bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.down = down
}

func (o *slowOutage) attempts() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.calls
}

func TestUnreachableTripsOnlyOnConnectionErrors(t *testing.T) {
	trips := []error{
		&net.OpError{Op: "dial", Net: "tcp", Err: errors.New("connection refused")},
		&smtpStepError{"Verbindung", &net.OpError{Op: "dial", Net: "tcp", Err: os.ErrDeadlineExceeded}},
		&net.DNSError{Err: "no such host", Name: "smtp.example.com"},
		&url.Error{Op: "Post", URL: "https://hooks.example.com", Err: os.ErrDeadlineExceeded},
	}
	for _, err := range trips {
		if !unreachable(err) {
			t.Errorf("want unreachable: %v", err)
		}
	}
	keeps := []error{
		nil,
		errors.New("HTTP Status 500"),
		&smtpStepError{"RCPT TO", errors.New("550 mailbox unavailable")},
		&url.Error{Op: "Post", URL: "https://hooks.example.com", Err: errors.New("stopped after 10 redirects")},
	}
	for _, err := range keeps {
		if unreachable(err) {
			t.Errorf("want reachable: %v", err)
		}
	}
}

// A mail server and a webhook host that are down hold up the digest run once each, not once per
// recipient: the other recipients' channels go out in the same run, the skipped mails and webhooks wait
// for a later run without using up their attempts, and go out once the targets are back.
func TestDigestsGoOnPastATargetThatIsDown(t *testing.T) {
	srv, _ := notifyServer(t)
	store := srv.store
	router := srv.Router()
	bench := newAlarmBench(srv)
	const wait = 400 * time.Millisecond
	mail := &slowOutage{down: true, wait: wait}
	hooks := &slowOutage{down: true, wait: wait}
	srv.notifyEmailHook = func(to, subject, text, html string) error {
		if err := mail.try(); err != nil {
			return err
		}
		return bench.record("email", to, subject, text)
	}
	srv.notifyWebhookHook = func(u, heading string, items []notifyItem) error {
		if host, _ := url.Parse(u); host.Host == "down.example.com" {
			if err := hooks.try(); err != nil {
				return err
			}
		}
		return bench.record("webhook", u, heading, itemTexts(items))
	}
	owner, ownerToken := newTestUser(t, store, "owner@example.com")
	list, _ := store.CreateTaskList(owner.ID, "", "", "Haushalt", "🏠", "#000000")
	var people []*domain.User
	for _, p := range []struct{ email, hook string }{
		{"bob@example.com", "https://down.example.com/bob"},
		{"carol@example.com", "https://down.example.com/carol"},
		{"dave@example.com", "https://up.example.com/dave"},
	} {
		u, token := newTestUser(t, store, p.email)
		people = append(people, u)
		if _, err := store.AddTaskListShare(list.ID, "user", u.ID, "editor", owner.ID); err != nil {
			t.Fatal(err)
		}
		body := `{"customWebhookUrl":"` + p.hook + `","notificationSettings":{"events":{"assigned":{"email":true,"webhook":true,"push":true}}}}`
		if rec := sessionCall(router, "PATCH", "/api/v1/auth/settings", token, body, ""); rec.Code != http.StatusOK {
			t.Fatalf("saving the settings: %d %s", rec.Code, rec.Body.String())
		}
		task, _ := store.CreateThoughtWithDetails(owner.ID, "Aufgabe für "+p.email, "normal", "manual", "", list.ID, "todo", "")
		if rec := sessionCall(router, "PATCH", "/api/v1/thoughts/"+task.ID, ownerToken, `{"assignees":["`+u.ID+`"]}`, ""); rec.Code != http.StatusOK {
			t.Fatalf("assign: %d %s", rec.Code, rec.Body.String())
		}
	}
	attempts := func() (sum, untouched int) {
		t.Helper()
		for _, u := range people {
			q, err := store.QueuedNotifications(u.ID)
			if err != nil || len(q) != 1 {
				t.Fatalf("queue of %s: %+v %v", u.Email, q, err)
			}
			sum += q[0].Attempts
			if q[0].Attempts == 0 {
				untouched++
			}
		}
		return sum, untouched
	}
	run := 0
	flush := func() time.Duration {
		run++
		start := time.Now()
		srv.runNotificationJobs(time.Now().Add(time.Duration(10+run) * time.Minute))
		return time.Since(start)
	}

	// 1. Both down: one attempt at the mail server and one at the webhook host, everything else goes out
	// in the same run (push for all three, the webhook on the other host)
	took := flush()
	if mail.attempts() != 1 || hooks.attempts() != 1 {
		t.Fatalf("one attempt per target and run: mail %d, webhook host %d", mail.attempts(), hooks.attempts())
	}
	if took >= 4*wait {
		t.Errorf("the run waited for every recipient: %v", took)
	}
	if bench.count("push") != 3 || bench.count("webhook") != 1 || bench.count("email") != 0 {
		t.Fatalf("first run: %+v", bench.sent)
	}
	// Only the recipients that were really tried count an attempt (one per target at most)
	if sum, untouched := attempts(); sum < 1 || sum > 2 || untouched < 1 {
		t.Fatalf("attempts after the first run: sum %d, untouched %d", sum, untouched)
	}

	// 2. Still down: again one attempt each, nothing sent twice
	flush()
	if mail.attempts() != 2 || hooks.attempts() != 2 || bench.count("push") != 3 || bench.count("webhook") != 1 {
		t.Fatalf("second run: mail %d, webhook host %d, %+v", mail.attempts(), hooks.attempts(), bench.sent)
	}
	if sum, untouched := attempts(); sum > 4 || untouched < 1 {
		t.Fatalf("attempts after the second run: sum %d, untouched %d", sum, untouched)
	}

	// 3. Back: every skipped mail and webhook goes out, nothing twice, the queues are empty
	mail.set(false)
	hooks.set(false)
	flush()
	if bench.count("email") != 3 || bench.count("webhook") != 3 || bench.count("push") != 3 {
		t.Fatalf("after the outage every channel once: %+v", bench.sent)
	}
	for _, u := range people {
		if q, _ := store.QueuedNotifications(u.ID); len(q) != 0 {
			t.Fatalf("queue of %s not empty: %+v", u.Email, q)
		}
	}
}

// Task alarms: a mail server that is down is tried once per run, the other alarms' pushes go out in the
// same run and their mails come in a later one; an outage longer than MaxAlarmFailures runs gives up at
// most the alarms that were really tried, not every alarm that was skipped.
func TestTaskAlarmsGoOnPastAMailServerThatIsDown(t *testing.T) {
	srv, store, _ := setupTestServer(t)
	srv.cfg.SMTPHost = "smtp.example.com"
	bench := newAlarmBench(srv)
	const wait = 400 * time.Millisecond
	mail := &slowOutage{down: true, wait: wait}
	srv.notifyEmailHook = func(to, subject, text, html string) error {
		if err := mail.try(); err != nil {
			return err
		}
		return bench.record("email", to, subject, text)
	}
	at := func(day, hour, min int) time.Time { return time.Date(2026, 12, day, hour, min, 0, 0, clock.Location()) }
	addTasks := func(due string) {
		t.Helper()
		for _, email := range []string{"anna@example.com", "ben@example.com", "cleo@example.com"} {
			u, err := store.GetUserByEmail(email)
			if err != nil || u == nil {
				u, _ = newTestUser(t, store, email)
				if err := store.SetNotificationSettings(u.ID, domain.NotificationSettings{Events: domain.NotificationEvents{Due: domain.ChannelChoice{Email: true, Push: true}}}); err != nil {
					t.Fatal(err)
				}
			}
			task, err := store.CreateThoughtWithDetails(u.ID, "Termin von "+email, "normal", "manual", due, "", "todo", "")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = store.UpdateThoughtTriage(u.ID, task.ID, "keep", "task", "", due, "")
		}
	}

	// 1. Down in the first run: one attempt, three pushes, quickly; back in the next run: three mails
	addTasks("2026-12-10T10:00")
	start := time.Now()
	srv.checkAlarms(at(10, 9, 30))
	if took := time.Since(start); took >= 3*wait {
		t.Errorf("the run waited for every alarm: %v", took)
	}
	if mail.attempts() != 1 || bench.count("push") != 3 || bench.count("email") != 0 {
		t.Fatalf("first run: %d mail attempts, %+v", mail.attempts(), bench.sent)
	}
	mail.set(false)
	srv.checkAlarms(at(10, 9, 31))
	srv.checkAlarms(at(10, 9, 32))
	if bench.count("email") != 3 || bench.count("push") != 3 {
		t.Fatalf("after the outage every channel once: %+v", bench.sent)
	}

	// 2. Down for longer than MaxAlarmFailures runs: one attempt per run, so at most one alarm is given up;
	// the others still get their mail once the server is back
	bench.reset()
	mail.set(true)
	before := mail.attempts()
	addTasks("2026-12-11T10:00")
	for i := 0; i < storage.MaxAlarmFailures; i++ {
		srv.checkAlarms(at(11, 9, 30+i))
	}
	if n := mail.attempts() - before; n != storage.MaxAlarmFailures {
		t.Fatalf("one attempt per run: %d", n)
	}
	mail.set(false)
	srv.checkAlarms(at(11, 9, 40))
	srv.checkAlarms(at(11, 9, 41))
	if n := bench.count("email"); n < 2 {
		t.Fatalf("skipped alarms are not given up: %d mails after the outage (%+v)", n, bench.sent)
	}
	if bench.count("push") != 3 {
		t.Fatalf("push once each: %+v", bench.sent)
	}
}

// Daily summaries: the mail server is tried once per run; a summary whose mail was only skipped goes out
// in the next run, one whose attempt failed waits dailySummaryRetryEvery as before.
func TestDailySummariesGoOnPastAMailServerThatIsDown(t *testing.T) {
	srv, _ := notifyServer(t)
	store := srv.store
	bench := newAlarmBench(srv)
	mail := &slowOutage{down: true, wait: 100 * time.Millisecond}
	srv.notifyEmailHook = func(to, subject, text, html string) error {
		if err := mail.try(); err != nil {
			return err
		}
		return bench.record("email", to, subject, text)
	}
	for _, email := range []string{"anna@example.com", "ben@example.com"} {
		u, _ := newTestUser(t, store, email)
		set := domain.NotificationSettings{DailySummary: domain.DailySummary{Enabled: true, Time: "07:00", Email: true, Push: true}}
		if err := store.SetNotificationSettings(u.ID, set); err != nil {
			t.Fatal(err)
		}
		th, _ := store.CreateThoughtWithDetails(u.ID, "Steuererklärung abgeben", "normal", "manual", "2026-12-01", "", "todo", "")
		if _, err := store.UpdateThoughtTriage(u.ID, th.ID, "keep", "task", "", "2026-12-01", ""); err != nil {
			t.Fatal(err)
		}
	}
	at := func(hour, min int) time.Time { return time.Date(2026, 12, 1, hour, min, 0, 0, clock.Location()) }

	srv.runNotificationJobs(at(7, 0))
	if mail.attempts() != 1 || bench.count("push") != 2 || bench.count("email") != 0 {
		t.Fatalf("first run: %d mail attempts, %+v", mail.attempts(), bench.sent)
	}
	mail.set(false)
	srv.runNotificationJobs(at(7, 1))
	if bench.count("email") != 1 {
		t.Fatalf("the skipped summary goes out in the next run: %+v", bench.sent)
	}
	for m := 2; m < 5; m++ {
		srv.runNotificationJobs(at(7, m))
	}
	if bench.count("email") != 1 {
		t.Fatalf("the failed one waits for its retry: %+v", bench.sent)
	}
	srv.runNotificationJobs(at(7, 5))
	srv.runNotificationJobs(at(7, 6))
	if bench.count("email") != 2 || bench.count("push") != 2 {
		t.Fatalf("every channel once: %+v", bench.sent)
	}
}
