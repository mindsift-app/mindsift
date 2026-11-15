package i18n

import (
	"regexp"
	"sort"
	"strings"
	"testing"
)

// That every German server text has a translation is checked by i18ncheck (catalog_test.go here and in
// internal/api and internal/storage).

// Placeholders of a translation are the ones of the German text.
func TestCatalogPlaceholders(t *testing.T) {
	ph := regexp.MustCompile(`\{\w+\}`)
	for lang, catalog := range catalogs {
		for de, tr := range catalog {
			a, b := ph.FindAllString(de, -1), ph.FindAllString(tr, -1)
			sort.Strings(a)
			sort.Strings(b)
			if strings.Join(a, ",") != strings.Join(b, ",") {
				t.Errorf("%s: %q has placeholders %v, translation %v", lang, de, a, b)
			}
		}
	}
}

func TestT(t *testing.T) {
	saved := catalogs
	defer func() { catalogs = saved }()
	catalogs = map[string]map[string]string{"en": {"Hallo {name}": "Hello {name}", "SMTP-Fehler": "SMTP error", "Verbindung abgelehnt": "Connection refused"}}
	for _, c := range []struct{ lang, msg, want string }{
		{"en", "Hallo {name}", "Hello Ada"},
		{"de", "Hallo {name}", "Hallo Ada"},
		{"fr", "Hallo {name}", "Hallo Ada"},
		{"en", "SMTP-Fehler: Verbindung abgelehnt", "SMTP error: Connection refused"},
		{"en", "SMTP-Fehler: dial tcp: timeout", "SMTP error: dial tcp: timeout"},
		{"en", "Unbekannt", "Unbekannt"},
	} {
		if got := T(c.lang, c.msg, "name", "Ada"); got != c.want {
			t.Errorf("T(%q, %q) = %q, want %q", c.lang, c.msg, got, c.want)
		}
	}
}
