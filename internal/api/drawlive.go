package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/drawing"
	"github.com/mindsift-app/mindsift/internal/drawlive"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

// Live drawing: several people draw in one drawing bullet at once (internal/drawlive). Drawing needs a
// WebSocket (DRAW_* messages, handled here); watching works on every channel, SSE and long polling join
// the session's room over REST (handleDrawWatch). The session holds the bullet's lease while anyone
// draws, so the note shows "Live-Zeichnung: …" and nobody else changes the block meanwhile.

// drawTick: leases of running sessions are renewed (LeaseTTL is 20 s), rights checked, old sessions dropped
const drawTick = 5 * time.Second

const (
	drawMaxSelected = 200
	drawMaxClientID = 64
)

type drawHub struct {
	mu sync.Mutex // serializes the sessions and what is sent, so everyone gets the changes in one order
	m  *drawlive.Manager
	// WebSocket connections in a session, for messages to one of them
	conns map[string]*ws.Client
}

func newDrawHub() *drawHub {
	return &drawHub{m: drawlive.NewManager(), conns: map[string]*ws.Client{}}
}

// drawRoom is the realtime room of a drawing; the room authorizer lets in everyone who can read the note.
func drawRoom(docID, blockID string) string { return "drawing:" + docID + ":" + blockID }

// drawHolder is the lease holder of a session (in place of a client of the note sync).
func drawHolder(blockID string) string { return collab.LiveDrawHolderPrefix + blockID }

type drawMessage struct {
	DocID    string            `json:"docId"`
	BlockID  string            `json:"blockId"`
	Base     string            `json:"base"`
	Els      []json.RawMessage `json:"els"`
	Order    []string          `json:"order"`
	Grid     *bool             `json:"grid"`
	X        float64           `json:"x"`
	Y        float64           `json:"y"`
	Sel      []string          `json:"sel"`
	Touch    bool              `json:"touch"`
	Gone     bool              `json:"gone"`
	ClientID string            `json:"clientId"`
}

func drawError(c *ws.Client, docID, blockID, code string) {
	c.SendEvent("DRAW_ERROR", map[string]any{"docId": docID, "blockId": blockID, "code": code})
}

// drawErrorCode is what the browser shows for an error (texts in its language files).
func drawErrorCode(err error) string {
	switch {
	case errors.Is(err, drawlive.ErrLimit):
		return "limit"
	case errors.Is(err, drawlive.ErrRate):
		return "rate"
	case errors.Is(err, drawlive.ErrTooMany):
		return "too_many"
	case errors.Is(err, drawlive.ErrBusy):
		return "busy"
	case errors.Is(err, drawlive.ErrNotHost):
		return "not_host"
	case errors.Is(err, drawlive.ErrInvalid):
		return "invalid"
	case errors.Is(err, drawlive.ErrSessionLocked):
		return "locked"
	default:
		return "no_session"
	}
}

func withYou(st drawlive.State, you string) map[string]any {
	return map[string]any{"docId": st.DocID, "blockId": st.BlockID, "active": st.Active, "host": st.Host,
		"participants": st.Participants, "watchers": st.Watchers, "els": st.Els, "order": st.Order, "grid": st.Grid,
		"seq": st.Seq, "you": you}
}

func people(st drawlive.State) map[string]any {
	return map[string]any{"docId": st.DocID, "blockId": st.BlockID, "active": st.Active, "host": st.Host,
		"participants": st.Participants, "watchers": st.Watchers}
}

func parseDrawElements(raw []json.RawMessage) ([]drawlive.Element, error) {
	if len(raw) > 2*drawlive.MaxElements {
		return nil, drawlive.ErrLimit
	}
	els := make([]drawlive.Element, 0, len(raw))
	for _, r := range raw {
		e, err := drawlive.ParseElement(r)
		if err != nil {
			return nil, err
		}
		els = append(els, e)
	}
	return els, nil
}

func (s *Server) displayName(userID string) string {
	if u, err := s.store.GetUserByID(userID); err == nil && u != nil {
		return u.DisplayName
	}
	return ""
}

// drawMessageHandler receives the DRAW_* messages of the WebSocket hub.
type drawMessageHandler struct{ s *Server }

func (h drawMessageHandler) HandleMessage(c *ws.Client, event string, payload json.RawMessage) {
	h.s.handleDrawMessage(c, event, payload)
}

func (h drawMessageHandler) ConnectionGone(connID string) { h.s.drawConnectionGone(connID) }

