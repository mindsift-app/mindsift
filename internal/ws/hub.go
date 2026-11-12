package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mindsift-app/mindsift/internal/domain"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return originCheck(r)
	},
}

// originCheck decides which browser origins may open a WebSocket (see SetOriginCheck). Without a
// configured check every origin is accepted: proxies often rewrite the Host header, so a plain
// same-host comparison would break working setups.
var originCheck = func(*http.Request) bool { return true }

// SetOriginCheck installs the origin rule for WebSocket upgrades.
func (h *Hub) SetOriginCheck(f func(*http.Request) bool) {
	if f != nil {
		originCheck = f
	}
}

type Client struct {
	hub             *Hub
	id              string // connection id (live drawing sessions tell connections apart by it)
	conn            *websocket.Conn
	roomID          string
	userID          string
	send            chan []byte
	subscribedRooms map[string]bool
	createdAt       time.Time // when the connection was opened (oldest is evicted over the per-user limit)
	sendMu          sync.RWMutex
	closed          bool
}

// ID is the connection's id.
func (c *Client) ID() string { return c.id }

// UserID is the signed-in user of the connection.
func (c *Client) UserID() string { return c.userID }

func (c *Client) closeSend() {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.send)
	}
}

func (c *Client) trySend(data []byte) {
	c.sendMu.RLock()
	defer c.sendMu.RUnlock()
	if c.closed {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}

type SSEClient struct {
	id              string
	userID          string
	roomID          string
	send            chan []byte
	subscribedRooms map[string]bool
	createdAt       time.Time // when the connection was opened (oldest is evicted over the per-user limit)
	sendMu          sync.RWMutex
	closed          bool
}

func (c *SSEClient) closeSend() {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.send)
	}
}

