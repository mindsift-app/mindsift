// Desktop shell for MindSift (feasibility spike): one window that either runs the MindSift server inside
// this process ("local") or loads the web app from a MindSift server ("remote").
//
// Local mode opens no port. The server's router is the Wails asset handler, so every request of the
// window goes straight from the webview into the router inside this process (wails://localhost/ on Linux,
// http://wails.localhost/ on Windows, both served by the webview itself). Nothing else on the machine can
// reach it. The server runs in desktop mode (config.ApplyDesktop): one account, created on the first start
// and signed in by the window itself, no sign-in screen and no setup wizard.
package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	_ "time/tzdata"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/mindsift-app/mindsift/internal/api"
	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/config"
	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
	"github.com/mindsift-app/mindsift/internal/ws"
)

//go:embed all:dist
var embeddedDist embed.FS

//go:embed icon.png
var trayIcon []byte

var version = ""

// localServer is the embedded MindSift server, started on the first request in local mode, so a shell
// that only connects to a remote server never creates a database.
type localServer struct {
	once    sync.Once
	handler http.Handler
	err     error
	close   func()
}

func (l *localServer) get(dataDir string) (http.Handler, error) {
	l.once.Do(func() {
		if err := os.MkdirAll(dataDir, 0o700); err != nil {
			l.err = err
			return
		}
		_ = os.Setenv("DATA_DIR", dataDir)
		// The server's time zone until the administration sets one: the system's, not UTC
		if os.Getenv("TZ") == "" {
			if zone := systemTimeZone(); zone != "" {
				_ = os.Setenv("TZ", zone)
			}
		}
		_, _ = clock.Apply("")
		// The server's default language: the system's, when MindSift speaks it
		if os.Getenv("DEFAULT_LANGUAGE") == "" {
			if lang := systemLanguage(); i18n.Valid(lang) {
				_ = os.Setenv("DEFAULT_LANGUAGE", lang)
			}
		}
		cfg := config.Load()
		cfg.AppVersion = version
		login, name := systemUser()
		cfg.ApplyDesktop(config.Desktop{Platform: runtime.GOOS, Origin: windowOrigin(), Username: login, DisplayName: name})
		store, err := storage.NewStore(cfg.DatabasePath, storage.WithSecretsKey(cfg.SecretsKey), storage.WithDefaultInstanceName(cfg.InstanceName))
		if err != nil {
			l.err = err
			return
		}
		store.ConfiguredLanguage = cfg.DefaultLanguage
		staticFS, err := fs.Sub(embeddedDist, "dist")
		if err != nil {
			l.err = err
			return
		}
		hub := ws.NewHub()
		srv := api.NewServer(cfg, store, hub, staticFS)
		srv.ApplyTimeZone()
		srv.CheckSecretsKey()
		ctx, cancel := context.WithCancel(context.Background())
		router := srv.Router()
		l.handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// The webview's requests carry no peer address; the server's rate limits and logs expect one
			if r.RemoteAddr == "" {
				r.RemoteAddr = "127.0.0.1:0"
			}
			router.ServeHTTP(w, r.WithContext(mergeDone(r.Context(), ctx)))
		})
		l.close = func() {
			cancel()
			hub.Close()
			srv.Close()
			_ = store.Close()
		}
		slog.Info("Local MindSift server ready", "data", dataDir)
	})
	return l.handler, l.err
}

