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
// examples in the tool description are ids of the editor.
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
	_, list, _ := strings.Cut(mcpCodeHelp, "language e.g. ")
	list, _, _ = strings.Cut(list, " (")
	named := strings.Split(list, ", ")
	if len(named) < 3 {
		t.Fatalf("no example languages in mcpCodeHelp: %q", list)
	}
	for _, name := range named {
		if !slices.Contains(ids, name) {
			t.Errorf("mcpCodeHelp names %q, which is no language id of %s", name, codeLanguagesFile)
		}
	}
}

// The advice in the descriptions holds: a fence on its own line becomes a code block with its language,
// below a bullet as its child, one block for the whole command sequence; backticks stay in the text.
func TestMCPCodeStyleExampleBecomesCodeBlock(t *testing.T) {
	blocks := mcpContentBlocks("- Install\n\t```bash\n\tnpm ci\n\tnpm test\n\t```\n- Run `npm ci` first")
	if len(blocks) != 3 {
		t.Fatalf("blocks: %+v", blocks)
	}
	if b := blocks[1]; b.Type != "code" || b.Lang != "bash" || b.Level != 1 || b.Content != "npm ci\nnpm test" {
		t.Errorf("code block: %+v", b)
	}
	if b := blocks[2]; b.Type != "bullet" || b.Content != "Run `npm ci` first" {
		t.Errorf("inline code: %+v", b)
	}
	for _, name := range []string{"create_note", "add_note_bullet", "update_note_bullet"} {
		tool, _ := mcpToolByName(name)
		if !strings.Contains(tool.Description, "`inline code`") {
			t.Errorf("%s: no advice on inline code", name)
		}
	}
}
