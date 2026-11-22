//go:build !linux

package shell

// HostPath: only Flatpak (Linux) hands out paths of the document portal; elsewhere a path is the host's
func HostPath(p string) string { return p }
