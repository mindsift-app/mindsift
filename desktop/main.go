// Desktop shell for MindSift: one window that shows a local instance (the MindSift server runs inside this
// process) or the web app of a MindSift server. The start view (a view of the frontend, features/desktop)
// lists both and opens one; the list lives in desktop.json in the app's base folder (internal/shell).
//
// Local instances open no port. The server's router is the Wails asset handler, so every request of the
// window goes straight from the webview into the router inside this process (wails://localhost/ on Linux,
// http://wails.localhost/ on Windows, both served by the webview itself). Nothing else on the machine can
// reach it. The server runs in desktop mode (config.ApplyDesktop): one account, created on the first start
// and signed in by the window itself, no sign-in screen and only a short setup wizard on its first start.
package main

import (
	"embed"
	"io/fs"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	_ "time/tzdata"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/mindsift-app/mindsift/desktop/internal/shell"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

//go:embed all:dist
var embeddedDist embed.FS

//go:embed icon.png
var trayIcon []byte

// The app icon (the window's icon on Windows when the exe has no resource, the about box); on Linux the
// window's icon comes from the desktop entry, see desktopentry_linux.go
//
//go:embed packaging/linux/icons/hicolor/512x512/apps/app.mindsift.MindSift.png
var appIcon []byte

var version = ""

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: config.LogLevelFromEnv(), ReplaceAttr: i18n.LogInEnglish}))
	slog.SetDefault(logger)

	base := appDataDir()
	settings, err := shell.LoadSettings(base)
	if err != nil {
		slog.Warn("Reading the desktop settings failed", "error", err)
	}
	staticFS, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		log.Fatal(err)
	}
	login, name := shell.SystemUser()
	local := &shell.Local{
		Static:  staticFS,
		Desktop: config.Desktop{Platform: runtime.GOOS, Origin: windowOrigin(), Username: login, DisplayName: name},
		Version: version,
	}
	sh := &shell.Shell{Settings: settings, Local: local, Static: staticFS, Origin: windowOrigin(), Version: version, Base: base}

	// Before the window opens, so the desktop finds the entry and its icon when it maps the window
	registerDesktopEntry()

	var window *application.WebviewWindow
	app := application.New(application.Options{
		Name:        "MindSift",
		Description: "MindSift desktop",
		Icon:        appIcon,
		// The application id is also the Wayland app-id and the X11 WM_CLASS of the window, which the
		// desktop matches to app.mindsift.MindSift.desktop (and with it the icon)
		Linux: application.LinuxOptions{ApplicationID: shell.DesktopEntryID},
		Assets: application.AssetOptions{
			Handler:        sh,
			DisableLogging: true,
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "app.mindsift.MindSift",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				if window != nil {
					window.Show()
					window.Focus()
				}
			},
		},
	})
	sh.ShowFolder = func(dir string) error { return app.Browser.OpenFile(dir) }
	sh.PickFolder = func(start string) (string, error) {
		d := app.Dialog.OpenFile().CanChooseDirectories(true).CanChooseFiles(false).CanCreateDirectories(true).
			SetTitle(shell.Text("pickFolder")).SetButtonText(shell.Text("pickFolderButton"))
		if start != "" {
			d.SetDirectory(start)
		}
		if window != nil {
			d.AttachToWindow(window)
		}
		return d.PromptForSingleSelection()
	}
	sh.Opened = func(e shell.Entry) {
		if window != nil {
			window.SetTitle(e.Name + " – MindSift")
		}
	}

	sh.StartShown = func() {
		if window != nil {
			window.SetTitle("MindSift")
		}
	}

	// "Instanz wechseln…": the start view, from the tray or with Ctrl+Shift+O (desktops without a tray);
	// the app's profile menu goes there itself
	showStart := func() {
		window.SetURL(shell.StartPath)
		window.Show()
		window.Focus()
	}

	startURL := sh.StartURL()
	window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "MindSift",
		Width:  1280,
		Height: 860,
		URL:    startURL,
		// Developer tools (right click → Inspect) help to see what the engine does while this is a spike
		DevToolsEnabled: true,
		// Runs after every page load, the server's pages included
		JS: dropGuard,
		KeyBindings: map[string]func(application.Window){
			"alt+left":     func(w application.Window) { w.ExecJS("history.back()") },
			"alt+right":    func(w application.Window) { w.ExecJS("history.forward()") },
			"f5":           func(w application.Window) { w.Reload() },
			"ctrl+r":       func(w application.Window) { w.Reload() },
			"ctrl+shift+o": func(application.Window) { showStart() },
		},
	})
	if e, ok := settings.Last(); ok && startURL != shell.StartPath {
		window.SetTitle(e.Name + " – MindSift")
	}

	tray := app.SystemTray.New()
	tray.SetIcon(trayIcon)
	tray.SetLabel("MindSift")
	menu := app.NewMenu()
	menu.Add(shell.Text("open")).OnClick(func(*application.Context) { window.Show(); window.Focus() })
	menu.Add(shell.Text("switch")).OnClick(func(*application.Context) { showStart() })
	menu.AddSeparator()
	menu.Add(shell.Text("quit")).OnClick(func(*application.Context) { app.Quit() })
	tray.SetMenu(menu)

	err = app.Run()
	local.Close()
	if err != nil {
		log.Fatal(err)
	}
}

// dropGuard: a file (or link) dropped where the page does not take it would make the engine open it in
// place of the app, with no way back in a window without a back button. Unhandled drops do nothing.
const dropGuard = `(function(){if(window.__msDropGuard)return;window.__msDropGuard=true;
function outside(e){var t=e.dataTransfer?Array.from(e.dataTransfer.types||[]):[];return !e.defaultPrevented&&(t.indexOf('Files')>=0||t.indexOf('text/uri-list')>=0)}
window.addEventListener('dragover',function(e){if(outside(e)){e.preventDefault();e.dataTransfer.dropEffect='none'}});
window.addEventListener('drop',function(e){if(outside(e))e.preventDefault()});})();`

// appDataDir: the app's base folder, holding desktop.json and every local instance (Linux:
// $XDG_DATA_HOME/MindSift or ~/.local/share/MindSift, under Flatpak XDG_DATA_HOME already points into the
// sandbox; Windows: %APPDATA%\MindSift). MINDSIFT_DESKTOP_DIR overrides it.
func appDataDir() string {
	if d := os.Getenv("MINDSIFT_DESKTOP_DIR"); d != "" {
		if abs, err := filepath.Abs(d); err == nil {
			return abs
		}
		return d
	}
	if runtime.GOOS == "windows" {
		if d, err := os.UserConfigDir(); err == nil { // %APPDATA%
			return filepath.Join(d, "MindSift")
		}
		return "MindSift"
	}
	if d := os.Getenv("XDG_DATA_HOME"); d != "" {
		return filepath.Join(d, "MindSift")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".local", "share", "MindSift")
	}
	return "MindSift"
}

// windowOrigin: the origin of the window's pages, which the server alone answers in desktop mode. Wails
// serves its assets on a custom scheme on Linux (WebKitGTK) and on http://wails.localhost on Windows
// (WebView2).
func windowOrigin() string {
	if runtime.GOOS == "windows" {
		return "http://wails.localhost"
	}
	return "wails://localhost"
}