func (s *Server) handleDrawMessage(c *ws.Client, event string, payload json.RawMessage) {
	var p drawMessage
	if len(payload) > drawlive.MaxMessageBytes {
		drawError(c, "", "", "limit")
		return
	}
	if json.Unmarshal(payload, &p) != nil || p.DocID == "" || p.BlockID == "" {
		return
	}
	switch event {
	case "DRAW_JOIN":
		s.drawJoin(c, p)
	case "DRAW_WATCH":
		s.drawWatch(c, p)
	case "DRAW_OPS":
		s.drawOps(c, p)
	case "DRAW_PRESENCE":
		s.drawPresence(c, p)
	case "DRAW_SYNC":
		d := s.draw
		d.mu.Lock()
		if st, ok := d.m.State(p.DocID, p.BlockID); ok && d.m.Member(p.DocID, p.BlockID, c.ID()) {
			c.SendEvent("DRAW_STATE", withYou(st, c.ID()))
		}
		d.mu.Unlock()
	case "DRAW_LEAVE":
		s.wsHub.LeaveRoom(c, drawRoom(p.DocID, p.BlockID))
		s.drawLeave(p.DocID, p.BlockID, c.ID(), c.UserID())
	case "DRAW_DONE", "DRAW_DISCARD":
		s.drawFinish(c, p, event == "DRAW_DONE")
	}
}

// allowDrawJoin keeps the rate of joining and watching per person (each start loads the note).
func (s *Server) allowDrawJoin(userID string) bool {
	d := s.draw
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.m.AllowJoin(userID, s.now())
}

// tellDrawDropped tells the watchers of sessions everyone had left, and that gave way for others, that
// they ended (as when they expire); called holding d.mu.
func (s *Server) tellDrawDropped() {
	for _, st := range s.draw.m.Dropped() {
		s.wsHub.BroadcastRoom(drawRoom(st.DocID, st.BlockID), "DRAW_END", map[string]any{"docId": st.DocID, "blockId": st.BlockID, "reason": "expired"}, nil)
	}
}

// drawJoin: someone with write access draws along, or starts a session.
func (s *Server) drawJoin(c *ws.Client, p drawMessage) {
	userID := c.UserID()
	if !s.allowDrawJoin(userID) {
		drawError(c, p.DocID, p.BlockID, "rate")
		return
	}
	if !storage.CanEditDoc(s.store.DocRole(userID, p.DocID)) {
		drawError(c, p.DocID, p.BlockID, "forbidden")
		return
	}
	els, err := parseDrawElements(p.Els)
	if err != nil {
		drawError(c, p.DocID, p.BlockID, drawErrorCode(err))
		return
	}
	d := s.draw
	d.mu.Lock()
	// One drawing per connection: joining another leaves the previous one
	left := d.m.LeaveElsewhere(p.DocID, p.BlockID, c.ID(), s.now())
	for _, ch := range left {
		s.wsHub.BroadcastRoom(drawRoom(ch.DocID, ch.BlockID), "DRAW_PEOPLE", people(ch.State), nil)
	}
	running := d.m.Running(p.DocID, p.BlockID)
	d.mu.Unlock()
	for _, ch := range left {
		s.wsHub.LeaveRoom(c, drawRoom(ch.DocID, ch.BlockID))
		s.syncDrawLease(ch.DocID, ch.BlockID)
	}
	if !running && !s.isDrawingBlock(p.DocID, p.BlockID) {
		drawError(c, p.DocID, p.BlockID, "no_session")
		return
	}
	me := drawlive.Person{ID: c.ID(), UserID: userID, Name: s.displayName(userID)}
	// A new session takes the bullet first: someone editing it alone (without WebSocket) keeps it
	if !running && !s.leases.HoldLive(p.DocID, p.BlockID, drawHolder(p.BlockID), []collab.Presence{{UserID: me.UserID, Name: me.Name}}) {
		drawError(c, p.DocID, p.BlockID, "locked")
		return
	}
	if !s.wsHub.JoinRoom(c, drawRoom(p.DocID, p.BlockID)) {
		drawError(c, p.DocID, p.BlockID, "forbidden")
		return
	}
	d.mu.Lock()
	st, _, won, err := d.m.Join(p.DocID, p.BlockID, me, p.Base, els, p.Grid, s.now())
	if err == nil {
		d.conns[c.ID()] = c
		c.SendEvent("DRAW_STATE", withYou(st, c.ID()))
		if len(won) > 0 {
			s.wsHub.BroadcastRoom(drawRoom(p.DocID, p.BlockID), "DRAW_OPS",
				map[string]any{"docId": p.DocID, "blockId": p.BlockID, "from": me.ID, "els": won, "seq": st.Seq}, c)
		}
		s.wsHub.BroadcastRoom(drawRoom(p.DocID, p.BlockID), "DRAW_PEOPLE", people(st), c)
	}
	s.tellDrawDropped()
	d.mu.Unlock()
	if err != nil {
		drawError(c, p.DocID, p.BlockID, drawErrorCode(err))
	}
	s.syncDrawLease(p.DocID, p.BlockID)
}

