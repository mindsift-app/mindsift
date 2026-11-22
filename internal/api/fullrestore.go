package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mindsift-app/mindsift/internal/auth"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// Restoring the whole instance from a full backup (storage/fullbackup.go) or an old database snapshot, from
// the list or from an upload (backup_upload.go). Admins only, not in the demo, and only where the runner
// (cmd/server, the desktop app's shell) can reopen the store (SetRestarter, capability "restore").
//
//  1. the backup is staged next to the database (restore-full/<token>/: the database unpacked, the media
//     as hard links or copies) and checked like any foreign database (storage.CheckUntrustedDatabase, a
//     newer version, at least one active admin)
//  2. a full backup of the current state is written ("pre-restore"), so the restore can be undone
//  3. restore-pending.json is written, the answer goes out (202) and the runner closes the server and its
//     store; it opens them again through storage.OpenStoreWithRestore, which swaps the files in and puts
//     the previous ones back when the restored database does not open
//  4. the new server records the restore in the restored database's audit log (restore-done.json)
//
// The app waits until /health answers with another boot id, then reloads.

var (
	errRestoreUnavailable = errors.New("Wiederherstellen ist hier nicht möglich")
	errRestoreBusy        = errors.New("Gerade läuft schon eine Wiederherstellung")
	errRestoreConfirm     = errors.New("Bitte die Wiederherstellung bestätigen")
	errRestoreNoAdmin     = errors.New("In der Sicherung ist kein aktives Administrator-Konto")
	errRestorePreBackup   = errors.New("Die Sicherung des aktuellen Stands ist fehlgeschlagen; nichts wurde geändert")
)

// restoreMu: one restore at a time
var restoreMu sync.Mutex

// SetRestarter: the runner's function that closes this server and its store and opens them again (through
// storage.OpenStoreWithRestore); called in its own goroutine once a restore is staged. Without one the
// instance offers no restore.
func (s *Server) SetRestarter(f func()) { s.restarter = f }

func (s *Server) canRestore() bool { return s.restarter != nil && !s.cfg.DemoMode }

// stageFunc fills the staging folder: the database as dbName, media/ when it brings media (media true)
type stageFunc func(dir, dbName string) (media bool, err error)

// stageListedBackup: a backup of the list, full (database and media) or an old database snapshot.
func stageListedBackup(src string) stageFunc {
	return func(dir, dbName string) (bool, error) {
		info, err := os.Stat(src)
		if err != nil {
			return false, err
		}
		if !info.IsDir() {
			return false, unpackSnapshot(src, filepath.Join(dir, dbName))
		}
		if err := unpackSnapshot(filepath.Join(src, storage.FullBackupDBName), filepath.Join(dir, dbName)); err != nil {
			return false, err
		}
		media := filepath.Join(dir, storage.FullBackupMedia)
		if err := os.MkdirAll(media, 0o755); err != nil {
			return false, err
		}
		return true, storage.LinkMediaTree(filepath.Join(src, storage.FullBackupMedia), media)
	}
}

// restoreRequest: the body of a restore; confirm repeats the backup's name (the app's confirmation)
type restoreRequest struct {
	Confirm string `json:"confirm"`
	// SHA256: uploads only, the checksum of the whole file (backup_upload.go)
	SHA256 string `json:"sha256"`
}

// handleAdminRestoreBackup: POST /admin/backups/{name}/restore {confirm: name}
func (s *Server) handleAdminRestoreBackup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var req restoreRequest
	_ = json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req)
	if req.Confirm != name {
		writeErrorFrom(w, http.StatusBadRequest, errRestoreConfirm)
		return
	}
	src, err := storage.BackupPath(filepath.Join(s.backupRoot(), "system"), name)
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, err)
		return
	}
	s.restoreFrom(w, r, name, false, stageListedBackup(src), nil)
}

