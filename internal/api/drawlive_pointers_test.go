package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mindsift-app/mindsift/internal/domain"
)

// fakeTimers stands in for time.AfterFunc: the bundles of pointers go out when the test fires them.
type fakeTimers struct {
	mu      sync.Mutex
	pending []*fakeTimer
}

type fakeTimer struct {
	f       func()
	stopped bool
}

// Stop is called holding drawHub.mu, as fire checks it after taking that lock
func (t *fakeTimer) Stop() bool { t.stopped = true; return true }

func (ft *fakeTimers) afterFunc(_ time.Duration, f func()) stopper {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	t := &fakeTimer{f: f}
	ft.pending = append(ft.pending, t)
	return t
}

// fire runs the timers started so far (not those they start themselves); it returns how many ran.
func (ft *fakeTimers) fire(d *drawHub) int {
	ft.mu.Lock()
	due := ft.pending
	ft.pending = nil
	ft.mu.Unlock()
	n := 0
	for _, t := range due {
		d.mu.Lock()
		stopped := t.stopped
		d.mu.Unlock()
		if !stopped {
			t.f()
			n++
		}
	}
	return n
}

// nextDraw reads the next DRAW_* event of a connection.
func nextDraw(t *testing.T, conn *websocket.Conn) sseMsg {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		var m sseMsg
		if err := conn.ReadJSON(&m); err != nil {
			t.Fatalf("reading: %v", err)
		}
		if strings.HasPrefix(m.Event, "DRAW_") {
			return m
		}
	}
}

// pointersOf reads the next DRAW_* event, which must be a bundle, as "from:x" pairs.
func pointersOf(t *testing.T, conn *websocket.Conn) string {
	t.Helper()
	m := nextDraw(t, conn)
	if m.Event != "DRAW_POINTERS" {
		t.Fatalf("expected DRAW_POINTERS, got %s %s", m.Event, m.Payload)
	}
	var b struct {
		Pointers []struct {
			From string  `json:"from"`
			X    float64 `json:"x"`
		} `json:"pointers"`
	}
	if err := json.Unmarshal(m.Payload, &b); err != nil {
		t.Fatalf("bundle %s: %v", m.Payload, err)
	}
	var out []string
	for _, p := range b.Pointers {
		out = append(out, fmt.Sprintf("%s:%g", p.From, p.X))
	}
	return strings.Join(out, " ")
}

