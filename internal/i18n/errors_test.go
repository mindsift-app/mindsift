package i18n

import (
	"errors"
	"fmt"
	"testing"
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
