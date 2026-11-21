package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The desktop app's backup folder: a local instance writes its backups to backups/ in its own folder unless
// the person chose another one (a second disk, a folder another program copies away) in the setup wizard or
// in the administration. Only in desktop mode: on a normal server the administrator's web form must not be
// able to make the server write wherever its process may, so the setting is neither offered nor read there.
// The copies written before migrations (storage.systemBackupDir) stay in the instance's folder: the store
// writes them before it can read any setting.

var (
	errBackupDirRelative = i18n.NewError("Der Ordner für die Backups muss ein vollständiger Pfad sein")
	errBackupDirData     = i18n.NewError("Der Ordner für die Backups darf nicht der Ordner der Instanz selbst sein")
	errBackupDirWrite    = i18n.NewError("In den Ordner für die Backups kann nicht geschrieben werden")
)

// defaultBackupRoot: backups/ next to the database (every server, and the desktop app unless chosen otherwise)
func (s *Server) defaultBackupRoot() string {
	return filepath.Join(filepath.Dir(s.cfg.DatabasePath), "backups")
}

// onlyInDesktop answers a route of the desktop app only (404 on a normal server).
func (s *Server) onlyInDesktop(h http.HandlerFunc) http.HandlerFunc {
	if s.desktopMode() {
		return h
	}
	return func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "Nicht gefunden")
	}
}

// checkBackupDir: the folder as stored, "" for the default folder. It must be an absolute path, not the
// instance's own folder (the backups' subfolders would mix with the database and media), and a folder this
// process can create and write in; it is created when missing.
func (s *Server) checkBackupDir(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if !filepath.IsAbs(raw) {
		return "", errBackupDirRelative
	}
	dir := filepath.Clean(raw)
	if dir == filepath.Clean(s.defaultBackupRoot()) {
		return "", nil
	}
	if dir == filepath.Clean(filepath.Dir(s.cfg.DatabasePath)) {
		return "", errBackupDirData
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", errBackupDirWrite
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return "", errBackupDirWrite
	}
	probe, err := os.CreateTemp(dir, ".mindsift-write-test-*")
	if err != nil {
		return "", errBackupDirWrite
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	return dir, nil
}

// backupLocation: what GET and PUT /admin/backups/location answer
type backupLocation struct {
	// Dir: where the backups go now; DefaultDir: backups/ in the instance's folder; Custom: Dir was chosen
	Dir        string `json:"dir"`
	DefaultDir string `json:"defaultDir"`
	Custom     bool   `json:"custom"`
}

func (s *Server) backupLocation() backupLocation {
	return backupLocation{Dir: s.backupRoot(), DefaultDir: s.defaultBackupRoot(), Custom: s.store.BackupDir() != ""}
}

// handleBackupLocation: GET /admin/backups/location (desktop app only)
func (s *Server) handleBackupLocation(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.backupLocation())
}

// handleSetBackupLocation: PUT /admin/backups/location {dir} (desktop app only; "" = the default folder).
// The backups already written stay where they are; the list and restore show the new folder's.
func (s *Server) handleSetBackupLocation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Dir string `json:"dir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Ungültige Anfrage")
		return
	}
	before := s.backupRoot()
	dir, err := s.checkBackupDir(req.Dir)
	if err != nil {
		writeErrorFrom(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.SetBackupDir(dir); err != nil {
		writeInternal(w, err)
		return
	}
	if after := s.backupRoot(); after != before {
		s.audit(r, storage.AuditSettingsChanged, storage.AuditEntry{TargetKind: storage.AuditTargetSettings},
			auditChanges{Changes: []auditChange{{Key: "backupDir", From: before, To: after}}})
	}
	writeJSON(w, http.StatusOK, s.backupLocation())
}
