package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Automatic backups (see storage/backup.go): daily at the configured time a snapshot of the whole
// database for the admin and one MindSift backup per active user, both kept for the configured number
// of days. Admins can also start a run by hand; users list, download and restore their own backups.

var backupRunMu sync.Mutex

// backupRoot: where the backups go, backups/ next to the database; in the desktop app MindSift's own
// subfolder of the folder chosen in its setup or settings, if any (desktop_backup.go).
func (s *Server) backupRoot() string {
	if s.desktopMode() {
		if dir := s.store.BackupDir(); dir != "" {
			return s.resolveBackupDir(dir)
		}
	}
	return s.defaultBackupRoot()
}

// runBackups makes one full run; returns the name of the system snapshot. The result goes into the metrics.
func (s *Server) runBackups() (string, error) {
	name, err := s.runBackupsOnce()
	s.metrics.backupRun(err, time.Now())
	return name, err
}

func (s *Server) runBackupsOnce() (string, error) {
	backupRunMu.Lock()
	defer backupRunMu.Unlock()
	// The folder the person chose (a second disk, say) has to be there already: a drive that is not
	// mounted would otherwise get the path created on the system disk. The run is skipped and the next
	// one tries again; the administration's backup card shows the warning (backupLocation).
	if chosen, missing := s.chosenBackupFolderMissing(); missing {
		slog.Warn("Backup skipped: the chosen backup folder does not exist (drive not mounted?)", "folder", chosen)
		return "", errBackupDirMissing(chosen)
	}
	now := clock.Now() // the file names carry the server's date and time; the scheduler reads them back
	root := s.backupRoot()
	keep := s.backupKeepDays()
	if root != s.defaultBackupRoot() {
		markBackupRoot(root)
	}

	name, err := s.store.WriteSystemSnapshot(filepath.Join(root, "system"), now)
	if err != nil {
		return "", err
	}
	logFailed("Removing old system backups", storage.PruneBackups(filepath.Join(root, "system"), keep, now))

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
		logFailed("Removing old backups of a person", storage.PruneBackups(dir, keep, now), "user_id", u.ID)
	}
	slog.Info("Backups created", "system", name, "users", len(users), "failed", failed)
	if failed > 0 {
		return name, i18n.NewError("{count} Benutzer-Backups fehlgeschlagen (siehe Server-Log)", "count", strconv.Itoa(failed))
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
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
		case <-s.backupNudge:
		}
		sys := s.effectiveSettings()
		if sys == nil {
			continue
		}
		// Read on every tick, so a new time zone from the administration counts from the next minute
		now := clock.Now()
		if !backupDue(sys, lastRun, now) {
			continue
		}
		lastRun = now.Format("2006-01-02")
		if _, err := s.runBackups(); err != nil {
			slog.Error("Automatic backup failed", "error", err)
		}
	}
}

// nudgeBackups lets the scheduler check at once whether a run is due, e.g. after the setup wizard switched
// the backups on: the first one then exists when the person opens the administration, not up to a minute
// later.
func (s *Server) nudgeBackups() {
	select {
	case s.backupNudge <- struct{}{}:
	default: // one is pending already
	}
}

// backupDue: the settings read on this tick ask for a run at now (switched on, the time of day reached,
// none yet on now's date), both in the server's time zone. lastRun is the date (YYYY-MM-DD) of the last run.
func backupDue(sys *domain.SystemSettings, lastRun string, now time.Time) bool {
	if sys == nil || !sys.BackupEnabled {
		return false
	}
	now = clock.In(now)
	return lastRun != now.Format("2006-01-02") && now.Format("15:04") >= sys.BackupTime
}

func (s *Server) handleAdminListBackups(w http.ResponseWriter, r *http.Request) {
	files, err := storage.ListBackups(filepath.Join(s.backupRoot(), "system"))
	if err != nil {
		writeInternal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, files)
}

func (s *Server) handleAdminRunBackup(w http.ResponseWriter, r *http.Request) {
	allowLongWork(w)
	if _, err := s.runBackups(); err != nil {
		writeError(w, http.StatusInternalServerError, "Backup fehlgeschlagen: "+clientMessage(err))
		return
	}
	s.audit(r, storage.AuditBackupCreated, storage.AuditEntry{TargetKind: storage.AuditTargetBackup}, nil)
	s.handleAdminListBackups(w, r)
}

// handleAdminDeleteBackup removes one database snapshot (admins only; users cannot delete their own
// backups, those expire with the retention period).
func (s *Server) handleAdminDeleteBackup(w http.ResponseWriter, r *http.Request) {
	if err := storage.DeleteBackup(filepath.Join(s.backupRoot(), "system"), chi.URLParam(r, "name")); err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	s.audit(r, storage.AuditBackupDeleted, storage.AuditEntry{TargetKind: storage.AuditTargetBackup, TargetName: chi.URLParam(r, "name")}, nil)
	s.handleAdminListBackups(w, r)
}

