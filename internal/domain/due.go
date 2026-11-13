package domain

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/clock"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Due dates are stored as "2006-01-02" (all day) or "2006-01-02T15:04" (with time), always in the
// server's time zone (clock.Location: the admin's setting, else TZ, else UTC). Both sort correctly as
// plain strings.
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
	if t, hasTime, ok := ParseDue(raw, clock.Location()); ok {
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
	switch {
	case notifyBeforeMinutes == ReminderMonth:
		t = monthBefore(t)
	case notifyBeforeMinutes > 0 && notifyBeforeMinutes%minutesPerDay == 0:
		// Whole days as calendar days: a change of daylight saving time in between moves nothing
		t = t.AddDate(0, 0, -notifyBeforeMinutes/minutesPerDay)
	case notifyBeforeMinutes > 0:
		t = t.Add(-time.Duration(notifyBeforeMinutes) * time.Minute)
	}
	return t, true
}

// monthBefore: the same day and time a month earlier; 31 March gives the last day of February
func monthBefore(t time.Time) time.Time {
	y, m, d := t.Date()
	last := time.Date(y, m, 0, 0, 0, 0, 0, t.Location()).Day()
	if d > last {
		d = last
	}
	return time.Date(y, m-1, d, t.Hour(), t.Minute(), 0, 0, t.Location())
}

// Reminders of a task: minutes before its due date, replacing each person's lead time. Whole days count
// as calendar days, ReminderMonth as one calendar month. Stored in thoughts.reminders as "20160,0".
const (
	minutesPerDay = 24 * 60
	ReminderMonth = 30 * minutesPerDay
)

// AllowedReminders are the choices in the task dialog (and what the API accepts)
var AllowedReminders = []int{0, 15, 30, 60, 120, minutesPerDay, 2 * minutesPerDay, 3 * minutesPerDay, 7 * minutesPerDay, 14 * minutesPerDay, ReminderMonth}

// NormalizeReminders keeps the allowed values once each, the earliest first; ok is false for any other.
func NormalizeReminders(in []int) ([]int, bool) {
	allowed := map[int]bool{}
	for _, m := range AllowedReminders {
		allowed[m] = true
	}
	seen := map[int]bool{}
	out := []int{}
	for _, m := range in {
		if !allowed[m] {
			return nil, false
		}
		if !seen[m] {
			seen[m] = true
			out = append(out, m)
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(out)))
	return out, true
}

// ParseReminders reads the stored column; unknown parts are skipped.
func ParseReminders(raw string) []int {
	out := []int{}
	for _, part := range strings.Split(raw, ",") {
		if m, err := strconv.Atoi(strings.TrimSpace(part)); err == nil && m >= 0 {
			out = append(out, m)
		}
	}
	return out
}

// FormatReminders is the stored form of reminders ("" = the lead time of each person).
func FormatReminders(r []int) string {
	parts := make([]string, len(r))
	for i, m := range r {
		parts[i] = strconv.Itoa(m)
	}
	return strings.Join(parts, ",")
}

// HumanDue renders a due date for messages in lang: "30.10.2026" or "30.10.2026, 14:30 Uhr".
func HumanDue(lang, raw string) string {
	t, hasTime, ok := ParseDue(raw, clock.Location())
	if !ok {
		return raw
	}
	if hasTime {
		return i18n.ShortDate(lang, t) + ", " + i18n.Clock(lang, t)
	}
	return i18n.ShortDate(lang, t)
}

// PriorityLabel: how a task's priority reads in mails and notes.
func PriorityLabel(lang, p string) string {
	switch p {
	case "urgent":
		return i18n.T(lang, "Dringend")
	case "high":
		return i18n.T(lang, "Wichtig")
	case "low":
		return i18n.T(lang, "Niedrig")
	}
	return i18n.T(lang, "Normal")
}
