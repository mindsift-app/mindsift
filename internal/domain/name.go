package domain

import (
	"strings"
	"unicode"
)

// CleanDisplayName: a name as it is stored and shown in one line (mails, push, chat messages). Control
// characters (line breaks, tabs, escapes) and line or paragraph separators become a single space, so a
// name cannot start a line of its own in the plain-text part of a mail. Format characters such as the
// zero-width joiner stay: emoji sequences need them.
func CleanDisplayName(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	gap := false
	for _, r := range s {
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