// isDrawingBlock: a live session only starts in an existing drawing bullet.
func (s *Server) isDrawingBlock(docID, blockID string) bool {
	snap, err := s.store.GetDocSnapshot(docID)
	if err != nil {
		return false
	}
	for _, b := range snap.Blocks {
		if b.ID == blockID {
			return !b.Deleted && b.Type == drawing.BlockType
		}
	}
	return false
}

// drawWatch: someone looks on over WebSocket (readers, or editors who chose to watch).
func (s *Server) drawWatch(c *ws.Client, p drawMessage) {
	userID := c.UserID()
	if !s.allowDrawJoin(userID) {
		drawError(c, p.DocID, p.BlockID, "rate")
		return
	}
	if !s.wsHub.JoinRoom(c, drawRoom(p.DocID, p.BlockID)) {
		drawError(c, p.DocID, p.BlockID, "forbidden")
		return
	}
	me := drawlive.Person{ID: c.ID(), UserID: userID, Name: s.displayName(userID)}
	d := s.draw
	d.mu.Lock()
	st, ok := d.m.Watch(p.DocID, p.BlockID, me)
	d.conns[c.ID()] = c
	c.SendEvent("DRAW_STATE", withYou(st, c.ID()))
	if ok {
		s.wsHub.BroadcastRoom(drawRoom(p.DocID, p.BlockID), "DRAW_PEOPLE", people(st), c)
	}
	d.mu.Unlock()
}

// drawOps merges changes and passes the winners on; the sender gets the sequence number back.
func (s *Server) drawOps(c *ws.Client, p drawMessage) {
	els, err := parseDrawElements(p.Els)
	if err != nil {
		drawError(c, p.DocID, p.BlockID, drawErrorCode(err))
		return
	}
	d := s.draw
	d.mu.Lock()
	ops, changed, err := d.m.Apply(p.DocID, p.BlockID, c.ID(), els, p.Order, p.Grid, s.now())
	if err == nil && changed {
		s.wsHub.BroadcastRoom(drawRoom(p.DocID, p.BlockID), "DRAW_OPS", map[string]any{"docId": p.DocID, "blockId": p.BlockID,
			"from": c.ID(), "els": ops.Els, "order": ops.Order, "grid": ops.Grid, "seq": ops.Seq}, c)
		c.SendEvent("DRAW_ACK", map[string]any{"docId": p.DocID, "blockId": p.BlockID, "seq": ops.Seq})
	}
	s.tellDrawDropped()
	d.mu.Unlock()
	if err != nil {
		drawError(c, p.DocID, p.BlockID, drawErrorCode(err))
	}
}

// drawPresence passes a pointer and selection on (dropped over the rate).
func (s *Server) drawPresence(c *ws.Client, p drawMessage) {
	sel := p.Sel
	if len(sel) > drawMaxSelected {
		sel = sel[:drawMaxSelected]
	}
	clean := make([]string, 0, len(sel))
	for _, id := range sel {
		if id != "" && len(id) <= 40 {
			clean = append(clean, id)
		}
	}
	d := s.draw
	d.mu.Lock()
	defer d.mu.Unlock()
	who, err := d.m.Presence(p.DocID, p.BlockID, c.ID(), s.now())
	if err != nil {
		return
	}
	s.wsHub.BroadcastRoom(drawRoom(p.DocID, p.BlockID), "DRAW_PRESENCE", map[string]any{"docId": p.DocID, "blockId": p.BlockID,
		"from": who.ID, "userId": who.UserID, "name": who.Name, "x": p.X, "y": p.Y, "sel": clean, "touch": p.Touch, "gone": p.Gone}, c)
}

