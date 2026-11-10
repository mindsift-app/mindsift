package api

import (
	"errors"
	"fmt"
	"testing"

	"github.com/mindsift-app/mindsift/internal/i18n"
	"github.com/mindsift-app/mindsift/internal/storage"
)

// The token of a public link never reaches the log (SA-04)
func TestLogPathHidesPublicTokens(t *testing.T) {
	cases := map[string]string{
		"/api/v1/public/abc123":        "/api/v1/public/<token>",
		"/api/v1/public/abc123/unlock": "/api/v1/public/<token>/unlock",
		"/api/v1/public/":              "/api/v1/public/",
		"/api/v1/thoughts":             "/api/v1/thoughts",
	}
	for in, want := range cases {
		if got := logPath(in); got != want {
			t.Errorf("logPath(%q) = %q, want %q", in, got, want)
		}
	}
}

// Clients see texts written for people; driver messages and paths stay in the log (SA-08)
func TestClientMessageHidesInternals(t *testing.T) {
	if got := clientMessage(errors.New("sql: database is closed")); got != errInternal {
		t.Errorf("internal error shown: %q", got)
	}
	if got := clientMessage(fmt.Errorf("open /data/x.db: %w", errors.New("permission denied"))); got != errInternal {
		t.Errorf("wrapped internal error shown: %q", got)
	}
	if got := clientMessage(storage.ErrEmailTaken); got != storage.ErrEmailTaken.Error() {
		t.Errorf("catalog text hidden: %q", got)
	}
	if got := clientMessage(i18n.NewError("Aufnahme zu groß (höchstens {mb} MB)", "mb", "25")); got == errInternal {
		t.Errorf("localized error hidden: %q", got)
	}
}

// A password typed into the name field must not land in the log (SA-17)
func TestMaskLogin(t *testing.T) {
	for in, want := range map[string]string{"geheim123!": "ge***", "a": "a***", "anna@example.com": maskEmail("anna@example.com")} {
		if got := maskLogin(in); got != want {
			t.Errorf("maskLogin(%q) = %q, want %q", in, got, want)
		}
	}
}
