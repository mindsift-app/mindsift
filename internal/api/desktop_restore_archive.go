package api

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/mindsift-app/mindsift/internal/importer"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// A server's backup with its media, for taking one account over (desktop_restore.go). What a server keeps:
//
//	<data>/mindsift.db                                         the live database (with mindsift.db-wal)
//	<data>/media/<note id>/<media id><ext>                     pictures and recordings
//	<data>/backups/system/mindsift-full-…/                     the daily full backups (database and media)
//	<data>/backups/system/mindsift-db-….db.gz                  older daily database snapshots (no media)
//	<data>/backups/users/<account id>/mindsift-backup-….zip    each account's daily backup, with its media
//
// A full backup as downloaded from the administration (a tar with manifest.json, mindsift.db.gz and media/,
// storage/fullbackup.go) is read like a data folder. A copy of the data folder or of its backups folder,
// packed as .zip, .tar or .tar.gz, is taken as it is:
// the database is the live one (with its -wal) or else the newest daily snapshot; the chosen account's
// pictures and recordings come from media/ of the data folder, or else from that account's newest daily
// backup. A database snapshot alone (.db.gz) still works, without media.
//
// Nothing in the archive is written under its own name: the database goes to the staging folder's
// mindsift.db, a media file only to the path the checked database gives for one of the chosen account's
// own files (inside the snapshot's media folder), and only regular files are read (no links, no "..").

const (
	// maxSnapshotMediaFileBytes: one picture or recording (the import takes no larger one, see
	// storage.maxImportMediaBytes)
	maxSnapshotMediaFileBytes = 100 << 20
	// stagedArchiveName / stagedArchiveInfo: the uploaded archive in the staging folder, and where in it the
	// data and backups folders are
	stagedArchiveName = "archive"
	stagedArchiveInfo = "archive.json"
	// stagedServerKey: the server's secrets.key from the archive, checked (stageServerKey)
	stagedServerKey = "server-secrets.key"
	// maxSecretsKeyFileBytes: a secrets.key is 65 bytes; a larger file of that name is no key
	maxSecretsKeyFileBytes = 1024
)

var (
	// The daily snapshots and the accounts' daily backups (storage/backup.go)
	snapshotFileRe   = regexp.MustCompile(`^mindsift-db-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?\.db\.gz$`)
	userBackupFileRe = regexp.MustCompile(`^mindsift-backup-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?\.zip$`)
)

type uploadKind string

const (
	uploadDB    uploadKind = "db"   // a plain database file
	uploadDBGz  uploadKind = "dbgz" // a snapshot as the server writes it
	uploadZip   uploadKind = "zip"
	uploadTar   uploadKind = "tar"
	uploadTarGz uploadKind = "tgz"
)

const (
	// tarMagicAt: where "ustar" stands in a tar header; sniffedBytes: what detectUpload looks at
	tarMagicAt   = 257
	sniffedBytes = 512
)

// stagedArchive: where the media of an uploaded archive are (paths inside the archive; "" = not in it).
type stagedArchive struct {
	Kind  uploadKind `json:"kind"`
	Media string     `json:"media"` // the data folder's media/
	Users string     `json:"users"` // the backups folder's users/
}

// detectUpload tells a database (plain or gzipped) from a zip or tar archive by its first bytes.
func detectUpload(file string) (uploadKind, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
	br := bufio.NewReader(f)
	head, _ := br.Peek(sniffedBytes)
	switch {
	case len(head) >= 2 && head[0] == 0x1f && head[1] == 0x8b:
		zr, err := gzip.NewReader(br)
		if err != nil {
			return "", errNotSnapshot
		}
		inner := make([]byte, sniffedBytes)
		n, _ := io.ReadFull(zr, inner)
		inner = inner[:n]
		switch {
		case bytes.HasPrefix(inner, sqliteHeader):
			return uploadDBGz, nil
		case isTarHeader(inner):
			return uploadTarGz, nil
		}
	case bytes.HasPrefix(head, []byte("PK\x03\x04")):
		return uploadZip, nil
	case bytes.HasPrefix(head, sqliteHeader):
		return uploadDB, nil
	case isTarHeader(head):
		return uploadTar, nil
	}
	return "", errNotSnapshot
}