// Pointers go out bundled: one DRAW_POINTERS per receiver and tick with everyone's latest pointer but its
// own; a pointer after a quiet tick goes out at once; changes keep their own way and order; a quiet tick
// and the end of the session stop the timer.
func TestLiveDrawingPointersAreBundled(t *testing.T) {
	srv, store, ts, owner, ownerToken := startRealtimeServer(t)
	timers := &fakeTimers{}
	srv.draw.mu.Lock()
	srv.draw.afterFunc = timers.afterFunc
	srv.draw.mu.Unlock()
	ben, benToken := newTestUser(t, store, "draw-ben@example.com")
	cleo, cleoToken := newTestUser(t, store, "draw-cleo@example.com")
	doc, err := store.CreateDocument(owner.ID, "", "Skizze", "", "", []domain.DocumentBlock{{ID: "d_b1", Type: "drawing", Content: drawBase}}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []*domain.User{ben, cleo} {
		if _, err := store.CreateDocShare(owner.ID, doc.ID, u.ID, "write"); err != nil {
			t.Fatal(err)
		}
	}
	at := func(extra map[string]any) map[string]any {
		p := map[string]any{"docId": doc.ID, "blockId": "d_b1", "base": drawBase}
		for k, v := range extra {
			p[k] = v
		}
		return p
	}
	conns := map[string]*websocket.Conn{}
	ids := map[string]string{}
	for _, who := range []struct{ name, token string }{{"anna", ownerToken}, {"ben", benToken}, {"cleo", cleoToken}} {
		c := dialWS(t, ts, who.token)
		sendDraw(t, c, "DRAW_JOIN", at(nil))
		ids[who.name] = readDraw(t, c, "DRAW_STATE").You
		conns[who.name] = c
	}
	anna, bc, cc := conns["anna"], conns["ben"], conns["cleo"]
	// Everything before (DRAW_PEOPLE of those who joined later, acks) is read once DRAW_STATE comes back
	settle := func(c *websocket.Conn) {
		t.Helper()
		sendDraw(t, c, "DRAW_SYNC", at(nil))
		for nextDraw(t, c).Event != "DRAW_STATE" {
		}
	}
	// Nothing came for c meanwhile: the next event is the answer to DRAW_SYNC
	nothingFor := func(c *websocket.Conn, what string) {
		t.Helper()
		sendDraw(t, c, "DRAW_SYNC", at(nil))
		if m := nextDraw(t, c); m.Event != "DRAW_STATE" {
			t.Fatalf("%s: unexpected %s %s", what, m.Event, m.Payload)
		}
	}
	for _, c := range conns {
		settle(c)
	}
	name := func(s string) string {
		for _, n := range []string{"anna", "ben", "cleo"} {
			s = strings.ReplaceAll(s, ids[n], n)
		}
		return s
	}
	presence := func(c *websocket.Conn, x float64) {
		sendDraw(t, c, "DRAW_PRESENCE", at(map[string]any{"x": x, "y": 1}))
	}
	rooms := func() int {
		srv.draw.mu.Lock()
		defer srv.draw.mu.Unlock()
		return len(srv.draw.pointers)
	}

	// The first pointer after a quiet time goes out at once, to the others only
	presence(anna, 1)
	if got := name(pointersOf(t, bc)); got != "anna:1" {
		t.Fatalf("ben got %q", got)
	}
	if got := name(pointersOf(t, cc)); got != "anna:1" {
		t.Fatalf("cleo got %q", got)
	}
	nothingFor(anna, "own pointer")

	// The next ones wait for the tick; a newer pointer replaces a waiting one; changes go out at once,
	// in their order
	ops := func(x int) {
		sendDraw(t, anna, "DRAW_OPS", at(map[string]any{"els": []json.RawMessage{drawEl("e1", 10+x, 0, x)}}))
	}
	presence(anna, 2)
	ops(1)
	presence(anna, 3)
	presence(bc, 5)
	ops(2)
	ops(3)
	for want := 1; want <= 3; want++ {
		m := nextDraw(t, cc)
		var p struct {
			Seq int `json:"seq"`
		}
		_ = json.Unmarshal(m.Payload, &p)
		if m.Event != "DRAW_OPS" || p.Seq != want {
			t.Fatalf("cleo expected change %d, got %s %s", want, m.Event, m.Payload)
		}
	}
	settle(anna) // its acks
	settle(bc)   // Ben's pointer has reached the server
	if n := timers.fire(srv.draw); n != 1 {
		t.Fatalf("%d timers fired, want 1", n)
	}
	if got := name(pointersOf(t, cc)); got != "anna:3 ben:5" {
		t.Fatalf("cleo got %q", got)
	}
	if got := name(pointersOf(t, bc)); got != "anna:3" {
		t.Fatalf("ben got %q", got)
	}
	if got := name(pointersOf(t, anna)); got != "ben:5" {
		t.Fatalf("anna got %q", got)
	}

	// A tick without pointers sends nothing, and no timer runs any more
	if n := timers.fire(srv.draw); n != 1 {
		t.Fatalf("%d timers fired, want 1", n)
	}
	if rooms() != 0 || timers.fire(srv.draw) != 0 {
		t.Fatalf("a quiet drawing keeps its timer (%d rooms)", rooms())
	}
	nothingFor(cc, "quiet tick")

	// The end of the session stops the timer
	presence(bc, 6)
	if got := name(pointersOf(t, cc)); got != "ben:6" {
		t.Fatalf("cleo got %q", got)
	}
	if rooms() != 1 {
		t.Fatal("pointers coming in start the timer again")
	}
	sendDraw(t, anna, "DRAW_DISCARD", at(nil))
	readDraw(t, anna, "DRAW_END")
	if rooms() != 0 || timers.fire(srv.draw) != 0 {
		t.Fatalf("the timer runs on after the session ended (%d rooms)", rooms())
	}
}
