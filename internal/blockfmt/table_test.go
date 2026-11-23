package blockfmt

import "testing"

func TestNormalizeTable(t *testing.T) {
	for in, want := range map[string]string{
		"| a | b |\n| --- | --- |\n| 1 | 2 |": "| a | b |\n| --- | --- |\n| 1 | 2 |",
		// outer pipes optional, alignment kept, missing cells added
		"a | b\n:-- | --:\n1":                 "| a | b |\n| :--- | ---: |\n| 1 |  |",
		"| a |\n| :-: |\n| 1 | 2 |":           "| a |  |\n| :---: | --- |\n| 1 | 2 |",
		"| [[Notiz#doc_1\\|Text]] |\n| --- |": "| [[Notiz#doc_1\\|Text]] |\n| --- |",
		"a | b\nc | d":                        "| a | b |\n| --- | --- |\n| c | d |",
		"":                                    "|  |\n| --- |",
	} {
		if got := NormalizeTable(in); got != want {
			t.Errorf("NormalizeTable(%q) = %q, want %q", in, got, want)
		}
	}
	if got := TableText("| Name | Wert |\n| --- | --- |\n| a\\|b |  |"); got != "Name · Wert\na|b" {
		t.Errorf("TableText: %q", got)
	}
}
