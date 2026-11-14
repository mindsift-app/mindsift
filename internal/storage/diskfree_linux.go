//go:build linux

package storage

import "syscall"

// diskFree returns the bytes an unprivileged process may still write on the file system of dir; ok is
// false when that cannot be told.
func diskFree(dir string) (free int64, ok bool) {
	var st syscall.Statfs_t
	if dir == "" || syscall.Statfs(dir, &st) != nil {
		return 0, false
	}
	return int64(st.Bavail) * int64(st.Bsize), true
}
