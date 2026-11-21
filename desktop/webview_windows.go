package main

// The window's WebView2 on Windows. Wails keeps the webview to itself: no navigation API, its JS option only
// reaches pages given as HTML (not the pages this window loads), and it injects its runtime into every page
// straight from WebView2's NavigationCompleted, before any hook of the app runs, so it cannot be kept out
// of a page the way webview_linux.go does. What the app can do comes after that: the hook of the event
// Wails sends next.

import (
	"encoding/json"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// useWebviewDataDir: on Windows the WebView2 user data folder is an option (main.go,
// WindowsOptions.WebviewUserDataPath)
func useWebviewDataDir(string) {}

// setupPages runs after every page load, after Wails has injected its runtime: the window's scripts (the JS
// option does not reach these pages on Windows) and, on a page that is not one of the window's own (a
// server's), the runtime taken out again and the marker set (shellMarker). The page's own scripts may run in between; what the runtime
// gives them (window._wails.invoke, a wrapper of chrome.webview.postMessage, which WebView2 gives every
// page anyway; flags; OS and architecture) is no way into the app: Wails' routes under /wails/ refuse
// other origins (shell.GuardWailsRoutes).
func setupPages(window *application.WebviewWindow, origin, scripts, marker string) {
	var once sync.Once
	window.RegisterHook(events.Windows.WebViewNavigationCompleted, func(*application.WindowEvent) {
		// ExecJS waits for "wails:runtime:ready", which only Wails' full runtime (runtime.js) sends and no
		// page of this app loads, so nothing the app runs in the page would ever arrive. Once is enough,
		// Wails never resets it.
		once.Do(func() { window.HandleMessage("wails:runtime:ready") })
		window.ExecJS(foreignPage(origin, marker) + scripts)
	})
}

// foreignPage: on a page that is not on origin, Wails' runtime taken out again and the marker set
func foreignPage(origin, marker string) string {
	o, _ := json.Marshal(origin)
	return `(function(){if((location.protocol+'//'+location.host).toLowerCase()===` + string(o) +
		`)return;try{delete window._wails;delete window.wails}catch(e){}` + marker + `})();`
}

// The window's history and reload, for the key bindings; on any page, the window's own or a server's
func goBack(w application.Window)    { w.ExecJS("history.back()") }
func goForward(w application.Window) { w.ExecJS("history.forward()") }
func reload(w application.Window)    { w.Reload() }