// drawLeave takes a connection out of a session ("Verlassen", editor closed). With userID, only a
// connection of that person (one a browser named); "" is for the server's own decisions.
func (s *Server) drawLeave(docID, blockID, connID, userID string) {
	d := s.draw
	d.mu.Lock()
	var ch drawlive.Change
	var ok bool
	if userID != "" {
		ch, ok = d.m.LeaveOwn(docID, blockID, connID, userID, s.now())
	} else {
		ch, ok = d.m.Leave(docID, blockID, connID, s.now())
	}
	if ok {
		s.wsHub.BroadcastRoom(drawRoom(docID, blockID), "DRAW_PEOPLE", people(ch.State), nil)
	}
	d.mu.Unlock()
	if ok && ch.Participant {
		s.syncDrawLease(docID, blockID)
	}
}

// drawConnectionGone: a closed tab or a lost connection leaves every session it was in.
func (s *Server) drawConnectionGone(connID string) {
	d := s.draw
	d.mu.Lock()
	delete(d.conns, connID)
	changes := d.m.Gone(connID, s.now())
	for _, ch := range changes {
		s.wsHub.BroadcastRoom(drawRoom(ch.DocID, ch.BlockID), "DRAW_PEOPLE", people(ch.State), nil)
	}
	d.mu.Unlock()
	for _, ch := range changes {
		if ch.Participant {
			s.syncDrawLease(ch.DocID, ch.BlockID)
		}
	}
}

// drawFinish ends a session for everyone; only the host may. "Fertig": the host gets the final state and
// saves it through the note sync (the bullet's lease goes to its note, so the save is no conflict);
// "Verwerfen": the state is gone.
func (s *Server) drawFinish(c *ws.Client, p drawMessage, save bool) {
	d := s.draw
	d.mu.Lock()
	st, err := d.m.Finish(p.DocID, p.BlockID, c.ID())
	if err == nil {
		reason := "discard"
		if save {
			reason = "done"
		}
		host := st.Participants[0]
		end := map[string]any{"docId": p.DocID, "blockId": p.BlockID, "reason": reason, "by": host.Name, "byUserId": host.UserID}
		s.wsHub.BroadcastRoom(drawRoom(p.DocID, p.BlockID), "DRAW_END", end, c)
		mine := withYou(st, c.ID())
		mine["reason"], mine["by"], mine["byUserId"] = reason, host.Name, host.UserID
		c.SendEvent("DRAW_END", mine)
	}
	d.mu.Unlock()
	if err != nil {
		drawError(c, p.DocID, p.BlockID, drawErrorCode(err))
		return
	}
	if save && p.ClientID != "" && len(p.ClientID) <= drawMaxClientID && !collab.ReservedClientID(p.ClientID) {
		s.leases.HandOver(p.DocID, p.BlockID, drawHolder(p.BlockID), collab.Actor{UserID: c.UserID(), ClientID: p.ClientID, Name: s.displayName(c.UserID())})
	} else {
		s.leases.Release(p.DocID, drawHolder(p.BlockID), []string{p.BlockID})
	}
	s.notifyDrawLease(p.DocID)
}

// syncDrawLease gives the bullet to its session while anyone draws, else frees it, and tells the note.
func (s *Server) syncDrawLease(docID, blockID string) {
	s.holdDrawLease(docID, blockID)
	s.notifyDrawLease(docID)
}

// holdDrawLease renews or frees the bullet's lease without telling anyone (nothing changed for them).
func (s *Server) holdDrawLease(docID, blockID string) {
	d := s.draw
	d.mu.Lock()
	st, ok := d.m.State(docID, blockID)
	d.mu.Unlock()
	if ok && st.Active {
		s.leases.HoldLive(docID, blockID, drawHolder(blockID), livePeople(st.Participants))
	} else {
		s.leases.Release(docID, drawHolder(blockID), []string{blockID})
	}
}

// livePeople: everyone drawing, each person once, the host first.
func livePeople(participants []drawlive.Person) []collab.Presence {
	seen := map[string]bool{}
	out := make([]collab.Presence, 0, len(participants))
	for _, p := range participants {
		if !seen[p.UserID] {
			seen[p.UserID] = true
			out = append(out, collab.Presence{UserID: p.UserID, Name: p.Name})
		}
	}
	return out
}

// notifyDrawLease lets open editors of the note sync, so they see who draws (or that the bullet is free).
func (s *Server) notifyDrawLease(docID string) {
	if _, head, err := s.store.GetDocOpsSince(docID, 0, 0); err == nil {
		s.notifyDocChanged(docID, head)
	}
}

