package storage

import (
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Automatic backups below $DATA_DIR/backups/:
//   system/mindsift-db-YYYY-MM-DD-HHMM.db.gz        the whole database (VACUUM INTO, consistent while
//                                                     others write), for the admin
//   system/pre-migration-<id>-YYYY-MM-DD-HHMMSS.db.gz   the same, written at start before pending
//                                                     migrations (migrations.go); the last three stay
//   users/<user id>/mindsift-backup-YYYY-MM-DD-HHMM.zip   the same ZIP as "Backup herunterladen"
// Files older than the retention are deleted after each run. Backups next to the database protect
// against mistakes, not against a broken disk; copy the folder elsewhere as well.

const (
	DefaultBackupTime          = "03:00"
	DefaultBackupRetentionDays = 3
	MaxBackupRetentionDays     = 365
)

var (
	backupTimeRe  = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
	backupNameRe  = regexp.MustCompile(`^mindsift-(db|backup)-\d{4}-\d{2}-\d{2}-\d{4}\.(db\.gz|zip)$`)
	ErrBackupName = errors.New("Unbekannte Sicherung")
	// The admin settings keep the stored value for these; the setup wizard refuses them
	ErrBackupTime      = errors.New("Ungültige Uhrzeit für die Backups (HH:MM)")
	ErrBackupRetention = errors.New("Ungültige Aufbewahrung der Backups (1 bis 365 Tage)")
	backupStampFmt     = "2006-01-02-1504"
)

// ValidBackupTime: the daily backup time as HH:MM (24 h).
func ValidBackupTime(v string) bool { return backupTimeRe.MatchString(v) }

// ValidBackupRetentionDays: how many days backups are kept, 1 to MaxBackupRetentionDays.
func ValidBackupRetentionDays(n int) bool { return n >= 1 && n <= MaxBackupRetentionDays }

// BackupFile is one entry of a backup listing.
type BackupFile struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"createdAt"`
}

// BackupPath returns the file of a backup in dir, refusing anything that is not one of our names
// (no path tricks through the API).
func BackupPath(dir, name string) (string, error) {
	if !backupNameRe.MatchString(name) {
		return "", ErrBackupName
	}
	p := filepath.Join(dir, name)
	if _, err := os.Stat(p); err != nil {
		return "", ErrBackupName
	}
	return p, nil
}

// DeleteBackup removes one backup in dir; like BackupPath it only accepts our own file names.
func DeleteBackup(dir, name string) error {
	p, err := BackupPath(dir, name)
	if err != nil {
		return err
	}
	return os.Remove(p)
}

// ListBackups lists the backups in dir, newest first.
func ListBackups(dir string) ([]BackupFile, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []BackupFile{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []BackupFile{}
	for _, e := range entries {
		if e.IsDir() || !backupNameRe.MatchString(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, BackupFile{Name: e.Name(), Size: info.Size(), CreatedAt: info.ModTime().UTC().Format(time.RFC3339)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })
	return out, nil
}

// PruneBackups deletes backups in dir older than keepDays.
func PruneBackups(dir string, keepDays int, now time.Time) error {
	files, err := ListBackups(dir)
	if err != nil {
		return err
	}
	cutoff := now.Add(-time.Duration(keepDays) * 24 * time.Hour)
	for _, f := range files {
		created, err := time.Parse(time.RFC3339, f.CreatedAt)
		if err == nil && created.Before(cutoff) {
			if err := os.Remove(filepath.Join(dir, f.Name)); err != nil {
				return err
			}
		}
	}
	return nil
}

// WriteSystemSnapshot writes a gzip-compressed copy of the whole database into dir.
func (s *Store) WriteSystemSnapshot(dir string, now time.Time) (string, error) {
	name := "mindsift-db-" + now.Format(backupStampFmt) + ".db.gz"
	return name, s.writeSnapshot(dir, name, now)
}

// writeSnapshot writes a consistent copy of the database (VACUUM INTO) gzip-compressed to dir/name.
// While it runs, the uncompressed copy lies next to it, so dir needs about the size of the database in
// free space; nothing half-written stays behind when that runs out.
func (s *Store) writeSnapshot(dir, name string, now time.Time) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp := filepath.Join(dir, ".tmp-"+now.Format("20060102150405.000000")+".db")
	defer os.Remove(tmp)
	if _, err := s.db.Exec(`VACUUM INTO ?`, tmp); err != nil {
		return fmt.Errorf("database snapshot: %w", err)
	}
	return gzipFile(tmp, filepath.Join(dir, name))
}

// WriteUserBackup writes the user's MindSift backup (ZIP with the JSON export) into dir.
func (s *Store) WriteUserBackup(userID, dir string, now time.Time) (string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	exp, err := s.ExportUserData(userID)
	if err != nil {
		return "", err
	}
	name := "mindsift-backup-" + now.Format(backupStampFmt) + ".zip"
	return name, writeFileAtomically(filepath.Join(dir, name), func(w io.Writer) error { return s.WriteBackupZip(userID, exp, w) })
}

func gzipFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	return writeFileAtomically(dst, func(w io.Writer) error {
		gz := gzip.NewWriter(w)
		if _, err := io.Copy(gz, in); err != nil {
			return err
		}
		return gz.Close()
	})
}

// writeFileAtomically writes to a temporary file and renames it, so a half-written backup never
// shows up in the list.
func writeFileAtomically(dst string, write func(io.Writer) error) error {
	tmp := dst + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := write(f); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

// UserBackupDir is the backup folder of one user below root; user IDs are generated by MindSift.
func UserBackupDir(root, userID string) string {
	return filepath.Join(root, "users", strings.ReplaceAll(filepath.Base(userID), "..", ""))
}
