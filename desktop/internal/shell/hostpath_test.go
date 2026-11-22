package shell

import "testing"

func TestSplitDocPath(t *testing.T) {
	cases := []struct {
		in, id, rest string
		ok           bool
	}{
		{"/run/user/1000/doc/1a2b3c4d/Backups", "1a2b3c4d", "", true},
		{"/run/user/1000/doc/1a2b3c4d/Backups/MindSift-Backups/Privat", "1a2b3c4d", "/MindSift-Backups/Privat", true},
		{"/run/user/1000/doc/1a2b3c4d/Backups/", "1a2b3c4d", "", true},
		{"/run/flatpak/doc/ff00/Notes.zip", "ff00", "", true},
		{"/run/user/1000/doc/by-app/app.mindsift.MindSift/1a2b/Backups/x", "1a2b", "/x", true},
		{"/run/user/1000/doc/1a2b3c4d", "", "", false},
		{"/run/user/1000/doc/", "", "", false},
		{"/run/user/1000/doc/by-app/app.mindsift.MindSift", "", "", false},
		{"/run/user/abc/doc/1a2b/x", "", "", false},
		{"/run/user/1000/other/1a2b/x", "", "", false},
		{"/home/anna/Backups", "", "", false},
		{"relative/run/user/1000/doc/a/b", "", "", false},
		{"", "", "", false},
	}
	for _, c := range cases {
		id, rest, ok := splitDocPath(c.in)
		if id != c.id || rest != c.rest || ok != c.ok {
			t.Errorf("splitDocPath(%q) = %q, %q, %v; want %q, %q, %v", c.in, id, rest, ok, c.id, c.rest, c.ok)
		}
	}
}

func TestJoinHostPath(t *testing.T) {
	if got := joinHostPath([]byte("/home/anna/Backups\x00"), "/MindSift-Backups/Privat"); got != "/home/anna/Backups/MindSift-Backups/Privat" {
		t.Errorf("got %q", got)
	}
	if got := joinHostPath([]byte("/home/anna/Backups"), ""); got != "/home/anna/Backups" {
		t.Errorf("got %q", got)
	}
	for _, bad := range [][]byte{nil, []byte("\x00"), []byte("relative")} {
		if got := joinHostPath(bad, "/x"); got != "" {
			t.Errorf("joinHostPath(%q) = %q, want empty", bad, got)
		}
	}
}

func TestHostPathLeavesOtherPaths(t *testing.T) {
	for _, p := range []string{"/home/anna/Backups", `C:\Users\anna`, ""} {
		if got := HostPath(p); got != p {
			t.Errorf("HostPath(%q) = %q", p, got)
		}
	}
}
