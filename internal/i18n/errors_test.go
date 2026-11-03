package i18n

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestText(t *testing.T) {
	saved := catalogs
	defer func() { catalogs = saved }()
	catalogs = map[string]map[string]string{"en": {"Ordner {name} ist voll": "Folder {name} is full", "Speichern": "Saving"}}
	err := NewError("Ordner {name} ist voll", "name", "Team")
	if err.Error() != "Ordner Team ist voll" {
		t.Fatalf("German: %q", err.Error())
	}
	for _, c := range []struct {
		err  error
		want string
	}{
		{err, "Folder Team is full"},
		{fmt.Errorf("%w", err), "Folder Team is full"},
		{fmt.Errorf("Speichern: %w", err), "Saving: Ordner Team ist voll"},
		{errors.New("Speichern"), "Saving"},
	} {
		if got := Text("en", c.err); got != c.want {
			t.Errorf("Text(%q) = %q, want %q", c.err, got, c.want)
		}
	}
}

// Every supported language writes its own dates; a text a catalog lacks comes in English.
func TestLanguagesComplete(t *testing.T) {
	day := time.Date(2026, 10, 30, 15, 30, 0, 0, time.UTC)
	for _, lang := range Supported {
		if _, ok := dateFormats[lang]; !ok {
			t.Errorf("%s has no date format", lang)
		}
		if lang != Fallback {
			if _, ok := catalogs[lang]; !ok {
				t.Errorf("%s has no server catalog", lang)
			}
		}
	}
	if got := LongDate("es", day); got != "viernes, 30 de octubre de 2026" {
		t.Errorf("Spanish date: %q", got)
	}
	if got := LongDate("fr", day) + " " + Clock("fr", day); got != "vendredi 30 octobre 2026 15:30" {
		t.Errorf("French date: %q", got)
	}
	saved := catalogs
	defer func() { catalogs = saved }()
	catalogs = map[string]map[string]string{"en": {"Nur hier": "Only here"}, "it": {}}
	if got := T("it", "Nur hier"); got != "Only here" {
		t.Errorf("missing Italian text should fall back to English, got %q", got)
	}
}
