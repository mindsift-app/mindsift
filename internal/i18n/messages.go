package i18n

import "strings"

// Server texts are written in German in the code; the German text is the key of every other language's
// catalog (like gettext). {name} marks a placeholder filled by T. A new language adds its catalog here.
var catalogs = map[string]map[string]string{
	"en": messagesEN,
}

// T returns msg in lang with the placeholders filled from name/value pairs. German, an unknown language
// or a text without translation give msg itself. A text "context: detail" without its own entry is
// translated part by part, so wrapped errors ("SMTP-Fehler: …") work too.
func T(lang, msg string, args ...string) string {
	out := translate(lang, msg)
	for i := 0; i+1 < len(args); i += 2 {
		out = strings.ReplaceAll(out, "{"+args[i]+"}", args[i+1])
	}
	return out
}

func translate(lang, msg string) string {
	catalog, ok := catalogs[lang]
	if !ok || msg == "" {
		return msg
	}
	if tr, ok := catalog[msg]; ok {
		return tr
	}
	if i := strings.Index(msg, ": "); i > 0 {
		return translate(lang, msg[:i]) + ": " + translate(lang, msg[i+2:])
	}
	return msg
}

// Has reports whether lang has its own text for msg (German always has).
func Has(lang, msg string) bool {
	if lang == Fallback {
		return true
	}
	_, ok := catalogs[lang][msg]
	return ok
}

// Languages with a server catalog besides German.
func CatalogLanguages() []string {
	out := make([]string, 0, len(catalogs))
	for _, l := range Supported {
		if _, ok := catalogs[l]; ok {
			out = append(out, l)
		}
	}
	return out
}
