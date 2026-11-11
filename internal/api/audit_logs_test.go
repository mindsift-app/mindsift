package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/auth"
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

// Error answers below 500 show only texts written for people: a database or driver error on a 400 path
// becomes an internal error (500, fixed text, details in the log), also behind a known context (N-02)
func TestErrorAnswersHideInternals(t *testing.T) {
	answer := func(status int, err error) (int, string) {
		rec := httptest.NewRecorder()
		rec.Header().Set("Content-Language", "en")
		writeErrorFrom(rec, status, err)
		var body map[string]string
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return rec.Code, body["error"]
	}
	sqlErr := errors.New("UNIQUE constraint failed: users.email")
	for _, err := range []error{sqlErr, fmt.Errorf("Discord-Webhook: %w", sqlErr), fmt.Errorf("moving note %q: %w", "Einkauf", sqlErr)} {
		if code, msg := answer(http.StatusBadRequest, err); code != http.StatusInternalServerError || strings.Contains(msg, "UNIQUE") || strings.Contains(msg, "Einkauf") {
			t.Errorf("%v: answered %d %q", err, code, msg)
		}
	}
	cases := []struct {
		err  error
		want string
	}{
		{storage.ErrEmailTaken, "This email address already exists"},
		{fmt.Errorf("Discord-Webhook: %w", errors.New("Ungültige URL")), "Discord webhook: Invalid URL"},
		{auth.ErrPasswordTooShort, "The password must be at least 8 characters long"},
	}
	for _, c := range cases {
		if code, msg := answer(http.StatusBadRequest, c.err); code != http.StatusBadRequest || msg != c.want {
			t.Errorf("%v: answered %d %q, want 400 %q", c.err, code, msg, c.want)
		}
	}
	// A test message to one's own Discord or webhook: the HTTP status is told, network details are not
	rec := httptest.NewRecorder()
	rec.Header().Set("Content-Language", "en")
	if got := deliveryProblem(rec, errors.New("dial tcp 10.0.0.5:443: connect: connection refused")); got != "Target not reachable" {
		t.Errorf("network error shown: %q", got)
	}
	if got := deliveryProblem(rec, i18n.NewError("HTTP-Status {status}", "status", "404")); got != "HTTP status 404" {
		t.Errorf("HTTP status: %q", got)
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
