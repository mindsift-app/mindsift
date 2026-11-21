package shell

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

// StartPath: the start view, a view of the frontend the shell serves itself (features/desktop)
const StartPath = "/__desktop/start"

// apiPrefix: the shell's JSON endpoints for the start view
const apiPrefix = "/__desktop/api/"

// apiHeader: every call of the start view carries it. A page of another origin (a server's page the window
// shows, a link opened in it) cannot send a custom header without a CORS preflight, which the shell never
// allows, so the request never arrives; Origin and Sec-Fetch-Site are checked on top.
const apiHeader = "X-MindSift-Desktop"

// Shell answers every request of the window: the start view and its endpoints under /__desktop/, all
// else goes to the open local instance, or, with none open, to the frontend's files (the start view's
// scripts) or back to the start view.
type Shell struct {
	Settings *Settings
	Local    *Local
	// Static: the built frontend; Origin: the window's own origin (wails://localhost, http://wails.localhost)
	Static  fs.FS
	Origin  string
	Version string
	// Base: the app's base folder, which holds desktop.json and every local instance
	Base string
	// ShowFolder opens a folder in the system's file manager. Set by main.go.
	ShowFolder func(dir string) error
	// PickFolder shows the system's folder dialog (at start, if set) and returns the chosen folder, "" when
	// cancelled. Set by main.go.
	PickFolder func(start string) (string, error)
	// Opened: an entry was opened; StartShown: the start view was loaded, from the tray, the shortcut or
	// the app's profile menu (main.go sets the window title)
	Opened     func(Entry)
	StartShown func()

	mu      sync.Mutex
	problem *Problem // why the entry opened last did not open at the start (shown once)
	// localAPIProblem: why the open instance's listener for local programs is not up (localapi.go)
	localAPIProblem *Problem
}

// StartURL opens the entry used last: a local instance right here (its address is "/"), a server at its
// address. Without one, or when the instance cannot be opened (locked, folder gone), the start view.
func (s *Shell) StartURL() string {
	e, ok := s.Settings.Last()
	if !ok {
		return StartPath
	}
	if e.Kind == KindServer {
		s.opened(e)
		return e.URL
	}
	if err := s.openLocal(e); err != nil {
		slog.Warn("Opening the instance used last failed", "path", e.Path, "error", err)
		s.mu.Lock()
		s.problem = asProblem(err)
		s.mu.Unlock()
		return StartPath
	}
	s.opened(e)
	return "/"
}

// openLocal opens a local instance (closing the one running) with its listener for local programs, if on
func (s *Shell) openLocal(e Entry) error {
	if err := s.Local.Open(e.ID, e.Path); err != nil {
		return err
	}
	s.applyLocalAPI(e)
	return nil
}

func (s *Shell) opened(e Entry) {
	if s.Opened != nil {
		s.Opened(e)
	}
}

func (s *Shell) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	switch {
	case p == StartPath:
		if s.StartShown != nil {
			s.StartShown()
		}
		s.startPage(w)
		return
	case strings.HasPrefix(p, apiPrefix):
		s.api(w, r, strings.TrimPrefix(p, apiPrefix))
		return
	case strings.HasPrefix(p, "/__desktop/"):
		http.NotFound(w, r)
		return
	}
	if s.Local.ServeHTTP(w, r) {
		return
	}
	if s.staticFile(w, r) {
		return
	}
	navigate(w, StartPath)
}

// startPage: the frontend's index.html, which shows the start view on this path (main.tsx), in the
// system's language until the frontend has looked at the window's languages itself
func (s *Shell) startPage(w http.ResponseWriter) {
	page, err := fs.ReadFile(s.Static, "index.html")
	if err != nil {
		http.Error(w, "index.html missing", http.StatusInternalServerError)
		return
	}
	if lang := SystemLanguage(); i18n.Valid(lang) {
		page = []byte(strings.Replace(string(page), `<html lang="de"`, `<html lang="`+lang+`"`, 1))
	}
	setPageHeaders(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(page)
}

// staticFile serves a file of the frontend while no instance is open (the start view's scripts, styles,
// fonts and icons). index.html is the start view's only.
func (s *Shell) staticFile(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" || name == "index.html" || !fs.ValidPath(name) {
		return false
	}
	f, err := s.Static.Open(name)
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		return false
	}
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		return false
	}
	if ct := mime.TypeByExtension(filepath.Ext(name)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, name, time.Time{}, rs)
	return true
}

// setPageHeaders: the same content security policy as the server's pages (internal/api/headers.go)
func setPageHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Security-Policy", strings.Join([]string{
		"default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
		"font-src 'self' data:", "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'",
		"object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
	}, "; "))
	h.Set("X-Frame-Options", "DENY")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "same-origin")
	h.Set("Cache-Control", "no-store")
}

// navigate answers with a page that moves on to target. WebKitGTK does not follow redirects of the
// webview's own scheme (a POST answered with 303 stays a blank page), so the shell never redirects.
func navigate(w http.ResponseWriter, target string) {
	b, _ := json.Marshal(target)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, `<!doctype html><meta charset="utf-8"><title>MindSift</title>`+
		`<script>location.replace(`+strings.ReplaceAll(string(b), "</", `<\/`)+`)</script>`)
}

// fromStartView: the request is a call of the start view on the window's own origin (see apiHeader)
func (s *Shell) fromStartView(r *http.Request) bool {
	if r.Method != http.MethodPost || r.Header.Get(apiHeader) != "1" {
		return false
	}
	if ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); ct != "application/json" {
		return false
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		return false
	}
	origin := r.Header.Get("Origin")
	return origin == "" || strings.EqualFold(origin, s.Origin)
}

func asProblem(err error) *Problem {
	var p *Problem
	if errors.As(err, &p) {
		return p
	}
	return problem("failed", err)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeProblem(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusOK, map[string]any{"error": asProblem(err)})
}