// drawTickOnce renews the leases of running sessions, takes out people who lost their access, and drops
// sessions everyone left more than drawlive.KeepFor ago.
func (s *Server) drawTickOnce() {
	d := s.draw
	d.mu.Lock()
	active := d.m.Active()
	expired := d.m.Sweep(s.now())
	for _, st := range expired {
		s.wsHub.BroadcastRoom(drawRoom(st.DocID, st.BlockID), "DRAW_END", map[string]any{"docId": st.DocID, "blockId": st.BlockID, "reason": "expired"}, nil)
	}
	d.mu.Unlock()
	for _, info := range active {
		var lost []string
		roles := map[string]string{}
		for _, p := range info.Participants {
			if _, ok := roles[p.UserID]; !ok {
				roles[p.UserID] = s.store.DocRole(p.UserID, info.DocID)
			}
			if !storage.CanEditDoc(roles[p.UserID]) {
				lost = append(lost, p.ID)
			}
		}
		for _, p := range info.Watchers {
			if _, ok := roles[p.UserID]; !ok {
				roles[p.UserID] = s.store.DocRole(p.UserID, info.DocID)
			}
			if roles[p.UserID] == "" {
				lost = append(lost, p.ID)
			}
		}
		for _, connID := range lost {
			d.mu.Lock()
			c := d.conns[connID]
			d.mu.Unlock()
			if c != nil {
				drawError(c, info.DocID, info.BlockID, "forbidden")
			}
			s.drawLeave(info.DocID, info.BlockID, connID, "")
		}
		if len(lost) == 0 {
			s.holdDrawLease(info.DocID, info.BlockID)
		}
	}
}

func (s *Server) startDrawTicker() {
	for s.wait(drawTick) {
		s.drawTickOnce()
	}
}

// handleDrawWatch lets an SSE or long-poll connection (sseId) watch a live drawing: it joins the room and
// counts as watching; {"leave": true} ends that. Drawing along needs a WebSocket.
func (s *Server) handleDrawWatch(w http.ResponseWriter, r *http.Request) {
	userID, docID, role := s.docAccess(w, r)
	if role == "" {
		return
	}
	blockID := chi.URLParam(r, "blockId")
	var req struct {
		SSEID string `json:"sseId"`
		Leave bool   `json:"leave"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil || strings.TrimSpace(req.SSEID) == "" {
		writeError(w, http.StatusBadRequest, "sseId und room erforderlich")
		return
	}
	room := drawRoom(docID, blockID)
	if req.Leave {
		// Only one's own connection: everyone in a drawing sees the connection ids of the others
		if !s.wsHub.LeaveSSERoomByID(req.SSEID, userID, room) {
			writeError(w, http.StatusForbidden, "Keine Berechtigung")
			return
		}
		s.drawLeave(docID, blockID, req.SSEID, userID)
		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
		return
	}
	if !s.allowDrawJoin(userID) {
		writeError(w, http.StatusTooManyRequests, "Zu viele Anfragen – bitte kurz warten")
		return
	}
	if !s.wsHub.JoinSSERoomByID(req.SSEID, userID, room) {
		writeError(w, http.StatusForbidden, "Kein Zugriff auf diesen Raum")
		return
	}
	me := drawlive.Person{ID: req.SSEID, UserID: userID, Name: s.displayName(userID)}
	d := s.draw
	d.mu.Lock()
	st, ok := d.m.Watch(docID, blockID, me)
	if ok {
		s.wsHub.BroadcastRoom(room, "DRAW_PEOPLE", people(st), nil)
	}
	d.mu.Unlock()
	writeJSON(w, http.StatusOK, withYou(st, req.SSEID))
}

// handleDrawLive tells whether people draw in a drawing and returns its state (watchers resync with it).
func (s *Server) handleDrawLive(w http.ResponseWriter, r *http.Request) {
	_, docID, role := s.docAccess(w, r)
	if role == "" {
		return
	}
	blockID := chi.URLParam(r, "blockId")
	d := s.draw
	d.mu.Lock()
	st, ok := d.m.State(docID, blockID)
	d.mu.Unlock()
	if !ok || !st.Active {
		// Nobody draws: no state to show (a session everyone left only resumes for someone drawing)
		st = drawlive.State{DocID: docID, BlockID: blockID, Participants: []drawlive.Person{}, Watchers: []drawlive.Person{},
			Els: []drawlive.Element{}, Order: []string{}}
	}
	writeJSON(w, http.StatusOK, withYou(st, ""))
}
