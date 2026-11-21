// Package shell is the part of the desktop app that needs no window: the list of instances and servers
// (desktop.json), the local MindSift server of the open instance, folders and the shell's JSON endpoints for
// the start view. main.go wires it to Wails (window, tray, native dialogs).
package shell

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Kinds of entries
const (
	KindLocal  = "local"
	KindServer = "server"
)

// settingsVersion: the format with a list of entries. The format before it ({mode, serverUrl}) had no
// version and is converted on loading.
const settingsVersion = 1

// Entry is one line of the start view: a local instance (a folder holding mindsift.db) or a server.
type Entry struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	Name       string    `json:"name"`
	Path       string    `json:"path,omitempty"` // local: the instance's folder
	URL        string    `json:"url,omitempty"`  // server: its address, ending in "/"
	LastOpened time.Time `json:"lastOpened,omitzero"`
}

// fileFormat is desktop.json. Mode and ServerURL are the format of phase 1, read only to convert it.
type fileFormat struct {
	Version   int     `json:"version"`
	Entries   []Entry `json:"entries"`
	Last      string  `json:"last,omitempty"`
	Mode      string  `json:"mode,omitempty"`
	ServerURL string  `json:"serverUrl,omitempty"`
}

// Settings holds desktop.json in memory; every change is written at once.
type Settings struct {
	mu   sync.Mutex
	path string
	f    fileFormat
}

// LoadSettings reads desktop.json in base (never nil, also with an error). A file of the old format (or none) is converted: the old data
// folder (base/data) becomes the instance "MindSift" when it holds a database or local mode was chosen, a
// chosen server becomes a server entry, and the mode chosen last is the entry opened next. The converted
// file is written right away, so an entry removed later does not come back.
func LoadSettings(base string) (*Settings, error) {
	s := &Settings{path: filepath.Join(base, "desktop.json")}
	data, err := os.ReadFile(s.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		// Unreadable: an empty list for this run, the file stays untouched
		s.f.Version = settingsVersion
		return s, err
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &s.f); err != nil {
			// A broken file must not keep the app from starting; it is kept next to the new one
			_ = os.Rename(s.path, s.path+".broken")
			s.f = fileFormat{}
		}
	}
	if s.f.Version == 0 {
		s.migrate(filepath.Join(base, legacyDir))
		if err := s.saveLocked(); err != nil {
			return s, err
		}
	}
	return s, nil
}

func (s *Settings) migrate(oldData string) {
	old := s.f
	s.f = fileFormat{Version: settingsVersion}
	_, dbErr := os.Stat(filepath.Join(oldData, DatabaseFile))
	if dbErr == nil || old.Mode == KindLocal {
		e := Entry{ID: newID(), Kind: KindLocal, Name: "MindSift", Path: oldData}
		s.f.Entries = append(s.f.Entries, e)
		if old.Mode == KindLocal {
			s.f.Last = e.ID
		}
	}
	if old.ServerURL != "" {
		if u, err := NormalizeServerURL(old.ServerURL); err == nil {
			e := Entry{ID: newID(), Kind: KindServer, Name: hostName(u), URL: u}
			s.f.Entries = append(s.f.Entries, e)
			if old.Mode == "remote" {
				s.f.Last = e.ID
			}
		}
	}
	// The one chosen last is the newest
	for i := range s.f.Entries {
		if s.f.Entries[i].ID == s.f.Last {
			s.f.Entries[i].LastOpened = time.Now().UTC()
		}
	}
}

func (s *Settings) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(s.f, "", "  ")
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Entries: all entries, the one opened last first; never opened ones keep the order they were added in,
// after the opened ones
func (s *Settings) Entries() []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]Entry(nil), s.f.Entries...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastOpened.After(out[j].LastOpened) })
	return out
}

// Get: the entry with this id
func (s *Settings) Get(id string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.f.Entries {
		if e.ID == id {
			return e, true
		}
	}
	return Entry{}, false
}

// Last: the entry opened last, which the app opens at its next start
func (s *Settings) Last() (Entry, bool) {
	s.mu.Lock()
	id := s.f.Last
	s.mu.Unlock()
	if id == "" {
		return Entry{}, false
	}
	return s.Get(id)
}

// FindLocal: the entry of an instance folder (paths compared cleaned; case-insensitive on Windows)
func (s *Settings) FindLocal(dir string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.f.Entries {
		if e.Kind == KindLocal && samePath(e.Path, dir) {
			return e, true
		}
	}
	return Entry{}, false
}

// FindServer: the entry of a server address
func (s *Settings) FindServer(u string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.f.Entries {
		if e.Kind == KindServer && strings.EqualFold(e.URL, u) {
			return e, true
		}
	}
	return Entry{}, false
}

// Add stores a new entry and returns it with its id
func (s *Settings) Add(e Entry) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e.ID = newID()
	s.f.Entries = append(s.f.Entries, e)
	return e, s.saveLocked()
}

// Rename gives an entry a new name
func (s *Settings) Rename(id, name string) error {
	return s.update(id, func(e *Entry) { e.Name = name })
}

// Opened marks an entry as opened now; the next start opens it
func (s *Settings) Opened(id string) error {
	err := s.update(id, func(e *Entry) { e.LastOpened = time.Now().UTC() })
	if err == nil {
		s.mu.Lock()
		s.f.Last = id
		err = s.saveLocked()
		s.mu.Unlock()
	}
	return err
}

// Forget: the next start shows the start view (the entry opened last could not be opened)
func (s *Settings) Forget() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.f.Last == "" {
		return nil
	}
	s.f.Last = ""
	return s.saveLocked()
}

// Remove takes an entry off the list. Its data stays where it is.
func (s *Settings) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, e := range s.f.Entries {
		if e.ID == id {
			s.f.Entries = append(s.f.Entries[:i], s.f.Entries[i+1:]...)
			if s.f.Last == id {
				s.f.Last = ""
			}
			return s.saveLocked()
		}
	}
	return ErrUnknownEntry
}

func (s *Settings) update(id string, change func(*Entry)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.f.Entries {
		if s.f.Entries[i].ID == id {
			change(&s.f.Entries[i])
			return s.saveLocked()
		}
	}
	return ErrUnknownEntry
}

// ErrUnknownEntry: no entry has this id
var ErrUnknownEntry = errors.New("unknown entry")

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// hostName: the host of an address, as the name of a server entry nobody named
func hostName(u string) string {
	if p, err := url.Parse(u); err == nil && p.Host != "" {
		return p.Host
	}
	return u
}
