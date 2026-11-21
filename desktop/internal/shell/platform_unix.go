//go:build !windows

package shell

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// systemLanguagePlatform: nothing beyond the locale variables (SystemLanguage reads them)
func systemLanguagePlatform() string { return "" }

// lockFile takes an exclusive lock (flock) on the open file without waiting; held until the file is closed
// or the process ends, whatever way it ends.
func lockFile(f *os.File) error {
	err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
	if errors.Is(err, unix.EWOULDBLOCK) {
		return ErrLocked
	}
	return err
}

// errAddrInUse: the error of a port another program listens on
var errAddrInUse error = unix.EADDRINUSE
