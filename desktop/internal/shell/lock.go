package shell

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// LockFile: the lock of an open instance, in its folder. A second app process (another account on the same
// machine, a second copy started with another MINDSIFT_DESKTOP_DIR) cannot open the same database while
// this one has it open. The operating system drops the lock when the process ends, so a crash leaves no
// stale lock behind; the empty file itself stays and does no harm.
const LockFile = "mindsift.lock"

// ErrLocked: another process has the instance open
var ErrLocked = errors.New("the instance is open in another MindSift window")

type instanceLock struct{ f *os.File }

// lockInstance takes the lock of the instance in dir, or fails with ErrLocked.
func lockInstance(dir string) (*instanceLock, error) {
	f, err := os.OpenFile(filepath.Join(dir, LockFile), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, fmt.Errorf("opening the lock file: %w", err)
	}
	if err := lockFile(f); err != nil {
		_ = f.Close()
		return nil, err
	}
	return &instanceLock{f: f}, nil
}

func (l *instanceLock) release() {
	if l != nil && l.f != nil {
		_ = l.f.Close()
		l.f = nil
	}
}
