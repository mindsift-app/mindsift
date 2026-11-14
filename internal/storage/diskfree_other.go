//go:build !linux

package storage

// diskFree cannot tell the free space here (the images and release binaries are Linux only).
func diskFree(string) (int64, bool) { return 0, false }
