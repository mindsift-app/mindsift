package api

import (
	"testing"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
)

func TestAlarmDue(t *testing.T) {
	berlin, _ := time.LoadLocation("Europe/Berlin")
	clock.UseInTest(t, berlin) // alarms read due dates in the server's time zone
	at := func(h, m int) time.Time { return time.Date(2026, 10, 30, h, m, 0, 0, berlin) }
	cases := []struct {
		due    string
		before int
		now    time.Time
		want   bool
	}{
		{"2026-10-30", 0, at(8, 59), false},
		{"2026-10-30", 0, at(9, 0), true},
		{"2026-10-30T14:30", 0, at(14, 29), false},
		{"2026-10-30T14:30", 30, at(14, 0), true},
		{"2026-10-29", 0, at(0, 1), true},
		{"bald", 0, at(23, 0), false},
	}
	for _, c := range cases {
		if got := alarmDue(c.due, c.before, c.now); got != c.want {
			t.Errorf("alarmDue(%q, %d, %v) = %v, want %v", c.due, c.before, c.now.Format("15:04"), got, c.want)
		}
	}
}
