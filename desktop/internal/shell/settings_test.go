package shell

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLoadSettingsMigratesLocalMode(t *testing.T) {
	base := t.TempDir()
	writeFile(t, filepath.Join(base, "desktop.json"), `{"mode":"local"}`)
	writeFile(t, filepath.Join(base, "data", DatabaseFile), "x")
	s, err := LoadSettings(base)
	if err != nil {
		t.Fatal(err)
	}
	entries := s.Entries()
	if len(entries) != 1 || entries[0].Kind != KindLocal || entries[0].Name != "MindSift" || entries[0].Path != filepath.Join(base, "data") {
		t.Fatalf("entries = %+v", entries)
	}
	if last, ok := s.Last(); !ok || last.ID != entries[0].ID {
		t.Fatalf("last = %+v %v", last, ok)
	}
	// Written in the new format right away
	var f fileFormat
	data, _ := os.ReadFile(filepath.Join(base, "desktop.json"))
	if err := json.Unmarshal(data, &f); err != nil || f.Version != settingsVersion || f.Mode != "" {
		t.Fatalf("file = %s (%v)", data, err)
	}
}

func TestLoadSettingsMigratesRemoteModeAndKeepsOldData(t *testing.T) {
	base := t.TempDir()
	writeFile(t, filepath.Join(base, "desktop.json"), `{"mode":"remote","serverUrl":"https://notes.example.com/"}`)
	writeFile(t, filepath.Join(base, "data", DatabaseFile), "x")
	s, _ := LoadSettings(base)
	entries := s.Entries()
	if len(entries) != 2 {
		t.Fatalf("entries = %+v", entries)
	}
	last, _ := s.Last()
	if last.Kind != KindServer || last.URL != "https://notes.example.com/" || last.Name != "notes.example.com" {
		t.Fatalf("last = %+v", last)
	}
	if entries[0].ID != last.ID {
		t.Fatalf("the server chosen last should come first: %+v", entries)
	}
}

func TestLoadSettingsWithoutFile(t *testing.T) {
	base := t.TempDir()
	s, err := LoadSettings(base)
	if err != nil || len(s.Entries()) != 0 {
		t.Fatalf("entries = %+v, err = %v", s.Entries(), err)
	}
	if _, ok := s.Last(); ok {
		t.Fatal("nothing to open on a first start")
	}
	// An old data folder without a choice (phase 1 created it on the first request) is found too
	base2 := t.TempDir()
	writeFile(t, filepath.Join(base2, "data", DatabaseFile), "x")
	s2, _ := LoadSettings(base2)
	if len(s2.Entries()) != 1 {
		t.Fatalf("entries = %+v", s2.Entries())
	}
}

func TestRemovedEntryStaysRemoved(t *testing.T) {
	base := t.TempDir()
	writeFile(t, filepath.Join(base, "data", DatabaseFile), "x")
	s, _ := LoadSettings(base)
	if err := s.Remove(s.Entries()[0].ID); err != nil {
		t.Fatal(err)
	}
	s2, _ := LoadSettings(base)
	if len(s2.Entries()) != 0 {
		t.Fatalf("entries = %+v", s2.Entries())
	}
	if _, err := os.Stat(filepath.Join(base, "data", DatabaseFile)); err != nil {
		t.Fatal("removing an entry must keep its data")
	}
}

func TestEntriesNewestFirstAndRename(t *testing.T) {
	s, _ := LoadSettings(t.TempDir())
	a, _ := s.Add(Entry{Kind: KindLocal, Name: "A", Path: "/a"})
	b, _ := s.Add(Entry{Kind: KindServer, Name: "B", URL: "https://b/"})
	c, _ := s.Add(Entry{Kind: KindLocal, Name: "C", Path: "/c"})
	_ = s.Opened(a.ID)
	_ = s.Opened(b.ID)
	_ = s.Rename(c.ID, "Neu")
	got := s.Entries()
	if got[0].ID != b.ID || got[1].ID != a.ID || got[2].Name != "Neu" {
		t.Fatalf("entries = %+v", got)
	}
	if last, _ := s.Last(); last.ID != b.ID {
		t.Fatalf("last = %+v", last)
	}
	if err := s.Rename("nope", "x"); err != ErrUnknownEntry {
		t.Fatalf("err = %v", err)
	}
}

func TestBrokenSettingsFileIsKept(t *testing.T) {
	base := t.TempDir()
	writeFile(t, filepath.Join(base, "desktop.json"), `{nope`)
	if _, err := LoadSettings(base); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(base, "desktop.json.broken")); err != nil {
		t.Fatal("the broken file should be kept")
	}
}
