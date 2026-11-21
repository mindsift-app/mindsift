package shell

import (
	"bytes"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// DesktopEntryID is the application id: the name of the .desktop file and of the icons, the GTK
// application id and with it the Wayland app-id / X11 WM_CLASS of the window, which is how the desktop
// finds the entry (and with it the icon) for the window.
const DesktopEntryID = "app.mindsift.MindSift"

// InstallDesktopEntry makes a loose Linux binary known to the desktop: a .desktop file and the icons in
// the user's data home (dataHome/applications, dataHome/icons/hicolor), so the window gets its icon and
// the app shows up in the launcher. entry is the shared desktop file (desktop/packaging/linux, the same
// one a Flatpak ships; its Exec line is replaced by exe), icons the hicolor tree. Files that are already
// right are left alone, so a changed binary path or a new icon is the only thing that writes. Nothing
// happens when the app is packaged (Flatpak brings its own entry; a system package under /usr as well).
func InstallDesktopEntry(dataHome, exe string, entry []byte, icons fs.FS) error {
	if os.Getenv("FLATPAK_ID") != "" || exe == "" || strings.HasPrefix(exe, "/usr/") || dataHome == "" {
		return nil
	}
	err := writeIfChanged(filepath.Join(dataHome, "applications", DesktopEntryID+".desktop"), withExec(entry, exe))
	if err != nil {
		return err
	}
	return fs.WalkDir(icons, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(icons, p)
		if err != nil {
			return err
		}
		return writeIfChanged(filepath.Join(dataHome, "icons", "hicolor", filepath.FromSlash(path.Clean(p))), data)
	})
}

// withExec: the desktop file with its Exec line pointing to exe
func withExec(entry []byte, exe string) []byte {
	lines := strings.Split(string(entry), "\n")
	for i, l := range lines {
		if strings.HasPrefix(l, "Exec=") {
			lines[i] = "Exec=" + execQuote(exe)
		}
	}
	return []byte(strings.Join(lines, "\n"))
}

// execQuote: a path as the Exec key wants it: quoted, with \ " ` $ escaped by a backslash that is itself
// doubled (the file's string escaping comes on top of the quoting), % doubled
func execQuote(p string) string {
	r := strings.NewReplacer(`\`, `\\\\`, `"`, `\\"`, "`", "\\\\`", `$`, `\\$`, `%`, `%%`)
	return `"` + r.Replace(p) + `"`
}

func writeIfChanged(file string, data []byte) error {
	if old, err := os.ReadFile(file); err == nil && bytes.Equal(old, data) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}
