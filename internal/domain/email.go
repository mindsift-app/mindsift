package domain

import (
	"strings"
	"unicode"
)

// NormalizeEmail: an address as it is stored and compared: lower case, without spaces and without
// invisible format characters (left-to-right marks, zero-width spaces, BOM), which come along when an
// address is copied from a messenger or a mail and make two addresses that look the same differ.
func NormalizeEmail(s string) string {
	return strings.ToLower(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s))
}
