package i18n

import "log/slog"

// LogInEnglish is a slog ReplaceAttr that writes errors in English. An error a person may read is a
// German catalog text (see Doku/i18n.md); in the server log it appears translated, like everything else
// there. Errors that are no catalog text (SQL, I/O, protocol replies) stay as they are.
func LogInEnglish(_ []string, a slog.Attr) slog.Attr {
	if a.Value.Kind() != slog.KindAny {
		return a
	}
	if err, ok := a.Value.Any().(error); ok && err != nil {
		return slog.String(a.Key, Text("en", err))
	}
	return a
}
