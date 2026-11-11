package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/mindsift-app/mindsift/internal/auth"
)

// WebSocket and EventSource cannot send an Authorization header, so the browser used to put its
// 30-day session token into the URL, where it ends up in proxy and access logs (FLAW-22). Instead the
// app now asks for a stream ticket (POST /auth/stream-ticket, with the normal header) right before it
// connects and passes that: random, valid for 60 seconds, usable once, bound to the session's token
// version. A ticket in a log is worthless.

const streamTicketTTL = 60 * time.Second

type streamTicket struct {
	userID       string
	sessionID    string
	tokenVersion int
	expires      time.Time
}

type streamTickets struct {
	mu      sync.Mutex
	tickets map[string]streamTicket
}

func (t *streamTickets) issue(userID, sessionID string, tokenVersion int) (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := hex.EncodeToString(buf)
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.tickets == nil {
		t.tickets = map[string]streamTicket{}
	}
	for k, v := range t.tickets {
		if now.After(v.expires) {
			delete(t.tickets, k)
		}
	}
	t.tickets[id] = streamTicket{userID: userID, sessionID: sessionID, tokenVersion: tokenVersion, expires: now.Add(streamTicketTTL)}
	return id, nil
}

// consume returns the ticket and removes it; ok is false for unknown or expired tickets.
func (t *streamTickets) consume(id string) (streamTicket, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	tk, ok := t.tickets[id]
	delete(t.tickets, id)
	if !ok || time.Now().After(tk.expires) {
		return streamTicket{}, false
	}
	return tk, true
}

func (s *Server) handleStreamTicket(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.GetUserByID(auth.GetUserID(r.Context()))
	if err != nil || user == nil {
		writeError(w, http.StatusUnauthorized, "Nicht autorisiert")
		return
	}
	ticket, err := s.streamTickets.issue(user.ID, sessionIDFrom(r), user.TokenVersion)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ticket konnte nicht erstellt werden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ticket": ticket, "expiresIn": int(streamTicketTTL.Seconds())})
}

// streamOriginAllowed: with BASE_URL set, browsers may open WebSockets only from that address or the
// requested host itself. Requests without Origin (non-browser clients) pass; they need a ticket anyway.
func (s *Server) streamOriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || !s.cfg.BaseURLSet {
		return true
	}
	o, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if strings.EqualFold(o.Host, r.Host) {
		return true
	}
	base, err := url.Parse(s.cfg.BaseURL)
	return err == nil && strings.EqualFold(o.Host, base.Host)
}
