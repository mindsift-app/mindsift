package domain

import (
	"testing"
	"time"
)

func TestNormalizeDue(t *testing.T) {
	cases := map[string]string{
		"2026-10-30":          "2026-10-30",
		"2026-10-30T14:30":    "2026-10-30T14:30",
		"2026-10-30 14:30":    "2026-10-30T14:30",
		"2026-10-30T14:30:59": "2026-10-30T14:30",
		" ":                   "",
		"nächste Woche":       "nächste Woche",
	}
	for in, want := range cases {
		if got := NormalizeDue(in); got != want {
			t.Errorf("NormalizeDue(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDueAlarmAt(t *testing.T) {
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Fatal(err)
	}
	at, ok := DueAlarmAt("2026-10-30", 0, berlin)
	if !ok || !at.Equal(time.Date(2026, 10, 30, 9, 0, 0, 0, berlin)) {
		t.Errorf("all-day alarm should fire at 09:00 local, got %v", at)
	}
	at, _ = DueAlarmAt("2026-10-30T14:30", 15, berlin)
	if !at.Equal(time.Date(2026, 10, 30, 14, 15, 0, 0, berlin)) {
		t.Errorf("lead time not applied: %v", at)
	}
	if _, ok := DueAlarmAt("irgendwann", 0, berlin); ok {
		t.Errorf("unreadable due date must not produce an alarm")
	}
}