func (c *SSEClient) trySend(data []byte) {
	c.sendMu.RLock()
	defer c.sendMu.RUnlock()
	if c.closed {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}

type Hub struct {
	mu           sync.RWMutex
	rooms        map[string]map[*Client]bool
	userRooms    map[string]map[*Client]bool
	allClients   map[*Client]bool
	sseClients   map[*SSEClient]bool
	sseUserRooms map[string]map[*SSEClient]bool
	sseRooms     map[string]map[*SSEClient]bool
	polls        map[string]*pollConn
	closed       bool

	// authorizeRoom decides whether a user may receive events of a room; without it every join is denied
	authorizeRoom func(userID, roomID string) bool
	// messages takes client messages the hub does not handle itself (live drawing, DRAW_*)
	messages MessageHandler
}

// MessageHandler handles messages browsers send over WebSocket beyond room subscriptions, and learns
// when a connection (WebSocket, SSE or long poll) is gone.
type MessageHandler interface {
	HandleMessage(c *Client, event string, payload json.RawMessage)
	ConnectionGone(connID string)
}

// SetMessageHandler installs the handler for DRAW_* messages and closed connections.
func (h *Hub) SetMessageHandler(m MessageHandler) {
	h.mu.Lock()
	h.messages = m
	h.mu.Unlock()
}

func (h *Hub) messageHandler() MessageHandler {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.messages
}

// connectionGone tells the message handler; called without holding h.mu.
func (h *Hub) connectionGone(connID string) {
	if m := h.messageHandler(); m != nil && connID != "" {
		m.ConnectionGone(connID)
	}
}

// SetRoomAuthorizer installs the permission check used for every room join (URL room, JOIN_ROOM, SSE rooms).
func (h *Hub) SetRoomAuthorizer(f func(userID, roomID string) bool) {
	h.mu.Lock()
	h.authorizeRoom = f
	h.mu.Unlock()
}

// canJoin must be called without holding h.mu, since the authorizer queries the database.
func (h *Hub) canJoin(userID, roomID string) bool {
	if roomID == "" || userID == "" || userID == "anonymous" {
		return false
	}
	h.mu.RLock()
	f := h.authorizeRoom
	h.mu.RUnlock()
	return f != nil && f(userID, roomID)
}

func NewHub() *Hub {
	return &Hub{
		rooms:        make(map[string]map[*Client]bool),
		userRooms:    make(map[string]map[*Client]bool),
		allClients:   make(map[*Client]bool),
		sseClients:   make(map[*SSEClient]bool),
		sseUserRooms: make(map[string]map[*SSEClient]bool),
		sseRooms:     make(map[string]map[*SSEClient]bool),
		polls:        make(map[string]*pollConn),
	}
}

// Long polling, for networks that let neither WebSocket nor event streams through (proxies that buffer
// SSE): a poll connection is an SSEClient without a stream. Its events wait in the send buffer until the
// next poll picks them up; room joins work like for SSE (JoinSSERoomByID with its id).

// PollIdleTimeout: a poll connection nobody asked for this long is closed (tab closed, device asleep).
const PollIdleTimeout = 2 * time.Minute

// MaxConnectionsPerUser caps how many realtime connections (WebSocket + SSE + long-poll together) one
// account may hold at once. Generous: several devices with a few tabs each still fit; it only stops a
// single account from binding server resources without bound (FLAW-42). When a new connection would go
// over the cap, the account's oldest connection is closed instead of refusing the new one, so a device
// that reconnects before its stale connection is cleaned up never locks the account out.
const MaxConnectionsPerUser = 20

type pollConn struct {
	client   *SSEClient
	lastPoll time.Time
	waiting  int // polls running right now
}

// OpenPoll registers a poll connection for the user and returns its id.
func (h *Hub) OpenPoll(userID string, rooms []string) string {
	h.sweepPolls()
	c := &SSEClient{
		id:              domain.NewID("poll"),
		userID:          userID,
		send:            make(chan []byte, 256),
		subscribedRooms: make(map[string]bool),
		createdAt:       time.Now(),
	}
	for _, room := range rooms {
		if room = strings.TrimSpace(room); room != "" {
			c.subscribedRooms[room] = true
		}
	}
	h.RegisterSSE(c)
	h.mu.Lock()
	h.polls[c.id] = &pollConn{client: c, lastPoll: time.Now()}
	h.mu.Unlock()
	return c.id
}

// Poll waits up to wait for events of the user's poll connection id and returns everything buffered.
// ok is false when the connection is unknown or closed (expired, server restart): open a new one.
func (h *Hub) Poll(ctx context.Context, id, userID string, wait time.Duration) (events []json.RawMessage, ok bool) {
	h.sweepPolls()
	h.mu.Lock()
	p := h.polls[id]
	if p == nil || p.client.userID != userID {
		h.mu.Unlock()
		return nil, false
	}
	p.waiting++
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		p.waiting--
		p.lastPoll = time.Now()
		h.mu.Unlock()
	}()

	// What is already waiting goes out right away; otherwise wait for the first event
	events, open := drainBuffered(p.client.send)
	if len(events) > 0 || !open {
		return events, open || len(events) > 0
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case msg, open := <-p.client.send:
		if !open {
			return nil, false
		}
		rest, _ := drainBuffered(p.client.send) // whatever came along goes in the same answer
		return append([]json.RawMessage{msg}, rest...), true
	case <-timer.C:
	case <-ctx.Done():
	}
	return events, true
}

// drainBuffered takes everything waiting in ch without blocking; open is false once ch is closed.
func drainBuffered(ch chan []byte) (events []json.RawMessage, open bool) {
	events = []json.RawMessage{}
	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return events, false
			}
			events = append(events, msg)
		default:
			return events, true
		}
	}
}

// sweepPolls closes poll connections that were not asked for within PollIdleTimeout.
func (h *Hub) sweepPolls() {
	h.mu.Lock()
	var stale []*SSEClient
	for id, p := range h.polls {
		if p.waiting == 0 && time.Since(p.lastPoll) > PollIdleTimeout {
			stale = append(stale, p.client)
			delete(h.polls, id)
		}
	}
	h.mu.Unlock()
	for _, c := range stale {
		h.UnregisterSSE(c)
	}
}

