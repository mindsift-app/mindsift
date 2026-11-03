package i18n

import "errors"

// Localizer is an error that can say itself in another language, keeping values like a folder name
// that a translation of its finished text could not find again.
type Localizer interface {
	error
	Localize(lang string) string
}

// Error is a Localizer from a catalog text with placeholders (see T).
type Error struct {
	Msg  string
	Args []string
}

func NewError(msg string, args ...string) *Error { return &Error{Msg: msg, Args: args} }

func (e *Error) Error() string { return T(Fallback, e.Msg, e.Args...) }

func (e *Error) Localize(lang string) string { return T(lang, e.Msg, e.Args...) }

// Text returns err in lang: a Localizer (unless wrapped with more context) says itself, anything else
// goes through the catalog.
func Text(lang string, err error) string {
	var l Localizer
	if errors.As(err, &l) && l.Error() == err.Error() {
		return l.Localize(lang)
	}
	return T(lang, err.Error())
}
