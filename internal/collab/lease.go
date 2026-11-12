package collab

import (
	"sort"
	"sync"
	"time"
)

const (
	LeaseTTL       = 20 * time.Second
	SessionTimeout = 30 * time.Second
)

type lease struct {
	clientID string
	userID   string
	name     string
	expires  time.Time
	live     []Presence // a live drawing session holds the block: everyone drawing in it
}

type session struct {
	userID   string
	name     string
	lastSeen time.Time
}

// LeaseInfo describes a block held by another client, for display ("Anna bearbeitet …").
type LeaseInfo struct {
	BlockID string `json:"blockId"`
	UserID  string `json:"userId"`
	Name    string `json:"name"`
	// Live: the block is a drawing several people draw in right now ("Live-Zeichnung: Anna, Ben")
	Live []Presence `json:"live,omitempty"`
}

// Presence is one client that synced a document recently.
type Presence struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
}

// LeaseManager keeps block leases and active sessions in memory. Leases are short-lived; after a server
// restart clients simply request them again with their next sync.
type LeaseManager struct {
	mu       sync.Mutex
	now      func() time.Time
	leases   map[string]map[string]lease   // docID -> blockID -> lease
	sessions map[string]map[string]session // docID -> clientID -> session
}

func NewLeaseManager(now func() time.Time) *LeaseManager {
	if now == nil {
		now = time.Now
	}
	return &LeaseManager{now: now, leases: map[string]map[string]lease{}, sessions: map[string]map[string]session{}}
}

func (m *LeaseManager) docLeases(docID string) map[string]lease {
	l := m.leases[docID]
	if l == nil {
		l = map[string]lease{}
		m.leases[docID] = l
	}
	return l
}

func (m *LeaseManager) prune(docID string, now time.Time) {
	for id, l := range m.leases[docID] {
		if !now.Before(l.expires) {
			delete(m.leases[docID], id)
		}
	}
	for cid, s := range m.sessions[docID] {
		if now.Sub(s.lastSeen) > SessionTimeout {
			delete(m.sessions[docID], cid)
		}
	}
}

// Hold acquires or renews leases for a client. A block held by another live client is denied.
func (m *LeaseManager) Hold(docID string, a Actor, blockIDs []string) (granted, denied []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.prune(docID, now)
	l := m.docLeases(docID)
	for _, id := range blockIDs {
		if cur, ok := l[id]; ok && cur.clientID != a.ClientID {
			denied = append(denied, id)
			continue
		}
		l[id] = lease{clientID: a.ClientID, userID: a.UserID, name: a.Name, expires: now.Add(LeaseTTL)}
		granted = append(granted, id)
	}
	return granted, denied
}

// Exchange applies the leases a client sends with a sync: whatever it no longer holds is released, the
// blocks in hold are acquired or renewed. changed says whether a block changed hands (a renewal does not),
// so the others are only told then; telling them on every sync made each client sync again right away.
func (m *LeaseManager) Exchange(docID string, a Actor, hold, release []string) (granted, denied []string, changed bool) {
	before := m.holders(docID)
	m.ReleaseAllExcept(docID, a.ClientID, hold)
	m.Release(docID, a.ClientID, release)
	granted, denied = m.Hold(docID, a, hold)
	after := m.holders(docID)
	if len(before) != len(after) {
		return granted, denied, true
	}
	for id, c := range after {
		if before[id] != c {
			return granted, denied, true
		}
	}
	return granted, denied, false
}

// holders maps the blocks of a document to the client holding them.
func (m *LeaseManager) holders(docID string) map[string]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	h := make(map[string]string, len(m.leases[docID]))
	for id, l := range m.leases[docID] {
		h[id] = l.clientID
	}
	return h
}