// handleAdminDownloadBackup: a snapshot holds everybody's data, so the download is in the audit log.
func (s *Server) handleAdminDownloadBackup(w http.ResponseWriter, r *http.Request) {
	dir, name := filepath.Join(s.backupRoot(), "system"), chi.URLParam(r, "name")
	if _, err := storage.BackupPath(dir, name); err == nil {
		s.audit(r, storage.AuditBackupDownloaded, storage.AuditEntry{TargetKind: storage.AuditTargetBackup, TargetName: name}, nil)
	}
	serveBackupFile(w, r, dir, name, "application/gzip")
}

func (s *Server) handleListMyBackups(w http.ResponseWriter, r *http.Request) {
	files, err := storage.ListBackups(storage.UserBackupDir(s.backupRoot(), auth.GetUserID(r.Context())))
	if err != nil {
		writeInternal(w, err)
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
	allowLongWork(w)
	userID := auth.GetUserID(r.Context())
	path, err := storage.BackupPath(storage.UserBackupDir(s.backupRoot(), userID), chi.URLParam(r, "name"))
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	done, ok := s.startImport(w, r)
	if !ok {
		return
	}
	defer done()
	file, err := os.Open(path)
	if err != nil {
		writeInternal(w, err)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeInternal(w, err)
		return
	}
	plan, err := storage.PlanMindSiftImport(file, info.Size(), filepath.Base(path))
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	sections := storage.NormalizeSections(strings.Split(r.URL.Query().Get("sections"), ","))
	plan = plan.Only(sections)
	if r.URL.Query().Get("preview") == "1" {
		s.previewImport(w, userID, plan)
		return
	}
	s.applyImport(w, userID, plan, sections, r.URL.Query().Get("mode") == "restore")
}

func serveBackupFile(w http.ResponseWriter, r *http.Request, dir, name, contentType string) {
	path, err := storage.BackupPath(dir, name)
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	allowLongTransfer(w)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	http.ServeFile(w, r, path)
}

// removeUserBackups deletes the server backups of an account its owner deleted (FLAW-37). The system
// snapshots still contain it until they expire (BACKUP retention).
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

// Backups of accounts an admin or user manager deleted stay for the backup retention period under
// backups/deleted/<id> (with account.json: who it was, when), so an account deleted by mistake can be
// given its data back: the admin downloads a backup and the person imports it into a new account.

type deletedAccountBackups struct {
	UserID      string               `json:"userId"`
	DisplayName string               `json:"displayName"`
	Email       string               `json:"email"`
	DeletedAt   string               `json:"deletedAt"`
	RemoveAt    string               `json:"removeAt"`
	Files       []storage.BackupFile `json:"files"`
}

func (s *Server) deletedBackupDir(userID string) string {
	return filepath.Join(s.backupRoot(), "deleted", strings.ReplaceAll(filepath.Base(userID), "..", ""))
}

func (s *Server) backupKeepDays() int {
	if sys := s.effectiveSettings(); sys != nil && sys.BackupRetentionDays > 0 {
		return sys.BackupRetentionDays
	}
	return storage.DefaultBackupRetentionDays
}

// keepUserBackups moves the backups of an account deleted by an admin aside instead of deleting them.
func (s *Server) keepUserBackups(u *domain.User, now time.Time) {
	src := storage.UserBackupDir(s.backupRoot(), u.ID)
	if files, err := storage.ListBackups(src); err != nil || len(files) == 0 {
		s.removeUserBackups(u.ID)
		return
	}
	dst := s.deletedBackupDir(u.ID)
	if filepath.Dir(dst) != filepath.Join(s.backupRoot(), "deleted") || filepath.Base(dst) != u.ID {
		s.removeUserBackups(u.ID)
		return
	}
	_ = os.RemoveAll(dst)
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err == nil {
		err = os.Rename(src, dst)
		if err == nil {
			// The move itself on disk (both folders), then account.json written and flushed like a backup
			logFailed("Flushing the moved backups of a deleted account to disk", errors.Join(
				storage.SyncDir(filepath.Dir(dst)), storage.SyncDir(filepath.Dir(src))), "user_id", u.ID)
			meta, _ := json.Marshal(deletedAccountBackups{UserID: u.ID, DisplayName: u.DisplayName, Email: u.Email, DeletedAt: now.UTC().Format(time.RFC3339)})
			err = storage.WriteFileAtomically(filepath.Join(dst, "account.json"), meta)
		}
		if err == nil {
			return
		}
		slog.Warn("Backups of the deleted account could not be kept", "user_id", u.ID, "error", err)
	}
	s.removeUserBackups(u.ID)
}

// deletedAccounts reads backups/deleted; expired ones are removed when sweep is set. Only folders MindSift
// wrote count (deletedAccountFolder): in the desktop app the backups may lie in a folder the person chose,
// and whatever else is there is neither listed nor ever removed.
func (s *Server) deletedAccounts(now time.Time, sweep bool) []deletedAccountBackups {
	root := filepath.Join(s.backupRoot(), "deleted")
	entries, _ := os.ReadDir(root)
	keep := time.Duration(s.backupKeepDays()) * 24 * time.Hour
	out := []deletedAccountBackups{}
	for _, e := range entries {
		dir := filepath.Join(root, e.Name())
		d, deleted, ok := deletedAccountFolder(dir, e)
		if !ok {
			continue
		}
		removeAt := deleted.Add(keep)
		if !now.Before(removeAt) {
			if sweep {
				if err := os.RemoveAll(dir); err != nil {
					slog.Warn("Expired backups of a deleted account could not be removed", "user_id", e.Name(), "error", err)
				}
			}
			continue
		}
		d.DeletedAt = deleted.UTC().Format(time.RFC3339)
		d.RemoveAt = removeAt.UTC().Format(time.RFC3339)
		d.Files, _ = storage.ListBackups(dir)
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DeletedAt > out[j].DeletedAt })
	return out
}

