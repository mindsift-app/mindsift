package shell

import "testing"

// The window's title follows the page shown: the start view, the open local instance, a server's page
func TestTitleFollowsThePage(t *testing.T) {
	t.Setenv("DB_MAX_CONNS", "1")
	sh := newTestShell(t)
	if _, err := sh.Settings.Add(Entry{Kind: KindServer, Name: "Büro", URL: "https://mind.example.com/"}); err != nil {
		t.Fatal(err)
	}
	if _, err := sh.Settings.Add(Entry{Kind: KindServer, Name: "Sub", URL: "https://mind.example.com/team/"}); err != nil {
		t.Fatal(err)
	}
	check := func(address, want string) {
		t.Helper()
		if got := sh.TitleFor(address); got != want {
			t.Errorf("TitleFor(%q) = %q, want %q", address, got, want)
		}
	}

	// No instance open: the app's name on the start view and on pages that would lead back to it
	check("wails://localhost/__desktop/start", "MindSift")
	check("wails://localhost/", "MindSift")

	// A server's pages, the entry with the longer matching path first
	check("https://mind.example.com/", "Büro – MindSift")
	check("https://mind.example.com/notes/abc", "Büro – MindSift")
	check("HTTPS://MIND.example.com/login", "Büro – MindSift")
	check("https://mind.example.com/team/", "Sub – MindSift")
	check("https://mind.example.com/team/notes", "Sub – MindSift")
	check("https://mind.example.com/teammate", "Büro – MindSift")
	check("https://other.example.com/", "MindSift")
	check("https://mind.example.com:8443/", "MindSift")
	check("", "MindSift")

	// A local instance open: its pages carry its name, the start view does not
	_, out := call(t, sh, "create", map[string]any{"name": "Arbeit"})
	if out["local"] != true {
		t.Fatalf("create: %v", out)
	}
	check("wails://localhost/", "Arbeit – MindSift")
	check("wails://localhost/notes/1", "Arbeit – MindSift")
	check("wails://localhost/__desktop/start", "MindSift")
	check("https://mind.example.com/", "Büro – MindSift")

	// The page call of Windows (a page of the window's own origin tells its address)
	var got string
	sh.Navigated = func(a string) { got = a }
	if code, _ := call(t, sh, "page", map[string]any{"path": "/__desktop/start"}); code != 200 || got != "wails://localhost/__desktop/start" {
		t.Errorf("page call: %d, address %q", code, got)
	}
	got = ""
	call(t, sh, "page", map[string]any{"path": "evil"})
	if got != "" {
		t.Errorf("a path without a leading slash was passed on: %q", got)
	}
}
