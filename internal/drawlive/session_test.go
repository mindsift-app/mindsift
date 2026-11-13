package drawlive

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// A fixed moment: the session logic only uses the times it is given
var t0 = time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)

func el(t *testing.T, id string, ver, nonce int64, extra string) Element {
	t.Helper()
	raw := fmt.Sprintf(`{"id":%q,"ver":%d,"nonce":%d,"t":"rect","x":0,"y":0,"w":10,"h":10,"s":"main","f":"none","sw":2%s}`, id, ver, nonce, extra)
	e, err := ParseElement(json.RawMessage(raw))
	if err != nil {
		t.Fatalf("parse %s: %v", raw, err)
	}
	return e
}

func tomb(t *testing.T, id string, ver, nonce int64) Element {
	t.Helper()
	e, err := ParseElement(json.RawMessage(fmt.Sprintf(`{"id":%q,"ver":%d,"nonce":%d,"deleted":true,"t":"rect","x":5}`, id, ver, nonce)))
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func anna() Person { return Person{ID: "ws_a", UserID: "u_anna", Name: "Anna"} }
func ben() Person  { return Person{ID: "ws_b", UserID: "u_ben", Name: "Ben"} }
func cleo() Person { return Person{ID: "ws_c", UserID: "u_cleo", Name: "Cleo"} }

func stored(t *testing.T, m *Manager, id string) (Element, bool) {
	t.Helper()
	st, ok := m.State("d1", "b1")
	if !ok {
		t.Fatal("no session")
	}
	for _, e := range st.Els {
		if e.ID == id {
			return e, true
		}
	}
	return Element{}, false
}

func TestMergeByVersionThenNonce(t *testing.T) {
	m := NewManager()
	if _, started, _, err := m.Join("d1", "b1", anna(), "base", []Element{el(t, "e1", 1, 0, "")}, nil, t0); err != nil || !started {
		t.Fatalf("join: started=%v err=%v", started, err)
	}
	m.Join("d1", "b1", ben(), "base", nil, nil, t0)

	// Higher version wins
	ops, changed, err := m.Apply("d1", "b1", "ws_b", []Element{el(t, "e1", 2, 500, `,"txt":"Ben"`)}, nil, nil, t0)
	if err != nil || !changed || len(ops.Els) != 1 || ops.Seq != 1 {
		t.Fatalf("higher version: %+v changed=%v err=%v", ops, changed, err)
	}
	// Lower version loses
	if _, changed, _ := m.Apply("d1", "b1", "ws_a", []Element{el(t, "e1", 1, 1, `,"txt":"alt"`)}, nil, nil, t0); changed {
		t.Fatal("an older version must not win")
	}
	// Same version: the lower nonce wins, the same nonce changes nothing
	if _, changed, _ := m.Apply("d1", "b1", "ws_a", []Element{el(t, "e1", 2, 900, `,"txt":"Anna"`)}, nil, nil, t0); changed {
		t.Fatal("a higher nonce must lose a tie")
	}
	if _, changed, _ := m.Apply("d1", "b1", "ws_a", []Element{el(t, "e1", 2, 100, `,"txt":"Anna"`)}, nil, nil, t0); !changed {
		t.Fatal("a lower nonce must win a tie")
	}
	if _, changed, _ := m.Apply("d1", "b1", "ws_b", []Element{el(t, "e1", 2, 100, `,"txt":"Anna"`)}, nil, nil, t0); changed {
		t.Fatal("the same element again changes nothing")
	}
	got, _ := stored(t, m, "e1")
	if !strings.Contains(string(got.Raw), `"txt":"Anna"`) {
		t.Fatalf("stored element: %s", got.Raw)
	}
	// Wins is the rule every browser applies too
	if !Wins(el(t, "x", 3, 9, ""), el(t, "x", 2, 0, "")) || Wins(el(t, "x", 2, 5, ""), el(t, "x", 2, 5, "")) {
		t.Fatal("Wins: higher version first, ties to the lower nonce, equal never wins")
	}
}

func TestTombstonesKeepDeletedElementsDeleted(t *testing.T) {
	m := NewManager()
	m.Join("d1", "b1", anna(), "base", []Element{el(t, "e1", 1, 0, ""), el(t, "e2", 1, 0, "")}, nil, t0)
	m.Join("d1", "b1", ben(), "base", nil, nil, t0)

	ops, changed, err := m.Apply("d1", "b1", "ws_a", []Element{tomb(t, "e1", 2, 7)}, nil, nil, t0)
	if err != nil || !changed {
		t.Fatalf("delete: %v %v", changed, err)
	}
	if string(ops.Els[0].Raw) != `{"deleted":true,"id":"e1","nonce":7,"ver":2}` {
		t.Fatalf("a tombstone keeps only id, version and nonce: %s", ops.Els[0].Raw)
	}
	st, _ := m.State("d1", "b1")
	if len(st.Order) != 1 || st.Order[0] != "e2" {
		t.Fatalf("order after delete: %v", st.Order)
	}
	// A late change made before the delete does not bring it back
	if _, changed, _ := m.Apply("d1", "b1", "ws_b", []Element{el(t, "e1", 2, 9, `,"x":40`)}, nil, nil, t0); changed {
		t.Fatal("a late change revived a deleted element")
	}
	// Undo of the delete (a newer version) does, and it goes on top
	if _, changed, _ := m.Apply("d1", "b1", "ws_a", []Element{el(t, "e1", 3, 1, "")}, nil, nil, t0); !changed {
		t.Fatal("restoring with a newer version failed")
	}
	st, _ = m.State("d1", "b1")
	if strings.Join(st.Order, ",") != "e2,e1" {
		t.Fatalf("order after restore: %v", st.Order)
	}
}

func TestReorderAndGrid(t *testing.T) {
	m := NewManager()
	m.Join("d1", "b1", anna(), "base", []Element{el(t, "a", 1, 0, ""), el(t, "b", 1, 0, ""), el(t, "c", 1, 0, "")}, nil, t0)
	grid := true
	ops, changed, err := m.Apply("d1", "b1", "ws_a", nil, []string{"c", "zz", "c", "a"}, &grid, t0)
	if err != nil || !changed {
		t.Fatal(err)
	}
	if strings.Join(ops.Order, ",") != "c,a,b" || ops.Grid == nil || !*ops.Grid {
		t.Fatalf("reorder: %+v", ops)
	}
	if _, changed, _ := m.Apply("d1", "b1", "ws_a", nil, nil, &grid, t0); changed {
		t.Fatal("the same grid again changes nothing")
	}
}

func TestLimits(t *testing.T) {
	if _, err := ParseElement(json.RawMessage(`{"id":"","ver":1}`)); !errors.Is(err, ErrInvalid) {
		t.Fatal("an element needs an id")
	}
	if _, err := ParseElement(json.RawMessage(`{"id":"` + strings.Repeat("x", 41) + `","ver":1}`)); !errors.Is(err, ErrInvalid) {
		t.Fatal("ids are short")
	}
	if _, err := ParseElement(json.RawMessage(`{"id":"a","ver":-1}`)); !errors.Is(err, ErrInvalid) {
		t.Fatal("versions are not negative")
	}
	big := `{"id":"a","ver":1,"pts":[` + strings.Repeat("1,", MaxElementBytes/2) + `1]}`
	if _, err := ParseElement(json.RawMessage(big)); !errors.Is(err, ErrLimit) {
		t.Fatal("one element is limited in size")
	}

	m := NewManager()
	m.Join("d1", "b1", anna(), "base", nil, nil, t0)
	many := make([]Element, 0, MaxElements+1)
	for i := 0; i <= MaxElements; i++ {
		many = append(many, el(t, fmt.Sprintf("e%d", i), 1, 0, ""))
	}
	if _, _, err := m.Apply("d1", "b1", "ws_a", many, nil, nil, t0); !errors.Is(err, ErrLimit) {
		t.Fatalf("too many elements: %v", err)
	}
	if st, _ := m.State("d1", "b1"); len(st.Els) != 0 {
		t.Fatal("a message over the limit changes nothing")
	}
	// Bytes: elements of 60 kB each run over MaxBytes after about 17
	pad := `,"txt":"` + strings.Repeat("y", 60000) + `"`
	var heavy []Element
	for i := 0; i < 20; i++ {
		heavy = append(heavy, el(t, fmt.Sprintf("h%d", i), 1, 0, pad))
	}
	if _, _, err := m.Apply("d1", "b1", "ws_a", heavy, nil, nil, t0); !errors.Is(err, ErrLimit) {
		t.Fatalf("too many bytes: %v", err)
	}
}

func TestRateLimit(t *testing.T) {
	m := NewManager()
	m.Join("d1", "b1", anna(), "base", nil, nil, t0)
	refused := 0
	for i := 0; i < opsBurst+10; i++ {
		if _, _, err := m.Apply("d1", "b1", "ws_a", []Element{el(t, "e", int64(i+1), 0, "")}, nil, nil, t0); errors.Is(err, ErrRate) {
			refused++
		}
	}
	if refused != 10 {
		t.Fatalf("refused %d messages over the burst, want 10", refused)
	}
	// A second later there is room again
	if _, _, err := m.Apply("d1", "b1", "ws_a", []Element{el(t, "e", 1000, 0, "")}, nil, nil, t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < presenceBurst; i++ {
		if _, err := m.Presence("d1", "b1", "ws_a", t0); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := m.Presence("d1", "b1", "ws_a", t0); !errors.Is(err, ErrRate) {
		t.Fatal("pointers are limited too")
	}
}

func TestWatchersOnlyLook(t *testing.T) {
	m := NewManager()
	if _, ok := m.Watch("d1", "b1", cleo()); ok {
		t.Fatal("nothing to watch without a session")
	}
	m.Join("d1", "b1", anna(), "base", []Element{el(t, "e1", 1, 0, "")}, nil, t0)
	st, ok := m.Watch("d1", "b1", cleo())
	if !ok || len(st.Watchers) != 1 || len(st.Els) != 1 || st.Host != "ws_a" {
		t.Fatalf("watch: %+v", st)
	}
	if _, _, err := m.Apply("d1", "b1", "ws_c", []Element{el(t, "e1", 5, 0, "")}, nil, nil, t0); !errors.Is(err, ErrNotInSession) {
		t.Fatalf("a watcher changed the drawing: %v", err)
	}
	if _, err := m.Presence("d1", "b1", "ws_c", t0); !errors.Is(err, ErrNotInSession) {
		t.Fatal("watchers send no pointer")
	}
	if _, err := m.Finish("d1", "b1", "ws_c"); !errors.Is(err, ErrNotHost) {
		t.Fatal("a watcher cannot end the session")
	}
}

func TestHostHandsOverToLongestPresent(t *testing.T) {
	m := NewManager()
	m.Join("d1", "b1", anna(), "base", nil, nil, t0)
	m.Join("d1", "b1", ben(), "base", nil, nil, t0)
	m.Join("d1", "b1", cleo(), "base", nil, nil, t0)
	if _, err := m.Finish("d1", "b1", "ws_b"); !errors.Is(err, ErrNotHost) {
		t.Fatal("only the host saves or discards")
	}
	chs := m.Gone("ws_a", t0) // Anna's tab closed
	if len(chs) != 1 || !chs[0].HostChanged || chs[0].State.Host != "ws_b" {
		t.Fatalf("handover: %+v", chs)
	}
	if ch, _ := m.Leave("d1", "b1", "ws_c", t0); ch.HostChanged || ch.Empty || ch.State.Host != "ws_b" {
		t.Fatalf("someone else leaving keeps the host: %+v", ch)
	}
	st, err := m.Finish("d1", "b1", "ws_b")
	if err != nil || st.Host != "ws_b" {
		t.Fatalf("finish: %v", err)
	}
	if m.Running("d1", "b1") {
		t.Fatal("the session ends with Fertig")
	}
	if _, ok := m.State("d1", "b1"); ok {
		t.Fatal("a finished session is not kept")
	}
}

func TestRejoinAfterEveryoneLeft(t *testing.T) {
	setup := func() *Manager {
		m := NewManager()
		m.Join("d1", "b1", anna(), "base", []Element{el(t, "e1", 1, 0, "")}, nil, t0)
		m.Apply("d1", "b1", "ws_a", []Element{el(t, "e2", 1, 3, "")}, nil, nil, t0)
		ch, _ := m.Leave("d1", "b1", "ws_a", t0)
		if !ch.Empty || m.Running("d1", "b1") {
			t.Fatal("the session should be empty")
		}
		return m
	}
	// Within ten minutes the state comes back
	m := setup()
	st, started, _, _ := m.Join("d1", "b1", ben(), "base", []Element{el(t, "e1", 1, 0, "")}, nil, t0.Add(9*time.Minute))
	if !started || len(st.Els) != 2 || st.Host != "ws_b" {
		t.Fatalf("resume: started=%v %+v", started, st)
	}
	// Later it is gone, the joiner's drawing is the start
	m = setup()
	if st, _, _, _ := m.Join("d1", "b1", ben(), "base", []Element{el(t, "e1", 1, 0, "")}, nil, t0.Add(11*time.Minute)); len(st.Els) != 1 {
		t.Fatalf("expired state came back: %+v", st.Els)
	}
	// Someone saved the block meanwhile (other base): start from that
	m = setup()
	if st, _, _, _ := m.Join("d1", "b1", ben(), "newer", []Element{el(t, "e9", 4, 0, "")}, nil, t0.Add(time.Minute)); len(st.Els) != 1 || st.Els[0].ID != "e9" {
		t.Fatalf("state of an older base came back: %+v", st.Els)
	}
	// Sweep drops it after ten minutes
	m = setup()
	if len(m.Sweep(t0.Add(5*time.Minute))) != 0 {
		t.Fatal("swept too early")
	}
	if len(m.Sweep(t0.Add(11*time.Minute))) != 1 {
		t.Fatal("not swept after ten minutes")
	}
	if _, ok := m.State("d1", "b1"); ok {
		t.Fatal("still there after the sweep")
	}
}

func TestReconnectMergesOwnState(t *testing.T) {
	// After a server restart (no session) or a dropped connection, the browser joins again with its whole
	// state; what it changed meanwhile wins by version and goes to the others
	m := NewManager()
	m.Join("d1", "b1", anna(), "base", []Element{el(t, "e1", 1, 0, "")}, nil, t0)
	m.Join("d1", "b1", ben(), "base", []Element{el(t, "e1", 1, 0, "")}, nil, t0)
	m.Gone("ws_b", t0)
	st, started, won, err := m.Join("d1", "b1", Person{ID: "ws_b2", UserID: "u_ben", Name: "Ben"}, "base",
		[]Element{el(t, "e1", 4, 2, `,"x":99`), tomb(t, "e7", 2, 1)}, nil, t0)
	if err != nil || started || len(won) != 2 || st.Seq != 1 {
		t.Fatalf("rejoin: started=%v won=%d seq=%d err=%v", started, len(won), st.Seq, err)
	}
	if st.Host != "ws_a" || len(st.Participants) != 2 {
		t.Fatalf("Anna stays host: %+v", st.Participants)
	}
}

func TestLeaveOwnOnlyTakesOwnConnections(t *testing.T) {
	m := NewManager()
	m.Join("d1", "b1", anna(), "base", nil, nil, t0)
	m.Watch("d1", "b1", cleo())
	// Cleo sees Anna's connection id, but cannot take her out
	if _, ok := m.LeaveOwn("d1", "b1", "ws_a", "u_cleo", t0); ok || !m.Running("d1", "b1") {
		t.Fatal("someone else's connection left the session")
	}
	if ch, ok := m.LeaveOwn("d1", "b1", "ws_c", "u_cleo", t0); !ok || ch.Participant {
		t.Fatalf("leaving as watcher: %+v", ch)
	}
	if ch, ok := m.LeaveOwn("d1", "b1", "ws_a", "u_anna", t0); !ok || !ch.Empty {
		t.Fatalf("leaving as the one drawing: %+v", ch)
	}
}

func TestOneDrawingPerConnection(t *testing.T) {
	m := NewManager()
	m.Join("d1", "b1", anna(), "base", nil, nil, t0)
	m.Join("d1", "b1", ben(), "base", nil, nil, t0)
	if chs := m.LeaveElsewhere("d1", "b1", "ws_a", t0); len(chs) != 0 {
		t.Fatal("joining the same drawing again leaves nothing")
	}
	chs := m.LeaveElsewhere("d1", "b2", "ws_a", t0)
	if len(chs) != 1 || chs[0].BlockID != "b1" || !chs[0].HostChanged || chs[0].State.Host != "ws_b" {
		t.Fatalf("joining another drawing: %+v", chs)
	}
}

func TestSessionsPerPerson(t *testing.T) {
	m := NewManager()
	conn := func(i int) Person { return Person{ID: fmt.Sprintf("ws_a%d", i), UserID: "u_anna", Name: "Anna"} }
	for i := 0; i < MaxUserSessions; i++ {
		if _, _, _, err := m.Join("d1", fmt.Sprintf("b%d", i), conn(i), "base", nil, nil, t0); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, _, err := m.Join("d1", "bx", conn(99), "base", nil, nil, t0); !errors.Is(err, ErrTooMany) {
		t.Fatalf("one drawing more: %v", err)
	}
	if _, ok := m.State("d1", "bx"); ok {
		t.Fatal("a refused join keeps no session")
	}
	// Drawing along in a running session of someone else is always possible
	m.Join("d1", "bb", ben(), "base", nil, nil, t0)
	if _, _, _, err := m.Join("d1", "bb", conn(99), "base", nil, nil, t0); err != nil {
		t.Fatalf("drawing along: %v", err)
	}
	m.Leave("d1", "bb", "ws_a99", t0)
	// Sessions Anna left last count until they expire, but give way for a new one, the oldest first
	m.Leave("d1", "b3", "ws_a3", t0)
	m.Leave("d1", "b5", "ws_a5", t0.Add(time.Second))
	if _, _, _, err := m.Join("d1", "bx", conn(99), "base", nil, nil, t0.Add(2*time.Second)); err != nil {
		t.Fatalf("after leaving two: %v", err)
	}
	if _, ok := m.State("d1", "b3"); ok {
		t.Fatal("the oldest left session should have given way")
	}
	if _, ok := m.State("d1", "b5"); !ok {
		t.Fatal("only as many give way as needed")
	}
	if d := m.Dropped(); len(d) != 1 || d[0].BlockID != "b3" {
		t.Fatalf("dropped: %+v", d)
	}
	if len(m.Dropped()) != 0 {
		t.Fatal("dropped sessions are told once")
	}
	if !m.Running("d1", "bb") {
		t.Fatal("Ben's session stays")
	}
}

func TestSessionsOfTheServer(t *testing.T) {
	someone := func(i int) Person {
		return Person{ID: fmt.Sprintf("ws_%d", i), UserID: fmt.Sprintf("u_%d", i), Name: "P"}
	}
	m := NewManager()
	for i := 0; i < MaxSessions; i++ {
		if _, _, _, err := m.Join("d1", fmt.Sprintf("b%d", i), someone(i), "base", nil, nil, t0); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, _, err := m.Join("d1", "bx", someone(999), "base", nil, nil, t0); !errors.Is(err, ErrBusy) {
		t.Fatalf("one session more than the server takes: %v", err)
	}
	m.Leave("d1", "b7", "ws_7", t0)
	if _, _, _, err := m.Join("d1", "bx", someone(999), "base", nil, nil, t0); err != nil {
		t.Fatalf("a left session gives way: %v", err)
	}
	if _, ok := m.State("d1", "b7"); ok {
		t.Fatal("the left session is still there")
	}

	// Bytes: sessions of about 1 MB each until the total is reached
	m = NewManager()
	pad := `,"txt":"` + strings.Repeat("y", 60000) + `"`
	heavy := func() []Element {
		var out []Element
		for i := 0; i < 17; i++ {
			out = append(out, el(t, fmt.Sprintf("h%d", i), 1, 0, pad))
		}
		return out
	}
	// b0 starts small and grows later
	if _, _, _, err := m.Join("d1", "b0", someone(0), "base", nil, nil, t0); err != nil {
		t.Fatal(err)
	}
	n := 1
	for ; n < MaxSessions; n++ {
		_, _, _, err := m.Join("d1", fmt.Sprintf("b%d", n), someone(n), "base", heavy(), nil, t0)
		if errors.Is(err, ErrBusy) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if n == MaxSessions || m.bytes > MaxTotalBytes || m.bytes < MaxTotalBytes-MaxBytes {
		t.Fatalf("%d sessions with %d bytes", n, m.bytes)
	}
	if _, ok := m.State("d1", fmt.Sprintf("b%d", n)); ok {
		t.Fatal("a refused join keeps no session")
	}
	// Changes that keep the size still go into running sessions; growing over the total does not
	if _, _, err := m.Apply("d1", "b1", "ws_1", []Element{el(t, "h0", 2, 0, pad)}, nil, nil, t0); err != nil {
		t.Fatalf("a change of the same size: %v", err)
	}
	if _, _, err := m.Apply("d1", "b0", "ws_0", heavy(), nil, nil, t0); !errors.Is(err, ErrBusy) {
		t.Fatalf("growing over the total: %v", err)
	}
	m.Leave("d1", "b1", "ws_1", t0)
	if _, _, _, err := m.Join("d1", "bx", someone(999), "base", heavy(), nil, t0); err != nil {
		t.Fatalf("a left session gives way for bytes too: %v", err)
	}
	// Whatever ends a session gives its bytes back
	m.Forget("d1")
	if m.bytes != 0 {
		t.Fatalf("%d bytes left after all sessions ended", m.bytes)
	}
}

func TestJoinRate(t *testing.T) {
	m := NewManager()
	for i := 0; i < joinsBurst; i++ {
		if !m.AllowJoin("u_anna", t0) {
			t.Fatalf("join %d refused within the burst", i)
		}
	}
	if m.AllowJoin("u_anna", t0) {
		t.Fatal("joining is limited")
	}
	if !m.AllowJoin("u_ben", t0) {
		t.Fatal("the rate is per person")
	}
	if !m.AllowJoin("u_anna", t0.Add(time.Second)) {
		t.Fatal("a second later there is room again")
	}
	m.Sweep(t0.Add(time.Minute))
	if len(m.joins) != 0 {
		t.Fatalf("rates that filled up again are kept: %d", len(m.joins))
	}
}
