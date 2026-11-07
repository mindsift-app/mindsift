package domain

import "testing"

// Addresses copied from a messenger carry invisible marks; they must compare like the typed address
func TestNormalizeEmail(t *testing.T) {
	for _, in := range []string{
		"schreiweislara21@gmail.com",
		" Schreiweislara21@Gmail.com ",
		"\u200eschreiweislara21@gmail.com",
		"schreiweislara21@gmail.com\u200b",
		"\ufeffschreiweislara21@gmail.com\u00a0",
		"schreiweislara21@gmail.com\u202c",
	} {
		if got := NormalizeEmail(in); got != "schreiweislara21@gmail.com" {
			t.Errorf("NormalizeEmail(%q) = %q", in, got)
		}
	}
}
