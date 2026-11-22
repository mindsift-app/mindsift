package shell

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mindsift-app/mindsift/internal/config"
)

const testOrigin = "wails://localhost"

func newTestShell(t *testing.T) *Shell {
	t.Helper()
	base := t.TempDir()
	t.Setenv("SECRETS_KEY", "")
	settings, err := LoadSettings(base)
	if err != nil {
		t.Fatal(err)
	}
	static := fstest.MapFS{
		"index.html":    {Data: []byte(`<!DOCTYPE html><html lang="de" class="dark"><body>start</body></html>`)},
		"assets/app.js": {Data: []byte(`console.log(1)`)},
	}
	local := &Local{Static: static, Desktop: config.Desktop{Platform: config.DesktopLinux, Origin: testOrigin, Username: "anna"}}
	sh := &Shell{Settings: settings, Local: local, Static: static, Origin: testOrigin, Base: base}
	t.Cleanup(local.Close)
	return sh
}

func call(t *testing.T, sh *Shell, op string, body any, mutate ...func(*http.Request)) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, apiPrefix+op, strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(apiHeader, "1")
	req.Header.Set("Origin", testOrigin)
	for _, m := range mutate {
		m(req)
	}
	rec := httptest.NewRecorder()
	sh.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestShellRefusesOtherOrigins(t *testing.T) {
	sh := newTestShell(t)
	for name, m := range map[string]func(*http.Request){
		"other origin":   func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") },
		"cross-site":     func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		"no header":      func(r *http.Request) { r.Header.Del(apiHeader) },
		"form post":      func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") },
		"get":            func(r *http.Request) { r.Method = http.MethodGet },
		"null origin":    func(r *http.Request) { r.Header.Set("Origin", "null") },
		"preflight like": func(r *http.Request) { r.Method = http.MethodOptions },
	} {
		if code, _ := call(t, sh, "state", map[string]any{}, m); code != http.StatusForbidden {
			t.Errorf("%s: status %d", name, code)
		}
	}
	if code, out := call(t, sh, "state", map[string]any{}); code != http.StatusOK || out["base"] != sh.Base {
		t.Fatalf("own origin: %d %v", code, out)
	}
}

func TestShellCreateSwitchAndRestart(t *testing.T) {
	t.Setenv("DB_MAX_CONNS", "1")
	sh := newTestShell(t)
	_, out := call(t, sh, "create", map[string]any{"name": "Arbeit"})
	if out["url"] != "/" || out["local"] != true {
		t.Fatalf("create: %v", out)
	}
	first := out["id"].(string)
	dirA := filepath.Join(sh.Base, "instances", "Arbeit")
	if _, err := os.Stat(filepath.Join(dirA, DatabaseFile)); err != nil {
		t.Fatalf("database of the new instance: %v", err)
	}
	// The instance answers through the shell
	rec := httptest.NewRecorder()
	sh.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("health: %d", rec.Code)
	}
	// A second process cannot open it
	if _, err := lockInstance(dirA); err == nil {
		t.Fatal("the open instance should be locked")
	}

	_, out = call(t, sh, "create", map[string]any{"name": "Privat"})
	second := out["id"].(string)
	if sh.Local.Current() != second {
		t.Fatalf("current = %q", sh.Local.Current())
	}
	// The first one is closed: its lock is free again
	l, err := lockInstance(dirA)
	if err != nil {
		t.Fatalf("the first instance should be closed: %v", err)
	}
	// ... and now held by "another process": opening it is refused with a clear code
	_, out = call(t, sh, "open", map[string]any{"id": first})
	if e, _ := out["error"].(map[string]any); e == nil || e["code"] != "locked" {
		t.Fatalf("locked: %v", out)
	}
	l.release()
	if _, out = call(t, sh, "open", map[string]any{"id": first}); out["id"] != first {
		t.Fatalf("open: %v", out)
	}

	// The next start opens the one used last
	sh.Local.Close()
	settings, _ := LoadSettings(sh.Base)
	sh2 := &Shell{Settings: settings, Local: sh.Local, Static: sh.Static, Origin: testOrigin, Base: sh.Base}
	if u := sh2.StartURL(); u != "/" || sh.Local.Current() != first {
		t.Fatalf("start url %q, current %q", u, sh.Local.Current())
	}
}