func isTarHeader(b []byte) bool {
	return len(b) >= tarMagicAt+5 && string(b[tarMagicAt:tarMagicAt+5]) == "ustar"
}

// stageUpload puts the database of the uploaded file raw into dir/mindsift.db. An archive stays as
// dir/archive (its media are read when an account is taken over); a database file is removed.
func stageUpload(raw, dir string) error {
	kind, err := detectUpload(raw)
	if err != nil {
		return err
	}
	if kind == uploadDB || kind == uploadDBGz {
		err := unpackSnapshot(raw, filepath.Join(dir, snapshotDBName))
		logFailed("Removing the uploaded database snapshot", os.Remove(raw))
		return err
	}
	info, err := stageArchive(kind, raw, dir)
	if err != nil {
		return err
	}
	data, err := json.Marshal(info)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, stagedArchiveInfo), data, 0o600); err != nil {
		return err
	}
	return os.Rename(raw, filepath.Join(dir, stagedArchiveName))
}

// stageArchive finds the server's database in the archive and writes it to dir/mindsift.db: the live
// database closest to the archive's root, with its -wal; without one, the newest daily snapshot.
func stageArchive(kind uploadKind, file, dir string) (*stagedArchive, error) {
	liveTmp, snapTmp := filepath.Join(dir, "live.db"), filepath.Join(dir, "snapshot.db.gz")
	defer os.Remove(liveTmp)
	defer os.Remove(snapTmp)
	var live, snap string
	wals := map[string]string{} // folder in the archive → its -wal, staged
	keys := map[string]string{} // folder in the archive → its secrets.key, staged
	defer func() {
		for _, f := range wals {
			_ = os.Remove(f)
		}
		for _, f := range keys {
			_ = os.Remove(f)
		}
	}()
	err := walkArchive(kind, file, func(e archiveEntry) error {
		base, parent := path.Base(e.name), entryDir(e.name)
		switch {
		case base == snapshotDBName, base == storage.FullBackupDBName:
			// A full backup (mindsift.db.gz with media/ beside it) counts like a data folder; of several at
			// the same depth the newest (the folder names carry the time), a plain database before them
			if live != "" && !betterLiveDB(e.name, live) {
				return nil
			}
			if err := copyEntry(e, liveTmp, maxSnapshotBytes); err != nil {
				return err
			}
			live = e.name
		case base == snapshotDBName+"-wal":
			dst := filepath.Join(dir, fmt.Sprintf("wal-%d", len(wals)))
			if old, ok := wals[parent]; ok {
				dst = old
			}
			if err := copyEntry(e, dst, maxSnapshotBytes); err != nil {
				return err
			}
			wals[parent] = dst
		case base == storage.FullBackupSecretsKey:
			dst := filepath.Join(dir, fmt.Sprintf("key-%d", len(keys)))
			if old, ok := keys[parent]; ok {
				dst = old
			}
			err := copyEntry(e, dst, maxSecretsKeyFileBytes)
			if errors.Is(err, errSnapshotTooLarge) {
				return nil // no key file of MindSift
			}
			if err != nil {
				return err
			}
			keys[parent] = dst
		case path.Base(parent) == "system" && snapshotFileRe.MatchString(base):
			if snap != "" && base <= path.Base(snap) {
				return nil
			}
			if err := copyEntry(e, snapTmp, maxSnapshotBytes); err != nil {
				return err
			}
			snap = e.name
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	db := filepath.Join(dir, snapshotDBName)
	info := &stagedArchive{Kind: kind}
	switch {
	case live != "":
		data := entryDir(live)
		info.Media, info.Users = path.Join(data, "media"), path.Join(data, "backups", "users")
		if err := unpackSnapshot(liveTmp, db); err != nil {
			return nil, err
		}
		if wal, ok := wals[data]; ok {
			if err := os.Rename(wal, db+"-wal"); err != nil {
				return nil, err
			}
			delete(wals, data)
		}
	case snap != "":
		backups := entryDir(entryDir(snap))
		info.Users = path.Join(backups, "users")
		if backups != "" {
			info.Media = path.Join(entryDir(backups), "media")
		}
		if err := unpackSnapshot(snapTmp, db); err != nil {
			return nil, err
		}
	default:
		return nil, errNotSnapshot
	}
	// The server's key: beside the database (a data folder, a full backup); for a daily snapshot the one of
	// the data folder its backups folder lies in
	keyDir, haveKeyDir := "", false
	switch {
	case live != "":
		keyDir, haveKeyDir = entryDir(live), true
	case info.Media != "":
		keyDir, haveKeyDir = entryDir(info.Media), true
	}
	if key, ok := keys[keyDir]; ok && haveKeyDir {
		stageServerKey(key, dir)
	}
	return info, nil
}

// stageServerKey keeps the server's secrets.key found in the archive as dir/server-secrets.key when it is
// one (storage.ReadSecretsKeyFile: hex, 32 bytes); anything else is dropped and the hidden values stay
// behind as without a key. The key is only read by a take-over (snapshotHiddenValuesOf) and goes with
// the staging folder; it never becomes the instance's key.
func stageServerKey(src, dir string) {
	key, err := storage.ReadSecretsKeyFile(src)
	if err != nil {
		slog.Warn("The secrets.key in the server's backup is not a MindSift key and is ignored", "error", err)
		return
	}
	logFailed("Staging the server's secrets key", storage.WriteFileAtomically(filepath.Join(dir, stagedServerKey), []byte(hex.EncodeToString(key)+"\n")))
}

// extractAccountMedia puts the pictures and recordings of the account's notes from the staged archive into
// the snapshot's media folder, where the export of the account (WriteBackupZip) picks them up. Only files
// of this account are written, each to the path the snapshot's database gives for it. Without an archive
// (a database snapshot alone) there is nothing to do.
func extractAccountMedia(st *storage.Store, dir, accountID string) error {
	raw, err := os.ReadFile(filepath.Join(dir, stagedArchiveInfo))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var info stagedArchive
	if err := json.Unmarshal(raw, &info); err != nil {
		return err
	}
	media, err := st.MediaOfUser(accountID)
	if err != nil {
		return err
	}
	root := st.MediaRoot()
	byEntry := map[string]string{} // entry in the data folder's media/ → where it goes
	byFile := map[string]string{}  // <media id><ext> → where it goes
	for i := range media {
		dst := st.MediaFilePath(&media[i])
		if rel, err := filepath.Rel(root, dst); err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
			continue
		}
		if _, err := os.Stat(dst); err == nil {
			continue // a preview already got it
		}
		name := filepath.Base(dst)
		byFile[name] = dst
		if info.Media != "" {
			byEntry[path.Join(info.Media, filepath.Base(filepath.Dir(dst)), name)] = dst
		}
	}
	if len(byFile) == 0 {
		return nil
	}
	budget := int64(maxSnapshotUploadBytes)
	done := map[string]bool{}
	take := func(e archiveEntry, dst string) error {
		if done[dst] {
			return nil
		}
		if e.size > maxSnapshotMediaFileBytes || e.size > budget {
			return nil
		}
		err := copyEntry(e, dst, maxSnapshotMediaFileBytes)
		if errors.Is(err, errSnapshotTooLarge) {
			return nil // larger than it said: left out, like a file the import would refuse
		}
		if err != nil {
			return err
		}
		if fi, err := os.Stat(dst); err == nil {
			budget -= fi.Size()
		}
		done[dst] = true
		return nil
	}

	// The account's newest daily backup, for what the data folder does not have
	userDir := ""
	if info.Users != "" && accountID != "" && !strings.ContainsAny(accountID, `/\`) {
		userDir = path.Join(info.Users, accountID)
	}
	userZip, userZipName := filepath.Join(dir, "account-backup.zip"), ""
	defer os.Remove(userZip)
	archive := filepath.Join(dir, stagedArchiveName)
	err = walkArchive(info.Kind, archive, func(e archiveEntry) error {
		if dst, ok := byEntry[e.name]; ok {
			return take(e, dst)
		}
		if base := path.Base(e.name); userDir != "" && entryDir(e.name) == userDir && userBackupFileRe.MatchString(base) && base > userZipName {
			if err := copyEntry(e, userZip, maxSnapshotBytes); err != nil {
				return err
			}
			userZipName = base
		}
		return nil
	})
	if err != nil || userZipName == "" || len(done) == len(byFile) {
		return err
	}
	// In the account's backup: Obsidian/attachments/<id><ext>, media/<id><ext> in older ones
	return walkArchive(uploadZip, userZip, func(e archiveEntry) error {
		d := entryDir(e.name)
		if d != importer.BackupVaultDir+"/attachments" && d != "media" {
			return nil
		}
		if dst, ok := byFile[path.Base(e.name)]; ok {
			return take(e, dst)
		}
		return nil
	})
}

// snapshotMediaCounts: how many of the account's pictures and recordings are there to take over, and how
// many are missing (a database snapshot alone has none).
func snapshotMediaCounts(st *storage.Store, accountID string) (found, missing int) {
	media, err := st.MediaOfUser(accountID)
	if err != nil {
		return 0, 0
	}
	for i := range media {
		if _, err := os.Stat(st.MediaFilePath(&media[i])); err == nil {
			found++
		} else {
			missing++
		}
	}
	return found, missing
}

// archiveEntry is one regular file of an archive; name is cleaned ("/" separated, no "." or "..").
type archiveEntry struct {
	name string
	size int64
	open func() (io.ReadCloser, error)
}

// walkArchive calls fn for every regular file of a zip or tar (gzipped or not) archive. Folders, links and
// entries whose name leaves the archive ("..") are passed over.
func walkArchive(kind uploadKind, file string, fn func(archiveEntry) error) error {
	if kind == uploadZip {
		zr, err := zip.OpenReader(file)
		if err != nil {
			return errNotSnapshot
		}
		defer zr.Close()
		for _, f := range zr.File {
			name := cleanEntryName(f.Name)
			if name == "" || strings.HasSuffix(f.Name, "/") || !f.Mode().IsRegular() {
				continue
			}
			if err := fn(archiveEntry{name: name, size: int64(f.UncompressedSize64), open: f.Open}); err != nil {
				return err
			}
		}
		return nil
	}
	in, err := os.Open(file)
	if err != nil {
		return err
	}
	defer in.Close()
	var r io.Reader = bufio.NewReader(in)
	if kind == uploadTarGz {
		zr, err := gzip.NewReader(r)
		if err != nil {
			return errNotSnapshot
		}
		defer zr.Close()
		r = zr
	}
	tr := tar.NewReader(r)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return errNotSnapshot
		}
		name := cleanEntryName(h.Name)
		if name == "" || h.Typeflag != tar.TypeReg {
			continue
		}
		if err := fn(archiveEntry{name: name, size: h.Size, open: func() (io.ReadCloser, error) { return io.NopCloser(tr), nil }}); err != nil {
			return err
		}
	}
}

// cleanEntryName: the entry's path with "/" separators, without empty and "." parts; "" when it has a ".."
// part or nothing is left.
func cleanEntryName(name string) string {
	parts := []string{}
	for _, p := range strings.Split(strings.ReplaceAll(name, `\`, "/"), "/") {
		switch p {
		case "", ".":
			continue
		case "..":
			return ""
		}
		parts = append(parts, p)
	}
	return strings.Join(parts, "/")
}

// entryDir: the folder of an entry, "" at the archive's root.
func entryDir(name string) string {
	if d := path.Dir(name); d != "." && d != "/" {
		return d
	}
	return ""
}

func depth(name string) int { return strings.Count(name, "/") }

// betterLiveDB: the database entry name is a better choice than cur: closer to the archive's root, or at
// the same depth a plain database over a full backup's, and the newer of two full backups.
func betterLiveDB(name, cur string) bool {
	if depth(name) != depth(cur) {
		return depth(name) < depth(cur)
	}
	gz, curGz := path.Base(name) == storage.FullBackupDBName, path.Base(cur) == storage.FullBackupDBName
	if gz != curGz {
		return !gz
	}
	return gz && entryDir(name) > entryDir(cur)
}

// copyEntry writes the entry to dst, at most limit bytes (more: errSnapshotTooLarge, nothing stays).
func copyEntry(e archiveEntry, dst string, limit int64) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	src, err := e.open()
	if err != nil {
		return errNotSnapshot
	}
	defer src.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	n, err := io.Copy(out, io.LimitReader(src, limit+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	var fileErr *os.PathError
	switch {
	case err == nil && n > limit:
		err = errSnapshotTooLarge
	case err != nil && !errors.As(err, &fileErr):
		// not writing failed but reading: a broken archive (checksum, cut off)
		err = errNotSnapshot
	}
	if err != nil {
		_ = os.Remove(dst)
	}
	return err
}
