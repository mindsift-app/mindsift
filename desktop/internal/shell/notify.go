package shell

import (
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"github.com/mindsift-app/mindsift/internal/api"
)

// System notifications for the alarms of the open local instance. Its server runs in this process, so it
// hands each alarm of the channel "desktop" to Notifications.Notify (api.DesktopNotifier, set in
// Local.start); the platform shows it (notify_linux.go: D-Bus, main's notify_windows.go: toasts). A click
// comes back through Click with the instance and the task, and the window opens the task if that instance
// is still the open one. Only while the app runs: closing the window quits it, there is no background mode.

// Note is one notification as the platform shows it.
type Note struct {
	// ID: a later note with the same ID replaces this one where the platform can
	ID    string
	Title string
	Body  string
	// Data comes back to the click (the instance and the task, see Notifications.Click)
	Data string
}

// NoteShower shows notes on this platform.
type NoteShower interface {
	Show(Note) error
}

// errNoNotifications: the platform has no notifications (or they failed to start)
var errNoNotifications = errors.New("no system notifications on this platform")

// maxNoteBody: a notification is a glimpse; the daily summary's list is cut, the task itself is in the app
const maxNoteBody = 400

// Notifications passes the alarms of local instances to the system and clicks back to the window.
type Notifications struct {
	// Shower: the platform's notifications, nil where there are none
	Shower NoteShower
	// Clicked: a notification was clicked; the instance it came from and its task (may be empty). Called
	// on the platform's goroutine, not the main thread.
	Clicked func(instanceID, taskID string)
}

// noteData is what a note carries back to the click
type noteData struct {
	Instance string `json:"i"`
	Task     string `json:"t,omitempty"`
}

// Notify shows an alarm of the local instance instanceID.
func (n *Notifications) Notify(instanceID string, msg api.DesktopNotification) error {
	if n == nil || n.Shower == nil {
		return errNoNotifications
	}
	data, _ := json.Marshal(noteData{Instance: instanceID, Task: msg.TaskID})
	id := "mindsift"
	if msg.Tag != "" {
		id += "-" + msg.Tag
	}
	return n.Shower.Show(Note{ID: id, Title: msg.Title, Body: clip(msg.Body, maxNoteBody), Data: string(data)})
}

// Click hands a click on a note (its Data) to Clicked; data it did not make is ignored.
func (n *Notifications) Click(data string) {
	var d noteData
	if n == nil || n.Clicked == nil || json.Unmarshal([]byte(data), &d) != nil || d.Instance == "" {
		return
	}
	n.Clicked(d.Instance, d.Task)
}

// clip cuts s to at most max characters, ending in "…" when cut
func clip(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return strings.TrimRight(string(r[:max-1]), " \n") + "…"
}

// OpenTaskScript: the script that makes the window's app open a task (App.tsx listens for
// mindsift:open-link, as for a link ?task=…); it does nothing on another origin (a server's page) or on the
// shell's own pages (the start view).
func OpenTaskScript(origin, taskID string) string {
	o, _ := json.Marshal(strings.ToLower(origin))
	link, _ := json.Marshal("?task=" + url.QueryEscape(taskID))
	return `(function(){if((location.protocol+'//'+location.host).toLowerCase()!==` + string(o) +
		`||location.pathname.indexOf('/__desktop/')===0)return;` +
		`window.dispatchEvent(new CustomEvent('mindsift:open-link',{detail:` + string(link) + `}))})();`
}
