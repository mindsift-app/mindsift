package shell

import (
	"errors"
	"os"
	"testing"
)

// Audit 2026-11-22 F8: a program path with a line break, tab or other control character would add lines
// of its own (keys, groups) to the desktop entry; nothing is written for it.
func TestInstallDesktopEntryRefusesControlCharacters(t *testing.T) {
	t.Setenv("FLATPAK_ID", "")
	for _, exe := range []string{
		"/home/u/Downloads/x\nExec=sh -c 'touch /tmp/pwned'\nX=/mindsift-desktop",
		"/home/u/a\rb/mindsift",
		"/home/u/a\tb/mindsift",
		"/home/u/a\x00b/mindsift",
		"/home/u/a\x7fb/mindsift",
		"/home/u/a\u0085b/mindsift",
	} {
		home := t.TempDir()
		if err := InstallDesktopEntry(home, exe, testEntry, testIcons()); !errors.Is(err, ErrExecPath) {
			t.Errorf("%q: %v, want ErrExecPath", exe, err)
		}
		if entries, _ := os.ReadDir(home); len(entries) != 0 {
			t.Errorf("%q: written: %v", exe, entries)
		}
	}
}

// Audit 2026-11-22 F7: the developer tools only in builds of a branch or when asked for.
func TestDevToolsEnabled(t *testing.T) {
	t.Setenv(DevToolsEnv, "")
	for version, want := range map[string]bool{"": true, "v0.98.0-dev": true, "v0.98.0": false, "v1.0.0-rc1": false} {
		if got := DevToolsEnabled(version); got != want {
			t.Errorf("DevToolsEnabled(%q) = %v, want %v", version, got, want)
		}
	}
	// The same yes/no values as the server's variables
	for raw, want := range map[string]bool{"1": true, "true": true, "yes": true, "ON": true, "0": false, "off": false, "maybe": false} {
		t.Setenv(DevToolsEnv, raw)
		if got := DevToolsEnabled("v0.98.0"); got != want {
			t.Errorf("MINDSIFT_DESKTOP_DEVTOOLS=%q in a release: %v, want %v", raw, got, want)
		}
	}
}
