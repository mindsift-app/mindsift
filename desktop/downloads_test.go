package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeDownloadName(t *testing.T) {
	for in, want := range map[string]string{
		"mindsift-backup-2026-11-22.zip": "mindsift-backup-2026-11-22.zip",
		"../../etc/passwd":               "passwd",
		`..\..\Windows\evil.exe`:         "evil.exe",
		"a:b*c?.md":                      "a_b_c_.md",
		"line\nbreak.txt":                "line_break.txt",
		"  ..  ":                         "download",
		"":                               "download",
		"Notiz über Äpfel.md":            "Notiz über Äpfel.md",
	} {
		if got := safeDownloadName(in); got != want {
			t.Errorf("safeDownloadName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDownloadNotice(t *testing.T) {
	js := downloadNotice(true, `a"b</script>.zip`)
	if !strings.Contains(js, `"mindsift:desktop-download"`) || !strings.Contains(js, `"saved":true`) || strings.Contains(js, `a"b`) || strings.Contains(js, "</script>") {
		t.Errorf("notice script: %s", js)
	}
	if js := downloadNotice(false, "x.zip"); !strings.Contains(js, `"saved":false`) || !strings.Contains(js, `"name":"x.zip"`) {
		t.Errorf("notice script: %s", js)
	}
}

func TestMoveDownload(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "tmp", "a.zip")
	if err := os.MkdirAll(filepath.Dir(src), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, []byte("backup"), 0o600); err != nil {
		t.Fatal(err)
	}
	// The save dialog asked about overwriting: an existing file is replaced
	dst := filepath.Join(dir, "Backups", "a.zip")
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte("old and longer content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := moveDownload(src, dst); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(dst); string(b) != "backup" {
		t.Errorf("destination holds %q", b)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Errorf("source still there: %v", err)
	}
	if err := moveDownload(filepath.Join(dir, "missing"), dst); err == nil {
		t.Error("a missing source moved")
	}
}

func TestDownloadStartDir(t *testing.T) {
	existing := t.TempDir()
	missing := filepath.Join(existing, "fehlt")
	cases := []struct {
		last, downloads string
		sandboxed       bool
		want            string
	}{
		{existing, "", false, existing},
		{missing, existing, false, existing},
		{missing, missing, false, ""},
		{"", "", false, ""},
		{"relativ", existing, false, existing},
		// Under Flatpak the host's folders are not visible here: handed over as they are
		{missing, existing, true, missing},
		{"", missing, true, missing},
	}
	for _, c := range cases {
		if got := downloadStartDir(c.last, c.downloads, c.sandboxed); got != c.want {
			t.Errorf("downloadStartDir(%q, %q, %v) = %q, want %q", c.last, c.downloads, c.sandboxed, got, c.want)
		}
	}
}
