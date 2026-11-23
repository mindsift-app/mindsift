package api

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// pushServices stands for the push services of the devices: a host that is down waits and fails with a
// timeout, as the dialer would; the others take every message.
type pushServices struct {
	mu    sync.Mutex
	down  map[string]bool
	tried map[string]int
	got   []string // endpoints that received a message
	wait  time.Duration
}

func (p *pushServices) RoundTrip(r *http.Request) (*http.Response, error) {
	p.mu.Lock()
	p.tried[r.URL.Host]++
	down := p.down[r.URL.Host]
	if !down {
		p.got = append(p.got, r.URL.String())
	}
	p.mu.Unlock()
	if down {
		time.Sleep(p.wait)
		return nil, &net.OpError{Op: "dial", Net: "tcp", Err: os.ErrDeadlineExceeded}
	}
	return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
}

func (p *pushServices) setDown(host string, down bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.down[host] = down
}

func (p *pushServices) attempts(host string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.tried[host]
}

// received: how many messages reached endpoints containing part
func (p *pushServices) received(part string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, e := range p.got {
		if strings.Contains(e, part) {
			n++
		}
	}
	return n
}

func newPushServices(srv *Server, wait time.Duration) *pushServices {
	p := &pushServices{down: map[string]bool{}, tried: map[string]int{}, wait: wait}
	srv.notifyPushHook = nil
	srv.pushHTTPClient = &http.Client{Transport: p}
	return p
}

// addPushDevice registers a device with real keys (the payload is encrypted for it) at endpoint.
func addPushDevice(t *testing.T, store *storage.Store, userID, endpoint string) {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 16)
	_, _ = rand.Read(secret)
	b64 := base64.RawURLEncoding
	if err := store.SavePushSubscription(userID, endpoint, b64.EncodeToString(key.PublicKey().Bytes()), b64.EncodeToString(secret), "Test"); err != nil {
		t.Fatal(err)
	}
}

// Task alarms by push: a push service that is down is tried once per run, the devices on other push
// services get their alarm in the same run; a device skipped on the down service gets it once the
// service is back, and an outage longer than MaxAlarmFailures runs gives up only the alarm that was
// really tried.
func TestTaskAlarmPushGoesOnPastAPushServiceThatIsDown(t *testing.T) {
	t.Parallel()
	srv, store, _ := setupTestServer(t)
	const wait = 300 * time.Millisecond
	push := newPushServices(srv, wait)
	push.setDown("down.push.example", true)
	devices := map[string][]string{
		"anna@example.com": {"https://down.push.example/anna"},
		"ben@example.com":  {"https://down.push.example/ben"},
		"cleo@example.com": {"https://up.push.example/cleo"},
		// one device on each: the alarm is delivered by the one that is up
		"dora@example.com": {"https://down.push.example/dora", "https://up.push.example/dora"},
	}
	for email, endpoints := range devices {
		u, _ := newTestUser(t, store, email)
		if err := store.SetNotificationSettings(u.ID, domain.NotificationSettings{Events: domain.NotificationEvents{Due: domain.ChannelChoice{Push: true}}}); err != nil {
			t.Fatal(err)
		}
		for _, e := range endpoints {
			addPushDevice(t, store, u.ID, e)
		}
		task, _ := store.CreateThoughtWithDetails(u.ID, "Termin von "+email, "normal", "manual", "2026-12-10T10:00", "", "todo", "")
		_, _ = store.UpdateThoughtTriage(u.ID, task.ID, "keep", "task", "", "2026-12-10T10:00", "")
	}
	at := func(min int) time.Time { return time.Date(2026, 12, 10, 9, min, 0, 0, clock.Location()) }

	start := time.Now()
	srv.checkAlarms(at(30))
	if took := time.Since(start); took >= 2*wait {
		t.Errorf("the run waited for every device on the down push service: %v", took)
	}
	if n := push.attempts("down.push.example"); n != 1 {
		t.Fatalf("one attempt at the down push service per run: %d", n)
	}
	if push.received("/cleo") != 1 || push.received("/dora") != 1 {
		t.Fatalf("the devices on the other push service get their alarm in the same run: %v", push.got)
	}

	// Down for MaxAlarmFailures runs in all: still one attempt per run
	for i := 1; i < storage.MaxAlarmFailures; i++ {
		srv.checkAlarms(at(30 + i))
	}
	if n := push.attempts("down.push.example"); n != storage.MaxAlarmFailures {
		t.Fatalf("one attempt per run: %d", n)
	}
	push.setDown("down.push.example", false)
	srv.checkAlarms(at(40))
	srv.checkAlarms(at(41))
	if n := push.received("/anna") + push.received("/ben"); n < 1 {
		t.Fatalf("the skipped alarm is not given up: %v", push.got)
	}
	if push.received("/cleo") != 1 || push.received("/dora") != 1 {
		t.Fatalf("an alarm that got through goes out once: %v", push.got)
	}
}

