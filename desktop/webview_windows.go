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
// server's), the runtime taken out again and the marker set (shellMarker), and on every page the note for
// the title (pageScript). The page's own scripts may run in between; what the runtime
// gives them (window._wails.invoke, a wrapper of chrome.webview.postMessage, which WebView2 gives every
// page anyway; flags; OS and architecture) is no way into the app: Wails' routes under /wails/ answer
// nobody but their scripts (shell.GuardWailsRoutes).
// The hook does not know the page's address (Wails has no way to ask WebView2 for it), so every page posts
// pageMessage after its load (pageScript) and rawMessages takes the address from WebView2 itself: the title
// follows every page shown, the window's own and servers' alike, history included.
func setupPages(window *application.WebviewWindow, origin, scripts, marker string, navigated func(address string)) {
	pageShown = navigated
	var once sync.Once
	window.RegisterHook(events.Windows.WebViewNavigationCompleted, func(*application.WindowEvent) {
		// ExecJS waits for "wails:runtime:ready", which only Wails' full runtime (runtime.js) sends and no
		// page of this app loads, so nothing the app runs in the page would ever arrive. Once is enough,
		// Wails never resets it.
		once.Do(func() { window.HandleMessage("wails:runtime:ready") })
		window.ExecJS(foreignPage(origin, marker) + scripts + pageScript)
	})
}

// pageMessage: "a page was shown", posted through WebView2's message channel; not a "wails:" message, so
// Wails hands it to rawMessages
const pageMessage = "mindsift:page"

// pageScript: tells the shell that a page was shown, nothing more (the address comes from WebView2)
const pageScript = `(function(){try{window.chrome.webview.postMessage('` + pageMessage + `')}catch(e){}})();`

// pageShown: shell.Navigated (set by setupPages, before the app runs)
var pageShown func(address string)

// rawMessages: Wails' RawMessageHandler. On pageMessage the title follows the page the window shows. The
// address is the top-level document's as WebView2 knows it (ICoreWebView2.Source, Wails' TopOrigin), not
// anything a page says, so a page posting the message itself only has the title worked out again.
func rawMessages(_ application.Window, message string, origin *application.OriginInfo) {
	if message != pageMessage || origin == nil || origin.TopOrigin == "" || pageShown == nil {
		return
	}
	pageShown(origin.TopOrigin)
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
