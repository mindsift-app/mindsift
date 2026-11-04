package storage

import (
	"archive/zip"
	"bytes"
	"io"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mindsift-app/mindsift/internal/domain"
)

func TestBlocksToVaultMarkdown(t *testing.T) {
	md := BlocksToVaultMarkdown([]domain.DocumentBlock{
		{Type: "h2", Content: "Warum", Level: 0},
		{Type: "bullet", Content: "Strom sparen", Level: 1},
		{Type: "bullet", Content: "120 € im Jahr", Level: 2},
		{Type: "h1", Content: "Umzug", Level: 0},
		{Type: "bullet", Content: "Server", Level: 0},
		{Type: "todo", Content: "Backup ziehen", Checked: true, Level: 1},
		{Type: "bullet", Content: "Zeile 1\nZeile 2", Level: 1},
		{Type: "code", Content: "docker compose up -d", Lang: "bash", Level: 2},
		{Type: "divider", Level: 0},
		{Type: "code", Content: "echo hi", Lang: "sh", Level: 0},
	})
	want := []string{
		// children of a heading start a list at the margin, not an indented code block
		"## Warum\n\n- Strom sparen\n\t- 120 € im Jahr\n",
		"# Umzug\n\n- Server\n",
		"\t- [x] Backup ziehen\n",
		"\t- Zeile 1\n\t  Zeile 2\n",
		"\t\t```bash\n\t\tdocker compose up -d\n\t\t```\n",
		"\n---\n\n",
		"```sh\necho hi\n```\n",
	}
	for _, w := range want {
		if !strings.Contains(md, w) {
			t.Errorf("missing %q in:\n%s", w, md)
		}
	}
}

func TestWriteMarkdownVault(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "vault.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	openSharing(t, store)
	anna, _ := store.CreateUser("anna@example.com", "hash", "Anna", "member")
	ben, _ := store.CreateUser("ben@example.com", "hash", "Ben", "member")

	if _, err := store.CreateFolder(anna.ID, "Projekte/Leer"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	blocks := []domain.DocumentBlock{{ID: "b1", Type: "bullet", Content: "Inhalt", Level: 0}}
	// Note tags come from #hashtags in the text
	tagged := []domain.DocumentBlock{{ID: "b0", Type: "bullet", Content: "Inhalt #server", Level: 0}}
	_, _ = store.CreateDocument(anna.ID, "", "Homelab", "🖥️", "Projekte", tagged, nil, false)
	_, _ = store.CreateDocument(anna.ID, "", "Homelab", "🖥️", "Projekte", blocks, nil, false)
	_, _ = store.CreateDocument(anna.ID, "", "../../etc/passwd", "", "", blocks, nil, false)
	shared, _ := store.CreateDocument(ben.ID, "", "Von Ben", "", "", blocks, nil, false)
	_, _ = store.CreateDocument(ben.ID, "", "Bens Geheimnis", "", "", blocks, nil, false)
	if _, err := store.CreateDocShare(ben.ID, shared.ID, anna.ID, "read"); err != nil {
		t.Fatalf("share: %v", err)
	}

	tl, _ := store.CreateTaskList(anna.ID, "", "", "Haushalt", "🏠", "")
	task, _ := store.CreateThoughtWithDetails(anna.ID, "Fenster putzen", "high", "manual", "2026-11-02", tl.ID, "todo", "")
	_, _ = store.UpdateThoughtTriage(anna.ID, task.ID, "keep", "task", "", "2026-11-02", tl.ID)
	subs := []domain.SubTask{{ID: "s1", Title: "Leiter holen", IsCompleted: true}}
	_, _ = store.UpdateThoughtDetails(anna.ID, task.ID, nil, nil, nil, nil, nil, nil, nil, &subs, nil)
	list, _ := store.CreateList(anna.ID, "Einkauf", "🛒", "shopping")
	_, _ = store.CreateListItem(list.ID, "Milch", "Kühlregal", "2L", 0, anna.ID)

	var buf bytes.Buffer
	if err := store.WriteMarkdownVault(anna.ID, &buf); err != nil {
		t.Fatalf("WriteMarkdownVault: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	files := map[string]string{}
	for _, f := range zr.File {
		for _, part := range strings.Split(f.Name, "/") {
			if part == ".." || part == "." || strings.HasPrefix(f.Name, "/") {
				t.Errorf("unsafe path in archive: %q", f.Name)
			}
		}
		rc, _ := f.Open()
		data, _ := io.ReadAll(rc)
		rc.Close()
		files[f.Name] = string(data)
	}

	for _, name := range []string{"Projekte/Leer/", "Projekte/Homelab.md", "Projekte/Homelab (2).md", "Von Ben.md", "Aufgaben/Haushalt.md", "Listen/Einkauf.md"} {
		if _, ok := files[name]; !ok {
			t.Errorf("missing %q; archive has %v", name, keys(files))
		}
	}
	for name := range files {
		if strings.Contains(name, "Geheimnis") {
			t.Errorf("Ben's unshared note must not be exported: %q", name)
		}
	}
	tagged1, tagged2 := files["Projekte/Homelab.md"], files["Projekte/Homelab (2).md"]
	if !strings.Contains(tagged1+tagged2, "---\ntitle: \"Homelab\"\nicon: \"🖥️\"\ntags:\n  - \"server\"\n") {
		t.Errorf("frontmatter wrong:\n%s\n--- (2):\n%s", files["Projekte/Homelab.md"], files["Projekte/Homelab (2).md"])
	}
	if want := "- [ ] Fenster putzen ⏫ 📅 2026-11-02\n\t- [x] Leiter holen\n"; !strings.Contains(files["Aufgaben/Haushalt.md"], want) {
		t.Errorf("task line wrong:\n%s", files["Aufgaben/Haushalt.md"])
	}
	if !strings.Contains(files["Listen/Einkauf.md"], "- [ ] Milch (2L) #Kühlregal") {
		t.Errorf("list item wrong:\n%s", files["Listen/Einkauf.md"])
	}
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// Warnings and errors go out as Obsidian callouts and come back as the same block types
func TestWarningAndErrorBlocksRoundTrip(t *testing.T) {
	blocks := []domain.DocumentBlock{
		{Type: "warning", Content: "Strom vorher abschalten", Level: 0},
		{Type: "bullet", Content: "Server", Level: 0},
		{Type: "error", Content: "Backup fehlgeschlagen", Level: 1},
		{Type: "callout", Content: "Nur ein Hinweis", Level: 0},
	}
	md := BlocksToVaultMarkdown(blocks)
	for _, w := range []string{"> [!warning]\n> Strom vorher abschalten\n", "\t- > [!failure] Backup fehlgeschlagen\n", "> [!note]\n> Nur ein Hinweis\n"} {
		if !strings.Contains(md, w) {
			t.Errorf("missing %q in:\n%s", w, md)
		}
	}
	back := MarkdownToBlocks(md)
	var got []string
	for _, b := range back {
		got = append(got, b.Type+":"+b.Content)
	}
	want := []string{"warning:Strom vorher abschalten", "bullet:Server", "error:Backup fehlgeschlagen", "callout:Nur ein Hinweis"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("round trip: got %v, want %v", got, want)
	}
	// Other Obsidian kinds: caution is a warning, danger an error, tip a plain callout
	for md, typ := range map[string]string{"> [!caution] A": "warning", "> [!danger]\n> B": "error", "> [!tip] C": "callout"} {
		if b := MarkdownToBlocks(md); len(b) != 1 || b[0].Type != typ {
			t.Errorf("%q: got %+v, want type %s", md, b, typ)
		}
	}
}
