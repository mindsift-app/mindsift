//go:build windows

package shell

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

// systemLanguagePlatform: the first language of the Windows display ("de-DE")
func systemLanguagePlatform() string {
	langs, err := windows.GetUserPreferredUILanguages(windows.MUI_LANGUAGE_NAME)
	if err != nil || len(langs) == 0 {
		return ""
	}
	return langs[0]
}

// lockFile takes an exclusive lock on the first byte of the open file without waiting; held until the
// handle is closed or the process ends.
func lockFile(f *os.File) error {
	ol := new(windows.Overlapped)
	err := windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, ol)
	if errors.Is(err, windows.ERROR_LOCK_VIOLATION) || errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		return ErrLocked
	}
	return err
}

// errAddrInUse: the error of a port another program listens on
var errAddrInUse error = windows.WSAEADDRINUSE
