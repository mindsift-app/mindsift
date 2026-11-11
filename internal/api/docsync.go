package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/collab"
	"github.com/mindsift-app/mindsift/internal/storage"
)

const (
	syncMaxOps     = 500
	syncMaxLog     = 1000
	syncMaxBody    = 8 << 20
	longPollMax    = 25 * time.Second
	maxClientIDLen = 64
)

type syncLeases struct {
	Granted []string           `json:"granted"`
	Denied  []string           `json:"denied"`
	Others  []collab.LeaseInfo `json:"others"`
}

type syncResponse struct {
	Results  []collab.Result       `json:"results"`
	Ops      []storage.DocLogEntry `json:"ops"`
	HeadSeq  int64                 `json:"headSeq"`
	HasMore  bool                  `json:"hasMore"`
	Resync   bool                  `json:"resync,omitempty"` // reload the snapshot (state ahead of the server or log compacted)
	Role     string                `json:"role"`
	Shared   bool                  `json:"shared"`
	Sessions int                   `json:"sessions"`
	Presence []collab.Presence     `json:"presence"`
	Leases   syncLeases            `json:"leases"`
	// Checkboxes linked to a task or to a subtask (block → task), for the editor's badges
	TaskLinks    map[string]string `json:"taskLinks"`
	SubtaskLinks map[string]string `json:"subtaskLinks"`
}

// docAccess resolves the caller's role; it writes 404 and returns "" without access.
func (s *Server) docAccess(w http.ResponseWriter, r *http.Request) (userID, docID, role string) {
	userID = auth.GetUserID(r.Context())
	docID = chi.URLParam(r, "id")
	role = s.store.DocRole(userID, docID)
	if role == "" {
		writeError(w, http.StatusNotFound, storage.ErrDocNotFound.Error())
	}
	return userID, docID, role
}

func (s *Server) handleDocSnapshot(w http.ResponseWriter, r *http.Request) {
	_, docID, role := s.docAccess(w, r)
	if role == "" {
		return
	}
	snap, err := s.store.GetDocSnapshotCtx(r.Context(), docID)
	if r.Context().Err() != nil {
		return // the client has gone; nobody reads the answer
	}
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"docId":        snap.DocID,
		"title":        snap.Title,
		"titleVersion": snap.TitleVersion,
		"headSeq":      snap.HeadSeq,
		"blocks":       snap.Blocks,
		"role":         role,
		"shared":       s.store.IsDocShared(docID),
	})
}

