package i18n

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// Server texts that reach people: error answers, translated texts and errors of the storage layer
var textCall = regexp.MustCompile(`(?:writeError\(w, [^,]+, |writeErrorCode\(w, [^,]+, "[a-z_]+", |\btr\(w, |i18n\.T\("?[\w.()]*"?, |i18n\.NewError\(|errors\.New\(|fmt\.Errorf\(|toolError\(|jsonrpcError\{\w+, )"((?:[^"\\]|\\.)*)"(\s*\+)?`)

// German texts are recognised by umlauts or common German words; English internal errors stay as they are
var germanWords = regexp.MustCompile(`(?i)[äöüß]|\b(der|die|das|dem|den|des|ein|eine|einen|nicht|kein|keine|ist|und|oder|für|mit|zu|bitte|Bitte|wurde|konnte|nur|Nur|fehlt|erforderlich|Ungültig\w*|ungültig\w*|gefunden|Fehler|Benutzer|Liste|Aufgabe|Notiz|Datei|Gruppe|Sitzung|Zugriff|Berechtigung|Anfrage|Passwort|fehlgeschlagen|abgebrochen|unbekannt\w*|existiert|bereits|erlaubt|Aufgaben|Notizen|Rechte|Fehler\w*)\b`)

// germanTexts collects the German texts of the server code with the place they appear first.
func germanTexts(t *testing.T) map[string]string {
	t.Helper()
	found := map[string]string{}
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		// Seed and demo content is per language as a whole (step 5), not through the catalog
		base := filepath.Base(path)
		if strings.HasPrefix(base, "seed") || base == "demo.go" || strings.HasPrefix(base, "messages_") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "//") || strings.Contains(line, "slog.") {
				continue
			}
			for _, m := range textCall.FindAllStringSubmatch(line, -1) {
				text := m[1]
				// fmt.Errorf("Kontext: %w", err) works like "Kontext: " + err
				if trimmed := strings.TrimSuffix(strings.TrimSuffix(text, ": %w"), ": %v"); trimmed != text && !strings.Contains(trimmed, "%") {
					text = trimmed
				}
				// "Kontext: " + err: the context alone is the key (T translates both parts)
				if m[2] != "" {
					text = strings.TrimSuffix(strings.TrimSpace(text), ":")
				}
				if strings.Contains(text, "%") || !germanWords.MatchString(text) {
					continue
				}
				if _, ok := found[text]; !ok {
					found[text] = path + ":" + strconv.Itoa(i+1)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

// Every German server text has a translation in every catalog, so nothing shows up in German by accident.
func TestCatalogsCoverServerTexts(t *testing.T) {
	texts := germanTexts(t)
	if len(texts) < 100 {
		t.Fatalf("found only %d texts; the scan is broken", len(texts))
	}
	for _, lang := range CatalogLanguages() {
		var missing []string
		for text, where := range texts {
			if !Has(lang, text) {
				missing = append(missing, where+"\t"+text)
			}
		}
		sort.Strings(missing)
		if len(missing) > 0 {
			t.Errorf("%s lacks %d texts:\n%s", lang, len(missing), strings.Join(missing, "\n"))
		}
	}
}

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