// restoreFrom runs a restore (steps 1 to 3 above); scheduled runs after the answer went out.
func (s *Server) restoreFrom(w http.ResponseWriter, r *http.Request, backup string, uploaded bool, stage stageFunc, scheduled func()) {
	if !s.canRestore() {
		writeErrorFrom(w, http.StatusNotFound, errRestoreUnavailable)
		return
	}
	if !restoreMu.TryLock() {
		writeErrorFrom(w, http.StatusConflict, errRestoreBusy)
		return
	}
	restarting := false
	defer func() {
		if !restarting {
			restoreMu.Unlock()
		}
	}()
	allowLongTransfer(w) // unpacking and the backup of the current state take a while for large instances
	token, err := randomToken(16)
	if err != nil {
		writeInternal(w, err)
		return
	}
	dbPath := s.cfg.DatabasePath
	dir := storage.RestoreStagingPath(dbPath, token)
	_ = os.RemoveAll(filepath.Dir(dir)) // what an earlier attempt left
	if err := os.MkdirAll(dir, 0o700); err != nil {
		writeInternal(w, err)
		return
	}
	failed := func(status int, err error) {
		storage.CancelRestorePlan(dbPath, token)
		slog.Warn("Restoring a backup refused", "backup", backup, "error", err)
		writeErrorFrom(w, status, err)
	}
	dbName := filepath.Base(dbPath)
	media, err := stage(dir, dbName)
	if err != nil {
		failed(http.StatusBadRequest, restoreClientError(err))
		return
	}
	if err := s.checkRestoreDatabase(r.Context(), filepath.Join(dir, dbName)); err != nil {
		failed(http.StatusBadRequest, err)
		return
	}
	backupRunMu.Lock()
	pre, err := s.store.WriteFullBackup(filepath.Join(s.backupRoot(), "system"), clock.Now(), storage.FullBackupPreRestore)
	backupRunMu.Unlock()
	if err != nil {
		slog.Error("Backup before a restore failed", "error", err)
		failed(http.StatusInternalServerError, errRestorePreBackup)
		return
	}
	actor := s.auditActor(r)
	plan := storage.RestorePlan{Staging: token, Media: media, Backup: backup, PreBackup: pre, ActorID: actor.ID, ActorName: auditName(actor), Uploaded: uploaded}
	if err := storage.WriteRestorePlan(dbPath, plan); err != nil {
		failed(http.StatusInternalServerError, err)
		return
	}
	restarting = true
	slog.Info("Restoring a backup: the server reopens", "backup", backup, "pre_restore_backup", pre, "media", media)
	writeJSON(w, http.StatusAccepted, map[string]any{"restarting": true, "preRestoreBackup": pre})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	if scheduled != nil {
		scheduled()
	}
	restart := s.restarter
	go func() {
		defer restoreMu.Unlock()
		restart()
	}()
}

// restoreClientError: what the person sees when staging failed (a broken or foreign file, not our disk).
func restoreClientError(err error) error {
	var pathErr *os.PathError
	switch {
	case errors.Is(err, errNotSnapshot), errors.Is(err, errSnapshotTooLarge), errors.Is(err, storage.ErrNotFullBackup):
		return err
	case errors.As(err, &pathErr):
		return fmt.Errorf("staging the backup: %w", err)
	}
	return err
}

// checkRestoreDatabase: the staged database is sound, has nothing MindSift does not create, is not from a
// newer version and has an active admin (else nobody could sign in to the restored instance).
func (s *Server) checkRestoreDatabase(ctx context.Context, file string) error {
	known, err := s.store.SchemaObjects()
	if err != nil {
		return err
	}
	cctx, cancel := context.WithTimeout(ctx, snapshotCheckTimeout)
	err = storage.CheckUntrustedDatabase(cctx, file, known)
	cancel()
	if err != nil {
		slog.Warn("Database of a backup refused", "error", err)
		return errSnapshotRefused
	}
	st, err := storage.NewStore(file, storage.WithUntrustedFile())
	var newer *storage.NewerDatabaseError
	switch {
	case errors.As(err, &newer):
		return errSnapshotNewer
	case err != nil:
		slog.Warn("Database of a backup could not be opened", "error", err)
		return errNotSnapshot
	}
	users, err := st.GetAllUsers()
	if cerr := st.Close(); cerr != nil {
		return cerr
	}
	if err != nil {
		return errNotSnapshot
	}
	// Closed cleanly, SQLite has written its -wal into the file; only the file is swapped in
	if info, err := os.Stat(file + "-wal"); err == nil && info.Size() > 0 {
		return errors.New("restore: the checked database kept its write-ahead log")
	}
	_ = os.Remove(file + "-wal")
	_ = os.Remove(file + "-shm")
	for _, u := range users {
		if u.Role == "admin" && u.IsActive {
			return nil
		}
	}
	return errRestoreNoAdmin
}

// recordRestoreDone writes the restore swapped in at this start into the (restored) audit log.
func (s *Server) recordRestoreDone() {
	plan := storage.TakeRestoreDone(s.cfg.DatabasePath)
	if plan == nil {
		return
	}
	details := map[string]any{"preRestoreBackup": plan.PreBackup}
	if plan.Uploaded {
		details["uploaded"] = true
	}
	action := storage.AuditBackupRestored
	if plan.Error != "" {
		action = storage.AuditBackupRestoreFailed
	}
	s.recordAudit(storage.AuditEntry{
		Action: action, ActorKind: storage.AuditActorUser, Source: storage.AuditSourceWeb,
		ActorID: plan.ActorID, ActorName: plan.ActorName, TargetKind: storage.AuditTargetBackup, TargetName: plan.Backup,
	}, details)
}

