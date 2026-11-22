package shell

import (
	"net/http"
	"net/url"
	"strings"
)

// The window shows the shell's own pages (start view, local instances) on the window's origin
// (wails://localhost, http://wails.localhost) and the pages of servers on theirs. Wails gives a page its
// runtime (window._wails) and answers its calls under /wails/ (window control, dialogs, clipboard, opening
// addresses, quitting the app). A server's page, possibly one of a server the person does not run, gets
// neither: main.go keeps the runtime out of it, GuardWailsRoutes refuses its calls.

// OwnPage: the address is one of the window's own pages (scheme and host of origin; any path)
func OwnPage(address, origin string) bool {
	u, err := url.Parse(address)
	if err != nil || u.Opaque != "" || u.User != nil {
		return false
	}
	o, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return u.Scheme != "" && strings.EqualFold(u.Scheme, o.Scheme) && strings.EqualFold(u.Host, o.Host)
}

// wailsPrefix: the paths Wails answers itself before the asset handler (its runtime calls, event payloads,
// streams and scripts)
const wailsPrefix = "/wails/"

// GuardWailsRoutes is the outermost asset middleware: of Wails' own routes under /wails/ only its scripts
// (runtime.js, transport.js; they hold nothing) are answered, for every page; every other route (runtime
// calls: window control, dialogs, clipboard, opening addresses, quitting; event payloads; streams) is
// refused, for the window's own pages too. Wails checks no origin there in a desktop build, a page of
// another origin can send a request there without a preflight (a form, an image, fetch in no-cors mode),
// and WebKitGTK sends such requests to wails:// without Origin and Sec-Fetch-Site, so no header tells the
// window's own pages apart. The app needs none of it: the frontend uses no Wails runtime or bindings, and
// what the shell does for it goes through Go (key bindings and the tray are native, the window's scripts
// run by evaluation, dropped files come through filedrop_linux.go, the folder dialog and the start view
// through the shell's /__desktop/api). The runtime's own messages (ready, drag) use the webview's message
// handler, not these routes.
func GuardWailsRoutes() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, wailsPrefix) && !wailsRouteAllowed(r) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func wailsRouteAllowed(r *http.Request) bool {
	switch r.URL.Path {
	case "/wails/runtime.js", "/wails/transport.js":
		return r.Method == http.MethodGet || r.Method == http.MethodHead
	}
	return false
}
