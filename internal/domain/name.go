package domain

import (
	"strings"
	"unicode"
)

// CleanDisplayName: a name as it is stored and shown in one line (mails, push, chat messages). Control
// characters (line breaks, tabs, escapes) and line or paragraph separators become a single space, so a
// name cannot start a line of its own in the plain-text part of a mail. Bidirectional controls are
// dropped: an override or isolate in a name turns the text after it around (U+202E shows the rest of the
// line backwards, "exe.txt" as "txt.exe"), and the invisible marks make two names that look alike differ.
// Other format characters such as the zero-width joiner stay: emoji sequences need them.
func CleanDisplayName(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	gap := false
	for _, r := range s {
		if bidiControl(r) {
			continue
		}
		if unicode.IsControl(r) || unicode.In(r, unicode.Zl, unicode.Zp) {
			gap = true
			continue
		}
		if gap {
			b.WriteByte(' ')
			gap = false
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// bidiControl: the embeddings and overrides U+202A–U+202E, the isolates U+2066–U+2069 and the marks
// U+200E, U+200F and U+061C.
func bidiControl(r rune) bool {
	return (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069) || r == 0x200E || r == 0x200F || r == 0x061C
}
