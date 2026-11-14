//go:build linux

package storage

import (
	"os"
	"syscall"
)

// diskFree returns the bytes an unprivileged process may still write on the file system of dir; ok is
// false when that cannot be told.
func diskFree(dir string) (free int64, ok bool) {
	var st syscall.Statfs_t
	if dir == "" || syscall.Statfs(dir, &st) != nil {
		return 0, false
	}
	return int64(st.Bavail) * int64(st.Bsize), true
}

// fileSystemID identifies the file system dir lies on; ok is false when that cannot be told.
func fileSystemID(dir string) (id uint64, ok bool) {
	var st syscall.Stat_t
	if dir == "" || syscall.Stat(dir, &st) != nil {
		return 0, false
	}
	return uint64(st.Dev), true
}

// sqliteTempDir is the directory SQLite writes its temporary files to (VACUUM's copy of the database),
// picked as unixTempFileDir in SQLite's os_unix.c does: the first of SQLITE_TMPDIR, TMPDIR, /var/tmp,
// /usr/tmp, /tmp and "." that is a directory the process may write to.
func sqliteTempDir() string {
	for _, d := range []string{os.Getenv("SQLITE_TMPDIR"), os.Getenv("TMPDIR"), "/var/tmp", "/usr/tmp", "/tmp", "."} {
		if d == "" {
			continue
		}
		if fi, err := os.Stat(d); err == nil && fi.IsDir() && syscall.Access(d, 0o3) == nil { // W_OK | X_OK
			return d
		}
	}
	return ""
}