// HoldLive gives a drawing block to a live drawing session (holder, e.g. "draw:<blockId>") and renews it.
// The session takes the block over from clients of the people drawing in it (their own editor held it
// before the session started), never from anyone else: ok is false while someone else holds it.
func (m *LeaseManager) HoldLive(docID, blockID, holder string, people []Presence) bool {
	if len(people) == 0 {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.prune(docID, now)
	l := m.docLeases(docID)
	if cur, ok := l[blockID]; ok && cur.clientID != holder {
		drawing := false
		for _, p := range people {
			drawing = drawing || p.UserID == cur.userID
		}
		if !drawing {
			return false
		}
	}
	live := append([]Presence(nil), people...)
	l[blockID] = lease{clientID: holder, userID: people[0].UserID, name: people[0].Name, expires: now.Add(LeaseTTL), live: live}
	return true
}

// HandOver passes a block from one holder to a client (a live drawing session that ended with "Fertig"
// hands it to the note of the person saving, so the save is no conflict). A block held by someone else
// stays theirs.
func (m *LeaseManager) HandOver(docID, blockID, from string, to Actor) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.prune(docID, now)
	l := m.docLeases(docID)
	if cur, ok := l[blockID]; ok && cur.clientID != from && cur.clientID != to.ClientID {
		return false
	}
	l[blockID] = lease{clientID: to.ClientID, userID: to.UserID, name: to.Name, expires: now.Add(LeaseTTL)}
	return true
}

// Release gives up leases held by this client.
func (m *LeaseManager) Release(docID, clientID string, blockIDs []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	l := m.leases[docID]
	for _, id := range blockIDs {
		if cur, ok := l[id]; ok && cur.clientID == clientID {
			delete(l, id)
		}
	}
}

// ReleaseAllExcept drops every lease of the client in this document that is not in keep.
func (m *LeaseManager) ReleaseAllExcept(docID, clientID string, keep []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	keepSet := make(map[string]bool, len(keep))
	for _, id := range keep {
		keepSet[id] = true
	}
	for id, cur := range m.leases[docID] {
		if cur.clientID == clientID && !keepSet[id] {
			delete(m.leases[docID], id)
		}
	}
}

// View returns a snapshot of the current leases of a document for operation validation.
func (m *LeaseManager) View(docID string) LeaseView {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.prune(docID, now)
	snap := make(leaseSnapshot, len(m.leases[docID]))
	for id, l := range m.leases[docID] {
		snap[id] = l.clientID
	}
	return snap
}

// Others lists blocks held by clients other than clientID.
func (m *LeaseManager) Others(docID, clientID string) []LeaseInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune(docID, m.now())
	out := make([]LeaseInfo, 0)
	for id, l := range m.leases[docID] {
		if l.clientID != clientID {
			out = append(out, LeaseInfo{BlockID: id, UserID: l.userID, Name: l.name, Live: l.live})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].BlockID < out[j].BlockID })
	return out
}

// Touch records that a client synced the document; it counts as an open session for SessionTimeout.
func (m *LeaseManager) Touch(docID string, a Actor) (joined bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[docID]
	if s == nil {
		s = map[string]session{}
		m.sessions[docID] = s
	}
	_, known := s[a.ClientID]
	s[a.ClientID] = session{userID: a.UserID, name: a.Name, lastSeen: m.now()}
	return !known
}

// Leave removes a client's session and all its leases (tab closed, app sent to background).
func (m *LeaseManager) Leave(docID, clientID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions[docID], clientID)
	for id, l := range m.leases[docID] {
		if l.clientID == clientID {
			delete(m.leases[docID], id)
		}
	}
}

// Forget drops every session and lease of a document that no longer exists.
func (m *LeaseManager) Forget(docID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, docID)
	delete(m.leases, docID)
}

// Sessions returns how many clients have the document open and who they are.
func (m *LeaseManager) Sessions(docID string) (int, []Presence) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune(docID, m.now())
	seen := map[string]bool{}
	people := make([]Presence, 0)
	for _, s := range m.sessions[docID] {
		if !seen[s.userID] {
			seen[s.userID] = true
			people = append(people, Presence{UserID: s.userID, Name: s.name})
		}
	}
	sort.Slice(people, func(i, j int) bool { return people[i].UserID < people[j].UserID })
	return len(m.sessions[docID]), people
}

type leaseSnapshot map[string]string

func (s leaseSnapshot) HolderOf(blockID string) (string, bool) {
	c, ok := s[blockID]
	return c, ok
}

// Sweep drops expired leases and sessions of all documents and forgets documents nobody uses any more,
// so the maps do not grow with every note ever opened.
func (m *LeaseManager) Sweep() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	for docID := range m.leases {
		m.prune(docID, now)
		if len(m.leases[docID]) == 0 {
			delete(m.leases, docID)
		}
	}
	for docID := range m.sessions {
		m.prune(docID, now)
		if len(m.sessions[docID]) == 0 {
			delete(m.sessions, docID)
		}
	}
}
