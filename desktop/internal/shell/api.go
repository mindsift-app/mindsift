package shell

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// The start view's endpoints: POST /__desktop/api/<op> with a JSON body, only from the window's own origin
// (fromStartView). Errors are answered with 200 and {"error": {code, detail}}, which the start view shows
// in the person's language.

// request: the fields any of the endpoints takes
type request struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
	URL  string `json:"url"`
}

// stateAnswer: what the start view shows
type stateAnswer struct {
	// Base: the folder holding every local instance; Sync: the sync service it lies in, if any
	Base    string          `json:"base"`
	Sync    string          `json:"sync,omitempty"`
	Entries []Entry         `json:"entries"`
	Found   []FoundInstance `json:"found"`
	// Current: the entry open in this window (a local instance running, or the server shown last)
	Current string   `json:"current,omitempty"`
	Problem *Problem `json:"problem,omitempty"`
	Version string   `json:"version,omitempty"`
}

// openAnswer: where the start view goes next. Local is set for a local instance: the frontend keeps the
// data of one instance at a time in the window's storage (all of them share the window's origin) and
// clears it when another instance opens.
type openAnswer struct {
	URL   string `json:"url"`
	ID    string `json:"id"`
	Local bool   `json:"local,omitempty"`
}

const maxNameLength = 80

func (s *Shell) api(w http.ResponseWriter, r *http.Request, op string) {
	if !s.fromStartView(r) {
		slog.Warn("Desktop shell call refused", "op", op, "origin", r.Header.Get("Origin"), "site", r.Header.Get("Sec-Fetch-Site"))
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	var req request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	switch op {
	case "state":
		writeJSON(w, http.StatusOK, s.state())
	case "create":
		a, err := s.createLocal(req.Name)
		s.answerOpen(w, a, err)
	case "open":
		a, err := s.openEntry(req.ID)
		s.answerOpen(w, a, err)
	case "open-found":
		a, err := s.openFound(req.Path)
		s.answerOpen(w, a, err)
	case "add-server":
		a, err := s.addServer(r, req.Name, req.URL)
		s.answerOpen(w, a, err)
	case "rename":
		name, err := entryName(req.Name)
		if err == nil {
			err = s.Settings.Rename(req.ID, name)
		}
		s.answerDone(w, err)
	case "remove":
		s.answerDone(w, s.Settings.Remove(req.ID))
	case "show-base":
		err := CreateFolder(s.Base)
		if err == nil && s.ShowFolder != nil {
			err = s.ShowFolder(s.Base)
		}
		s.answerDone(w, err)
	default:
		http.NotFound(w, r)
	}
}

func (s *Shell) answerOpen(w http.ResponseWriter, a openAnswer, err error) {
	if err != nil {
		writeProblem(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Shell) answerDone(w http.ResponseWriter, err error) {
	if err != nil {
		writeProblem(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Shell) state() stateAnswer {
	a := stateAnswer{Base: s.Base, Sync: SyncService(s.Base), Entries: s.Settings.Entries(), Version: s.Version}
	if a.Entries == nil {
		a.Entries = []Entry{}
	}
	a.Found = []FoundInstance{}
	for _, f := range FindInstances(s.Base) {
		if _, listed := s.Settings.FindLocal(f.Path); !listed {
			a.Found = append(a.Found, f)
		}
	}
	a.Current = s.Local.Current()
	if a.Current == "" {
		if last, ok := s.Settings.Last(); ok && last.Kind == KindServer {
			a.Current = last.ID
		}
	}
	s.mu.Lock()
	a.Problem, s.problem = s.problem, nil
	s.mu.Unlock()
	return a
}

// entryName: a name as typed, trimmed; required, at most maxNameLength characters
func entryName(name string) (string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if name == "" {
		return "", problem("nameMissing")
	}
	if utf8.RuneCountInString(name) > maxNameLength {
		return "", problem("nameTooLong")
	}
	return name, nil
}

// createLocal: a new instance of this name in its own folder below the base folder, opened right away
func (s *Shell) createLocal(raw string) (openAnswer, error) {
	name, err := entryName(raw)
	if err != nil {
		return openAnswer{}, err
	}
	dir := NewInstanceFolder(s.Base, name)
	if err := CreateFolder(dir); err != nil {
		return openAnswer{}, problem("folderFailed", err)
	}
	e, err := s.Settings.Add(Entry{Kind: KindLocal, Name: name, Path: dir})
	if err != nil {
		return openAnswer{}, problem("failed", err)
	}
	return s.open(e)
}

// openFound: an instance folder found in the base folder; listed (again) under its folder's name
func (s *Shell) openFound(path string) (openAnswer, error) {
	dir := filepath.Clean(path)
	if !filepath.IsAbs(dir) || !InBase(s.Base, dir) || !isInstance(dir) {
		return openAnswer{}, problem("notFound")
	}
	e, ok := s.Settings.FindLocal(dir)
	if !ok {
		name := filepath.Base(dir)
		if samePath(dir, filepath.Join(s.Base, legacyDir)) {
			name = "MindSift"
		}
		var err error
		if e, err = s.Settings.Add(Entry{Kind: KindLocal, Name: name, Path: dir}); err != nil {
			return openAnswer{}, problem("failed", err)
		}
	}
	return s.open(e)
}

func (s *Shell) openEntry(id string) (openAnswer, error) {
	e, ok := s.Settings.Get(id)
	if !ok {
		return openAnswer{}, problem("notFound")
	}
	return s.open(e)
}

// open opens an entry: a local instance replaces the one running (one at a time), a server closes it.
func (s *Shell) open(e Entry) (openAnswer, error) {
	if e.Kind == KindServer {
		s.Local.Close()
		if err := s.Settings.Opened(e.ID); err != nil {
			slog.Warn("Saving the desktop settings failed", "error", err)
		}
		s.opened(e)
		return openAnswer{URL: e.URL, ID: e.ID}, nil
	}
	// A listed instance whose folder was emptied or removed by hand is not made anew in silence
	if !isInstance(e.Path) && s.Local.Current() != e.ID {
		if !exists(e.Path) || !InBase(s.Base, e.Path) {
			return openAnswer{}, problem("folderGone", e.Path)
		}
	}
	if err := s.Local.Open(e.ID, e.Path); err != nil {
		return openAnswer{}, err
	}
	if err := s.Settings.Opened(e.ID); err != nil {
		slog.Warn("Saving the desktop settings failed", "error", err)
	}
	s.opened(e)
	return openAnswer{URL: "/", ID: e.ID, Local: true}, nil
}

// addServer: a server entry after the address answered like a MindSift server; an address already listed
// keeps its entry (renamed when a name was given)
func (s *Shell) addServer(r *http.Request, rawName, rawURL string) (openAnswer, error) {
	u, err := NormalizeServerURL(rawURL)
	if err != nil {
		return openAnswer{}, err
	}
	name := strings.TrimSpace(rawName)
	if name == "" {
		name = hostName(u)
	}
	if name, err = entryName(name); err != nil {
		return openAnswer{}, err
	}
	if err := CheckServer(r.Context(), u); err != nil {
		return openAnswer{}, err
	}
	e, ok := s.Settings.FindServer(u)
	if ok {
		if strings.TrimSpace(rawName) != "" && name != e.Name {
			_ = s.Settings.Rename(e.ID, name)
		}
	} else if e, err = s.Settings.Add(Entry{Kind: KindServer, Name: name, URL: u}); err != nil {
		return openAnswer{}, problem("failed", err)
	}
	return s.open(e)
}
