package api

import (
	"log/slog"
	"strings"

	"github.com/mindsift-app/mindsift/internal/ws"
)

// Realtime rooms are checked when a connection joins them (canJoinRoom). Whoever loses access later
// (a share removed, out of a group, the list or note deleted, a note moved out of a shared folder) is
// taken out of the rooms right after the change, or an open connection would keep receiving the list's
// entries (ITEM_*) and the live drawing (DRAW_*). Every change that can take access away calls one of
// these; broadcastListAudience does it itself for the lists.

// dropLostRooms rechecks every room of these people (a group they left, a group deleted).
func (s *Server) dropLostRooms(userIDs []string) {
	s.afterRoomsLeft(s.wsHub.RecheckRooms(userIDs))
}

// dropLostAllRooms rechecks every room of every connection: after changes whose losers are not known
// one by one. Only the fallback of accessLost.
func (s *Server) dropLostAllRooms() {
	s.afterRoomsLeft(s.wsHub.RecheckAllRooms())
}

// accessLost follows shares or group memberships that went in bulk, without an event of their own (the
// administration removed someone from an organization or deleted one, an account deleted, a stricter
// sharing mode; storage.PruneSharingPeople and Store.ConnectedUserIDs name the people concerned): the
// rooms of these people are rechecked and they get ACCESS_CHANGED, so their apps load their lists, task
// lists, notes, folders and groups again. nil, when the people could not be worked out, means everyone.
func (s *Server) accessLost(userIDs []string) {
	if s.wsHub != nil {
		if userIDs == nil {
			s.dropLostAllRooms()
		} else if len(userIDs) > 0 {
			s.dropLostRooms(userIDs)
		}
	}
	s.tellAccessChanged(userIDs)
}

// tellAccessChanged sends ACCESS_CHANGED to these people, or to every connection with nil (accessLost),
// and drops their cached counters (also of those not connected). Without a hub (the command line) nobody
// is connected.
func (s *Server) tellAccessChanged(userIDs []string) {
	if userIDs == nil {
		// Everyone's counters may have changed; the cache would hold the old ones for a few seconds
		if s.stats != nil { // the command line's account tools have none
			s.stats.clear()
		}
		if s.wsHub != nil {
			s.wsHub.BroadcastSystem(eventAccessChanged)
		}
		return
	}
	if len(userIDs) == 0 {
		return
	}
	if s.stats != nil {
		for _, uid := range userIDs {
			s.stats.invalidate(uid)
		}
	}
	if s.wsHub != nil {
		s.wsHub.BroadcastToUsers(userIDs, eventAccessChanged, map[string]any{})
	}
}

// accountPartners: everyone connected to the account through something shared, asked before it goes
// (their shares, groups and member lists change with it), and the account itself (its own connections
// leave the rooms of what it had); nil (everyone) when the query fails.
func (s *Server) accountPartners(userID string) []string {
	ids, err := s.store.ConnectedUserIDs(userID)
	if err != nil {
		slog.Warn("Finding the people an account shares with failed; everyone is told", "user_id", userID, "error", err)
		return nil
	}
	return append(ids, userID)
}

// dropLostListRoom rechecks everyone in a list's room (list deleted, a share removed).
func (s *Server) dropLostListRoom(listID string) {
	if listID == "" {
		return
	}
	s.afterRoomsLeft(s.wsHub.RecheckRoomsWhere(func(room string) bool { return room == listID }))
}

// dropLostNoteRooms rechecks everyone in the rooms of these notes and of their live drawings (note
// deleted, unshared, moved out of a shared folder, shared folder deleted or unshared).
func (s *Server) dropLostNoteRooms(docIDs ...string) {
	if len(docIDs) == 0 {
		return
	}
	ids := make(map[string]bool, len(docIDs))
	for _, id := range docIDs {
		ids[id] = true
	}
	s.afterRoomsLeft(s.wsHub.RecheckRoomsWhere(func(room string) bool { return ids[roomDocID(room)] }))
}

// lostUsers: the people in before who are not in after (each once).
func lostUsers(before, after []string) []string {
	keep := make(map[string]bool, len(after))
	for _, uid := range after {
		keep[uid] = true
	}
	var out []string
	for _, uid := range before {
		if uid != "" && !keep[uid] {
			keep[uid] = true
			out = append(out, uid)
		}
	}
	return out
}

// roomDocID is the note of a room "doc:<id>" or "drawing:<id>:<blockId>", "" for a list's room.
func roomDocID(room string) string {
	if id, ok := strings.CutPrefix(room, "doc:"); ok {
		return id
	}
	if rest, ok := strings.CutPrefix(room, "drawing:"); ok {
		id, _, _ := strings.Cut(rest, ":")
		return id
	}
	return ""
}

// afterRoomsLeft ends what hangs on a room taken away: a connection out of a live drawing's room also
// leaves the session (it could still send changes otherwise), and its app learns why.
func (s *Server) afterRoomsLeft(left []ws.RoomLeft) {
	for _, l := range left {
		rest, ok := strings.CutPrefix(l.Room, "drawing:")
		if !ok {
			continue
		}
		docID, blockID, _ := strings.Cut(rest, ":")
		s.drawLeave(docID, blockID, l.ConnID, "")
		d := s.draw
		d.mu.Lock()
		c := d.conns[l.ConnID]
		d.mu.Unlock()
		if c != nil {
			drawError(c, docID, blockID, "forbidden")
		}
	}
}
