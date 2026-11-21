package shell

import (
	"os"
	"path/filepath"
	"strings"
)

// Cloud sync: a sync client copies the database file while the server writes to it and can bring back an
// older copy or a conflict file; an open SQLite database can be destroyed that way. The start view warns
// before an instance in such a folder is created or opened (the person may go on anyway). Found by the
// names of the folders on the path and by the files the clients leave in the folders they sync.

// syncFolderPrefixes: folder names a sync client gives its folder ("Nextcloud", "Dropbox (Firma)",
// "OneDrive - Contoso", "Google Drive"), compared in lower case with the start of each folder on the path
var syncFolderPrefixes = []struct{ prefix, service string }{
	{"nextcloud", "Nextcloud"},
	{"owncloud", "ownCloud"},
	{"dropbox", "Dropbox"},
	{"onedrive", "OneDrive"},
	{"google drive", "Google Drive"},
	{"googledrive", "Google Drive"},
	{"my drive", "Google Drive"},
	{"meine ablage", "Google Drive"},
	{"icloud drive", "iCloud"},
	{"iclouddrive", "iCloud"},
	{"pcloud", "pCloud"},
	{"seadrive", "Seafile"},
	{"seafile", "Seafile"},
	{"tresorit", "Tresorit"},
	{"proton drive", "Proton Drive"},
	{"yandex.disk", "Yandex Disk"},
	{"resilio sync", "Resilio Sync"},
	{"box sync", "Box"},
	{"megasync", "MEGA"},
}

// syncFolderNames: short names that only count when they are the whole folder name
var syncFolderNames = map[string]string{
	"mega":   "MEGA",
	"box":    "Box",
	"sync":   "Sync.com",
	"koofr":  "Koofr",
	"insync": "Insync",
}

// syncMarkers: files and folders a sync client leaves in the root of what it syncs, looked for in the
// folder and every folder above it
var syncMarkers = []struct{ name, service string }{
	{".stfolder", "Syncthing"},
	{".dropbox", "Dropbox"},
	{".dropbox.cache", "Dropbox"},
	{".nextcloudsync.log", "Nextcloud"},
	{".owncloudsync.log", "ownCloud"},
	{".sync_journal.db", "Nextcloud"},
	{".debris", "MEGA"},
	{".megaignore", "MEGA"},
	{".sync", "Resilio Sync"},
	{".seafile-data", "Seafile"},
	{".tresorit", "Tresorit"},
	{".pcloud", "pCloud"},
}

// SyncService: the sync service the folder lies in, empty when none was found. The folder itself need
// not exist yet.
func SyncService(dir string) string {
	dir = filepath.Clean(dir)
	if s := syncByEnvironment(dir); s != "" {
		return s
	}
	for _, part := range strings.FieldsFunc(dir, func(r rune) bool { return r == '/' || r == '\\' }) {
		if s := syncByName(part); s != "" {
			return s
		}
	}
	// Mounts of the desktop's online accounts (GNOME: Google Drive, Nextcloud through gvfs)
	if strings.Contains(filepath.ToSlash(dir), "/gvfs/") {
		return "GVFS"
	}
	for d := dir; ; {
		if s := syncByMarker(d); s != "" {
			return s
		}
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	return ""
}

func syncByName(folder string) string {
	f := strings.ToLower(strings.TrimSpace(folder))
	if s, ok := syncFolderNames[f]; ok {
		return s
	}
	for _, p := range syncFolderPrefixes {
		if strings.HasPrefix(f, p.prefix) {
			return p.service
		}
	}
	return ""
}

func syncByMarker(dir string) string {
	for _, m := range syncMarkers {
		if _, err := os.Lstat(filepath.Join(dir, m.name)); err == nil {
			return m.service
		}
	}
	// Nextcloud and ownCloud keep their journal as .sync_<hash>.db or ._sync_<hash>.db
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			n := e.Name()
			if (strings.HasPrefix(n, ".sync_") || strings.HasPrefix(n, "._sync_")) && strings.HasSuffix(n, ".db") {
				return "Nextcloud"
			}
		}
	}
	return ""
}

// syncByEnvironment: the OneDrive folders Windows names in the environment
func syncByEnvironment(dir string) string {
	for _, v := range []string{"OneDrive", "OneDriveConsumer", "OneDriveCommercial"} {
		root := os.Getenv(v)
		if root != "" && within(dir, root) {
			return "OneDrive"
		}
	}
	return ""
}

// within: dir is root or lies below it
func within(dir, root string) bool {
	rel, err := filepath.Rel(filepath.Clean(root), dir)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