// mergeDone: the request's context, also cancelled when the app shuts down (long polls and streams end)
func mergeDone(req, app context.Context) context.Context {
	ctx, cancel := context.WithCancel(req)
	stop := context.AfterFunc(app, cancel)
	go func() {
		<-ctx.Done()
		stop()
	}()
	return ctx
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: config.LogLevelFromEnv(), ReplaceAttr: i18n.LogInEnglish}))
	slog.SetDefault(logger)

	base := appDataDir()
	settingsPath := filepath.Join(base, "desktop.json")
	settings := loadSettings(settingsPath)
	dataDir := filepath.Join(base, "data")
	local := &localServer{}

	var window *application.WebviewWindow
	shell := &shellHandler{
		settingsPath: settingsPath,
		settings:     &settings,
		local:        func() (http.Handler, error) { return local.get(dataDir) },
		dataDir:      dataDir,
		version:      version,
	}

	app := application.New(application.Options{
		Name:        "MindSift",
		Description: "MindSift desktop",
		Assets: application.AssetOptions{
			Handler:        shell,
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

	window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "MindSift",
		Width:  1280,
		Height: 860,
		URL:    shell.startURL(),
		// Developer tools (right click → Inspect) help to see what the engine does in this spike
		DevToolsEnabled: true,
		// Runs after every page load, the server's pages included
		JS: dropGuard,
		KeyBindings: map[string]func(application.Window){
			"alt+left":  func(w application.Window) { w.ExecJS("history.back()") },
			"alt+right": func(w application.Window) { w.ExecJS("history.forward()") },
			"f5":        func(w application.Window) { w.Reload() },
			"ctrl+r":    func(w application.Window) { w.Reload() },
		},
	})
	shell.setURL = func(u string) { window.SetURL(u) }

	tray := app.SystemTray.New()
	tray.SetIcon(trayIcon)
	tray.SetLabel("MindSift")
	menu := app.NewMenu()
	menu.Add("MindSift öffnen").OnClick(func(*application.Context) { window.Show(); window.Focus() })
	menu.Add("Betriebsart wechseln …").OnClick(func(*application.Context) { window.SetURL(startPath); window.Show() })
	menu.Add("Prüfseite (WebKit-Funktionen)").OnClick(func(*application.Context) { window.SetURL(checkPath); window.Show() })
	menu.AddSeparator()
	menu.Add("Beenden").OnClick(func(*application.Context) { app.Quit() })
	tray.SetMenu(menu)

	err := app.Run()
	if local.close != nil {
		local.close()
	}
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

// appDataDir: where the shell keeps its settings and the local database (Linux: $XDG_DATA_HOME/MindSift or
// ~/.local/share/MindSift, under Flatpak XDG_DATA_HOME already points into the sandbox; Windows:
// %APPDATA%\MindSift). MINDSIFT_DESKTOP_DIR overrides it.
func appDataDir() string {
	if d := os.Getenv("MINDSIFT_DESKTOP_DIR"); d != "" {
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

// systemUser: login name and full name of the system's user, for the account of the first start.
func systemUser() (login, name string) {
	u, err := user.Current()
	if err != nil {
		return os.Getenv("USER"), ""
	}
	login = u.Username
	if i := strings.LastIndexAny(login, `\/`); i >= 0 { // Windows: DOMAIN\user
		login = login[i+1:]
	}
	// GECOS may carry more fields after the name ("Full Name,Room,Phone")
	name, _, _ = strings.Cut(u.Name, ",")
	return login, strings.TrimSpace(name)
}

// systemLanguage: the language of the system's locale (LC_ALL, LC_MESSAGES, LANG: "de_DE.UTF-8" → "de");
// empty on Windows, where the server keeps its default.
func systemLanguage() string {
	for _, v := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if l := os.Getenv(v); l != "" && l != "C" && l != "POSIX" {
			l, _, _ = strings.Cut(l, ".")
			l, _, _ = strings.Cut(l, "_")
			return strings.ToLower(l)
		}
	}
	return ""
}

// systemTimeZone: the IANA name of the system's time zone on Linux (/etc/localtime links into the zoneinfo
// folder; /etc/timezone on Debian-like systems); empty where unknown, e.g. on Windows.
func systemTimeZone() string {
	if runtime.GOOS == "windows" {
		return ""
	}
	if target, err := os.Readlink("/etc/localtime"); err == nil {
		if _, zone, ok := strings.Cut(filepath.ToSlash(target), "/zoneinfo/"); ok && zone != "" {
			return zone
		}
	}
	if data, err := os.ReadFile("/etc/timezone"); err == nil {
		return strings.TrimSpace(string(data))
	}
	return ""
}
