//go:build !linux

package storage

// diskFree cannot tell the free space here (the images and release binaries are Linux only).
func diskFree(string) (int64, bool) { return 0, false }

// fileSystemID cannot tell the file system here either.
func fileSystemID(string) (uint64, bool) { return 0, false }

// sqliteTempDir: without diskFree there is nothing to check in it.
func sqliteTempDir() string { return "" }
