package domain

import (
	"strings"
	"time"
)

// Due dates are stored as "2006-01-02" (all day) or "2006-01-02T15:04" (with time), always in the
// server's local time zone (TZ, default Europe/Berlin). Both sort correctly as plain strings.
const (
	dueDateLayout     = "2006-01-02"
	dueDateTimeLayout = "2006-01-02T15:04"
)

// AllDayAlarmHour is when alarms for tasks without a time fire.
const AllDayAlarmHour = 9

// NormalizeDue brings accepted spellings ("2006-01-02 15:04", seconds, RFC3339) to the stored form.
// Values it cannot read are kept as they are so no input gets lost.
func NormalizeDue(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if t, hasTime, ok := ParseDue(raw, time.Local); ok {
		if hasTime {
			return t.Format(dueDateTimeLayout)
		}
		return t.Format(dueDateLayout)
	}
	return raw
}

// ParseDue reads a due date in loc. hasTime is false for all-day dates (then t is midnight).
func ParseDue(raw string, loc *time.Location) (t time.Time, hasTime, ok bool) {
	raw = strings.TrimSpace(raw)
	if t, err := time.ParseInLocation(dueDateLayout, raw, loc); err == nil {
		return t, false, true
	}
	for _, layout := range []string{dueDateTimeLayout, "2006-01-02 15:04", "2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
		if t, err := time.ParseInLocation(layout, raw, loc); err == nil {
			return t, true, true
		}
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.In(loc), true, true
	}
	return time.Time{}, false, false
}

// DueAlarmAt is the moment the alarm for a due date fires: the due time (09:00 for all-day tasks)
// minus the user's lead time.
func DueAlarmAt(raw string, notifyBeforeMinutes int, loc *time.Location) (time.Time, bool) {
	t, hasTime, ok := ParseDue(raw, loc)
	if !ok {
		return time.Time{}, false
	}
	if !hasTime {
		t = time.Date(t.Year(), t.Month(), t.Day(), AllDayAlarmHour, 0, 0, 0, loc)
	}
	if notifyBeforeMinutes > 0 {
		t = t.Add(-time.Duration(notifyBeforeMinutes) * time.Minute)
	}
	return t, true
}

// HumanDue renders a due date for messages: "30.10.2026" or "30.10.2026, 14:30 Uhr".
func HumanDue(raw string) string {
	t, hasTime, ok := ParseDue(raw, time.Local)
	if !ok {
		return raw
	}
	if hasTime {
		return t.Format("02.01.2006, 15:04") + " Uhr"
	}
	return t.Format("02.01.2006")
}

// PriorityLabel: how a task's priority reads in mails and notes.
func PriorityLabel(p string) string {
	switch p {
	case "urgent":
		return "Dringend"
	case "high":
		return "Wichtig"
	case "low":
		return "Niedrig"
	}
	return "Normal"
}