// Digests by push: the down push service is tried for one recipient per run; the others' events wait
// without counting an attempt and go out once the service is back.
func TestDigestPushGoesOnPastAPushServiceThatIsDown(t *testing.T) {
	t.Parallel()
	srv, _ := notifyServer(t)
	store := srv.store
	push := newPushServices(srv, 100*time.Millisecond)
	push.setDown("down.push.example", true)
	var people []*domain.User
	for _, name := range []string{"anna", "ben", "cleo"} {
		u, _ := newTestUser(t, store, name+"@example.com")
		people = append(people, u)
		if err := store.SetNotificationSettings(u.ID, domain.NotificationSettings{Events: domain.NotificationEvents{Assigned: domain.ChannelChoice{Push: true}}}); err != nil {
			t.Fatal(err)
		}
		addPushDevice(t, store, u.ID, "https://down.push.example/"+name)
		if err := store.QueueNotification(u.ID, "assigned", map[string]string{"title": "Einkauf", "text": "Dir wurde „Einkauf“ zugewiesen"}); err != nil {
			t.Fatal(err)
		}
	}
	srv.flushNotifications(time.Now().Add(10*time.Minute), nil)
	if n := push.attempts("down.push.example"); n != 1 {
		t.Fatalf("one attempt per run: %d", n)
	}
	sum := 0
	for _, u := range people {
		q, err := store.QueuedNotifications(u.ID)
		if err != nil || len(q) != 1 {
			t.Fatalf("queue of %s: %+v %v", u.Email, q, err)
		}
		sum += q[0].Attempts
	}
	if sum != 1 {
		t.Fatalf("only the recipient really tried counts an attempt: %d", sum)
	}
	push.setDown("down.push.example", false)
	srv.flushNotifications(time.Now().Add(11*time.Minute), nil)
	for _, u := range people {
		if q, _ := store.QueuedNotifications(u.ID); len(q) != 0 {
			t.Fatalf("queue of %s not empty: %+v", u.Email, q)
		}
	}
	if push.received("/anna") != 1 || push.received("/ben") != 1 || push.received("/cleo") != 1 {
		t.Fatalf("every device once: %v", push.got)
	}
}

// The test push in the settings has no circuit breaker: every device is tried, even after the first
// one's push service did not answer.
func TestPushTestTriesEveryDevice(t *testing.T) {
	t.Parallel()
	srv, store, _ := setupTestServer(t)
	push := newPushServices(srv, 10*time.Millisecond)
	push.setDown("down.push.example", true)
	u, _ := newTestUser(t, store, "anna@example.com")
	addPushDevice(t, store, u.ID, "https://down.push.example/1")
	addPushDevice(t, store, u.ID, "https://down.push.example/2")
	if err := srv.sendPush(u.ID, pushMessage{Title: "MindSift", Body: "Test"}); err == nil || skipped(err) {
		t.Fatalf("want the push service's error: %v", err)
	}
	if n := push.attempts("down.push.example"); n != 2 {
		t.Fatalf("both devices tried: %d", n)
	}
}

// Events that still miss a channel after 2 days are dropped, also those the circuit breaker only ever
// skipped and that never counted an attempt; younger ones wait.
func TestQueuedNotificationsDroppedAfterTwoDays(t *testing.T) {
	srv, _ := notifyServer(t)
	store := srv.store
	mail := &slowOutage{down: true, wait: 10 * time.Millisecond}
	srv.notifyEmailHook = func(to, subject, text, html string) error { return mail.try() }
	var people []*domain.User
	for _, name := range []string{"anna", "ben"} {
		u, _ := newTestUser(t, store, name+"@example.com")
		people = append(people, u)
		if err := store.SetNotificationSettings(u.ID, domain.NotificationSettings{Events: domain.NotificationEvents{Assigned: domain.ChannelChoice{Email: true}}}); err != nil {
			t.Fatal(err)
		}
		if err := store.QueueNotification(u.ID, "assigned", map[string]string{"title": "Einkauf", "text": "Dir wurde „Einkauf“ zugewiesen"}); err != nil {
			t.Fatal(err)
		}
	}
	queued := func() int {
		n := 0
		for _, u := range people {
			q, _ := store.QueuedNotifications(u.ID)
			n += len(q)
		}
		return n
	}
	start := time.Now()
	srv.flushNotifications(start.Add(10*time.Minute), nil)
	srv.flushNotifications(start.Add(47*time.Hour), nil)
	if n := queued(); n != 2 {
		t.Fatalf("younger than 2 days: both wait, %d queued", n)
	}
	srv.flushNotifications(start.Add(notifyMaxAge+time.Minute), nil)
	if n := queued(); n != 0 {
		t.Fatalf("older than 2 days: dropped, %d queued", n)
	}
}

// The alarm mail greets by the time of the alarm run, not by the clock.
func TestAlarmMailGreetsByTheRunTime(t *testing.T) {
	t.Parallel()
	srv, store, _ := setupTestServer(t)
	srv.cfg.SMTPHost = "smtp.example.com"
	bench := newAlarmBench(srv)
	u, _ := newTestUser(t, store, "anna@example.com")
	if err := store.SetNotificationSettings(u.ID, domain.NotificationSettings{Events: domain.NotificationEvents{Due: domain.ChannelChoice{Email: true}}}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		due   string
		hour  int
		greet string
	}{{"2026-12-10T07:00", 7, "Guten Morgen"}, {"2026-12-10T14:00", 14, "Hallo"}, {"2026-12-10T20:00", 20, "Guten Abend"}} {
		task, _ := store.CreateThoughtWithDetails(u.ID, "Termin um "+c.due, "normal", "manual", c.due, "", "todo", "")
		_, _ = store.UpdateThoughtTriage(u.ID, task.ID, "keep", "task", "", c.due, "")
		bench.reset()
		srv.checkAlarms(time.Date(2026, 12, 10, c.hour, 0, 0, 0, clock.Location()))
		bench.mu.Lock()
		sent := bench.sent
		bench.mu.Unlock()
		if len(sent) != 1 || !strings.Contains(sent[0].text, c.greet+", anna") {
			t.Fatalf("%02d:00: want %q, got %+v", c.hour, c.greet, sent)
		}
	}
}
