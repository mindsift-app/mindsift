package api

import (
	"encoding/json"
	"maps"
	"os"
	"slices"
	"strings"
	"testing"
)

// codeLanguagesFile is the editor's language list (CodeBlockEditor.tsx reads it); the Dockerfile copies it
// into the Go build for this test.
const codeLanguagesFile = "../../frontend/src/features/workspace/codeLanguages.json"

// The languages MCP accepts for code bullets are the editor's: the same ids, the same short names, and the
// tool description names every id.
func TestMCPCodeLanguagesMatchEditor(t *testing.T) {
	raw, err := os.ReadFile(codeLanguagesFile)
	if err != nil {
		t.Fatal(err)
	}
	var editor struct {
		Groups []struct {
			Options []struct {
				ID string `json:"id"`
			} `json:"options"`
		} `json:"groups"`
		Aliases map[string]string `json:"aliases"`
	}
	if err := json.Unmarshal(raw, &editor); err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, g := range editor.Groups {
		for _, o := range g.Options {
			ids = append(ids, o.ID)
		}
	}
	slices.Sort(ids)
	if mcp := slices.Sorted(maps.Keys(mcpCodeLanguages)); !slices.Equal(ids, mcp) {
		t.Errorf("language ids differ from %s:\neditor %v\nmcp    %v", codeLanguagesFile, ids, mcp)
	}
	if !maps.Equal(editor.Aliases, mcpCodeAliases) {
		t.Errorf("short names differ from %s:\neditor %v\nmcp    %v", codeLanguagesFile, editor.Aliases, mcpCodeAliases)
	}
	_, list, _ := strings.Cut(mcpCodeHelp, "for highlighting: ")
	list, _, _ = strings.Cut(list, " (")
	if named := slices.Sorted(slices.Values(strings.Split(list, ", "))); !slices.Equal(ids, named) {
		t.Errorf("the languages in mcpCodeHelp differ from %s:\neditor %v\nhelp   %v", codeLanguagesFile, ids, named)
	}
}
