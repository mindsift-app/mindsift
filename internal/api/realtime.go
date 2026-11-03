package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
)

// authenticateUserFromReq authenticates a live stream: a one-time ticket (?ticket=, browsers) or a
// session in the Authorization header (other clients). Session tokens in the URL are not accepted any
// more (FLAW-22), API keys never (streams carry the user's data, keys only deliver).
func (s *Server) authenticateUserFromReq(r *http.Request) string {
	if id := r.URL.Query().Get("ticket"); id != "" {
		tk, ok := s.streamTickets.consume(id)
		if !ok {
			return ""
		}
		u, err := s.store.GetUserByID(tk.userID)
		if err != nil || u == nil || !u.IsActive || u.TokenVersion != tk.tokenVersion || !s.store.SessionActive(tk.sessionID, u.ID) {
			return ""
		}
		return u.ID
	}
	token := ""
	if authHdr := r.Header.Get("Authorization"); strings.HasPrefix(authHdr, "Bearer ") {
		token = strings.TrimPrefix(authHdr, "Bearer ")
	}
	if user, key := s.authenticateToken(token); user != nil && key == nil {
		return user.ID
	}
	return ""
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Some corporate proxies and reverse proxies (e.g. OpenResty/Nginx or HTTP/2 intermediaries)
	// strip or alter the Connection header (e.g. "close" or missing) while passing
	// Sec-WebSocket-Key or Upgrade: websocket. Normalize it so Gorilla Upgrader succeeds.
	if r.Header.Get("Sec-Websocket-Key") != "" {
		if !strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
			r.Header.Set("Connection", "Upgrade")
		}
		if !strings.Contains(strings.ToLower(r.Header.Get("Upgrade")), "websocket") {
			r.Header.Set("Upgrade", "websocket")
		}
	}

	roomID := chi.URLParam(r, "listId")
	if roomID == "" {
		roomID = chi.URLParam(r, "spaceId")
	}
	if roomID == "" {
		roomID = r.URL.Query().Get("listId")
	}
	if roomID == "" {
		roomID = r.URL.Query().Get("spaceId")
	}

	userID := s.authenticateUserFromReq(r)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "Nicht autorisiert – bitte anmelden")
		return
	}
	s.wsHub.ServeWS(w, r, roomID, userID)
}

func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("listId")
	if roomID == "" {
		roomID = r.URL.Query().Get("spaceId")
	}

	userID := s.authenticateUserFromReq(r)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "Nicht autorisiert – bitte anmelden")
		return
	}

	var initialRooms []string
	if roomsParam := r.URL.Query().Get("rooms"); roomsParam != "" {
		for _, rm := range strings.Split(roomsParam, ",") {
			rm = strings.TrimSpace(rm)
			if rm != "" {
				initialRooms = append(initialRooms, rm)
			}
		}
	}
	if docID := r.URL.Query().Get("docId"); docID != "" {
		initialRooms = append(initialRooms, "doc:"+strings.TrimSpace(docID))
	}

	s.wsHub.ServeSSE(w, r, roomID, userID, initialRooms)
}

func (s *Server) handleSSERooms(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		SSEID  string `json:"sseId"`
		Room   string `json:"room"`
		DocID  string `json:"docId"`
		Action string `json:"action"` // "join" or "leave"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	if req.Room == "" && req.DocID != "" {
		req.Room = "doc:" + req.DocID
	}
	if req.SSEID == "" || req.Room == "" {
		writeError(w, http.StatusBadRequest, "sseId und room erforderlich")
		return
	}

	if req.Action == "leave" {
		s.wsHub.LeaveSSERoomByID(req.SSEID, userID, req.Room)
		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
		return
	}
	if !s.wsHub.JoinSSERoomByID(req.SSEID, userID, req.Room) {
		writeError(w, http.StatusForbidden, "Kein Zugriff auf diesen Raum")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// handleOpenPoll starts a long-poll connection (third transport after WebSocket and SSE, for proxies that
// let neither through). Rooms can be given right away or joined later via /events/rooms with the id.
func (s *Server) handleOpenPoll(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Rooms []string `json:"rooms"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&req)
	writeJSON(w, http.StatusOK, map[string]string{"pollId": s.wsHub.OpenPoll(auth.GetUserID(r.Context()), req.Rooms)})
}

// handlePoll returns the events of a poll connection as soon as there are some, at the latest after
// `wait` seconds (empty list). 404: the connection expired, the client opens a new one.
func (s *Server) handlePoll(w http.ResponseWriter, r *http.Request) {
	wait := longPollMax
	if sec, err := strconv.Atoi(r.URL.Query().Get("wait")); err == nil && sec >= 0 && time.Duration(sec)*time.Second < wait {
		wait = time.Duration(sec) * time.Second
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(wait + 10*time.Second))
	events, ok := s.wsHub.Poll(r.Context(), chi.URLParam(r, "id"), auth.GetUserID(r.Context()), wait)
	if !ok {
		writeError(w, http.StatusNotFound, "Verbindung abgelaufen")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"events": events})
}
