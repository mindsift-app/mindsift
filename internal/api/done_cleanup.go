package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// startDoneCleanupTicker runs the retention delays (storage/retention.go): completed tasks into the
// task trash, the trashes and ticked-off list items emptied; once shortly after the start and then
// every hour. Expired and unused OAuth connections go in the same pass (oauth.go), and so do hidden
// values no note holds any more (secrets.go), expired public links (publiclinks.go) and backups of
// deleted accounts past the backup retention (backups.go).
func (s *Server) startDoneCleanupTicker() {
	time.Sleep(2 * time.Minute)
	s.runDoneCleanup(time.Now())
	s.runOAuthCleanup(time.Now())
	s.runSecretSweep(time.Now())
	s.runPublicLinkCleanup(time.Now())
	s.runDeletedBackupSweep(time.Now())
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for now := range ticker.C {
		s.runDoneCleanup(now)
		s.runOAuthCleanup(now)
		s.runSecretSweep(now)
		s.runPublicLinkCleanup(now)
		s.runDeletedBackupSweep(now)
	}
}

// allowNeverRetention: RETENTION_ALLOW_NEVER if set, else the admin's switch in the system settings.
func (s *Server) allowNeverRetention() bool {
	if s.cfg.RetentionAllowNever != nil {
		return *s.cfg.RetentionAllowNever
	}
	return s.store.RetentionAllowNeverSetting()
}

func (s *Server) runDoneCleanup(now time.Time) {
	res, err := s.store.PurgeExpired(now, s.allowNeverRetention())
	if err != nil {
		slog.Error("Cleaning up by retention periods failed", "error", err)
	}
	if n := len(res.TasksToTrash) + len(res.TrashedTasks) + res.Discarded + len(res.Notes) + len(res.ListItems) + res.Invites; n > 0 {
		slog.Info("Retention periods applied", "erledigte_in_papierkorb", len(res.TasksToTrash), "papierkorb_aufgaben", len(res.TrashedTasks),
			"triage", res.Discarded, "notizen", len(res.Notes), "listeneintraege", len(res.ListItems), "einladungen", res.Invites)
	}
	s.broadcastDeletedTasks(res.TasksToTrash)
	for _, it := range res.ListItems {
		s.wsHub.BroadcastListEvent(it.ListID, "ITEM_DELETED", map[string]string{"itemId": it.ID, "listId": it.ListID})
	}
}

// broadcastDeletedTasks tells everyone who saw the tasks; there are no watcher notifications for this.
func (s *Server) broadcastDeletedTasks(deleted []storage.DeletedTask) {
	for _, d := range deleted {
		audience := append(s.store.GetTaskListUserIDs(d.TaskListID), d.UserID)
		s.wsHub.BroadcastToUsers(audience, "TASK_DELETED", map[string]string{"id": d.ID})
	}
}

// handleClearDoneTasks: "Erledigte leeren" (into the task trash) for one task list (taskListId) or all
// the user can edit.
func (s *Server) handleClearDoneTasks(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	var req struct {
		TaskListID string `json:"taskListId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	deleted, err := s.store.ClearDoneTasks(userID, req.TaskListID)
	if err != nil {
		writeStoreError(w, http.StatusBadRequest, err)
		return
	}
	s.broadcastDeletedTasks(deleted)
	writeJSON(w, http.StatusOK, map[string]int{"deleted": len(deleted)})
}

// --- Task trash (storage/task_trash.go) ---

// handleGetTaskTrash: GET /tasks/trash?taskListId= – the trashed tasks the user can see.
func (s *Server) handleGetTaskTrash(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.GetTaskTrash(auth.GetUserID(r.Context()), r.URL.Query().Get("taskListId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// handleRestoreTrashedTask puts a task back and tells everyone who sees it.
func (s *Server) handleRestoreTrashedTask(w http.ResponseWriter, r *http.Request) {
	task, err := s.store.RestoreTrashedTask(auth.GetUserID(r.Context()), chi.URLParam(r, "id"))
	if err != nil {
		writeTaskTrashError(w, err)
		return
	}
	s.wsHub.BroadcastToUsers(s.taskAudience(task), "TASK_CREATED", task)
	writeJSON(w, http.StatusOK, task)
}

func (s *Server) handlePurgeTrashedTask(w http.ResponseWriter, r *http.Request) {
	if err := s.store.PurgeTrashedTask(auth.GetUserID(r.Context()), chi.URLParam(r, "id")); err != nil {
		writeTaskTrashError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// handleEmptyTaskTrash: POST /tasks/trash/empty {taskListId} – one list or all the user may edit.
func (s *Server) handleEmptyTaskTrash(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TaskListID string `json:"taskListId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	ids, err := s.store.EmptyTaskTrash(auth.GetUserID(r.Context()), req.TaskListID)
	if err != nil {
		writeTaskTrashError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"deleted": len(ids)})
}

func writeTaskTrashError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrNotInTaskTrash):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, storage.ErrTaskListReadOnly):
		writeError(w, http.StatusForbidden, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}
