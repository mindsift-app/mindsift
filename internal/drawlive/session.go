// Package drawlive keeps live drawing sessions in memory: several people drawing in the same drawing
// bullet at once over WebSocket, in the manner of Excalidraw. Every element carries a version (ver) and
// a random nonce; a change raises the version, and when two changes meet, the higher version wins, a tie
// goes to the lower nonce. Deleted elements stay as tombstones (deleted: true) until the session ends, so
// a late change cannot bring them back by accident. The server only merges and relays: what an element
// looks like is the browser's business (frontend/src/lib/drawing/live.ts), saving goes through the note
// sync as before.
//
// A Manager is not safe for concurrent use; the caller serializes (and sends the results in that order).
package drawlive

import (
	"encoding/json"
	"errors"
	"time"
)

const (
	// KeepFor: after everyone left without saving, the state stays this long; joining again resumes it
	KeepFor = 10 * time.Minute
	// MaxElements: live elements of a session, and as many tombstones
	MaxElements = 5000
	// MaxBytes: everything a session holds (elements and tombstones as sent). A drawing block takes 100 kB;
	// a session may run over that for a while, the editor says so before saving.
	MaxBytes = 1 << 20
	// MaxElementBytes: one element (a long freehand stroke)
	MaxElementBytes = 64 << 10
	// MaxMessageBytes: one message of a browser (joining sends the whole drawing)
	MaxMessageBytes = MaxBytes + 64<<10
	maxIDLength     = 40
	maxNonce        = 1<<53 - 1

	// Rates per connection: changes go out every 50 ms at most, pointers 20 times a second
	opsPerSecond      = 40
	opsBurst          = 80
	presencePerSecond = 30
	presenceBurst     = 30
)

var (
	ErrInvalid       = errors.New("invalid element")
	ErrLimit         = errors.New("drawing too large")
	ErrRate          = errors.New("too many messages")
	ErrNotInSession  = errors.New("not drawing in this session")
	ErrNotHost       = errors.New("only the host may do that")
	ErrNoSession     = errors.New("no live session")
	ErrSessionLocked = errors.New("someone else is editing the drawing")
)

// Element is one element as a browser sent it; Raw is passed on unchanged.
type Element struct {
	ID      string
	Ver     int64
	Nonce   int64
	Deleted bool
	Raw     json.RawMessage
}

func (e Element) MarshalJSON() ([]byte, error) { return e.Raw, nil }

// ParseElement reads one element. Only the fields for merging are checked; a tombstone keeps nothing else.
func ParseElement(raw json.RawMessage) (Element, error) {
	if len(raw) > MaxElementBytes {
		return Element{}, ErrLimit
	}
	var head struct {
		ID      string `json:"id"`
		Ver     int64  `json:"ver"`
		Nonce   int64  `json:"nonce"`
		Deleted bool   `json:"deleted"`
	}
	if err := json.Unmarshal(raw, &head); err != nil || head.ID == "" || len(head.ID) > maxIDLength ||
		head.Ver < 0 || head.Ver > maxNonce || head.Nonce < 0 || head.Nonce > maxNonce {
		return Element{}, ErrInvalid
	}
	e := Element{ID: head.ID, Ver: head.Ver, Nonce: head.Nonce, Deleted: head.Deleted, Raw: raw}
	if e.Deleted {
		e.Raw, _ = json.Marshal(map[string]any{"id": e.ID, "ver": e.Ver, "nonce": e.Nonce, "deleted": true})
	}
	return e, nil
}

// Wins tells whether a replaces b: the higher version, on a tie the lower nonce (the same rule in every
// browser, so all end up with the same element).
func Wins(a, b Element) bool {
	return a.Ver > b.Ver || (a.Ver == b.Ver && a.Nonce < b.Nonce)
}

// Person is one connection in a session (a person with two tabs is there twice).
type Person struct {
	ID     string `json:"id"` // connection
	UserID string `json:"userId"`
	Name   string `json:"name"`
}

