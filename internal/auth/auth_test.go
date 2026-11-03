package auth

import (
	"strings"
	"testing"
)

func TestValidatePassword(t *testing.T) {
	cases := map[string]error{
		"geheim12":              nil,
		"äöüßäöüß":              nil, // counts characters, not bytes
		"kurz":                  ErrPasswordTooShort,
		"        ":              ErrPasswordTooShort,
		strings.Repeat("a", 73): ErrPasswordTooLong,
		"leer zeichen sind ok":  nil,
	}
	for pw, want := range cases {
		if got := ValidatePassword(pw); got != want {
			t.Errorf("ValidatePassword(%q) = %v, want %v", pw, got, want)
		}
	}
}
