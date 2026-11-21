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

// GuardWailsRoutes is the outermost asset middleware: Wails' own routes under /wails/ only for calls of
// the window's own pages. Wails checks no origin there in a desktop build, and a page of another origin can
// send a request there without a preflight (a form, an image, fetch in no-cors mode; on Windows
// http://wails.localhost counts as a local and with it secure address). Its scripts (runtime.js,
// transport.js) stay readable, they hold nothing; every other route needs the window's origin in Origin,
// which a browser sets on every POST and on cross-origin requests of fetch, and no cross-site
// Sec-Fetch-Site. The app itself calls none of these routes (the frontend uses no Wails runtime).
func GuardWailsRoutes(origin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, wailsPrefix) && !wailsCallAllowed(r, origin) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func wailsCallAllowed(r *http.Request, origin string) bool {
	switch r.URL.Path {
	case "/wails/runtime.js", "/wails/transport.js":
		return r.Method == http.MethodGet || r.Method == http.MethodHead
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		return false
	}
	o := r.Header.Get("Origin")
	return o != "" && strings.EqualFold(o, origin)
}
