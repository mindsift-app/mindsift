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

// errBackupDirMissing: the run was skipped, the chosen folder is not there (see chosenBackupFolderMissing)
func errBackupDirMissing(dir string) error {
	return i18n.NewError("Der gewählte Backup-Ordner {dir} existiert nicht (Laufwerk nicht eingebunden?), das Backup wurde übersprungen", "dir", dir)
}

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

// The backups never go straight into the chosen folder but into <chosen>/MindSift-Backups/<instance>
// (resolveBackupDir): the folder is the person's (a Nextcloud folder, a second disk), and what MindSift
// writes, prunes and sweeps there must not mix with their files nor with another instance's backups. A
// folder MindSift writes its backups to carries backupRootMarker.
const (
	backupFolderName = "MindSift-Backups"
	backupRootMarker = ".mindsift-backups"
)

// instanceBackupFolder: the name of the instance's subfolder below MindSift-Backups, the name of its own
// folder (unique among the app's instances; the folder of the first version, data/, is "MindSift").
func (s *Server) instanceBackupFolder() string {
	name := filepath.Base(filepath.Dir(s.cfg.DatabasePath))
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) || name == "data" {
		return "MindSift"
	}
	return name
}

// resolveBackupDir: where the backups go for the chosen folder. Installs from before the subfolder wrote
// straight into the chosen folder: a folder that already is a MindSift backup folder (marker, or system
// snapshots in system/) stays in use, so its backups stay listed and are pruned as before. Choosing the
// shown folder itself (…/MindSift-Backups/<instance>) also lands there instead of nesting.
func (s *Server) resolveBackupDir(chosen string) string {
	if isBackupRoot(chosen) {
		return chosen
	}
	return filepath.Join(chosen, backupFolderName, s.instanceBackupFolder())
}

func isBackupRoot(dir string) bool {
	if info, err := os.Lstat(filepath.Join(dir, backupRootMarker)); err == nil && info.Mode().IsRegular() {
		return true
	}
	files, err := storage.ListBackups(filepath.Join(dir, "system"))
	return err == nil && len(files) > 0
}

// markBackupRoot leaves the marker in a folder MindSift writes its backups to (also one from before the
// subfolder, which then stays recognised once its old snapshots are pruned).
func markBackupRoot(dir string) {
	marker := filepath.Join(dir, backupRootMarker)
	if _, err := os.Lstat(marker); err == nil {
		return
	}
	if err := os.MkdirAll(dir, 0o700); err == nil {
		err = os.WriteFile(marker, []byte("MindSift writes its backups to this folder.\n"), 0o600)
		logFailed("Marking the backup folder", err, "folder", dir)
	}
}

// checkBackupDir: the folder as stored, "" for the default folder. It must be an absolute path, not the
// instance's own folder (the backups' subfolders would mix with the database and media), and a folder this
// process can create and write in; MindSift's subfolder in it is created and marked.
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
	root := s.resolveBackupDir(dir)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", errBackupDirWrite
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return "", errBackupDirWrite
	}
	probe, err := os.CreateTemp(root, ".mindsift-write-test-*")
	if err != nil {
		return "", errBackupDirWrite
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	markBackupRoot(root)
	return dir, nil
}

// chosenBackupFolderMissing: the person chose a backup folder (desktop app) that does not exist now,
// typically because it lies on a drive that is not mounted. Writing a backup would then create the path on
// the system disk, so a backup run leaves it alone: only the setting dialog (checkBackupDir) creates the
// chosen folder, never a backup run. Returns the folder as chosen.
func (s *Server) chosenBackupFolderMissing() (string, bool) {
	if !s.desktopMode() {
		return "", false
	}
	chosen := s.store.BackupDir()
	if chosen == "" {
		return "", false
	}
	info, err := os.Stat(chosen)
	return chosen, err != nil || !info.IsDir()
}

// backupLocation: what GET and PUT /admin/backups/location answer
type backupLocation struct {
	// Dir: where the backups go now; DefaultDir: backups/ in the instance's folder; Custom: a folder was
	// chosen, Chosen (Dir is MindSift's subfolder in it, or the folder itself for an older install);
	// ChosenMissing: the chosen folder does not exist now (drive not mounted), backup runs are skipped
	Dir           string `json:"dir"`
	DefaultDir    string `json:"defaultDir"`
	Custom        bool   `json:"custom"`
	Chosen        string `json:"chosen"`
	ChosenMissing bool   `json:"chosenMissing"`
}

func (s *Server) backupLocation() backupLocation {
	chosen := s.store.BackupDir()
	_, missing := s.chosenBackupFolderMissing()
	return backupLocation{Dir: s.backupRoot(), DefaultDir: s.defaultBackupRoot(), Custom: chosen != "", Chosen: chosen, ChosenMissing: missing}
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
