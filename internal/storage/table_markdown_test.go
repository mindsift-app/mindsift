package storage

import (
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/importer"
)

func TestTableAlignmentRoundTrip(t *testing.T) {
	// Every alignment of the separator row survives normalizing (again and again), the export and the import
	table := "| Name | Menge | Preis | Notiz |\n| --- | :---: | ---: | :--- |\n| Brot | 2 | 3,50 | frisch |"
	if got := blockfmt.NormalizeTable(table); got != table {
		t.Fatalf("blockfmt.NormalizeTable lost the alignment: %q", got)
	}
	if got := blockfmt.NormalizeTable(blockfmt.NormalizeTable(table)); got != table {
		t.Errorf("blockfmt.NormalizeTable is not stable: %q", got)
	}
	// Short and long forms read the same
	if got := blockfmt.NormalizeTable("a | b | c\n:-: | -: | :-\n1 | 2 | 3"); got != "| a | b | c |\n| :---: | ---: | :--- |\n| 1 | 2 | 3 |" {
		t.Errorf("short separators: %q", got)
	}
	md := BlocksToVaultMarkdown([]domain.DocumentBlock{{Type: "table", Content: table, Level: 0}, {Type: "bullet", Content: "Danach", Level: 0}})
	blocks := importer.MarkdownToBlocks(md)
	if len(blocks) == 0 || blocks[0].Type != "table" || blocks[0].Content != table {
		t.Errorf("export and import lost the alignment:\n%q\n%+v", md, blocks)
	}
	// Tables without colons stay left (no alignment written)
	if got := blockfmt.NormalizeTable("| a | b |\n|---|---|"); got != "| a | b |\n| --- | --- |" {
		t.Errorf("plain table: %q", got)
	}
}

func TestTablesInVaultMarkdown(t *testing.T) {
	table := "| Name | Wert |\n| --- | --- |\n| a | 1 |"
	md := BlocksToVaultMarkdown([]domain.DocumentBlock{
		{Type: "table", Content: table, Lang: "grid", Level: 0},
		{Type: "bullet", Content: "Kind", Level: 1},
		{Type: "bullet", Content: "Liste", Level: 0},
		{Type: "table", Content: table, Level: 1},
		{Type: "bullet", Content: "Weiter", Level: 1},
	})
	want := "| Name | Wert |\n| --- | --- |\n| a | 1 |\n\n- Kind\n- Liste\n\n\t| Name | Wert |\n\t| --- | --- |\n\t| a | 1 |\n\n\t- Weiter\n"
	if md != want {
		t.Errorf("vault markdown:\n%q\nwant\n%q", md, want)
	}

	// Imported again, the tables come back on their levels
	var got []string
	for _, b := range importer.MarkdownToBlocks(md) {
		got = append(got, b.Type+"@"+string(rune('0'+b.Level))+":"+b.Content)
	}
	wantBlocks := []string{"table@0:" + table, "bullet@0:Kind", "bullet@0:Liste", "table@1:" + table, "bullet@1:Weiter"}
	if strings.Join(got, "\n") != strings.Join(wantBlocks, "\n") {
		t.Errorf("imported:\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(wantBlocks, "\n"))
	}
}

func TestWikiLinksInTables(t *testing.T) {
	if l := parseWikiLink(`Homelab#doc_8f3a\|hier`); l != (wikiLink{Title: "Homelab", DocID: "doc_8f3a", Label: "hier"}) {
		t.Errorf("escaped pipe: %+v", l)
	}
	table := "| Link |\n| --- |\n| [[Homelab#doc_8f3a\\|hier]] |"
	// Readable for agents and the export, and the table keeps its cells
	got := ReadableWikiLinks(table, map[string]string{"doc_8f3a": "Homelab neu"})
	if got != "| Link |\n| --- |\n| [[Homelab neu\\|hier]] |" {
		t.Errorf("ReadableWikiLinks: %q", got)
	}
	if back := KeepWikiLinkIDs(table, got, map[string]string{"doc_8f3a": "Homelab neu"}); back != "| Link |\n| --- |\n| [[Homelab neu#doc_8f3a\\|hier]] |" {
		t.Errorf("KeepWikiLinkIDs: %q", back)
	}
}

func TestSearchFindsTablesByTheirCells(t *testing.T) {
	store, userA, _ := setupTestStore(t)
	defer store.Close()
	blocks := []domain.DocumentBlock{{ID: "tbl1", Type: "table", Content: "| Gerät | Watt |\n| --- | --- |\n| Waschmaschine | 2000 |"}}
	if _, err := store.CreateDocument(userA.ID, "", "Strom", "", "", blocks, nil, false); err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	res, err := store.SearchGlobal(userA.ID, "Waschmaschine")
	if err != nil || len(res.Hits) == 0 {
		t.Fatalf("table cell not found: %v %+v", err, res)
	}
	if res.Hits[0].Content != "Gerät · Watt\nWaschmaschine · 2000" {
		t.Errorf("hit shows %q", res.Hits[0].Content)
	}
	if strings.Contains(res.Hits[0].Snippet, "|") || strings.Contains(res.Hits[0].Snippet, "---") {
		t.Errorf("snippet with table syntax: %q", res.Hits[0].Snippet)
	}
}