func (h *Hub) Register(c *Client) {
	if c.roomID != "" && !h.canJoin(c.userID, c.roomID) {
		c.roomID = ""
	}
	h.mu.Lock()
	h.allClients[c] = true
	if c.roomID != "" {
		if h.rooms[c.roomID] == nil {
			h.rooms[c.roomID] = make(map[*Client]bool)
		}
		h.rooms[c.roomID][c] = true
	}
	if c.userID != "" && c.userID != "anonymous" {
		if h.userRooms[c.userID] == nil {
			h.userRooms[c.userID] = make(map[*Client]bool)
		}
		h.userRooms[c.userID][c] = true
	}
	onlineCount := len(h.allClients) + len(h.sseClients)
	h.mu.Unlock()

	h.enforceUserConnLimit(c.userID)

	if c.roomID != "" {
		h.Broadcast(c.roomID, "", "USER_PRESENCE", map[string]any{
			"onlineCount": onlineCount,
		})
	}
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	h.removeClientLocked(c)
	h.mu.Unlock()
	h.connectionGone(c.id)
}

// removeClientLocked drops a WebSocket client from every map and closes its send channel. The caller
// holds h.mu.
func (h *Hub) removeClientLocked(c *Client) {
	delete(h.allClients, c)
	if c.roomID != "" {
		if room, ok := h.rooms[c.roomID]; ok {
			delete(room, c)
			if len(room) == 0 {
				delete(h.rooms, c.roomID)
			}
		}
	}

	if c.subscribedRooms != nil {
		for rID := range c.subscribedRooms {
			if room, ok := h.rooms[rID]; ok {
				delete(room, c)
				if len(room) == 0 {
					delete(h.rooms, rID)
				}
			}
		}
	}

	if c.userID != "" && c.userID != "anonymous" {
		if uRoom, ok := h.userRooms[c.userID]; ok {
			delete(uRoom, c)
			if len(uRoom) == 0 {
				delete(h.userRooms, c.userID)
			}
		}
	}
	c.closeSend()
}

func (h *Hub) RegisterSSE(c *SSEClient) {
	if c.roomID != "" && !h.canJoin(c.userID, c.roomID) {
		c.roomID = ""
	}
	for rID := range c.subscribedRooms {
		if !h.canJoin(c.userID, rID) {
			delete(c.subscribedRooms, rID)
		}
	}
	h.mu.Lock()
	h.sseClients[c] = true
	if c.roomID != "" {
		if h.sseRooms[c.roomID] == nil {
			h.sseRooms[c.roomID] = make(map[*SSEClient]bool)
		}
		h.sseRooms[c.roomID][c] = true
	}
	if c.userID != "" && c.userID != "anonymous" {
		if h.sseUserRooms[c.userID] == nil {
			h.sseUserRooms[c.userID] = make(map[*SSEClient]bool)
		}
		h.sseUserRooms[c.userID][c] = true
	}
	if c.subscribedRooms != nil {
		for rID := range c.subscribedRooms {
			if h.sseRooms[rID] == nil {
				h.sseRooms[rID] = make(map[*SSEClient]bool)
			}
			h.sseRooms[rID][c] = true
		}
	}
	onlineCount := len(h.allClients) + len(h.sseClients)
	h.mu.Unlock()

	h.enforceUserConnLimit(c.userID)

	if c.roomID != "" {
		h.Broadcast(c.roomID, "", "USER_PRESENCE", map[string]any{
			"onlineCount": onlineCount,
		})
	}
}

func (h *Hub) UnregisterSSE(c *SSEClient) {
	h.mu.Lock()
	h.removeSSEClientLocked(c)
	h.mu.Unlock()
	h.connectionGone(c.id)
}

