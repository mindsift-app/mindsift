package storage

import (
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// seedNote is one sample note of the demo's knowledge base: where it lives, its hashtags and its outline
// in the compact form seedOutline reads.
type seedNote struct {
	title, folder string
	tags          []string
	outline       string
}

// seedOutline turns a compact text into bullets, one per line, so the many sample notes stay readable:
//
//	two spaces per level, then the line starts with
//	"# ", "## ", "### "  headings        "- [ ] " / "- [x] "  checkbox
//	"- "  bullet          "1. "  numbered item        "> " callout        "! " warning
//	"---" divider         "| a | b |" lines  one table      "~~~lang" … "~~~"  code
//
// Tabs in front of a line are the indentation of the Go source and are ignored.
func seedOutline(text string) []seedBlock {
	var out []seedBlock
	var table []string
	tableLevel := 0
	flushTable := func() {
		if len(table) > 0 {
			out = append(out, seedBlock{level: tableLevel, typ: "table", text: NormalizeTable(strings.Join(table, "\n"))})
			table = nil
		}
	}
	lines := strings.Split(strings.Trim(text, "\n"), "\n")
	for i := 0; i < len(lines); i++ {
		line := strings.TrimRight(strings.TrimLeft(lines[i], "\t"), " \t")
		if line == "" {
			continue
		}
		trimmed := strings.TrimLeft(line, " ")
		level := (len(line) - len(trimmed)) / 2
		if strings.HasPrefix(trimmed, "|") {
			if len(table) == 0 {
				tableLevel = level
			}
			table = append(table, trimmed)
			continue
		}
		flushTable()
		b := seedBlock{level: level}
		switch {
		case strings.HasPrefix(trimmed, "~~~"):
			b.typ, b.lang = "code", strings.TrimPrefix(trimmed, "~~~")
			var code []string
			for i++; i < len(lines) && strings.TrimSpace(lines[i]) != "~~~"; i++ {
				// The code is indented like its fence: drop that much
				code = append(code, strings.TrimPrefix(strings.TrimLeft(lines[i], "\t"), strings.Repeat(" ", level*2)))
			}
			b.text = strings.Join(code, "\n")
		case trimmed == "---":
			b.typ = "divider"
		case strings.HasPrefix(trimmed, "### "):
			b.typ, b.text = "h3", trimmed[4:]
		case strings.HasPrefix(trimmed, "## "):
			b.typ, b.text = "h2", trimmed[3:]
		case strings.HasPrefix(trimmed, "# "):
			b.typ, b.text = "h1", trimmed[2:]
		case strings.HasPrefix(trimmed, "- [ ] "):
			b.typ, b.text = "todo", trimmed[6:]
		case strings.HasPrefix(trimmed, "- [x] "):
			b.typ, b.text, b.checked = "todo", trimmed[6:], true
		case strings.HasPrefix(trimmed, "- "):
			b.text = trimmed[2:]
		case strings.HasPrefix(trimmed, "1. "):
			b.typ, b.text = "numbered", trimmed[3:]
		case strings.HasPrefix(trimmed, "> "):
			b.typ, b.text = "callout", trimmed[2:]
		case strings.HasPrefix(trimmed, "! "):
			b.typ, b.text = "warning", trimmed[2:]
		default:
			b.text = trimmed
		}
		out = append(out, b)
	}
	flushTable()
	return out
}

// seedKnowledgeBase fills the demo with the notes of a person who keeps a lot in MindSift: work, projects,
// recipes, reading notes, travel, a journal. They link each other with [[…]] and share hashtags, so the
// backlinks, the hashtag pages and the search have something to show. No icons: they get the standard one.
func (s *Store) seedKnowledgeBase(user *domain.User, notes []seedNote) {
	for _, n := range notes {
		if n.folder != "" {
			_, _ = s.CreateFolder(user.ID, n.folder)
		}
		_, _ = s.CreateDocument(user.ID, "", n.title, "", n.folder, seedBlocks(seedOutline(n.outline)), n.tags, false)
	}
}
