package shell

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// Guarded actions of the shell: the tray, the key bindings and the window's close button would otherwise
// load another page, reload it or close the window behind the page's back and lose a recording or
// dictation still under way. Every such action goes through Guard.Request, the one way in: the shell asks
// the page first (ShellActionEvent with the action's name and a reply function) and runs the action once
// the page says so. The page (frontend lib/desktopShellActions.ts) answers at once with "go" when nothing
// would be lost; otherwise it answers "wait", asks the person and then answers "go" or "stay".
//
// Nothing may hang on the page: a page that does not answer within Wait (not loaded yet, busy, crashed,
// or a server's older frontend without the listener) has the action run anyway. A page that said "wait"
// keeps the question open until the person answers, but the next guarded action after Insist runs at once
// (the person insists, or the page never answers), so no page can hold the window for good; Wails shutting
// down by itself (e.g. on a signal) never comes here at all.
//
// A new action: give it a name, call Request(name, run) where the shell would have run it, and give the
// frontend its texts (desktopShellActions.ts); an older frontend answers nothing and the action runs after
// Wait.

// ShellActionEvent: the window event the page gets for every guarded action, detail {action, reply}
const ShellActionEvent = "mindsift:desktop-shell-action"

// guardPrefix: the page's answers through the engine's message channel, "<prefix><id>:<answer>"
const guardPrefix = "mindsift:shell-action:"

const (
	// DefaultGuardWait: how long the page has to answer at all
	DefaultGuardWait = time.Second
	// DefaultGuardInsist: from when on another guarded action, while a question is open, runs at once
	DefaultGuardInsist = 3 * time.Second
)

// Guard runs the shell's guarded actions; the zero value with Ask set works with the default times.
type Guard struct {
	// Ask runs a script in the window's page (from any goroutine)
	Ask func(script string)
	// Asking: the page asks the person (it answered "wait"); e.g. bring the window up. Optional.
	Asking func()
	// Wait and Insist: see above; 0 means the defaults
	Wait, Insist time.Duration

	mu   sync.Mutex
	open *guarded
}

type guarded struct {
	id, action string
	run        func()
	asked      time.Time
	waiting    bool // the page asks the person
	timer      *time.Timer
}

// Request runs action's run once the page agrees, or after Wait without an answer. One question at a time:
// another guarded action while one is open is dropped within Insist and runs at once after it (the open
// question is dropped then).
func (g *Guard) Request(action string, run func()) {
	g.mu.Lock()
	if o := g.open; o != nil {
		insist := time.Since(o.asked) >= durationOr(g.Insist, DefaultGuardInsist)
		if insist {
			g.dropLocked()
		}
		g.mu.Unlock()
		if insist {
			run()
		}
		return
	}
	r := &guarded{id: newGuardID(), action: action, run: run, asked: time.Now()}
	r.timer = time.AfterFunc(durationOr(g.Wait, DefaultGuardWait), func() { g.answer(r.id, "go") })
	g.open = r
	g.mu.Unlock()
	g.Ask(guardScript(r.id, action))
}

// Message takes the page's answer from the engine's message channel; false when message is none (the
// caller hands it on). Any page may post one, but only the open question's id counts, and all an answer
// can do is run or drop an action the person started.
func (g *Guard) Message(message string) bool {
	rest, ok := strings.CutPrefix(message, guardPrefix)
	if !ok {
		return false
	}
	if id, answer, ok := strings.Cut(rest, ":"); ok {
		g.answer(id, answer)
	}
	return true
}

// PageChanged: the window shows another page; a question the last page put to the person went with it.
// An action the page has not answered yet stays and runs after Wait (its page may never have got it).
func (g *Guard) PageChanged() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.open != nil && g.open.waiting {
		g.dropLocked()
	}
}

func (g *Guard) answer(id, answer string) {
	g.mu.Lock()
	r := g.open
	if r == nil || r.id != id {
		g.mu.Unlock()
		return
	}
	switch answer {
	case "wait":
		if r.waiting {
			g.mu.Unlock()
			return
		}
		r.waiting = true
		r.timer.Stop()
		g.mu.Unlock()
		if g.Asking != nil {
			g.Asking()
		}
	case "go":
		g.dropLocked()
		g.mu.Unlock()
		r.run()
	case "stay":
		g.dropLocked()
		g.mu.Unlock()
	default:
		g.mu.Unlock()
	}
}

func (g *Guard) dropLocked() {
	g.open.timer.Stop()
	g.open = nil
}

// guardScript: fires ShellActionEvent in the page with a reply function that posts the answer through the
// engine's message channel (WebKitGTK: Wails' "external" handler, on every page; WebView2: chrome.webview).
func guardScript(id, action string) string {
	prefix, _ := json.Marshal(guardPrefix + id + ":")
	act, _ := json.Marshal(action)
	event, _ := json.Marshal(ShellActionEvent)
	return `(function(){var p=` + string(prefix) + `;function reply(a){try{` +
		`var h=window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.external;` +
		`if(h)h.postMessage(p+a);else if(window.chrome&&window.chrome.webview)window.chrome.webview.postMessage(p+a)}catch(e){}}` +
		`window.dispatchEvent(new CustomEvent(` + string(event) + `,{detail:{action:` + string(act) + `,reply:reply}}))})();`
}

func newGuardID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func durationOr(d, fallback time.Duration) time.Duration {
	if d > 0 {
		return d
	}
	return fallback
}
