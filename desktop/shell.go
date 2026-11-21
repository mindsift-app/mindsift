package main

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	startPath = "/__desktop/start"
	checkPath = "/__desktop/check"
)

// settings: what the person chose on the start page
type settings struct {
	Mode      string `json:"mode"` // "local", "remote" or "" (not chosen yet)
	ServerURL string `json:"serverUrl,omitempty"`
}

func loadSettings(path string) settings {
	var s settings
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &s)
	}
	return s
}

func saveSettings(path string, s settings) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(s, "", "  ")
	return os.WriteFile(path, data, 0o600)
}

// shellHandler answers every request of the window: the shell's own pages under /__desktop/, everything
// else goes to the local server (local mode) or back to the start page.
type shellHandler struct {
	mu           sync.Mutex
	settingsPath string
	settings     *settings
	local        func() (http.Handler, error)
	dataDir      string
	version      string
	setURL       func(string)
}

func (h *shellHandler) current() settings {
	h.mu.Lock()
	defer h.mu.Unlock()
	return *h.settings
}

func (h *shellHandler) startURL() string {
	// Spike: open another page of the shell first (e.g. /__desktop/check), for checks without clicking
	if p := os.Getenv("MINDSIFT_DESKTOP_START"); strings.HasPrefix(p, "/") {
		return p
	}
	s := h.current()
	switch {
	case s.Mode == "local":
		return "/"
	case s.Mode == "remote" && s.ServerURL != "":
		return s.ServerURL
	}
	return startPath
}

