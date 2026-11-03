// Package i18n holds the languages MindSift speaks. The web app has its own texts (frontend/src/locales);
// this package decides which language a person or a request gets.
package i18n

import (
	"strconv"
	"strings"
)

// Fallback is the language of the source texts; it is used whenever nothing else fits.
const Fallback = "de"

// Supported lists the languages with complete texts, in the order the app offers them. Keep it in step
// with LANGUAGES in frontend/src/i18n/index.ts.
var Supported = []string{"de"}

// Valid reports whether lang is a supported language code.
func Valid(lang string) bool {
	for _, l := range Supported {
		if l == lang {
			return true
		}
	}
	return false
}

// Normalize turns a language tag like "de-AT" or "EN_us" into a supported code, or "" when there is none.
func Normalize(tag string) string {
	tag = strings.ToLower(strings.TrimSpace(tag))
	if i := strings.IndexAny(tag, "-_"); i >= 0 {
		tag = tag[:i]
	}
	if Valid(tag) {
		return tag
	}
	return ""
}

// Match picks the best supported language from an Accept-Language header, or "" when none fits.
func Match(acceptLanguage string) string {
	best, bestQ := "", 0.0
	for _, part := range strings.Split(acceptLanguage, ",") {
		fields := strings.Split(part, ";")
		lang := Normalize(fields[0])
		if lang == "" {
			continue
		}
		q := 1.0
		for _, f := range fields[1:] {
			if v, ok := strings.CutPrefix(strings.TrimSpace(f), "q="); ok {
				if n, err := strconv.ParseFloat(v, 64); err == nil {
					q = n
				}
			}
		}
		if q > bestQ {
			best, bestQ = lang, q
		}
	}
	return best
}
