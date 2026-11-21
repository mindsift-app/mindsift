//go:build linux

package main

import (
	"embed"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/mindsift-app/mindsift/desktop/internal/shell"
)

// The desktop file and icons shared with the Flatpak (desktop/packaging/linux)
//
//go:embed packaging/linux/app.mindsift.MindSift.desktop
var desktopFile []byte

//go:embed all:packaging/linux/icons/hicolor
var desktopIcons embed.FS

// registerDesktopEntry: a loose binary writes its own desktop entry and icons into the user's data home
// (the desktop takes the window's icon from it); packaged builds (Flatpak, /usr) skip this, see
// shell.InstallDesktopEntry. Failing is only a missing icon, so it is logged and nothing more.
func registerDesktopEntry() {
	exe := os.Getenv("APPIMAGE") // inside an AppImage the binary is a temporary mount, the image is the program
	if exe == "" {
		p, err := os.Executable()
		if err != nil {
			return
		}
		if r, err := filepath.EvalSymlinks(p); err == nil {
			p = r
		}
		exe = p
	}
	dataHome := os.Getenv("XDG_DATA_HOME")
	if dataHome == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return
		}
		dataHome = filepath.Join(home, ".local", "share")
	}
	icons, err := fs.Sub(desktopIcons, "packaging/linux/icons/hicolor")
	if err != nil {
		return
	}
	if err := shell.InstallDesktopEntry(dataHome, exe, desktopFile, icons); err != nil {
		slog.Warn("Writing the desktop entry failed", "error", err)
	}
}
