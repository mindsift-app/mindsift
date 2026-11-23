// Package i18ncheck finds German server texts that lack a translation in one of the catalogs of
// internal/i18n. Only tests import it: the check runs in internal/i18n and also in internal/api,
// internal/storage and internal/importer, where most texts live. A change there is tested with its own
// package while working (targeted checks), so a missing translation shows up then, not only in the image
// build that tests all packages.
package i18ncheck

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

// Server texts that reach people: error answers, translated texts and errors of the storage layer
var textCall = regexp.MustCompile(`(?:writeError\(w, [^,]+, |writeErrorCode\(w, [^,]+, "[a-z_]+", |\btr\(w, |i18n\.T\("?[\w.()]*"?, |i18n\.NewError\(|errors\.New\(|fmt\.Errorf\(|toolError\(|writeOAuthError\(w, [^,]+, "[a-z_]+", |\brpcError\(\w+, |\.[sS]kip\([^,]+, )"((?:[^"\\]|\\.)*)"(\s*\+)?`)

// German texts are recognised by umlauts or common German words; English internal errors stay as they are
var germanWords = regexp.MustCompile(`(?i)[äöüß]|\b(der|die|das|dem|den|des|ein|eine|einen|nicht|kein|keine|ist|und|oder|für|mit|zu|bitte|Bitte|wurde|konnte|nur|Nur|fehlt|erforderlich|Ungültig\w*|ungültig\w*|gefunden|Fehler|Benutzer|Liste|Aufgabe|Notiz|Datei|Gruppe|Sitzung|Zugriff|Berechtigung|Anfrage|Passwort|fehlgeschlagen|abgebrochen|unbekannt\w*|existiert|bereits|erlaubt|Aufgaben|Notizen|Rechte|Fehler\w*)\b`)

// moduleRoot is the directory with go.mod above the working directory (a test runs in its package's).
func moduleRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("go.mod not found")
		}
		dir = parent
	}
}

// GermanTexts collects the German texts of the server code (internal/ and cmd/) with the place they
// appear first, relative to the module root.
func GermanTexts() (map[string]string, error) {
	root, err := moduleRoot()
	if err != nil {
		return nil, err
	}
	found := map[string]string{}
	for _, top := range []string{"internal", "cmd"} {
		err := filepath.WalkDir(filepath.Join(root, top), func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				// The built frontend (cmd/server/dist) holds no Go code
				if d.Name() == "dist" || d.Name() == "node_modules" {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			// Seed and demo content is per language as a whole, not through the catalog
			base := filepath.Base(path)
			if strings.HasPrefix(base, "seed") || base == "demo.go" || strings.HasPrefix(base, "messages_") {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			rel, _ := filepath.Rel(root, path)
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
						found[text] = rel + ":" + strconv.Itoa(i+1)
					}
				}
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return found, nil
}

// CatalogsCoverServerTexts fails t for every German server text without a translation in a catalog, so
// nothing shows up in German by accident.
func CatalogsCoverServerTexts(t testing.TB) {
	t.Helper()
	texts, err := GermanTexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(texts) < 100 {
		t.Fatalf("found only %d texts; the scan is broken", len(texts))
	}
	for _, lang := range i18n.CatalogLanguages() {
		var missing []string
		for text, where := range texts {
			if !i18n.Has(lang, text) {
				missing = append(missing, where+"\t"+text)
			}
		}
		sort.Strings(missing)
		if len(missing) > 0 {
			t.Errorf("%s lacks %d texts (internal/i18n/messages_%s.go):\n%s", lang, len(missing), lang, strings.Join(missing, "\n"))
		}
	}
}
