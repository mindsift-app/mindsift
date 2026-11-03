package domain

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestExtractTagsIgnoresURLAnchors(t *testing.T) {
	cases := map[string][]string{
		"#start mitten #zwei":                             {"start", "zwei"},
		"siehe example.com/blog#ueberschrift":             {},
		"https://example.com/blog#ueberschrift und #echt": {"echt"},
		"[Link](https://x.de/#anker) #tag":                {"tag"},
		"(#inKlammern) C# ist kein Tag":                   {"inklammern"},
		"Zeile eins\n#zeilenanfang":                       {"zeilenanfang"},
		"#Doppelt #doppelt":                               {"doppelt"},
	}
	for in, want := range cases {
		got := ExtractTags(in)
		if len(got) == 0 && len(want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("ExtractTags(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestStaleAnchorTags(t *testing.T) {
	got := StaleAnchorTags("example.com/a#teil und #teil sowie x.de/#nur")
	if !reflect.DeepEqual(got, []string{"nur"}) {
		t.Fatalf("only tags that exist solely as anchors are stale, got %v", got)
	}
}

func TestSystemSettingsAcceptsPortAsNumberOrText(t *testing.T) {
	for _, body := range []string{`{"smtpPort": 465, "smtpHost": "mail"}`, `{"smtpPort": "465", "smtpHost": "mail"}`} {
		var s SystemSettings
		if err := json.Unmarshal([]byte(body), &s); err != nil {
			t.Fatalf("%s: %v", body, err)
		}
		if s.SMTPPort != "465" || s.SMTPHost != "mail" {
			t.Errorf("%s: got port %q host %q", body, s.SMTPPort, s.SMTPHost)
		}
	}
	var empty SystemSettings
	if err := json.Unmarshal([]byte(`{"smtpPort": ""}`), &empty); err != nil || empty.SMTPPort != "" {
		t.Errorf("empty port: %q (%v)", empty.SMTPPort, err)
	}
}
