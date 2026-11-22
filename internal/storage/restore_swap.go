package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Restoring the whole instance from a full backup (api/fullrestore.go) replaces the database file and the
// media folder while no store has them open. The API prepares everything in a staging folder next to the
// database ($DATA_DIR/restore-full/<token>/: the database as <db name>, media/ unless only the database is
// restored) and writes restore-pending.json; the runner (cmd/server, the desktop app's shell) then closes
// the server and its store and opens them again through OpenStoreWithRestore, which swaps the files:
//
//  1. the current database (with -wal and -shm) and media folder move to $DATA_DIR/restore-previous/
//  2. the staged ones move into their place (renames inside one folder: atomic, no copying)
//  3. the marker goes; the store opens the restored database (migrating it when it is older)
//  4. opened fine: restore-previous and the staging folder are removed; failed: the previous files move back
//
// Every step can run again after a crash (a file is moved only while it is still where it was), and the
// start of the server runs the same function, so a restore cut off by a power failure completes there.

const (
	restorePendingFile = "restore-pending.json"
	restoreDoneFile    = "restore-done.json"
	restorePrevDir     = "restore-previous"
	// RestoreStagingDir: where the API prepares a restore, below the data folder
	RestoreStagingDir = "restore-full"
)

// RestorePlan is restore-pending.json: what to swap, and who asked (for the audit log of the restored
// database, RestoreDone).
type RestorePlan struct {
	// Staging: the folder name below RestoreStagingDir
	Staging string `json:"staging"`
	// Media: the staging folder has media/ to put in place (a database snapshot alone keeps the media)
	Media     bool   `json:"media"`
	Backup    string `json:"backup"`
	PreBackup string `json:"preBackup,omitempty"`
	ActorID   string `json:"actorId,omitempty"`
	ActorName string `json:"actorName,omitempty"`
	At        string `json:"at"`
	// Uploaded: the backup came as an upload, not from the list
	Uploaded bool `json:"uploaded,omitempty"`
	// Error: set in restore-done.json when the restore failed and the previous data were put back
	Error string `json:"error,omitempty"`
}

// restorePaths: the data folder of dbPath and the paths the swap moves; ok false for in-memory databases.
func restorePaths(dbPath string) (dataDir, media string, ok bool) {
	if dbPath == "" || strings.Contains(dbPath, ":memory:") || strings.HasPrefix(dbPath, "file:") || strings.Contains(dbPath, "?") {
		return "", "", false
	}
	dataDir = filepath.Dir(dbPath)
	return dataDir, filepath.Join(dataDir, "media"), true
}

// RestoreStagingPath: the staging folder token for the database at dbPath.
func RestoreStagingPath(dbPath, token string) string {
	return filepath.Join(filepath.Dir(dbPath), RestoreStagingDir, filepath.Base(token))
}

// WriteRestorePlan writes restore-pending.json next to the database; the next open swaps the files.
func WriteRestorePlan(dbPath string, plan RestorePlan) error {
	dataDir, _, ok := restorePaths(dbPath)
	if !ok {
		return errors.New("restore: the database is not a file")
	}
	if plan.At == "" {
		plan.At = time.Now().UTC().Format(time.RFC3339)
	}
	raw, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	return WriteFileAtomically(filepath.Join(dataDir, restorePendingFile), raw)
}

// CancelRestorePlan removes restore-pending.json and the staging folder (a restore that could not start).
func CancelRestorePlan(dbPath, token string) {
	if dataDir, _, ok := restorePaths(dbPath); ok {
		_ = os.Remove(filepath.Join(dataDir, restorePendingFile))
	}
	_ = os.RemoveAll(RestoreStagingPath(dbPath, token))
}

func readRestorePlan(dataDir string) (*RestorePlan, error) {
	raw, err := os.ReadFile(filepath.Join(dataDir, restorePendingFile))
	if err != nil {
		return nil, err
	}
	var plan RestorePlan
	if err := json.Unmarshal(raw, &plan); err != nil || plan.Staging == "" || filepath.Base(plan.Staging) != plan.Staging {
		return nil, fmt.Errorf("restore: unreadable %s", restorePendingFile)
	}
	return &plan, nil
}

// moveIfThere renames src to dst when src exists (and dst does not yet: a step done before a crash).
func moveIfThere(src, dst string) error {
	if _, err := os.Lstat(src); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if _, err := os.Lstat(dst); err == nil {
		if err := os.RemoveAll(dst); err != nil {
			return err
		}
	}
	return os.Rename(src, dst)
}

