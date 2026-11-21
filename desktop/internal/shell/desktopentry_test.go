package shell

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

var testEntry = []byte("[Desktop Entry]\nName=MindSift\nExec=mindsift-desktop\nIcon=app.mindsift.MindSift\n")

func testIcons() fstest.MapFS {
	return fstest.MapFS{
		"48x48/apps/app.mindsift.MindSift.png":    {Data: []byte("png48")},
		"scalable/apps/app.mindsift.MindSift.svg": {Data: []byte("<svg/>")},
	}
}

func TestInstallDesktopEntry(t *testing.T) {
	t.Setenv("FLATPAK_ID", "")
	home := t.TempDir()
	exe := "/home/anna/Apps/mindsift desktop"
	if err := InstallDesktopEntry(home, exe, testEntry, testIcons()); err != nil {
		t.Fatal(err)
	}
	desktop := filepath.Join(home, "applications", "app.mindsift.MindSift.desktop")
	got, err := os.ReadFile(desktop)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), "\nExec=\""+exe+"\"\n") || !strings.Contains(string(got), "Icon=app.mindsift.MindSift") {
		t.Fatalf("desktop file:\n%s", got)
	}
	for _, p := range []string{"48x48/apps/app.mindsift.MindSift.png", "scalable/apps/app.mindsift.MindSift.svg"} {
		if _, err := os.Stat(filepath.Join(home, "icons", "hicolor", p)); err != nil {
			t.Fatal(err)
		}
	}

	// the binary moved: the entry follows; icons stay
	if err := InstallDesktopEntry(home, "/opt/x/mindsift", testEntry, testIcons()); err != nil {
		t.Fatal(err)
	}
	got, _ = os.ReadFile(desktop)
	if !strings.Contains(string(got), "Exec=\"/opt/x/mindsift\"\n") {
		t.Fatalf("desktop file after the move:\n%s", got)
	}
}

func TestInstallDesktopEntrySkipped(t *testing.T) {
	home := t.TempDir()
	t.Setenv("FLATPAK_ID", "app.mindsift.MindSift")
	if err := InstallDesktopEntry(home, "/app/bin/mindsift-desktop", testEntry, testIcons()); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FLATPAK_ID", "")
	if err := InstallDesktopEntry(home, "/usr/bin/mindsift-desktop", testEntry, testIcons()); err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(home); len(entries) != 0 {
		t.Fatalf("nothing should be written, found %v", entries)
	}
}

func TestExecQuote(t *testing.T) {
	cases := map[string]string{
		`/home/a/mindsift`: `"/home/a/mindsift"`,
		`/home/a b/100%`:   `"/home/a b/100%%"`,
		`/home/$x/"q"`:     `"/home/\\$x/\\"q\\""`,
	}
	for in, want := range cases {
		if got := execQuote(in); got != want {
			t.Errorf("execQuote(%q) = %s, want %s", in, got, want)
		}
	}
}
