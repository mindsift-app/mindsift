package i18n

import "testing"

func TestNormalize(t *testing.T) {
	for tag, want := range map[string]string{"de": "de", "de-AT": "de", " DE_ch ": "de", "fr": "", "": ""} {
		if got := Normalize(tag); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", tag, got, want)
		}
	}
}

func TestMatch(t *testing.T) {
	saved := Supported
	defer func() { Supported = saved }()
	Supported = []string{"de", "en"}
	for header, want := range map[string]string{
		"de-DE,de;q=0.9,en;q=0.8":    "de",
		"fr-FR,en-US;q=0.7,de;q=0.5": "en",
		"en;q=0.3, de;q=0.6":         "de",
		"fr, it":                     "",
		"":                           "",
	} {
		if got := Match(header); got != want {
			t.Errorf("Match(%q) = %q, want %q", header, got, want)
		}
	}
}