func (h *shellHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case startPath:
		h.startPage(w, "")
		return
	case "/__desktop/choose":
		h.choose(w, r)
		return
	case checkPath:
		writeHTML(w, checkPage)
		return
	case "/__desktop/sw-test.js":
		w.Header().Set("Content-Type", "text/javascript")
		_, _ = io.WriteString(w, swTest)
		return
	case "/__desktop/sse":
		sseTest(w, r)
		return
	case "/__desktop/slow":
		time.Sleep(2 * time.Second)
		_, _ = io.WriteString(w, "ok")
		return
	case "/__desktop/echo":
		n, _ := io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"bytes":%d,"contentType":%q}`, n, r.Header.Get("Content-Type"))
		return
	}
	if h.current().Mode != "local" {
		http.Redirect(w, r, startPath, http.StatusSeeOther)
		return
	}
	handler, err := h.local()
	if err != nil {
		slog.Error("Starting the local server failed", "error", err)
		http.Error(w, "Der lokale MindSift-Server ließ sich nicht starten: "+err.Error(), http.StatusInternalServerError)
		return
	}
	handler.ServeHTTP(w, r)
}

func (h *shellHandler) choose(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Redirect(w, r, startPath, http.StatusSeeOther)
		return
	}
	_ = r.ParseForm()
	next := settings{Mode: r.PostFormValue("mode")}
	switch next.Mode {
	case "local":
	case "remote":
		u, err := normalizeServerURL(r.PostFormValue("url"))
		if err != nil {
			h.startPage(w, err.Error())
			return
		}
		if err := checkServer(r.Context(), u); err != nil {
			h.startPage(w, err.Error())
			return
		}
		next.ServerURL = u
	default:
		h.startPage(w, "Bitte eine Betriebsart wählen.")
		return
	}
	h.mu.Lock()
	*h.settings = next
	h.mu.Unlock()
	if err := saveSettings(h.settingsPath, next); err != nil {
		slog.Warn("Saving the desktop settings failed", "error", err)
	}
	if next.Mode == "local" {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	// Leaving the shell's origin for the server: a page that navigates, as a redirect from the webview's
	// own scheme to https is not followed by every engine
	writeHTML(w, `<!doctype html><meta charset="utf-8"><title>MindSift</title><p style="font-family:sans-serif">Verbinde mit `+
		html.EscapeString(next.ServerURL)+` …</p><script>location.replace(`+jsString(next.ServerURL)+`)</script>`)
}

func normalizeServerURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("Bitte die Adresse des Servers eingeben.")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", fmt.Errorf("Das ist keine gültige Adresse: %s", raw)
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/"
	u.RawQuery, u.Fragment = "", ""
	return u.String(), nil
}

// checkServer: the address answers like a MindSift server
func checkServer(ctx context.Context, base string) error {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, base+"api/v1/health", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("Der Server antwortet nicht: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Unter dieser Adresse antwortet kein MindSift-Server (Status %d).", resp.StatusCode)
	}
	return nil
}

func (h *shellHandler) startPage(w http.ResponseWriter, problem string) {
	s := h.current()
	msg := ""
	if problem != "" {
		msg = `<p class="err">` + html.EscapeString(problem) + `</p>`
	}
	page := strings.NewReplacer(
		"{{error}}", msg,
		"{{dataDir}}", html.EscapeString(h.dataDir),
		"{{url}}", html.EscapeString(s.ServerURL),
		"{{version}}", html.EscapeString(h.version),
	).Replace(startPageHTML)
	writeHTML(w, page)
}

func sseTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	flusher, _ := w.(http.Flusher)
	for i := 1; i <= 5; i++ {
		_, _ = fmt.Fprintf(w, "data: %d\n\n", i)
		if flusher != nil {
			flusher.Flush()
		}
		select {
		case <-r.Context().Done():
			return
		case <-time.After(700 * time.Millisecond):
		}
	}
}

func writeHTML(w http.ResponseWriter, page string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, page)
}

func jsString(s string) string {
	b, _ := json.Marshal(s)
	return strings.ReplaceAll(string(b), "</", `<\/`)
}

const startPageHTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>MindSift</title>
<style>
 body{font-family:system-ui,sans-serif;background:#16181d;color:#e6e6e6;display:flex;justify-content:center;padding:48px 16px;margin:0}
 main{max-width:640px;width:100%}
 h1{font-weight:600;margin:0 0 4px} .sub{color:#9aa0a6;margin:0 0 28px}
 form{background:#1f2229;border:1px solid #30343c;border-radius:12px;padding:20px;margin:0 0 16px}
 h2{margin:0 0 6px;font-size:18px} p{margin:0 0 14px;color:#b8bcc2;line-height:1.45}
 input[type=text]{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #3a3f48;background:#14161a;color:#e6e6e6;font-size:15px;margin:0 0 12px}
 button{background:#6d5dfc;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:15px;cursor:pointer}
 .err{background:#4a1f24;color:#ffb4b4;padding:10px 12px;border-radius:8px}
 code{font-size:13px;color:#c9c9ff} .foot{color:#6b7078;font-size:13px}
 a{color:#a99cff}
</style></head><body><main>
<h1>MindSift</h1><p class="sub">Desktop-Machbarkeitsprobe – wie möchtest du MindSift nutzen?</p>
{{error}}
<form method="post" action="/__desktop/choose"><input type="hidden" name="mode" value="local">
 <h2>Lokal auf diesem Rechner</h2>
 <p>Kein Server nötig. Die Daten bleiben auf diesem Rechner in <code>{{dataDir}}</code>. Der eingebaute Server ist nur für dieses Fenster erreichbar, nicht im Netz und nicht über localhost.</p>
 <button>Lokal nutzen</button></form>
<form method="post" action="/__desktop/choose"><input type="hidden" name="mode" value="remote">
 <h2>Mit einem MindSift-Server verbinden</h2>
 <p>Die Oberfläche kommt vom Server. Bei Verbindungsabbruch kannst du wie im Browser weiterarbeiten.</p>
 <input type="text" name="url" placeholder="https://notizen.example.com" value="{{url}}">
 <button>Verbinden</button></form>
<p class="foot">Wechseln geht jederzeit über das Symbol in der Leiste („Betriebsart wechseln“). <a href="/__desktop/check">Prüfseite</a> · Version {{version}}</p>
</main></body></html>`
