//go:build unix

package main

import "syscall"

// privateFiles makes new files 0600 and new folders 0700: database, keys, backups and media are for
// MindSift itself, not for other accounts on the host. The container's entrypoint sets the same umask;
// this covers the binary started on its own.
func privateFiles() { syscall.Umask(0o077) }
