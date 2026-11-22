//go:build linux

package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/mindsift-app/mindsift/desktop/internal/shell"
)

// newNoteShower: notifications over D-Bus (shell/notify_linux.go: the portal under Flatpak, the desktop's
// notification server otherwise); the connection closes when the app quits.
func newNoteShower(app *application.App, onClick func(data string)) shell.NoteShower {
	notes := shell.NewDBusNotes(onClick)
	app.OnShutdown(notes.Close)
	return notes
}