func TestShellFoundRenameRemove(t *testing.T) {
	t.Setenv("DB_MAX_CONNS", "1")
	sh := newTestShell(t)
	_, out := call(t, sh, "create", map[string]any{"name": "Kopie"})
	id := out["id"].(string)
	sh.Local.Close()
	if _, out = call(t, sh, "rename", map[string]any{"id": id, "name": "  Neuer   Name "}); out["ok"] != true {
		t.Fatalf("rename: %v", out)
	}
	if e, _ := sh.Settings.Get(id); e.Name != "Neuer Name" {
		t.Fatalf("name = %q", e.Name)
	}
	if _, out = call(t, sh, "remove", map[string]any{"id": id}); out["ok"] != true {
		t.Fatalf("remove: %v", out)
	}
	// Still there as a found folder, and opened from there again
	_, st := call(t, sh, "state", map[string]any{})
	found := st["found"].([]any)
	if len(found) != 1 {
		t.Fatalf("found = %v", found)
	}
	path := found[0].(map[string]any)["path"].(string)
	if _, out = call(t, sh, "open-found", map[string]any{"path": path}); out["local"] != true {
		t.Fatalf("open-found: %v", out)
	}
	// Only folders in the base folder
	if _, out = call(t, sh, "open-found", map[string]any{"path": t.TempDir()}); out["error"] == nil {
		t.Fatalf("outside the base folder: %v", out)
	}
}

func TestShellStaticAndStartPage(t *testing.T) {
	t.Setenv("LANGUAGE", "fr")
	sh := newTestShell(t)
	rec := httptest.NewRecorder()
	sh.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, StartPath, nil))
	if !strings.Contains(rec.Body.String(), `<html lang="fr"`) || rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatalf("start page: %s %v", rec.Body.String(), rec.Header())
	}
	rec = httptest.NewRecorder()
	sh.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/app.js", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Header().Get("Content-Type"), "javascript") {
		t.Fatalf("asset: %d %v", rec.Code, rec.Header())
	}
	// No instance open: the app's address leads to the start view
	rec = httptest.NewRecorder()
	sh.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if !strings.Contains(rec.Body.String(), StartPath) {
		t.Fatalf("root: %s", rec.Body.String())
	}
}

func TestNormalizeServerURL(t *testing.T) {
	for in, want := range map[string]string{
		"notes.example.com":            "https://notes.example.com/",
		"http://10.0.0.2:8080/app?x=1": "http://10.0.0.2:8080/app/",
	} {
		if got, err := NormalizeServerURL(in); err != nil || got != want {
			t.Errorf("%q → %q, %v", in, got, err)
		}
	}
	for _, in := range []string{"", "ftp://x", "https://user:pw@x/"} {
		if _, err := NormalizeServerURL(in); err == nil {
			t.Errorf("%q should be refused", in)
		}
	}
}

// The folder dialog: opened at the given folder or its nearest existing parent, the choice handed back, a
// cancelled dialog an empty path, and without a dialog (tests, no window) a problem the view can show.
func TestShellPickFolder(t *testing.T) {
	sh := newTestShell(t)
	if _, out := call(t, sh, "pick-folder", map[string]string{}); out["error"] == nil {
		t.Errorf("without a dialog: %v, want an error", out)
	}
	var gotStart string
	answer := "/media/disk/MindSift"
	sh.PickFolder = func(start string) (string, error) { gotStart = start; return answer, nil }
	existing := t.TempDir()
	if code, out := call(t, sh, "pick-folder", map[string]string{"path": existing}); code != http.StatusOK || out["path"] != answer || gotStart != existing {
		t.Errorf("pick: %d %v, start %q", code, out, gotStart)
	}
	for start, want := range map[string]string{filepath.Join(existing, "fehlt", "tief"): existing, "relativ": "", "": ""} {
		call(t, sh, "pick-folder", map[string]string{"path": start})
		if gotStart != want {
			t.Errorf("start %q handed to the dialog as %q, want %q", start, gotStart, want)
		}
	}
	answer = ""
	if _, out := call(t, sh, "pick-folder", map[string]string{}); out["path"] != "" || out["error"] != nil {
		t.Errorf("cancelled: %v", out)
	}
	other := func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }
	if code, _ := call(t, sh, "pick-folder", map[string]string{}, other); code != http.StatusForbidden {
		t.Errorf("other origin: %d", code)
	}
}