// removeSSEClientLocked drops an SSE or long-poll client from every map (including the poll registry)
// and closes its send channel. The caller holds h.mu.
func (h *Hub) removeSSEClientLocked(c *SSEClient) {
	delete(h.sseClients, c)
	delete(h.polls, c.id) // no-op for a plain SSE client; closes a long-poll connection too
	if c.roomID != "" {
		if room, ok := h.sseRooms[c.roomID]; ok {
			delete(room, c)
			if len(room) == 0 {
				delete(h.sseRooms, c.roomID)
			}
		}
	}
	if c.subscribedRooms != nil {
		for rID := range c.subscribedRooms {
			if room, ok := h.sseRooms[rID]; ok {
				delete(room, c)
				if len(room) == 0 {
					delete(h.sseRooms, rID)
				}
			}
		}
	}
	if c.userID != "" && c.userID != "anonymous" {
		if uRoom, ok := h.sseUserRooms[c.userID]; ok {
			delete(uRoom, c)
			if len(uRoom) == 0 {
				delete(h.sseUserRooms, c.userID)
			}
		}
	}
	c.closeSend()
}

// enforceUserConnLimit closes a user's oldest realtime connections when they would exceed
// MaxConnectionsPerUser (WebSocket, SSE and long-poll counted together). Called right after a new
// connection is registered.
func (h *Hub) enforceUserConnLimit(userID string) {
	if userID == "" || userID == "anonymous" {
		return
	}
	h.mu.Lock()
	total := len(h.userRooms[userID]) + len(h.sseUserRooms[userID])
	if total <= MaxConnectionsPerUser {
		h.mu.Unlock()
		return
	}
	// Every connection of the user, oldest first
	type conn struct {
		at  time.Time
		ws  *Client
		sse *SSEClient
	}
	conns := make([]conn, 0, total)
	for c := range h.userRooms[userID] {
		conns = append(conns, conn{at: c.createdAt, ws: c})
	}
	for c := range h.sseUserRooms[userID] {
		conns = append(conns, conn{at: c.createdAt, sse: c})
	}
	sort.Slice(conns, func(i, j int) bool { return conns[i].at.Before(conns[j].at) })
	evicted := conns[:total-MaxConnectionsPerUser]
	gone := make([]string, 0, len(evicted))
	for _, v := range evicted {
		if v.ws != nil {
			h.removeClientLocked(v.ws)
			gone = append(gone, v.ws.id)
		} else {
			h.removeSSEClientLocked(v.sse)
			gone = append(gone, v.sse.id)
		}
	}
	h.mu.Unlock()
	for _, id := range gone {
		h.connectionGone(id)
	}
	slog.Warn("Connection limit reached: oldest connection(s) closed",
		"user_id", userID, "closed", len(evicted), "limit", MaxConnectionsPerUser)
}

// JoinSSERoomByID adds the SSE connection sseID to a room; it only succeeds for the user owning that connection.
func (h *Hub) JoinSSERoomByID(sseID, userID, roomID string) bool {
	if !h.canJoin(userID, roomID) {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for client := range h.sseClients {
		if client.id == sseID && client.userID == userID {
			if h.sseRooms[roomID] == nil {
				h.sseRooms[roomID] = make(map[*SSEClient]bool)
			}
			h.sseRooms[roomID][client] = true
			if client.subscribedRooms == nil {
				client.subscribedRooms = make(map[string]bool)
			}
			client.subscribedRooms[roomID] = true
			return true
		}
	}
	return false
}

func (h *Hub) LeaveSSERoomByID(sseID, userID, roomID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for client := range h.sseClients {
		if client.id == sseID && client.userID == userID {
			if room, ok := h.sseRooms[roomID]; ok {
				delete(room, client)
				if len(room) == 0 {
					delete(h.sseRooms, roomID)
				}
			}
			if client.subscribedRooms != nil {
				delete(client.subscribedRooms, roomID)
			}
			return true
		}
	}
	return false
}

// Close gracefully disconnects all WebSocket and SSE connections so HTTP shutdown completes immediately.
func (h *Hub) Close() {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return
	}
	h.closed = true

	allWsClients := make([]*Client, 0, len(h.allClients))
	for c := range h.allClients {
		allWsClients = append(allWsClients, c)
	}

	allSSEClients := make([]*SSEClient, 0, len(h.sseClients))
	for c := range h.sseClients {
		allSSEClients = append(allSSEClients, c)
	}
	h.mu.Unlock()

	for _, c := range allWsClients {
		_ = c.conn.Close()
		c.closeSend()
	}

	for _, c := range allSSEClients {
		c.closeSend()
	}
}