// handleDocSync is the single round trip of the sync protocol: send own operations, hold or release
// block leases, and receive every log entry after lastSeq.
func (s *Server) handleDocSync(w http.ResponseWriter, r *http.Request) {
	userID, docID, role := s.docAccess(w, r)
	if role == "" {
		return
	}
	// Requests the client has already given up (timeout, page closed) are dropped instead of worked off:
	// before the operations are applied, the client resends them anyway (opIds keep them single)
	ctx := r.Context()
	var req struct {
		ClientID string      `json:"clientId"`
		LastSeq  int64       `json:"lastSeq"`
		Ops      []collab.Op `json:"ops"`
		Leases   *struct {
			Hold    []string `json:"hold"`
			Release []string `json:"release"`
		} `json:"leases"`
		SkipLog bool `json:"skipLog"` // one-off changes (e.g. ticking a to-do in the overview) need no log
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, syncMaxBody)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültiges JSON")
		return
	}
	if req.ClientID == "" || len(req.ClientID) > maxClientIDLen {
		writeError(w, http.StatusBadRequest, "clientId fehlt oder ist zu lang")
		return
	}
	if len(req.Ops) > syncMaxOps {
		writeError(w, http.StatusRequestEntityTooLarge, "Zu viele Änderungen in einer Anfrage")
		return
	}
	canEdit := storage.CanEditDoc(role)
	if len(req.Ops) > 0 && !canEdit {
		writeError(w, http.StatusForbidden, "Keine Schreibrechte für diese Notiz (nur Lesen)")
		return
	}

	if ctx.Err() != nil {
		return
	}
	actor := collab.Actor{UserID: userID, ClientID: req.ClientID}
	if u, err := s.store.GetUserByID(userID); err == nil {
		actor.Name = u.DisplayName
	}
	// The others hear about a new session (presence) or a block changing hands, not about a sync that
	// changes nothing: they sync again on every notice, so that would never stop
	changed := s.leases.Touch(docID, actor)

	resp := syncResponse{Results: []collab.Result{}, Role: role, Leases: syncLeases{Granted: []string{}, Denied: []string{}}}
	var appliedHead int64
	if req.Leases != nil && canEdit {
		var leasesChanged bool
		resp.Leases.Granted, resp.Leases.Denied, leasesChanged = s.leases.Exchange(docID, actor, req.Leases.Hold, req.Leases.Release)
		changed = changed || leasesChanged
	}

	if len(req.Ops) > 0 {
		results, head, err := s.store.ApplyDocOpsCtx(ctx, docID, actor, req.Ops, s.leases.View(docID))
		appliedHead = head
		if ctx.Err() != nil && err != nil {
			return
		}
		if errors.Is(err, storage.ErrDocNotFound) {
			// Deleted while the client was still typing in it
			writeErrorFrom(w, http.StatusNotFound, err)
			return
		}
		if err != nil {
			writeInternal(w, err)
			return
		}
		resp.Results = results
		// New blocks (and conflict copies) belong to their author right away
		var own []string
		for i, res := range results {
			if res.Status == collab.StatusApplied && req.Ops[i].Kind == collab.OpInsert {
				own = append(own, req.Ops[i].BlockID)
			}
			if res.ConflictBlockID != "" {
				own = append(own, res.ConflictBlockID)
			}
			if res.Seq > 0 {
				changed = true
			}
		}
		if len(own) > 0 {
			granted, _ := s.leases.Hold(docID, actor, own)
			resp.Leases.Granted = append(resp.Leases.Granted, granted...)
		}
	}
	if changed {
		s.afterDocChange(userID, docID, req.Ops, resp.Results)
	}

	logLimit := syncMaxLog
	if req.SkipLog {
		logLimit = 0
	}
	entries, head, err := s.store.GetDocOpsSinceCtx(ctx, docID, req.LastSeq, logLimit)
	compacted := errors.Is(err, storage.ErrLogCompacted)
	if err != nil && !compacted {
		// Applied operations still reach the others, even if this client is gone
		if changed && appliedHead > 0 {
			s.notifyDocChanged(docID, appliedHead)
		}
		if ctx.Err() != nil {
			return
		}
		if errors.Is(err, storage.ErrDocNotFound) {
			writeErrorFrom(w, http.StatusNotFound, err)
			return
		}
		writeInternal(w, err)
		return
	}
	// Client state is ahead of the server, or so far behind that the log entries are compacted away
	if (req.LastSeq > head || compacted) && !req.SkipLog {
		resp.Resync = true
		entries = []storage.DocLogEntry{}
	}
	resp.Ops = entries
	resp.HeadSeq = head
	resp.HasMore = len(entries) == syncMaxLog && entries[len(entries)-1].Seq < head
	resp.Shared = s.store.IsDocShared(docID)
	resp.TaskLinks, resp.SubtaskLinks = s.store.DocTaskLinks(docID)
	resp.Sessions, resp.Presence = s.leases.Sessions(docID)
	resp.Leases.Others = s.leases.Others(docID, req.ClientID)

	if changed {
		s.notifyDocChanged(docID, head)
	}
	writeJSON(w, http.StatusOK, resp)
}

// afterDocChange runs side effects of applied operations: linked tasks follow their blocks, and a new
// title reaches the note lists of everyone with access.
func (s *Server) afterDocChange(actorID, docID string, ops []collab.Op, results []collab.Result) {
	titleChanged := false
	for i, res := range results {
		if i < len(ops) && ops[i].Kind == collab.OpSetTitle && res.Seq > 0 {
			titleChanged = true
		}
	}
	for _, before := range s.store.ReconcileDocTaskLinks(docID) {
		if th, err := s.store.GetThoughtByIDUnchecked(before.ID); err == nil {
			s.wsHub.BroadcastToUsers(s.taskAudience(th), "TASK_UPDATED", th)
			// Ticked or retitled in the note: told like a change in the task (unlinking alone changes nothing)
			if len(taskChanges(before, th)) > 0 {
				s.notifyTaskChange(actorID, before, th, false)
			}
		}
	}
	s.notifyNoteMentions(actorID, docID, ops, results)
	if titleChanged {
		s.broadcastDocToAuthorizedUsers(docID, "DOC_UPDATED")
	}
}

