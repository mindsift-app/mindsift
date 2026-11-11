package api

import (
	"net/http"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

// configuredLanguage: the admin's choice in the system settings, else DEFAULT_LANGUAGE, else "".
func (s *Server) configuredLanguage() string {
	if v := s.store.DefaultLanguageSetting(); v != "" {
		return v
	}
	return s.cfg.DefaultLanguage
}

// defaultLanguage: the configured language (see configuredLanguage), else German.
func (s *Server) defaultLanguage() string {
	if v := s.configuredLanguage(); v != "" {
		return v
	}
	return i18n.Fallback
}

// languageMiddleware decides the language of the answer: the app sends its language as Accept-Language,
// other clients their browser's or nothing (see answerLanguage). It is passed on as the Content-Language
// header, where writeError and tr read it.
func (s *Server) languageMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Language", s.answerLanguage(r))
		next.ServeHTTP(w, r)
	})
}

// answerLanguage: the browser's language when MindSift speaks it, else the configured default language,
// else English. Unlike requestLanguage it does not fall back to German: a script or curl without
// Accept-Language on a server nobody set a language for gets English errors.
func (s *Server) answerLanguage(r *http.Request) string {
	if v := i18n.Match(r.Header.Get("Accept-Language")); v != "" {
		return v
	}
	if v := s.configuredLanguage(); v != "" {
		return v
	}
	return "en"
}

// tr translates a text into the language of the answer (see languageMiddleware).
func tr(w http.ResponseWriter, msg string, args ...string) string {
	return i18n.T(w.Header().Get("Content-Language"), msg, args...)
}

// trErr is tr for an error; errors with placeholders (i18n.Localizer) keep their values.
func trErr(w http.ResponseWriter, err error) string {
	return i18n.Text(w.Header().Get("Content-Language"), err)
}

// userLanguage: the language messages to a person are written in (mails, push, summaries): their own
// choice, else the default language.
func (s *Server) userLanguage(userID string) string {
	if v := s.store.Language(userID); i18n.Valid(v) {
		return v
	}
	return s.defaultLanguage()
}

// requestLanguage: the browser's language when MindSift speaks it, else the default language. New
// accounts start with it, and index.html and manifest.json come in it.
func (s *Server) requestLanguage(r *http.Request) string {
	if v := i18n.Match(r.Header.Get("Accept-Language")); v != "" {
		return v
	}
	return s.defaultLanguage()
}
