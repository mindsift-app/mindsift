package api

import (
	"strings"
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/ical"
)

// The calendar's name and description (what calendar apps show instead of the secret address) follow the
// person's language and the instance name, are escaped as TEXT and folded like every other line.
func TestRenderCalendarFeedName(t *testing.T) {
	t.Parallel()
	loc, _ := time.LoadLocation("Europe/Berlin")
	now := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC)
	for _, c := range []struct{ lang, instance, name, desc string }{
		{"de", "", "MindSift – Aufgaben", "Offene Aufgaben mit Fälligkeitsdatum aus MindSift"},
		{"en", "", "MindSift – Tasks", "Open tasks with a due date from MindSift"},
		{"es", "", "MindSift – Tareas", "Tareas abiertas con fecha de vencimiento de MindSift"},
		{"fr", "", "MindSift – Tâches", "Tâches ouvertes avec une échéance de MindSift"},
		{"it", "", "MindSift – Attività", "Attività aperte con una scadenza da MindSift"},
		{"de", "Zuhause", "Zuhause – Aufgaben", "Offene Aufgaben mit Fälligkeitsdatum aus Zuhause"},
		{"en", "  Büro  ", "Büro – Tasks", "Open tasks with a due date from Büro"},
		// commas, semicolons and backslashes of the instance name are escaped and come back unchanged
		{"en", `Nord, Süd; Ost\West`, `Nord, Süd; Ost\West – Tasks`, `Open tasks with a due date from Nord, Süd; Ost\West`},
		// an unknown language falls back to the German source text
		{"xx", "", "MindSift – Aufgaben", "Offene Aufgaben mit Fälligkeitsdatum aus MindSift"},
	} {
		body := renderCalendarFeed(nil, calendarFeedOptions{Lang: c.lang, Instance: c.instance, Loc: loc}, now)
		cal, err := ical.Parse(body)
		if err != nil {
			t.Fatalf("%s/%q: %v", c.lang, c.instance, err)
		}
		for _, prop := range []string{"NAME", "X-WR-CALNAME"} {
			if got := cal.Text(prop); got != c.name {
				t.Errorf("%s/%q: %s = %q, want %q", c.lang, c.instance, prop, got, c.name)
			}
		}
		for _, prop := range []string{"DESCRIPTION", "X-WR-CALDESC"} {
			if got := cal.Text(prop); got != c.desc {
				t.Errorf("%s/%q: %s = %q, want %q", c.lang, c.instance, prop, got, c.desc)
			}
		}
	}

	// On the wire: RFC 5545 escapes, CRLF, no line longer than 75 octets even for a long name
	body := renderCalendarFeed(nil, calendarFeedOptions{Lang: "en", Instance: `A, B; C\D`, Loc: loc}, now)
	if !strings.Contains(body, `X-WR-CALNAME:A\, B\; C\\D – Tasks`+"\r\n") {
		t.Errorf("the name is not escaped:\n%s", body)
	}
	long := strings.Repeat("Äußerst langer Name, ", 12)
	body = renderCalendarFeed(nil, calendarFeedOptions{Lang: "en", Instance: long, Loc: loc}, now)
	for _, line := range strings.Split(strings.TrimSuffix(body, "\r\n"), "\r\n") {
		if len(line) > 75 {
			t.Errorf("line of %d octets: %q", len(line), line)
		}
	}
	cal, err := ical.Parse(body)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := cal.Text("X-WR-CALNAME"), strings.TrimSpace(long)+" – Tasks"; got != want {
		t.Errorf("long name %q, want %q", got, want)
	}
}

// The served feed uses the instance name the administration set and the person's language.
func TestCalendarFeedNameFromSettings(t *testing.T) {
	srv, store, _, owner, _ := startRealtimeServer(t)
	now := time.Now()
	name := func() string {
		body, err := srv.calendarFeed(owner.ID, now)
		if err != nil {
			t.Fatal(err)
		}
		cal, err := ical.Parse(body)
		if err != nil {
			t.Fatal(err)
		}
		return cal.Text("X-WR-CALNAME")
	}
	if err := store.SetLanguage(owner.ID, "fr"); err != nil {
		t.Fatal(err)
	}
	if got := name(); got != "MindSift – Tâches" {
		t.Errorf("default instance name: %q", got)
	}
	sys, _ := store.GetSystemSettings()
	sys.InstanceName = "Familie Müller, Haus"
	if err := store.UpdateSystemSettings(sys); err != nil {
		t.Fatal(err)
	}
	if got := name(); got != "Familie Müller, Haus – Tâches" {
		t.Errorf("instance name: %q", got)
	}
	if err := store.SetLanguage(owner.ID, "en"); err != nil {
		t.Fatal(err)
	}
	if got := name(); got != "Familie Müller, Haus – Tasks" {
		t.Errorf("language: %q", got)
	}
}
