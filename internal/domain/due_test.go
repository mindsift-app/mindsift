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

// Reminders of whole days and a month go by the calendar, so the change of daylight saving time
// (29 March and 25 October 2026 in Berlin) keeps the hour
func TestDueAlarmAtCalendarDays(t *testing.T) {
	for _, zone := range []string{"Europe/Berlin", "America/Los_Angeles", "Asia/Tokyo"} {
		loc, err := time.LoadLocation(zone)
		if err != nil {
			t.Fatal(err)
		}
		at, _ := DueAlarmAt("2026-04-02", 7*24*60, loc)
		if !at.Equal(time.Date(2026, 3, 26, 9, 0, 0, 0, loc)) {
			t.Errorf("%s: a week before an all-day task over the clock change: %v", zone, at)
		}
		at, _ = DueAlarmAt("2026-11-03T18:30", 14*24*60, loc)
		if !at.Equal(time.Date(2026, 10, 20, 18, 30, 0, 0, loc)) {
			t.Errorf("%s: two weeks before 18:30: %v", zone, at)
		}
		at, _ = DueAlarmAt("2026-03-31", ReminderMonth, loc)
		if !at.Equal(time.Date(2026, 2, 28, 9, 0, 0, 0, loc)) {
			t.Errorf("%s: a month before: %v", zone, at)
		}
		at, _ = DueAlarmAt("2026-11-24", 24*60, loc)
		if !at.Equal(time.Date(2026, 11, 23, 9, 0, 0, 0, loc)) {
			t.Errorf("%s: a day before an all-day task: %v", zone, at)
		}
	}
}

func TestNormalizeReminders(t *testing.T) {
	got, ok := NormalizeReminders([]int{0, 20160, 60, 0})
	if !ok || FormatReminders(got) != "20160,60,0" {
		t.Errorf("got %v %v", got, ok)
	}
	if _, ok := NormalizeReminders([]int{45}); ok {
		t.Errorf("45 minutes is no choice")
	}
	if r := ParseReminders(""); len(r) != 0 {
		t.Errorf("empty column: %v", r)
	}
	if r := ParseReminders("1440,0"); len(r) != 2 || r[0] != 1440 || r[1] != 0 {
		t.Errorf("parse: %v", r)
	}
}
