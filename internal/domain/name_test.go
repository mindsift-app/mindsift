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
	}
	for in, want := range cases {
		if got := CleanDisplayName(in); got != want {
			t.Errorf("CleanDisplayName(%q) = %q, want %q", in, got, want)
		}
	}
}