// State is what a browser gets on joining or watching (and the host on "Fertig").
type State struct {
	DocID   string `json:"docId"`
	BlockID string `json:"blockId"`
	// Active: someone draws; a session everyone left is kept for KeepFor but not active
	Active bool `json:"active"`
	// Host: connection id of the person who saves (the first of Participants)
	Host         string    `json:"host"`
	Participants []Person  `json:"participants"`
	Watchers     []Person  `json:"watchers"`
	Els          []Element `json:"els"`
	Order        []string  `json:"order"`
	Grid         bool      `json:"grid"`
	Seq          int64     `json:"seq"`
}

// Ops is a merged change to pass on to the others.
type Ops struct {
	Els   []Element `json:"els"`
	Order []string  `json:"order,omitempty"`
	Grid  *bool     `json:"grid,omitempty"`
	Seq   int64     `json:"seq"`
}

// Change describes who joined or left a session.
type Change struct {
	DocID, BlockID string
	Person         Person
	// Participant: it was someone drawing (not a watcher)
	Participant bool
	HostChanged bool
	// Empty: nobody draws any more; the state is kept for KeepFor
	Empty bool
	State State
}

// Info is an active session, for the lease of its block.
type Info struct {
	DocID, BlockID string
	Participants   []Person
	Watchers       []Person
}

type bucket struct {
	tokens float64
	at     time.Time
}

