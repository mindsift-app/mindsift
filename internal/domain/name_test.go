package domain

import "testing"

func TestCleanDisplayName(t *testing.T) {
	cases := map[string]string{
		"Anna Beispiel":            "Anna Beispiel",
		"  Anna  ":                 "Anna",
		"Anna\nBcc: x@example.com": "Anna Bcc: x@example.com",
		"Anna\r\n\r\nText":         "Anna Text",
		"A\tB\x00C\x1bD\u0085E":    "A B C D E",
		"A\u2028B\u2029C":          "A B C",
		"\n\nAnna\n":               "Anna",
		"👩\u200d💻 Ada":             "👩\u200d💻 Ada",
		"":                         "",
		// Bidirectional controls go, without leaving a gap
		"Anna\u202etxt.exe":              "Annatxt.exe",
		"\u202atxt\u202c \u202b\u202d":   "txt",
		"\u2066Ada\u2069 \u2067B\u2068C": "Ada BC",
		"Ad\u200ea\u200f\u061c":          "Ada",
		"\u202e":                         "",
		"A\u202e\nB":                     "A B",
		// A right-to-left name with a joiner keeps both
		"\u05e9\u05e8\u05d4 \u200d\u05db\u05d4\u05df": "\u05e9\u05e8\u05d4 \u200d\u05db\u05d4\u05df",
	}
	for in, want := range cases {
		if got := CleanDisplayName(in); got != want {
			t.Errorf("CleanDisplayName(%q) = %q, want %q", in, got, want)
		}
	}
}
