package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Automatic backups (see storage/backup.go): daily at the configured time a snapshot of the whole
// database for the admin and one MindSift backup per active user, both kept for the configured number
// of days. Admins can also start a run by hand; users list, download and restore their own backups.

var backupRunMu sync.Mutex

func (s *Server) backupRoot() string {
	return filepath.Join(filepath.Dir(s.cfg.DatabasePath), "backups")
}

// runBackups makes one full run; returns the name of the system snapshot.
func (s *Server) runBackups() (string, error) {
	backupRunMu.Lock()
	defer backupRunMu.Unlock()
	now := time.Now()
	root := s.backupRoot()
	sys, _ := s.store.GetSystemSettings()
	keep := storage.DefaultBackupRetentionDays
	if sys != nil && sys.BackupRetentionDays > 0 {
		keep = sys.BackupRetentionDays
	}

	name, err := s.store.WriteSystemSnapshot(filepath.Join(root, "system"), now)
	if err != nil {
		return "", err
	}
	_ = storage.PruneBackups(filepath.Join(root, "system"), keep, now)

	users, err := s.store.GetAllUsers()
	if err != nil {
		return name, err
	}
	failed := 0
	for _, u := range users {
		if !u.IsActive {
			continue
		}
		dir := storage.UserBackupDir(root, u.ID)
		if _, err := s.store.WriteUserBackup(u.ID, dir, now); err != nil {
			failed++
			slog.Error("User backup failed", "user_id", u.ID, "error", err)
			continue
		}
		_ = storage.PruneBackups(dir, keep, now)
	}
	slog.Info("Backups created", "system", name, "users", len(users), "failed", failed)
	if failed > 0 {
		return name, fmt.Errorf("%d Benutzer-Backups fehlgeschlagen (siehe Server-Log)", failed)
	}
	return name, nil
}

// startBackupScheduler runs the backups once a day at the configured time (server time zone). After a
// restart past that time on a day without a run, it catches up.
func (s *Server) startBackupScheduler() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	lastRun := ""
	if files, err := storage.ListBackups(filepath.Join(s.backupRoot(), "system")); err == nil && len(files) > 0 {
		lastRun = strings.TrimPrefix(files[0].Name, "mindsift-db-")[:10] // date of the newest snapshot
	}
	for range ticker.C {
		sys, err := s.store.GetSystemSettings()
		if err != nil || sys == nil || !sys.BackupEnabled {
			continue
		}
		now := time.Now()
		today := now.Format("2006-01-02")
		if lastRun == today || now.Format("15:04") < sys.BackupTime {
			continue
		}
		lastRun = today
		if _, err := s.runBackups(); err != nil {
			slog.Error("Automatic backup failed", "error", err)
		}
	}
}

func (s *Server) handleAdminListBackups(w http.ResponseWriter, r *http.Request) {
	files, err := storage.ListBackups(filepath.Join(s.backupRoot(), "system"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, files)
}

func (s *Server) handleAdminRunBackup(w http.ResponseWriter, r *http.Request) {
	if _, err := s.runBackups(); err != nil {
		writeError(w, http.StatusInternalServerError, "Backup fehlgeschlagen: "+err.Error())
		return
	}
	s.handleAdminListBackups(w, r)
}

// handleAdminDeleteBackup removes one database snapshot (admins only; users cannot delete their own
// backups, those expire with the retention period).
func (s *Server) handleAdminDeleteBackup(w http.ResponseWriter, r *http.Request) {
	if err := storage.DeleteBackup(filepath.Join(s.backupRoot(), "system"), chi.URLParam(r, "name")); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	s.handleAdminListBackups(w, r)
}

func (s *Server) handleAdminDownloadBackup(w http.ResponseWriter, r *http.Request) {
	serveBackupFile(w, r, filepath.Join(s.backupRoot(), "system"), chi.URLParam(r, "name"), "application/gzip")
}

func (s *Server) handleListMyBackups(w http.ResponseWriter, r *http.Request) {
	files, err := storage.ListBackups(storage.UserBackupDir(s.backupRoot(), auth.GetUserID(r.Context())))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, files)
}

func (s *Server) handleDownloadMyBackup(w http.ResponseWriter, r *http.Request) {
	dir := storage.UserBackupDir(s.backupRoot(), auth.GetUserID(r.Context()))
	serveBackupFile(w, r, dir, chi.URLParam(r, "name"), "application/zip")
}

// handleRestoreMyBackup imports one of the user's server backups: mode=merge (add next to the data)
// or mode=restore (empty the chosen sections first), sections=notes,tasks,lists,inbox,themes.
func (s *Server) handleRestoreMyBackup(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	path, err := storage.BackupPath(storage.UserBackupDir(s.backupRoot(), userID), chi.URLParam(r, "name"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	plan, err := storage.PlanMindSiftImport(data, filepath.Base(path))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	sections := storage.NormalizeSections(strings.Split(r.URL.Query().Get("sections"), ","))
	plan = plan.Only(sections)
	if r.URL.Query().Get("preview") == "1" {
		writeJSON(w, http.StatusOK, trSummary(w, plan.Summary(false)))
		return
	}
	s.applyImport(w, userID, plan, sections, r.URL.Query().Get("mode") == "restore")
}

func serveBackupFile(w http.ResponseWriter, r *http.Request, dir, name, contentType string) {
	path, err := storage.BackupPath(dir, name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	allowLongTransfer(w)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	http.ServeFile(w, r, path)
}

// removeUserBackups deletes the server backups of a deleted account (FLAW-37). The system snapshots
// still contain it until they expire (BACKUP retention).
func (s *Server) removeUserBackups(userID string) {
	dir := storage.UserBackupDir(s.backupRoot(), userID)
	// Only ever one user's own folder, never backups/users itself (IDs like "." or "/")
	if base := filepath.Base(dir); userID == "" || base == "." || base == "users" || filepath.Dir(dir) != filepath.Join(s.backupRoot(), "users") {
		return
	}
	if err := os.RemoveAll(dir); err != nil {
		slog.Warn("Backups of the deleted account could not be removed", "user_id", userID, "error", err)
	}
}
