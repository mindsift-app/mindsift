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
			out = append(out, LeaseInfo{BlockID: id, UserID: l.userID, Name: l.name})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].BlockID < out[j].BlockID })
	return out
}

// Touch records that a client synced the document; it counts as an open session for SessionTimeout.
func (m *LeaseManager) Touch(docID string, a Actor) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[docID]
	if s == nil {
		s = map[string]session{}
		m.sessions[docID] = s
	}
	s[a.ClientID] = session{userID: a.UserID, name: a.Name, lastSeen: m.now()}
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
