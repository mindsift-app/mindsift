// Package ical writes iCalendar text (RFC 5545) for the read-only calendar subscription and reads it back
// for the tests. It knows only what the feed needs: lines ending in CRLF, folded at 75 octets without
// splitting a UTF-8 character, and TEXT values escaped.
package ical

import (
	"strings"
	"time"
	"unicode/utf8"
)

// maxLineOctets is the longest content line RFC 5545 allows, without the CRLF.
const maxLineOctets = 75

// Writer collects the content lines of a calendar.
type Writer struct {
	b strings.Builder
}

// Line adds a property whose value is already in its iCalendar form (dates, durations, URIs).
// name may carry parameters ("DTSTART;VALUE=DATE").
func (w *Writer) Line(name, value string) {
	w.b.WriteString(Fold(name + ":" + value))
}

// Text adds a property with a TEXT value, escaped.
func (w *Writer) Text(name, value string) {
	w.Line(name, EscapeText(value))
}

// String is the calendar written so far.
func (w *Writer) String() string { return w.b.String() }

// EscapeText escapes a TEXT value: backslash, semicolon, comma and line breaks; other control
// characters, which a TEXT value may not hold, are dropped (tabs stay).
func EscapeText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r == '\\':
			b.WriteString(`\\`)
		case r == ';':
			b.WriteString(`\;`)
		case r == ',':
			b.WriteString(`\,`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\t':
			b.WriteRune(r)
		case r < 0x20 || r == 0x7f:
			// dropped
		case r == utf8.RuneError:
			// invalid UTF-8 in the source; the feed must stay valid
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Fold turns one logical line into content lines of at most 75 octets each, every continuation starting
// with a space, and ends it with CRLF. A UTF-8 character is never split.
func Fold(line string) string {
	if len(line) <= maxLineOctets {
		return line + "\r\n"
	}
	var b strings.Builder
	b.Grow(len(line) + len(line)/maxLineOctets*3 + 2)
	limit := maxLineOctets
	for len(line) > limit {
		cut := limit
		for cut > 0 && !utf8.RuneStart(line[cut]) {
			cut--
		}
		b.WriteString(line[:cut])
		b.WriteString("\r\n ")
		line = line[cut:]
		limit = maxLineOctets - 1 // the leading space counts
	}
	b.WriteString(line)
	b.WriteString("\r\n")
	return b.String()
}

// UTC formats an instant as a DATE-TIME in UTC ("20261115T083000Z").
func UTC(t time.Time) string { return t.UTC().Format("20060102T150405Z") }

// Date formats the calendar day of t as a DATE ("20261115"), in t's own location.
func Date(t time.Time) string { return t.Format("20060102") }
