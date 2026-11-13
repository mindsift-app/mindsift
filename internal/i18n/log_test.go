package i18n

import (
	"bytes"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

// The server log is English: an error that is a German catalog text (the one people read) is logged
// translated, other errors and plain values stay as they are.
func TestLogInEnglish(t *testing.T) {
	saved := catalogs
	defer func() { catalogs = saved }()
	catalogs = map[string]map[string]string{"en": {"Ordner {name} ist voll": "Folder {name} is full", "Speichern": "Saving"}}

	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{ReplaceAttr: LogInEnglish}))
	log.Warn("Saving failed",
		"error", fmt.Errorf("Speichern: %w", errors.New("disk I/O error")),
		"cause", NewError("Ordner {name} ist voll", "name", "Team"),
		"folder", "Speichern",
		"count", 3,
		"none", error(nil))
	out := buf.String()
	for _, want := range []string{`error="Saving: disk I/O error"`, `cause="Folder Team is full"`, `folder=Speichern`, `count=3`, `none=<nil>`} {
		if !strings.Contains(out, want) {
			t.Errorf("log lacks %s:\n%s", want, out)
		}
	}
}
