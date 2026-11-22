//go:build !linux && !windows

package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/mindsift-app/mindsift/desktop/internal/shell"
)

// newNoteShower: no system notifications outside Linux and Windows (the app builds only for those two)
func newNoteShower(*application.App, func(string)) shell.NoteShower { return nil }