// notifyDocChanged wakes long-poll requests and pokes WebSocket/SSE clients in the note's room.
func (s *Server) notifyDocChanged(docID string, head int64) {
	s.notifier.Notify(docID)
	s.wsHub.BroadcastDocEvent(docID, "DOC_SEQ", map[string]any{"docId": docID, "headSeq": head})
}

// handleDocChanges is the long-poll fallback: it returns as soon as the note changes (or leases/presence
// change), at the latest after `wait` seconds. Clients then call /sync to fetch the data.
func (s *Server) handleDocChanges(w http.ResponseWriter, r *http.Request) {
	_, docID, role := s.docAccess(w, r)
	if role == "" {
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	wait := longPollMax
	if sec, err := strconv.Atoi(r.URL.Query().Get("wait")); err == nil && sec >= 0 && time.Duration(sec)*time.Second < wait {
		wait = time.Duration(sec) * time.Second
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(wait + 10*time.Second))

	woken := s.notifier.Changed(docID) // subscribe before reading, so no change can slip through
	_, head, err := s.store.GetDocOpsSinceCtx(r.Context(), docID, since, 0)
	if r.Context().Err() != nil {
		return
	}
	if errors.Is(err, storage.ErrDocNotFound) {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	if err != nil {
		writeInternal(w, err)
		return
	}
	changed := head > since
	if !changed {
		select {
		case <-woken:
			changed = true
		case <-time.After(wait):
		case <-r.Context().Done():
			return
		}
		if _, now, err := s.store.GetDocOpsSinceCtx(r.Context(), docID, since, 0); err == nil {
			head = now
		} else if r.Context().Err() == nil {
			logFailed("Reading the state of a note", err, "doc_id", docID) // the client syncs anyway
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"headSeq": head, "changed": changed})
}

// handleDocLeave ends a client's session on a note and frees its leases (tab closed, app in background).
func (s *Server) handleDocLeave(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	docID := chi.URLParam(r, "id")
	if s.store.DocRole(userID, docID) == "" {
		// Leaving a note that is gone meanwhile (deleted while open) is done already; only a note that
		// exists without access for the caller is "not found"
		if _, _, err := s.store.GetDocOpsSince(docID, 0, 0); errors.Is(err, storage.ErrDocNotFound) {
			s.leases.Forget(docID)
			writeJSON(w, http.StatusOK, map[string]bool{"success": true})
			return
		}
		writeError(w, http.StatusNotFound, storage.ErrDocNotFound.Error())
		return
	}
	var req struct {
		ClientID string `json:"clientId"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil || req.ClientID == "" {
		writeError(w, http.StatusBadRequest, "clientId fehlt")
		return
	}
	s.leases.Leave(docID, req.ClientID)
	_, head, _ := s.store.GetDocOpsSince(docID, 0, 0)
	s.notifyDocChanged(docID, head)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// compactionInterval is how often the operation log and tombstones are compacted (also once at start).
const compactionInterval = 6 * time.Hour

func (s *Server) startCompaction() {
	defer s.bg.Done()
	for {
		s.compactOnce()
		select {
		case <-s.stop:
			return
		case <-time.After(compactionInterval):
		}
	}
}

func (s *Server) compactOnce() {
	s.leases.Sweep()
	if n := s.store.PurgeUnverifiedAccounts(time.Now()); n > 0 {
		slog.Info("Unconfirmed registrations deleted", "count", n)
	}
	s.compactMedia(time.Now())
	logFailed("Removing old link previews", s.store.PruneLinkPreviews(time.Now().Add(-30*24*time.Hour)))
	st, err := s.store.CompactDocs(time.Now())
	if err != nil {
		slog.Error("Compacting the change log failed", "error", err)
	}
	// Open editors drop the purged tombstones with their next sync
	for docID, head := range st.Purged {
		s.notifyDocChanged(docID, head)
	}
	if st.Docs > 0 || st.OpResults > 0 {
		slog.Info("Change log compacted", "notes", st.Docs, "log_entries", st.LogEntries, "tombstones", st.Tombstones, "op_results", st.OpResults)
	}
}
