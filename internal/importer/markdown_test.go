package importer

import (
	"fmt"
	"strings"
	"testing"
)

func TestMarkdownHeadingsNestTheirSections(t *testing.T) {
	blocks := MarkdownToBlocks("# Projekt\nEinleitung\n## Teil A\n- Punkt\n  - Unterpunkt\n## Teil B\n1. Erstens\n# Anhang\nText")
	var got []string
	for _, b := range blocks {
		got = append(got, fmt.Sprintf("%d:%s:%s", b.Level, b.Type, b.Content))
	}
	want := []string{
		"0:h1:Projekt", "1:bullet:Einleitung", "1:h2:Teil A", "2:bullet:Punkt", "3:bullet:Unterpunkt",
		"1:h2:Teil B", "2:numbered:Erstens", "0:h1:Anhang", "1:bullet:Text",
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got  %v\nwant %v", got, want)
	}
}

func TestMarkdownListNestsUnderItsParagraph(t *testing.T) {
	blocks := MarkdownToBlocks("# Plan\nFolgende Punkte:\n\n- eins\n  - tiefer\n- zwei\n\nDanach Text\n\n1. a")
	var got []string
	for _, b := range blocks {
		got = append(got, fmt.Sprintf("%d:%s:%s", b.Level, b.Type, b.Content))
	}
	want := []string{"0:h1:Plan", "1:bullet:Folgende Punkte:", "2:bullet:eins", "3:bullet:tiefer", "2:bullet:zwei", "1:bullet:Danach Text", "2:numbered:a"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got  %v\nwant %v", got, want)
	}
}

// The MCP tools recommend an empty bullet (a line with just -) before a heading to set sections apart
func TestMarkdownEmptyBulletBeforeHeading(t *testing.T) {
	blocks := MarkdownToBlocks("# Einkauf\n- Milch\n-\n# Urlaub\n- Koffer")
	var got []string
	for _, b := range blocks {
		got = append(got, b.Type+":"+b.Content)
	}
	want := []string{"h1:Einkauf", "bullet:Milch", "bullet:", "h1:Urlaub", "bullet:Koffer"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// A fence as a list item's content ("- ```bash") is a code block at that item's level; its code is
// what is indented under the item, and an unclosed fence ends at the next line indented less.
func TestMarkdownFenceAfterListMarker(t *testing.T) {
	cases := []struct {
		name string
		md   string
		want []string
	}{
		{"with language", "- Install\n  - ```bash\n    npm ci\n    npm test\n    ```\n- next",
			[]string{"0:bullet::Install", "1:code:bash:npm ci\nnpm test", "0:bullet::next"}},
		{"without language", "- ```\n  a\n    b\n  ```\n- next",
			[]string{"0:code::a\n  b", "0:bullet::next"}},
		{"tildes", "- Setup\n  * ~~~ python\n    print(1)\n    ~~~\n- next",
			[]string{"0:bullet::Setup", "1:code:python:print(1)", "0:bullet::next"}},
		{"numbered item", "1. Build\n2. ```go\n   x := 1\n   ```\n3. Run",
			[]string{"0:numbered::Build", "0:code:go:x := 1", "0:numbered::Run"}},
		{"nested level", "- a\n  - b\n    - ```sh\n      ls\n      ```\n    - c\n  - d",
			[]string{"0:bullet::a", "1:bullet::b", "2:code:sh:ls", "2:bullet::c", "1:bullet::d"}},
		{"closing fence at the marker's indentation", "- x\n  - ```bash\n    npm ci\n  ```\n- next",
			[]string{"0:bullet::x", "1:code:bash:npm ci", "0:bullet::next"}},
		{"closing fence at column 0", "- ```bash\n  npm ci\n```\n- next",
			[]string{"0:code:bash:npm ci", "0:bullet::next"}},
		{"longer closing fence", "- ````md\n  ```\n  inner\n  ```\n  ````\n- next",
			[]string{"0:code:md:```\ninner\n```", "0:bullet::next"}},
		{"blank line inside the code", "- ```py\n  a = 1\n\n  b = 2\n  ```\n- next",
			[]string{"0:code:py:a = 1\n\nb = 2", "0:bullet::next"}},
		{"unclosed fence followed by bullets", "- Install\n  - ```bash\n    npm ci\n\n- next\n  - deeper",
			[]string{"0:bullet::Install", "1:code:bash:npm ci", "0:bullet::next", "1:bullet::deeper"}},
		{"unclosed fence at the end", "- ```bash\n  npm ci",
			[]string{"0:code:bash:npm ci"}},
		{"tabs", "- x\n\t- ```bash\n\t  npm ci\n\t    echo\n\t  ```\n- next",
			[]string{"0:bullet::x", "1:code:bash:npm ci\n  echo", "0:bullet::next"}},
		{"four spaces", "- x\n    - ```bash\n      npm ci\n      ```\n- next",
			[]string{"0:bullet::x", "1:code:bash:npm ci", "0:bullet::next"}},
		{"CRLF", "- Install\r\n  - ```bash\r\n    npm ci\r\n    ```\r\n- next\r\n",
			[]string{"0:bullet::Install", "1:code:bash:npm ci", "0:bullet::next"}},
		{"inline code stays text", "- ```x``` is inline\n- next",
			[]string{"0:bullet::```x``` is inline", "0:bullet::next"}},
		{"fence on its own line unchanged", "- Install\n  ```bash\n  npm ci\n  ```\n- next",
			[]string{"0:bullet::Install", "1:code:bash:npm ci", "0:bullet::next"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var got []string
			for _, b := range MarkdownToBlocks(c.md) {
				got = append(got, fmt.Sprintf("%d:%s:%s:%s", b.Level, b.Type, b.Lang, b.Content))
			}
			if strings.Join(got, "|") != strings.Join(c.want, "|") {
				t.Fatalf("got  %q\nwant %q", got, c.want)
			}
		})
	}
}

func TestImportTableAfterParagraphAndHeading(t *testing.T) {
	blocks := MarkdownToBlocks("## Preise\nÜbersicht:\n| Ding | Preis |\n|---|--:|\n| Brot | 3 |\nDanach")
	var got []string
	for _, b := range blocks {
		got = append(got, b.Type+"@"+string(rune('0'+b.Level))+":"+b.Content)
	}
	want := []string{"h2@0:Preise", "bullet@1:Übersicht:", "table@1:| Ding | Preis |\n| --- | ---: |\n| Brot | 3 |", "bullet@1:Danach"}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("got:\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	// A line with a pipe above a divider stays text
	if b := MarkdownToBlocks("a | b\n---"); len(b) == 0 || b[0].Type != "bullet" {
		t.Errorf("no table expected: %+v", b)
	}
}
