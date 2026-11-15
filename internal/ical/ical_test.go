package ical

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestEscapeText(t *testing.T) {
	cases := map[string]string{
		`a,b;c\d`:           `a\,b\;c\\d`,
		"one\ntwo\r\nthree": `one\ntwo\nthree`,
		"bell\x07tab\t":     "belltab\t",
		"#tag @Anna":        "#tag @Anna",
	}
	for in, want := range cases {
		if got := EscapeText(in); got != want {
			t.Errorf("EscapeText(%q) = %q, want %q", in, got, want)
		}
		if in != "bell\x07tab\t" {
			if back := UnescapeText(EscapeText(in)); back != strings.ReplaceAll(in, "\r\n", "\n") {
				t.Errorf("round trip of %q gave %q", in, back)
			}
		}
	}
}

func TestFoldKeepsUTF8AndLength(t *testing.T) {
	// Umlauts and emoji (4 octets) at every possible cut position
	for pad := 0; pad < 8; pad++ {
		value := strings.Repeat("x", pad) + strings.Repeat("Größe 🗓️ Ärger, ", 20)
		var w Writer
		w.Text("SUMMARY", value)
		out := w.String()
		if !strings.HasSuffix(out, "\r\n") {
			t.Fatalf("no CRLF at the end")
		}
		for i, line := range strings.Split(strings.TrimSuffix(out, "\r\n"), "\r\n") {
			if len(line) > 75 {
				t.Errorf("pad %d line %d has %d octets", pad, i, len(line))
			}
			if !utf8.ValidString(line) {
				t.Errorf("pad %d line %d splits a character: %q", pad, i, line)
			}
			if i > 0 && !strings.HasPrefix(line, " ") {
				t.Errorf("pad %d continuation line %d does not start with a space", pad, i)
			}
		}
		cal, err := Parse("BEGIN:VCALENDAR\r\n" + out + "END:VCALENDAR\r\n")
		if err != nil {
			t.Fatalf("pad %d: %v", pad, err)
		}
		if got := cal.Text("SUMMARY"); got != value {
			t.Errorf("pad %d: unfolded value differs:\n got %q\nwant %q", pad, got, value)
		}
	}
	if got := Fold("SHORT:x"); got != "SHORT:x\r\n" {
		t.Errorf("short line changed: %q", got)
	}
	exact := "X:" + strings.Repeat("a", 73)
	if got := Fold(exact); got != exact+"\r\n" {
		t.Errorf("a line of exactly 75 octets must not be folded")
	}
}

func TestParseRejectsBrokenText(t *testing.T) {
	bad := map[string]string{
		"LF only":        "BEGIN:VCALENDAR\nEND:VCALENDAR\n",
		"long line":      "BEGIN:VCALENDAR\r\nX:" + strings.Repeat("a", 80) + "\r\nEND:VCALENDAR\r\n",
		"not closed":     "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR\r\n",
		"no calendar":    "BEGIN:VEVENT\r\nEND:VEVENT\r\n",
		"split UTF-8":    "BEGIN:VCALENDAR\r\nX:\xc3\r\n \xa4\r\nEND:VCALENDAR\r\n",
		"no CRLF at end": "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
	}
	for name, text := range bad {
		if _, err := Parse(text); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestDateAndUTC(t *testing.T) {
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	at := time.Date(2026, 11, 16, 1, 30, 0, 0, tokyo) // still 15 Nov in UTC
	if got := UTC(at); got != "20261115T163000Z" {
		t.Errorf("UTC = %s", got)
	}
	if got := Date(at); got != "20261116" {
		t.Errorf("Date keeps the local day: got %s", got)
	}
}
