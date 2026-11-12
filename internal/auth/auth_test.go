package auth

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestValidatePassword(t *testing.T) {
	cases := map[string]error{
		"geheim12":                 nil,
		"äöüßäöüß":                 nil, // counts characters, not bytes
		"kurz":                     ErrPasswordTooShort,
		"        ":                 ErrPasswordTooShort,
		strings.Repeat("a", 73):    nil, // longer than bcrypt's 72 bytes: fine since the pre-hash
		strings.Repeat("ä", 1024):  nil, // 2048 bytes, but 1024 characters
		strings.Repeat("a", 1025):  ErrPasswordTooLong,
		"leer zeichen sind ok":     nil,
		strings.Repeat("ab ", 300): nil,
	}
	for pw, want := range cases {
		if got := ValidatePassword(pw); got != want {
			t.Errorf("ValidatePassword(%.20q…) = %v, want %v", pw, got, want)
		}
	}
}

func TestHashPasswordUsesThePrehashForm(t *testing.T) {
	h, err := HashPassword("geheim1234")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, passwordPrehashPrefix+"$2") {
		t.Fatalf("hash %q lacks the prefix", h)
	}
	if PasswordNeedsRehash(h) {
		t.Fatal("a new hash must not need a rehash")
	}
	if !CheckPassword("geheim1234", h) || CheckPassword("geheim12345", h) || CheckPassword("", h) {
		t.Fatal("check of the new form is wrong")
	}
}

// Passwords of earlier versions (plain bcrypt) keep working and are flagged for the new form.
func TestLegacyBcryptHashStillWorks(t *testing.T) {
	legacy, err := bcrypt.GenerateFromPassword([]byte("altes-passwort"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword("altes-passwort", string(legacy)) {
		t.Fatal("the right password must pass against an old hash")
	}
	if CheckPassword("altes-passwort!", string(legacy)) {
		t.Fatal("a wrong password must fail against an old hash")
	}
	if !PasswordNeedsRehash(string(legacy)) {
		t.Fatal("an old hash must be flagged for the new form")
	}
	if PasswordNeedsRehash("") {
		t.Fatal("no hash, nothing to rehash")
	}
}

// bcrypt alone ignores everything after byte 72; with the pre-hash every character counts.
func TestLongPasswordsDifferAfterByte72(t *testing.T) {
	base := strings.Repeat("x", 72)
	h, err := HashPassword(base + "A-rest-des-satzes")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(base+"A-rest-des-satzes", h) {
		t.Fatal("the long password must pass")
	}
	if CheckPassword(base+"B-rest-des-satzes", h) {
		t.Fatal("a password differing only at byte 73 must fail")
	}
	if CheckPassword(base, h) {
		t.Fatal("the first 72 bytes alone must fail")
	}
}