// accountIDPattern: the ids of accounts, domain.NewID("usr") (96 or, older, 40 random bits) and the
// demo accounts (usr_demo_admin)
var accountIDPattern = regexp.MustCompile(`^usr_[0-9a-z_]{4,40}$`)

// deletedAccountFolder: dir holds the backups of a deleted account as keepUserBackups leaves them: a real
// folder (no link) named after an account id, with the account.json written for that id and the time of
// the deletion. Anything else is not MindSift's.
func deletedAccountFolder(dir string, e os.DirEntry) (deletedAccountBackups, time.Time, bool) {
	var d deletedAccountBackups
	if !e.IsDir() || e.Type()&os.ModeSymlink != 0 || !accountIDPattern.MatchString(e.Name()) {
		return d, time.Time{}, false
	}
	meta := filepath.Join(dir, "account.json")
	if info, err := os.Lstat(meta); err != nil || !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return d, time.Time{}, false
	}
	raw, err := os.ReadFile(meta)
	if err != nil || json.Unmarshal(raw, &d) != nil || d.UserID != e.Name() {
		return d, time.Time{}, false
	}
	deleted, err := time.Parse(time.RFC3339, d.DeletedAt)
	if err != nil || deleted.IsZero() {
		return d, time.Time{}, false
	}
	return d, deleted, true
}

// runDeletedBackupSweep removes backups of deleted accounts past the retention period (hourly).
func (s *Server) runDeletedBackupSweep(now time.Time) {
	s.deletedAccounts(now, true)
}

// runPreMigrationBackupExpiry removes the copies from before migrations once they are 90 days old
// (hourly), so accounts deleted since do not live on in them.
func (s *Server) runPreMigrationBackupExpiry(now time.Time) {
	n, err := s.store.ExpirePreMigrationBackups(now)
	logFailed("Removing expired pre-migration backups", err)
	if n > 0 {
		slog.Info("Expired pre-migration backups removed", "count", n)
	}
}

// handleAdminDeletedBackups: GET /admin/backups/deleted – kept backups of deleted accounts.
func (s *Server) handleAdminDeletedBackups(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.deletedAccounts(time.Now(), false))
}

// handleAdminDownloadDeletedBackup: GET /admin/backups/deleted/{userId}/{name}
// The backup holds the data of the deleted account: the download is in the audit log, with the
// account as target.
func (s *Server) handleAdminDownloadDeletedBackup(w http.ResponseWriter, r *http.Request) {
	dir, name := s.deletedBackupDir(chi.URLParam(r, "userId")), chi.URLParam(r, "name")
	if _, err := storage.BackupPath(dir, name); err == nil {
		target := storage.AuditEntry{TargetKind: storage.AuditTargetUser, TargetID: filepath.Base(dir)}
		var d deletedAccountBackups
		if raw, err := os.ReadFile(filepath.Join(dir, "account.json")); err == nil && json.Unmarshal(raw, &d) == nil {
			target.TargetName = d.DisplayName
		}
		s.audit(r, storage.AuditBackupDownloaded, target, map[string]any{"file": name, "deletedAccount": true})
	}
	serveBackupFile(w, r, dir, name, "application/zip")
}
