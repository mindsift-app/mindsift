package storage

import (
	"archive/tar"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// A full backup of the instance: everything a restore needs, in one folder below backups/system/:
//
//	mindsift-full-YYYY-MM-DD-HHMMSS/
//	  manifest.json        what it is (format, time, counts, the size of its archive)
//	  mindsift.db.gz       the whole database (VACUUM INTO, consistent while others write), gzipped
//	  media/<note>/<file>  every picture and recording, hard links to the live files where possible
//
// Media files are written once and never changed in place (a new upload gets a new id), so a hard link is a
// safe copy: unchanged media cost no space however many backups keep them. A file is linked from the
// previous full backup when it is the same there (size and time), else from the live media folder, and
// copied only when neither link works (the backups on another disk). The download is one tar archive
// streamed from the folder (WriteFullBackupTar), with the same layout; an uploaded one is unpacked into a
// folder like this (UnpackFullBackupTar). Not included: the accounts' own backups (backups/users, their
// own files), caches, and secrets.key / jwt.secret (the key that decrypts hidden values must not travel
// with the data it protects; a new server needs it copied by hand to read them).
//
// Folders are written as .part and renamed once complete, so the list never shows half a backup.

const (
	FullBackupPrefix   = "mindsift-full-"
	FullBackupManifest = "manifest.json"
	FullBackupDBName   = "mindsift.db.gz"
	FullBackupMedia    = "media"
	fullBackupFormat   = "mindsift-full-backup"
	fullBackupVersion  = 1
	// FullBackupPreRestore: the reason of the backup written right before a restore
	FullBackupPreRestore = "pre-restore"
)

var (
	fullBackupNameRe = regexp.MustCompile(`^mindsift-full-\d{4}-\d{2}-\d{2}-\d{6}$`)
	// mediaSegmentRe: one part of a media path (a note id, a media id with its extension)
	mediaSegmentRe   = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$`)
	ErrNotFullBackup = errors.New("Die Datei ist keine vollständige MindSift-Sicherung")
)

// FullBackupManifestData is manifest.json of a full backup.
type FullBackupManifestData struct {
	Format     string `json:"format"`
	Version    int    `json:"version"`
	CreatedAt  string `json:"createdAt"`
	Reason     string `json:"reason,omitempty"`
	MediaFiles int    `json:"mediaFiles"`
	MediaBytes int64  `json:"mediaBytes"`
	// ArchiveBytes: the tar archive of everything but manifest.json (FullBackupSize adds it)
	ArchiveBytes int64 `json:"archiveBytes"`
}

// IsFullBackupName: the name of a full backup folder.
func IsFullBackupName(name string) bool { return fullBackupNameRe.MatchString(name) }

// ValidMediaPath: a path inside the media folder as MindSift writes it, "<note id>/<file>" with "/".
func ValidMediaPath(rel string) bool {
	parts := strings.Split(rel, "/")
	return len(parts) == 2 && mediaSegmentRe.MatchString(parts[0]) && mediaSegmentRe.MatchString(parts[1])
}

// readFullManifest reads manifest.json of the full backup in dir.
func readFullManifest(dir string) (*FullBackupManifestData, int64, error) {
	p := filepath.Join(dir, FullBackupManifest)
	info, err := os.Lstat(p)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return nil, 0, ErrNotFullBackup
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, 0, err
	}
	var m FullBackupManifestData
	if json.Unmarshal(raw, &m) != nil || m.Format != fullBackupFormat {
		return nil, 0, ErrNotFullBackup
	}
	return &m, info.Size(), nil
}

// tarEntrySize: the bytes a regular file of size n takes in a ustar archive (header plus padded content).
func tarEntrySize(n int64) int64 { return 512 + (n+511)/512*512 }

// tarEndSize: the two empty blocks that end an archive
const tarEndSize = 1024

// fullBackupFile is one file of the archive: its name in the archive and on disk.
type fullBackupFile struct {
	name, path string
	size       int64
	mod        time.Time
}

// fullBackupFiles lists the files of the full backup in dir in archive order: manifest.json, the database,
// then the media sorted by path. Only regular files with names MindSift writes; the total is the exact size
// of the tar archive.
func fullBackupFiles(dir string) ([]fullBackupFile, int64, error) {
	info, err := os.Lstat(filepath.Join(dir, FullBackupManifest))
	if err != nil || !info.Mode().IsRegular() {
		return nil, 0, ErrNotFullBackup
	}
	content, total, err := fullBackupContent(dir)
	if err != nil {
		return nil, 0, err
	}
	manifest := fullBackupFile{name: FullBackupManifest, path: filepath.Join(dir, FullBackupManifest), size: info.Size(), mod: info.ModTime()}
	return append([]fullBackupFile{manifest}, content...), total + tarEntrySize(info.Size()), nil
}

// fullBackupContent: the database and the media of the full backup in dir, and the size of their tar
// archive (everything but manifest.json, also while a backup is still being written).
func fullBackupContent(dir string) ([]fullBackupFile, int64, error) {
	info, err := os.Lstat(filepath.Join(dir, FullBackupDBName))
	if err != nil || !info.Mode().IsRegular() {
		return nil, 0, ErrNotFullBackup
	}
	files := []fullBackupFile{{name: FullBackupDBName, path: filepath.Join(dir, FullBackupDBName), size: info.Size(), mod: info.ModTime()}}
	media, err := mediaFiles(filepath.Join(dir, FullBackupMedia))
	if err != nil {
		return nil, 0, err
	}
	for _, m := range media {
		m.name = FullBackupMedia + "/" + m.name
		files = append(files, m)
	}
	total := int64(tarEndSize)
	for _, f := range files {
		total += tarEntrySize(f.size)
	}
	return files, total, nil
}

// mediaFiles lists the media files below root ("<note>/<file>", regular files only), sorted.
func mediaFiles(root string) ([]fullBackupFile, error) {
	var out []fullBackupFile
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if p == root && errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() {
			if p != root && filepath.Dir(p) != root {
				return fs.SkipDir // deeper than <note>/: not ours
			}
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if !d.Type().IsRegular() || !ValidMediaPath(rel) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil // removed meanwhile
		}
		out = append(out, fullBackupFile{name: rel, path: p, size: info.Size(), mod: info.ModTime()})
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out, err
}

// FullBackupSize: the size of the tar archive of the full backup in dir, from its manifest.
func FullBackupSize(dir string) (int64, *FullBackupManifestData, error) {
	m, manifestSize, err := readFullManifest(dir)
	if err != nil {
		return 0, nil, err
	}
	return m.ArchiveBytes + tarEntrySize(manifestSize), m, nil
}

// WriteFullBackupTar streams the full backup in dir as one tar archive to w. size: the exact length, known
// before the first byte (Content-Length).
func WriteFullBackupTar(dir string) (size int64, write func(io.Writer) error, err error) {
	files, total, err := fullBackupFiles(dir)
	if err != nil {
		return 0, nil, err
	}
	return total, func(w io.Writer) error {
		tw := tar.NewWriter(w)
		for _, f := range files {
			if err := writeTarFile(tw, f); err != nil {
				return err
			}
		}
		return tw.Close()
	}, nil
}

func writeTarFile(tw *tar.Writer, f fullBackupFile) error {
	in, err := os.Open(f.path)
	if err != nil {
		return err
	}
	defer in.Close()
	hdr := &tar.Header{Name: f.name, Mode: 0o600, Size: f.size, ModTime: f.mod.Truncate(time.Second), Typeflag: tar.TypeReg, Format: tar.FormatUSTAR}
	if err := tw.WriteHeader(hdr); err != nil {
		return err
	}
	n, err := io.Copy(tw, io.LimitReader(in, f.size))
	if err == nil && n != f.size {
		err = fmt.Errorf("%s changed while it was read", f.name)
	}
	return err
}

// LatestFullBackup: the folder of the newest full backup in dir, "" when there is none.
func LatestFullBackup(dir string) string {
	files, err := ListBackups(dir)
	if err != nil {
		return ""
	}
	for _, f := range files {
		if f.Full {
			return filepath.Join(dir, f.Name)
		}
	}
	return ""
}

// WriteFullBackup writes a full backup of the database and the media into dir (backups/system); reason
// is kept in the manifest ("" for the daily one, FullBackupPreRestore).
func (s *Store) WriteFullBackup(dir string, now time.Time, reason string) (string, error) {
	if s.mediaRoot == "" {
		return "", errors.New("full backup: the database has no data folder")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	removeStaleParts(dir, time.Now())
	// Two in the same second (a run by hand, then the backup before a restore): the next free second
	name := FullBackupPrefix + now.Format(backupStampFmt)
	for i := 1; i < 60; i++ {
		if _, err := os.Lstat(filepath.Join(dir, name)); errors.Is(err, fs.ErrNotExist) {
			break
		}
		name = FullBackupPrefix + now.Add(time.Duration(i)*time.Second).Format(backupStampFmt)
	}
	final := filepath.Join(dir, name)
	if _, err := os.Lstat(final); err == nil {
		return "", fmt.Errorf("full backup %s exists already", name)
	}
	tmp := filepath.Join(dir, "."+name+".part")
	_ = os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o700); err != nil {
		return "", err
	}
	ok := false
	defer func() {
		if !ok {
			_ = os.RemoveAll(tmp)
		}
	}()
	prev := LatestFullBackup(dir)
	if prev != "" {
		prev = filepath.Join(prev, FullBackupMedia)
	}
	media := filepath.Join(tmp, FullBackupMedia)
	// The media before and after the database: a file deleted or added while the snapshot was taken is in
	// the backup either way (a deleted one is left over, harmless)
	if err := linkMediaTree(s.mediaRoot, media, prev); err != nil {
		return "", fmt.Errorf("full backup, media: %w", err)
	}
	if err := s.writeSnapshot(tmp, FullBackupDBName, now); err != nil {
		return "", err
	}
	if err := linkMediaTree(s.mediaRoot, media, prev); err != nil {
		return "", fmt.Errorf("full backup, media: %w", err)
	}
	files, total, err := fullBackupContent(tmp)
	if err != nil {
		return "", err
	}
	m := FullBackupManifestData{Format: fullBackupFormat, Version: fullBackupVersion, CreatedAt: now.UTC().Format(time.RFC3339), Reason: reason, ArchiveBytes: total}
	for _, f := range files {
		if strings.HasPrefix(f.name, FullBackupMedia+"/") {
			m.MediaFiles++
			m.MediaBytes += f.size
		}
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return "", err
	}
	if err := WriteFileAtomically(filepath.Join(tmp, FullBackupManifest), raw); err != nil {
		return "", err
	}
	if err := SyncDir(tmp); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, final); err != nil {
		return "", err
	}
	ok = true
	return name, SyncDir(dir)
}

// removeStaleParts removes full backups left half-written by a crash.
func removeStaleParts(dir string, now time.Time) {
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		n := e.Name()
		if !strings.HasPrefix(n, "."+FullBackupPrefix) || !strings.HasSuffix(n, ".part") {
			continue
		}
		// Only old ones: the command line (mindsift check --backup) may write one while the server does
		if info, err := e.Info(); err == nil && now.Sub(info.ModTime()) > staleBackupPart {
			_ = os.RemoveAll(filepath.Join(dir, n))
		}
	}
}

// staleBackupPart: a full backup still being written after this was cut off
const staleBackupPart = 12 * time.Hour

// linkMediaTree puts every media file below src into dst (same layout), skipping those already there: a
// hard link to the same file in prev (the previous backup's media) when size and time match, else a hard
// link to the file in src, else a copy with the file's time.
func linkMediaTree(src, dst, prev string) error {
	files, err := mediaFiles(src)
	if err != nil {
		return err
	}
	madeDirs := map[string]bool{}
	for _, f := range files {
		target := filepath.Join(dst, filepath.FromSlash(f.name))
		if _, err := os.Lstat(target); err == nil {
			continue
		}
		if d := filepath.Dir(target); !madeDirs[d] {
			if err := os.MkdirAll(d, 0o700); err != nil {
				return err
			}
			madeDirs[d] = true
		}
		if err := placeMediaFile(f, target, prev); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue // deleted meanwhile
			}
			return err
		}
	}
	return nil
}

func placeMediaFile(f fullBackupFile, target, prev string) error {
	if prev != "" {
		p := filepath.Join(prev, filepath.FromSlash(f.name))
		if info, err := os.Lstat(p); err == nil && info.Mode().IsRegular() && info.Size() == f.size && info.ModTime().Equal(f.mod) {
			if os.Link(p, target) == nil {
				return nil
			}
		}
	}
	if os.Link(f.path, target) == nil {
		return nil
	}
	return copyFileWithTime(f.path, target, f.mod)
}

// copyFileWithTime copies src to dst (flushed to disk) and gives it the time mod.
func copyFileWithTime(src, dst string, mod time.Time) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(dst)
		return err
	}
	return os.Chtimes(dst, mod, mod)
}

// LinkMediaTree is linkMediaTree for the restore (a backup's media into the staging folder).
func LinkMediaTree(src, dst string) error { return linkMediaTree(src, dst, "") }