func (b *bucket) take(now time.Time, rate, burst float64) bool {
	if b.at.IsZero() {
		b.tokens = burst
	} else if d := now.Sub(b.at).Seconds(); d > 0 {
		b.tokens = min(burst, b.tokens+d*rate)
	}
	b.at = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

type session struct {
	docID, blockID string
	base           string // block content the session started from
	els            map[string]Element
	order          []string // z-order of the live elements
	grid           bool
	bytes          int
	live, tombs    int
	participants   []Person // in the order they joined; the first is the host
	watchers       []Person
	seq            int64
	emptySince     time.Time
	ops, presence  map[string]*bucket
}

type key struct{ docID, blockID string }

// Manager holds the sessions of all drawings.
type Manager struct {
	sessions map[key]*session
}

func NewManager() *Manager {
	return &Manager{sessions: map[key]*session{}}
}

func newSession(docID, blockID, base string) *session {
	return &session{docID: docID, blockID: blockID, base: base, els: map[string]Element{},
		ops: map[string]*bucket{}, presence: map[string]*bucket{}}
}

func indexOf(people []Person, connID string) int {
	for i, p := range people {
		if p.ID == connID {
			return i
		}
	}
	return -1
}

func (s *session) active() bool { return len(s.participants) > 0 }

func (s *session) state() State {
	st := State{DocID: s.docID, BlockID: s.blockID, Active: s.active(), Participants: append([]Person{}, s.participants...),
		Watchers: append([]Person{}, s.watchers...), Order: append([]string{}, s.order...), Grid: s.grid, Seq: s.seq,
		Els: make([]Element, 0, len(s.els))}
	if s.active() {
		st.Host = s.participants[0].ID
	}
	for _, id := range s.order {
		st.Els = append(st.Els, s.els[id])
	}
	for _, e := range s.els {
		if e.Deleted {
			st.Els = append(st.Els, e)
		}
	}
	return st
}

// merge takes the elements that beat what the session has; either all of them fit the limits or nothing
// changes.
func (s *session) merge(els []Element) ([]Element, error) {
	won := make([]Element, 0, len(els))
	next := map[string]Element{}
	bytes, live, tombs := s.bytes, s.live, s.tombs
	for _, e := range els {
		cur, ok := next[e.ID]
		if !ok {
			cur, ok = s.els[e.ID]
		}
		if ok && !Wins(e, cur) {
			continue
		}
		if ok {
			bytes -= len(cur.Raw)
			if cur.Deleted {
				tombs--
			} else {
				live--
			}
		}
		bytes += len(e.Raw)
		if e.Deleted {
			tombs++
		} else {
			live++
		}
		next[e.ID] = e
	}
	if bytes > MaxBytes || live > MaxElements || tombs > MaxElements {
		return nil, ErrLimit
	}
	for _, e := range els {
		w, ok := next[e.ID]
		if !ok || w.Raw == nil {
			continue
		}
		prev, had := s.els[e.ID]
		s.els[e.ID] = w
		switch {
		case w.Deleted && had && !prev.Deleted:
			s.dropFromOrder(w.ID)
		case !w.Deleted && (!had || prev.Deleted):
			s.order = append(s.order, w.ID)
		}
		won = append(won, w)
		next[e.ID] = Element{} // once, even when sent twice
	}
	s.bytes, s.live, s.tombs = bytes, live, tombs
	return won, nil
}

func (s *session) dropFromOrder(id string) {
	for i, o := range s.order {
		if o == id {
			s.order = append(s.order[:i], s.order[i+1:]...)
			return
		}
	}
}

// reorder puts the live elements named in order first, in that order; the rest follow as they were.
func (s *session) reorder(order []string) {
	seen := map[string]bool{}
	next := make([]string, 0, len(s.order))
	for _, id := range order {
		if e, ok := s.els[id]; ok && !e.Deleted && !seen[id] {
			seen[id] = true
			next = append(next, id)
		}
	}
	for _, id := range s.order {
		if !seen[id] {
			next = append(next, id)
		}
	}
	s.order = next
}

func (m *Manager) get(docID, blockID string) *session {
	return m.sessions[key{docID, blockID}]
}

// Running tells whether people draw in the drawing right now.
func (m *Manager) Running(docID, blockID string) bool {
	s := m.get(docID, blockID)
	return s != nil && s.active()
}

// Join adds a connection as drawing. Without a running session it starts one with the joiner as host: a
// session everyone left within KeepFor resumes, if the block still holds what it started from (base);
// otherwise the joiner's elements are the start. els is the joiner's own state (after a reconnect or a
// server restart its changes merge in by version); won are those that changed the session, for the others.
func (m *Manager) Join(docID, blockID string, p Person, base string, els []Element, grid *bool, now time.Time) (st State, started bool, won []Element, err error) {
	k := key{docID, blockID}
	s := m.sessions[k]
	if s != nil && !s.active() && (now.Sub(s.emptySince) > KeepFor || s.base != base) {
		s = nil
	}
	fresh := s == nil
	if fresh {
		s = newSession(docID, blockID, base)
		if grid != nil {
			s.grid = *grid
		}
	}
	started = !s.active()
	if won, err = s.merge(els); err != nil {
		return State{}, false, nil, err
	}
	if fresh {
		m.sessions[k] = s
		won = nil // nobody else has seen anything yet
	} else if len(won) > 0 {
		s.seq++
	}
	if i := indexOf(s.watchers, p.ID); i >= 0 {
		s.watchers = append(s.watchers[:i], s.watchers[i+1:]...)
	}
	if indexOf(s.participants, p.ID) < 0 {
		s.participants = append(s.participants, p)
	}
	s.emptySince = time.Time{}
	return s.state(), started, won, nil
}

// Watch adds a connection that only looks. ok is false when nobody draws in the drawing.
func (m *Manager) Watch(docID, blockID string, p Person) (State, bool) {
	s := m.get(docID, blockID)
	if s == nil || !s.active() {
		return State{DocID: docID, BlockID: blockID, Participants: []Person{}, Watchers: []Person{}, Els: []Element{}, Order: []string{}}, false
	}
	if indexOf(s.participants, p.ID) < 0 && indexOf(s.watchers, p.ID) < 0 {
		s.watchers = append(s.watchers, p)
	}
	return s.state(), true
}

// Member tells whether a connection draws in or watches the session.
func (m *Manager) Member(docID, blockID, connID string) bool {
	s := m.get(docID, blockID)
	return s != nil && (indexOf(s.participants, connID) >= 0 || indexOf(s.watchers, connID) >= 0)
}

// State returns the session's state.
func (m *Manager) State(docID, blockID string) (State, bool) {
	s := m.get(docID, blockID)
	if s == nil {
		return State{}, false
	}
	return s.state(), true
}

// Apply merges changes of someone drawing. changed is false when nothing beat the session's state.
func (m *Manager) Apply(docID, blockID, connID string, els []Element, order []string, grid *bool, now time.Time) (ops Ops, changed bool, err error) {
	s := m.get(docID, blockID)
	if s == nil || indexOf(s.participants, connID) < 0 {
		return Ops{}, false, ErrNotInSession
	}
	b := s.ops[connID]
	if b == nil {
		b = &bucket{}
		s.ops[connID] = b
	}
	if !b.take(now, opsPerSecond, opsBurst) {
		return Ops{}, false, ErrRate
	}
	won, err := s.merge(els)
	if err != nil {
		return Ops{}, false, err
	}
	ops.Els = won
	if order != nil {
		s.reorder(order)
		ops.Order = append([]string{}, s.order...)
	}
	if grid != nil && *grid != s.grid {
		s.grid = *grid
		ops.Grid = grid
	}
	if len(ops.Els) == 0 && ops.Order == nil && ops.Grid == nil {
		return ops, false, nil
	}
	s.seq++
	ops.Seq = s.seq
	return ops, true, nil
}

// Presence checks that a pointer may go out now (someone drawing, within the rate); else it is dropped.
func (m *Manager) Presence(docID, blockID, connID string, now time.Time) (Person, error) {
	s := m.get(docID, blockID)
	if s == nil {
		return Person{}, ErrNotInSession
	}
	i := indexOf(s.participants, connID)
	if i < 0 {
		return Person{}, ErrNotInSession
	}
	b := s.presence[connID]
	if b == nil {
		b = &bucket{}
		s.presence[connID] = b
	}
	if !b.take(now, presencePerSecond, presenceBurst) {
		return Person{}, ErrRate
	}
	return s.participants[i], nil
}

func (m *Manager) leave(s *session, connID string, now time.Time) (Change, bool) {
	ch := Change{DocID: s.docID, BlockID: s.blockID}
	if i := indexOf(s.participants, connID); i >= 0 {
		ch.Person, ch.Participant, ch.HostChanged = s.participants[i], true, i == 0
		s.participants = append(s.participants[:i], s.participants[i+1:]...)
		delete(s.ops, connID)
		delete(s.presence, connID)
		if !s.active() {
			ch.Empty, ch.HostChanged = true, false
			s.emptySince = now
		}
	} else if i := indexOf(s.watchers, connID); i >= 0 {
		ch.Person = s.watchers[i]
		s.watchers = append(s.watchers[:i], s.watchers[i+1:]...)
	} else {
		return ch, false
	}
	ch.State = s.state()
	return ch, true
}

// Leave takes a connection out of a session. When the host leaves, the person drawing longest takes over.
func (m *Manager) Leave(docID, blockID, connID string, now time.Time) (Change, bool) {
	s := m.get(docID, blockID)
	if s == nil {
		return Change{}, false
	}
	return m.leave(s, connID, now)
}

// Gone takes a closed connection out of every session.
func (m *Manager) Gone(connID string, now time.Time) []Change {
	var out []Change
	for _, s := range m.sessions {
		if ch, ok := m.leave(s, connID, now); ok {
			out = append(out, ch)
		}
	}
	return out
}

// Finish ends a session for "Fertig" (the host saves the returned state) or "Verwerfen"; only the host may.
func (m *Manager) Finish(docID, blockID, connID string) (State, error) {
	s := m.get(docID, blockID)
	if s == nil || !s.active() {
		return State{}, ErrNoSession
	}
	if s.participants[0].ID != connID {
		return State{}, ErrNotHost
	}
	st := s.state()
	delete(m.sessions, key{docID, blockID})
	return st, nil
}

// Forget drops every session of a note that no longer exists.
func (m *Manager) Forget(docID string) {
	for k := range m.sessions {
		if k.docID == docID {
			delete(m.sessions, k)
		}
	}
}

// Active lists the sessions people draw in.
func (m *Manager) Active() []Info {
	var out []Info
	for _, s := range m.sessions {
		if s.active() {
			out = append(out, Info{DocID: s.docID, BlockID: s.blockID, Participants: append([]Person{}, s.participants...),
				Watchers: append([]Person{}, s.watchers...)})
		}
	}
	return out
}

// Sweep drops sessions everyone left more than KeepFor ago and returns them (their watchers learn it).
func (m *Manager) Sweep(now time.Time) []State {
	var out []State
	for k, s := range m.sessions {
		if !s.active() && now.Sub(s.emptySince) > KeepFor {
			out = append(out, State{DocID: s.docID, BlockID: s.blockID, Watchers: append([]Person{}, s.watchers...)})
			delete(m.sessions, k)
		}
	}
	return out
}
