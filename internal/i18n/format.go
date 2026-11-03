package i18n

import (
	"strconv"
	"strings"
	"time"
)

// Dates and times in messages the server writes (mails, push, journal titles). A new language adds its
// entry here; languages without one use German.
type dateFormat struct {
	Weekdays [7]string // Sunday first, like time.Weekday
	Months   [12]string
	// LongDate with {weekday}, {day}, {month}, {year}: the journal title
	LongDate string
	// ShortDate and Clock are Go layouts; ClockSuffix follows the time ("14:30 Uhr")
	ShortDate   string
	Clock       string
	ClockSuffix string
}

var dateFormats = map[string]dateFormat{
	"de": {
		Weekdays:    [7]string{"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"},
		Months:      [12]string{"Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"},
		LongDate:    "{weekday}, {day}. {month} {year}",
		ShortDate:   "02.01.2006",
		Clock:       "15:04",
		ClockSuffix: " Uhr",
	},
	"en": {
		Weekdays:  [7]string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"},
		Months:    [12]string{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"},
		LongDate:  "{weekday}, {month} {day}, {year}",
		ShortDate: "01/02/2006",
		Clock:     "3:04 PM",
	},
}

func formatOf(lang string) dateFormat {
	if f, ok := dateFormats[lang]; ok {
		return f
	}
	return dateFormats[Fallback]
}

// LongDate: "Freitag, 30. Oktober 2026" / "Friday, October 30, 2026"
func LongDate(lang string, t time.Time) string {
	f := formatOf(lang)
	return strings.NewReplacer(
		"{weekday}", f.Weekdays[t.Weekday()],
		"{day}", strconv.Itoa(t.Day()),
		"{month}", f.Months[t.Month()-1],
		"{year}", strconv.Itoa(t.Year()),
	).Replace(f.LongDate)
}

// ShortDate: "30.10.2026" / "10/30/2026"
func ShortDate(lang string, t time.Time) string { return t.Format(formatOf(lang).ShortDate) }

// Clock: "14:30 Uhr" / "2:30 PM"
func Clock(lang string, t time.Time) string {
	f := formatOf(lang)
	return t.Format(f.Clock) + f.ClockSuffix
}
