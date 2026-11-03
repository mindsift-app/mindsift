package api

import (
	"net/http"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

// defaultLanguage: the admin's choice in the system settings, else DEFAULT_LANGUAGE, else German.
func (s *Server) defaultLanguage() string {
	if v := s.store.DefaultLanguageSetting(); v != "" {
		return v
	}
	if s.cfg.DefaultLanguage != "" {
		return s.cfg.DefaultLanguage
	}
	return i18n.Fallback
}

// requestLanguage: the browser's language when MindSift speaks it, else the default language. New
// accounts start with it.
func (s *Server) requestLanguage(r *http.Request) string {
	if v := i18n.Match(r.Header.Get("Accept-Language")); v != "" {
		return v
	}
	return s.defaultLanguage()
}