// Broadcasting Methods

func (h *Hub) BroadcastToUser(userID, event string, payload any) {
	msg := domain.WSMessage{
		Event:     event,
		Payload:   payload,
		Timestamp: domain.NowISO(),
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	if h.closed {
		h.mu.RUnlock()
		return
	}
	defer h.mu.RUnlock()

	if room, ok := h.userRooms[userID]; ok {
		for client := range room {
			client.trySend(data)
		}
	}
	if sseRoom, ok := h.sseUserRooms[userID]; ok {
		for sseClient := range sseRoom {
			sseClient.trySend(data)
		}
	}
}

// DisconnectUser ends every live connection of a user (logout, all sessions ended, new password,
// account deactivated). Clients reconnect with a fresh ticket if their session is still valid.
func (h *Hub) DisconnectUser(userID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.userRooms[userID] {
		client.closeSend()
	}
	for sseClient := range h.sseUserRooms[userID] {
		sseClient.closeSend()
	}
}

// BroadcastSystem sends an event to every connection. Only for events without user data (e.g. the
// demo reset notice).
func (h *Hub) BroadcastSystem(event string) {
	data, err := json.Marshal(domain.WSMessage{Event: event, Timestamp: domain.NowISO()})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.closed {
		return
	}
	for client := range h.allClients {
		client.trySend(data)
	}
	for sseClient := range h.sseClients {
		sseClient.trySend(data)
	}
}

// BroadcastToUsers sends one event to every connection of the given users (duplicates are ignored).
func (h *Hub) BroadcastToUsers(userIDs []string, event string, payload any) {
	seen := make(map[string]bool, len(userIDs))
	for _, uid := range userIDs {
		if uid == "" || seen[uid] {
			continue
		}
		seen[uid] = true
		h.BroadcastToUser(uid, event, payload)
	}
}

func (h *Hub) BroadcastDocEvent(docID, event string, payload any) {
	if docID != "" {
		h.BroadcastRoom("doc:"+docID, event, payload, nil)
	}
}

func (h *Hub) Broadcast(spaceID, listID, event string, payload any) {
	msg := domain.WSMessage{
		Event:     event,
		ListID:    listID,
		Payload:   payload,
		Timestamp: domain.NowISO(),
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	if h.closed {
		h.mu.RUnlock()
		return
	}
	defer h.mu.RUnlock()

	targetRoom := listID
	if targetRoom == "" {
		targetRoom = spaceID
	}

	if room, ok := h.rooms[targetRoom]; ok {
		for client := range room {
			client.trySend(data)
		}
	}
	if sseRoom, ok := h.sseRooms[targetRoom]; ok {
		for sseClient := range sseRoom {
			sseClient.trySend(data)
		}
	}
}

func (h *Hub) BroadcastListEvent(listID, event string, payload any) {
	h.Broadcast("", listID, event, payload)
}

func (h *Hub) JoinRoom(c *Client, roomID string) bool {
	if !h.canJoin(c.userID, roomID) {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[roomID] == nil {
		h.rooms[roomID] = make(map[*Client]bool)
	}
	h.rooms[roomID][c] = true
	if c.subscribedRooms == nil {
		c.subscribedRooms = make(map[string]bool)
	}
	c.subscribedRooms[roomID] = true
	return true
}

func (h *Hub) LeaveRoom(c *Client, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if room, ok := h.rooms[roomID]; ok {
		delete(room, c)
		if len(room) == 0 {
			delete(h.rooms, roomID)
		}
	}
	if c.subscribedRooms != nil {
		delete(c.subscribedRooms, roomID)
	}
}

func (h *Hub) BroadcastRoom(roomID, event string, payload any, excludeClient *Client) {
	msg := domain.WSMessage{
		Event:     event,
		Payload:   payload,
		Timestamp: domain.NowISO(),
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	if h.closed {
		h.mu.RUnlock()
		return
	}
	defer h.mu.RUnlock()

	if room, ok := h.rooms[roomID]; ok {
		for client := range room {
			if excludeClient != nil && client == excludeClient {
				continue
			}
			client.trySend(data)
		}
	}
	if sseRoom, ok := h.sseRooms[roomID]; ok {
		for sseClient := range sseRoom {
			sseClient.trySend(data)
		}
	}
}

func (c *Client) SendEvent(event string, payload any) {
	msg := domain.WSMessage{
		Event:     event,
		Payload:   payload,
		Timestamp: domain.NowISO(),
	}
	data, err := json.Marshal(msg)
	if err == nil {
		c.trySend(data)
	}
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, roomID, userID string) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("WebSocket upgrade error", "room_id", roomID, "user_id", userID, "error", err)
		return
	}

	client := &Client{
		hub:       h,
		id:        domain.NewID("ws"),
		conn:      conn,
		roomID:    roomID,
		userID:    userID,
		send:      make(chan []byte, 128),
		createdAt: time.Now(),
	}

	h.Register(client)
	go client.writePump()
	go client.readPump()
}

func (h *Hub) ServeSSE(w http.ResponseWriter, r *http.Request, roomID, userID string, initialRooms []string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}

	// The server's WriteTimeout would cut long-lived streams; lift it for this response only
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	client := &SSEClient{
		id:              domain.NewID("sse"),
		userID:          userID,
		roomID:          roomID,
		send:            make(chan []byte, 128),
		subscribedRooms: make(map[string]bool),
		createdAt:       time.Now(),
	}

	for _, room := range initialRooms {
		if strings.TrimSpace(room) != "" {
			client.subscribedRooms[strings.TrimSpace(room)] = true
		}
	}

	h.RegisterSSE(client)
	defer h.UnregisterSSE(client)

	// Send initial connected comment and event
	fmt.Fprintf(w, ": connected (transport: sse, id: %s)\n\n", client.id)
	connectedMsg, _ := json.Marshal(domain.WSMessage{
		Event: "SSE_CONNECTED",
		Payload: map[string]any{
			"sseId":     client.id,
			"transport": "sse",
			"userId":    userID,
		},
		Timestamp: domain.NowISO(),
	})
	fmt.Fprintf(w, "data: %s\n\n", connectedMsg)
	flusher.Flush()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	notify := r.Context().Done()

	for {
		select {
		case <-notify:
			return
		case msg, ok := <-client.send:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case <-ticker.C:
			// Periodic ping comment to keep HTTP connection alive and prevent proxy timeouts
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.Unregister(c)
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(4 * 1024 * 1024) // 4MB for large document CRDT updates
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		// Handle client-initiated room subscription messages
		var incoming struct {
			Event   string          `json:"event"`
			DocID   string          `json:"docId"`
			Room    string          `json:"room"`
			Payload json.RawMessage `json:"payload"`
		}
		if json.Unmarshal(message, &incoming) == nil && c.userID != "" && c.userID != "anonymous" {
			docID := incoming.DocID
			if docID == "" && len(incoming.Payload) > 0 {
				var p struct {
					DocID string `json:"docId"`
				}
				_ = json.Unmarshal(incoming.Payload, &p)
				docID = p.DocID
			}

			// Room subscription without requiring docID
			if incoming.Event == "PING" {
				// App-level heartbeat: lets clients detect proxies that accept the upgrade but forward nothing
				c.SendEvent("PONG", nil)
			} else if incoming.Event == "JOIN_ROOM" {
				room := incoming.Room
				if room == "" {
					room = docID
				}
				if room != "" {
					c.hub.JoinRoom(c, room)
				}
			} else if incoming.Event == "LEAVE_ROOM" {
				room := incoming.Room
				if room == "" {
					room = docID
				}
				if room != "" {
					c.hub.LeaveRoom(c, room)
				}
			} else if strings.HasPrefix(incoming.Event, "DRAW_") {
				// Live drawing: only over WebSocket, the one way a browser can send this fast
				if m := c.hub.messageHandler(); m != nil {
					m.HandleMessage(c, incoming.Event, incoming.Payload)
				}
			}
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
