package storage

import "testing"

func TestParseWikiLink(t *testing.T) {
	for in, want := range map[string]wikiLink{
		"Homelab#doc_8f3a":               {Title: "Homelab", DocID: "doc_8f3a"},
		"Homelab#doc_8f3a|siehe hier":    {Title: "Homelab", DocID: "doc_8f3a", Label: "siehe hier"},
		"Homelab#doc_8f3a^blk_1_x":       {Title: "Homelab", DocID: "doc_8f3a", BlockID: "blk_1_x"},
		"Homelab#doc_8f3a^doc_8f3a-b0|T": {Title: "Homelab", DocID: "doc_8f3a", BlockID: "doc_8f3a-b0", Label: "T"},
		"Homelab":                        {Title: "Homelab"},
		"Homelab|hier":                   {Title: "Homelab", Label: "hier"},
		"Homelab#Abschnitt":              {Title: "Homelab"},
		"Homelab#^blk_a_1|Homelab › B":   {Title: "Homelab", BlockID: "blk_a_1", Label: "Homelab › B"},
	} {
		if got := parseWikiLink(in); got != want {
			t.Errorf("parseWikiLink(%q) = %+v, want %+v", in, got, want)
		}
	}
}

func TestWikiLinkBuildAndFormat(t *testing.T) {
	if got := noteLink("Homelab [neu]", "doc_1", ""); got != "[[Homelab neu#doc_1]]" {
		t.Errorf("noteLink: %q", got)
	}
	if got := noteLink("Homelab", "doc_1", "siehe | hier"); got != "[[Homelab#doc_1|siehe hier]]" {
		t.Errorf("noteLink with label: %q", got)
	}
	if got := blockLink("Homelab #1", "doc_1", "blk_x", ""); got != "[[Homelab 1#doc_1^blk_x]]" {
		t.Errorf("blockLink: %q", got)
	}
	for _, s := range []string{"[[Homelab#doc_1]]", "[[Homelab#doc_1^blk_2|Text]]", "[[Homelab]]", "[[Homelab#^blk_2|Text]]"} {
		if got := parseWikiLink(s[2 : len(s)-2]).format(); got != s {
			t.Errorf("format round trip: %q -> %q", s, got)
		}
	}
	if l, ok := noteLinkOnly("[[Garten#doc_1]] #draußen"); !ok || l.DocID != "doc_1" {
		t.Errorf("noteLinkOnly: %+v %v", l, ok)
	}
	if _, ok := noteLinkOnly("[[Garten#doc_1^blk_1]]"); ok {
		t.Error("a link to one bullet is not a link to the note")
	}
}