// serveFullBackup streams a full backup as one tar archive (exact Content-Length, no
// buffering); the write deadline moves on while bytes flow, so several GB on a slow line get through.
func (s *Server) serveFullBackup(w http.ResponseWriter, dir, name string) {
	size, write, err := storage.WriteFullBackupTar(dir)
	if err != nil {
		writeErrorFrom(w, http.StatusNotFound, storage.ErrBackupName)
		return
	}
	w.Header().Set("Content-Type", "application/x-tar")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.tar"`, name))
	w.Header().Set("Content-Length", fmt.Sprint(size))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	if err := write(&deadlineWriter{w: w, rc: http.NewResponseController(w)}); err != nil {
		slog.Warn("Download of a full backup cut off", "backup", name, "error", err)
	}
}

// deadlineWriter pushes the write deadline forward every few MB, so a long download is not cut off at a
// fixed time while it still moves.
type deadlineWriter struct {
	w       io.Writer
	rc      *http.ResponseController
	pending int
}

const deadlineStep = 4 << 20

func (d *deadlineWriter) Write(p []byte) (int, error) {
	if d.pending <= 0 {
		_ = d.rc.SetWriteDeadline(time.Now().Add(5 * time.Minute))
		d.pending = deadlineStep
	}
	n, err := d.w.Write(p)
	d.pending -= n
	return n, err
}

// handleTicketBackupDownload: GET /api/v1/admin/backup-download/{name}?ticket=… – the browser's own
// download of a backup (a link, so several GB go straight to disk instead of into the page's memory). The
// one-time stream ticket stands in for the Authorization header a link cannot send; admins only.
func (s *Server) handleTicketBackupDownload(w http.ResponseWriter, r *http.Request) {
	user, _ := s.authenticateUserFromReq(r)
	if user == nil || r.URL.Query().Get("ticket") == "" {
		writeError(w, http.StatusUnauthorized, "Nicht autorisiert – bitte anmelden")
		return
	}
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "Server-Administrator-Rechte erforderlich")
		return
	}
	r = r.WithContext(auth.WithUserID(r.Context(), user.ID))
	s.handleAdminDownloadBackup(w, r)
}

// fullArchiveTarget: an archive entry's name for the unpacking of an uploaded full backup ("" = not ours).
func fullArchiveTarget(name string) (string, bool) {
	switch {
	case name == storage.FullBackupManifest || name == storage.FullBackupDBName:
		return name, true
	case strings.HasPrefix(name, storage.FullBackupMedia+"/"):
		rel := strings.TrimPrefix(name, storage.FullBackupMedia+"/")
		if storage.ValidMediaPath(rel) {
			return path.Join(storage.FullBackupMedia, rel), true
		}
	}
	return "", false
}

// maxRestoreMediaFile: one picture or recording in an uploaded full backup
const maxRestoreMediaFile = 4 << 30

// stageUploadedBackup: an uploaded file, a full backup (tar, as downloaded; also gzipped) or a database
// snapshot (.db.gz or a plain database file).
func stageUploadedBackup(file string) stageFunc {
	return func(dir, dbName string) (bool, error) {
		kind, err := detectUpload(file)
		if err != nil {
			return false, err
		}
		switch kind {
		case uploadDB, uploadDBGz:
			return false, unpackSnapshot(file, filepath.Join(dir, dbName))
		case uploadTar, uploadTarGz:
		default:
			return false, storage.ErrNotFullBackup
		}
		manifest, db := false, false
		media := filepath.Join(dir, storage.FullBackupMedia)
		if err := os.MkdirAll(media, 0o755); err != nil {
			return false, err
		}
		err = walkArchive(kind, file, func(e archiveEntry) error {
			target, ok := fullArchiveTarget(e.name)
			if !ok {
				return nil
			}
			switch target {
			case storage.FullBackupManifest:
				manifest = true
				return nil
			case storage.FullBackupDBName:
				tmp := filepath.Join(dir, "db.gz")
				if err := copyEntry(e, tmp, maxSnapshotBytes); err != nil {
					return err
				}
				defer os.Remove(tmp)
				if err := unpackSnapshot(tmp, filepath.Join(dir, dbName)); err != nil {
					return err
				}
				db = true
				return nil
			}
			return copyEntry(e, filepath.Join(dir, filepath.FromSlash(target)), maxRestoreMediaFile)
		})
		if err != nil {
			return false, err
		}
		if !manifest || !db {
			return false, storage.ErrNotFullBackup
		}
		return true, nil
	}
}