// applyRestore swaps the staged files in (steps 1 and 2); false when nothing is pending.
func applyRestore(dbPath string) (*RestorePlan, error) {
	dataDir, media, ok := restorePaths(dbPath)
	if !ok {
		return nil, nil
	}
	plan, err := readRestorePlan(dataDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := swapIn(dbPath, dataDir, media, plan); err != nil {
		return plan, err
	}
	raw, _ := json.Marshal(plan)
	if err := WriteFileAtomically(filepath.Join(dataDir, restoreDoneFile), raw); err != nil {
		return plan, err
	}
	if err := os.Remove(filepath.Join(dataDir, restorePendingFile)); err != nil {
		return plan, err
	}
	return plan, SyncDir(dataDir)
}

func swapIn(dbPath, dataDir, media string, plan *RestorePlan) error {
	staging := filepath.Join(dataDir, RestoreStagingDir, plan.Staging)
	prev := filepath.Join(dataDir, restorePrevDir)
	base := filepath.Base(dbPath)
	stagedDB := filepath.Join(staging, base)
	if _, err := os.Lstat(stagedDB); err == nil {
		// A restore-previous of an earlier restore that did not finish cleanly: the pre-restore backup has it
		if err := os.RemoveAll(prev); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(prev, 0o700); err != nil {
		return err
	}
	if _, err := os.Lstat(stagedDB); err == nil {
		for _, suffix := range []string{"", "-wal", "-shm"} {
			if err := moveIfThere(dbPath+suffix, filepath.Join(prev, base+suffix)); err != nil {
				return err
			}
		}
		if err := os.Rename(stagedDB, dbPath); err != nil {
			return err
		}
	}
	if plan.Media {
		stagedMedia := filepath.Join(staging, "media")
		if _, err := os.Lstat(stagedMedia); err == nil {
			if err := moveIfThere(media, filepath.Join(prev, "media")); err != nil {
				return err
			}
			if err := os.Rename(stagedMedia, media); err != nil {
				return err
			}
		}
	}
	return SyncDir(dataDir)
}

// rollbackRestore puts the files from before the restore back (the restored database did not open).
func rollbackRestore(dbPath string) error {
	dataDir, media, ok := restorePaths(dbPath)
	if !ok {
		return nil
	}
	prev := filepath.Join(dataDir, restorePrevDir)
	base := filepath.Base(dbPath)
	failed := filepath.Join(dataDir, RestoreStagingDir, "failed-"+time.Now().UTC().Format("20060102-150405"))
	if err := os.MkdirAll(failed, 0o700); err != nil {
		return err
	}
	if _, err := os.Lstat(filepath.Join(prev, base)); err == nil {
		for _, suffix := range []string{"", "-wal", "-shm"} {
			if err := moveIfThere(dbPath+suffix, filepath.Join(failed, base+suffix)); err != nil {
				return err
			}
			if err := moveIfThere(filepath.Join(prev, base+suffix), dbPath+suffix); err != nil {
				return err
			}
		}
	}
	if _, err := os.Lstat(filepath.Join(prev, "media")); err == nil {
		if err := moveIfThere(media, filepath.Join(failed, "media")); err != nil {
			return err
		}
		if err := os.Rename(filepath.Join(prev, "media"), media); err != nil {
			return err
		}
	}
	_ = os.Remove(filepath.Join(dataDir, restoreDoneFile))
	_ = os.RemoveAll(prev)
	return SyncDir(dataDir)
}

// finishRestore removes what the swap left (the previous files, the staging folders).
func finishRestore(dbPath string) {
	dataDir, _, ok := restorePaths(dbPath)
	if !ok {
		return
	}
	if _, err := os.Lstat(filepath.Join(dataDir, restorePendingFile)); err == nil {
		return // a restore waits to be swapped in; its staging folder must stay
	}
	for _, p := range []string{filepath.Join(dataDir, restorePrevDir), filepath.Join(dataDir, RestoreStagingDir)} {
		if err := os.RemoveAll(p); err != nil {
			slog.Warn("Removing what a restore left failed", "path", p, "error", err)
		}
	}
}

// OpenStoreWithRestore opens the store at dbPath like NewStore; a restore waiting in restore-pending.json is
// swapped in first. When that fails or the restored database does not open, the previous files are put back
// and opened instead (restoreErr says why the restore failed; restore-done.json records it for the audit
// log). Without a pending restore it also clears what an earlier one left. The cmd/server start and the
// desktop app open their store through this.
func OpenStoreWithRestore(dbPath string, opts ...StoreOption) (st *Store, restoreErr error, err error) {
	plan, restoreErr := applyRestore(dbPath)
	if restoreErr == nil {
		st, err = NewStore(dbPath, opts...)
		if err != nil && plan != nil {
			restoreErr, st = err, nil
		}
	}
	if restoreErr != nil {
		slog.Error("Restoring the backup failed; putting the previous data back", "error", restoreErr)
		if rbErr := rollbackRestore(dbPath); rbErr != nil {
			return nil, restoreErr, fmt.Errorf("restore failed (%v) and the previous data could not be put back: %w", restoreErr, rbErr)
		}
		dataDir := filepath.Dir(dbPath)
		_ = os.Remove(filepath.Join(dataDir, restorePendingFile))
		if plan != nil {
			plan.Error = restoreErr.Error()
			if raw, err := json.Marshal(plan); err == nil {
				logRestoreFailed(WriteFileAtomically(filepath.Join(dataDir, restoreDoneFile), raw))
			}
		}
		st, err = NewStore(dbPath, opts...)
	}
	if err == nil {
		finishRestore(dbPath)
		if plan != nil && restoreErr == nil {
			slog.Info("Backup restored", "backup", plan.Backup, "pre_restore_backup", plan.PreBackup)
		}
	}
	return st, restoreErr, err
}

func logRestoreFailed(err error) {
	if err != nil {
		slog.Warn("Recording the failed restore failed", "error", err)
	}
}

// TakeRestoreDone returns and removes the record of the restore swapped in at the last open (nil: none),
// for the audit log of the restored database.
func TakeRestoreDone(dbPath string) *RestorePlan {
	dataDir, _, ok := restorePaths(dbPath)
	if !ok {
		return nil
	}
	p := filepath.Join(dataDir, restoreDoneFile)
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	_ = os.Remove(p)
	var plan RestorePlan
	if json.Unmarshal(raw, &plan) != nil {
		return nil
	}
	return &plan
}
