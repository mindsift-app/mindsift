package importer

import (
	"encoding/json"
	"maps"
	"path"
	"regexp"
	"slices"
	"strings"

	"github.com/mindsift-app/mindsift/internal/blockfmt"
	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/drawing"
)

// --- Markdown parsing -------------------------------------------------------------------------------

type frontmatter struct {
	title, icon string
	tags        []string
}

// splitFrontmatter reads the few keys MindSift uses (title, icon, tags/tag) from YAML front matter.
// It is deliberately tolerant: unknown keys and nested structures are ignored.
func splitFrontmatter(text string) (frontmatter, string) {
	var fm frontmatter
	if !strings.HasPrefix(text, "---\n") {
		return fm, text
	}
	end := strings.Index(text[4:], "\n---")
	if end < 0 {
		return fm, text
	}
	head := text[4 : 4+end]
	body := strings.TrimLeft(text[4+end+4:], "\n")
	key := ""
	for _, line := range strings.Split(head, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- ") && (key == "tags" || key == "tag") {
			fm.tags = append(fm.tags, yamlScalar(trimmed[2:]))
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok || strings.HasPrefix(line, " ") {
			continue
		}
		key = strings.TrimSpace(strings.ToLower(k))
		v = strings.TrimSpace(v)
		switch key {
		case "title":
			fm.title = yamlScalar(v)
		case "icon":
			fm.icon = yamlScalar(v)
		case "tags", "tag":
			v = strings.Trim(v, "[]")
			for _, t := range strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ' ' }) {
				if t = yamlScalar(t); t != "" {
					fm.tags = append(fm.tags, t)
				}
			}
		}
	}
	return fm, body
}

func yamlScalar(v string) string {
	v = strings.TrimSpace(v)
	if strings.HasPrefix(v, `"`) {
		var out string
		if json.Unmarshal([]byte(v), &out) == nil {
			return out
		}
	}
	return strings.Trim(v, `"'`)
}

func missingTags(tags []string, body string) string {
	lower := strings.ToLower(body)
	var out []string
	for _, t := range tags {
		t = strings.TrimPrefix(strings.TrimSpace(t), "#")
		if t == "" || strings.Contains(lower, "#"+strings.ToLower(t)) {
			continue
		}
		out = append(out, "#"+strings.ReplaceAll(t, " ", "_"))
	}
	return strings.Join(out, " ")
}

var (
	listItemRe = regexp.MustCompile(`^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]+(.*))?$`)
	checkboxRe = regexp.MustCompile(`^\[([ xX])\][ \t]*(.*)$`)
	headingRe  = regexp.MustCompile(`^(#{1,6})[ \t]+(.*)$`)
	fenceRe    = regexp.MustCompile("^([ \\t]*)(```|~~~)(.*)$")
	calloutRe  = regexp.MustCompile(`^\[!([\w-]+)\][+-]?[ \t]*(.*)$`)
	// A fence as a list item's content ("- ```bash"): three or more backticks or tildes, then the language;
	// a backtick fence whose info holds a backtick is inline code, not a fence (CommonMark)
	itemFenceRe = regexp.MustCompile("^(?:(`{3,})[ \\t]*([^`]*)|(~{3,})[ \\t]*(.*))$")
)

// calloutType maps an Obsidian callout kind to a block type: warnings and failures keep their colour,
// every other kind (note, tip, quote …) becomes a plain callout.
func calloutType(kind string) string {
	switch strings.ToLower(kind) {
	case "warning", "caution", "attention":
		return "warning"
	case "failure", "fail", "missing", "danger", "error", "bug":
		return "error"
	}
	return "callout"
}

// codeBlock is a fenced block: a code block with the fence's language; a drawing copied or exported
// without its file comes back as a drawing.
func codeBlock(code, lang string, level int) domain.DocumentBlock {
	b := newBlock("code", code, level)
	b.Lang = lang
	if lang == drawing.Fence {
		if _, ok := drawing.Parse(b.Content); ok {
			b.Type, b.Lang = drawing.BlockType, ""
		}
	}
	return b
}

// itemFence reads the code of a fence that is a list item's content (lines[at], fence marker, content
// starting at column width): the lines indented at least that far, without that indentation. A closing
// fence ends it at any indentation; the first non-blank line indented less ends it too, without being
// taken (so an unclosed fence never swallows the bullets after it). Returns the code and the index of
// the last line it took.
func itemFence(lines []string, at int, marker string, width int) (string, int) {
	var code []string
	i := at + 1
	for ; i < len(lines); i++ {
		l := lines[i]
		t := strings.TrimSpace(l)
		if len(t) >= len(marker) && strings.Trim(t, marker[:1]) == "" {
			break
		}
		if t != "" && indentWidth(l[:len(l)-len(strings.TrimLeft(l, " \t"))]) < width {
			i--
			break
		}
		code = append(code, stripColumns(l, width))
	}
	for len(code) > 0 && strings.TrimSpace(code[len(code)-1]) == "" {
		code = code[:len(code)-1]
	}
	if i >= len(lines) {
		i = len(lines) - 1
	}
	return strings.Join(code, "\n"), i
}

// stripColumns takes up to n columns of leading spaces and tabs (a tab counts 4) off a line.
func stripColumns(s string, n int) string {
	w, k := 0, 0
	for k < len(s) && w < n && (s[k] == ' ' || s[k] == '\t') {
		if s[k] == '\t' {
			w += 4
		} else {
			w++
		}
		k++
	}
	return s[k:]
}

func newBlock(typ, content string, level int) domain.DocumentBlock {
	return domain.DocumentBlock{ID: domain.NewID("blk"), Type: typ, Content: content, Level: level}
}

// indentWidth counts a tab as 4 columns.
func indentWidth(s string) int {
	w := 0
	for _, r := range s {
		if r == '\t' {
			w += 4
		} else {
			w++
		}
	}
	return w
}

// MarkdownToBlocks turns Markdown into outliner blocks. Lists keep their nesting, headings start a
// section whose following content is nested below them (the reverse of the export), callouts and
// quotes become callout blocks, fenced code becomes a code block, Markdown tables become table blocks,
// plain paragraphs become bullets.
func MarkdownToBlocks(md string) []domain.DocumentBlock {
	blocks, _ := markdownToBlocks(md, 0)
	return blocks
}

// markdownToBlocks stops (ok false) as soon as there are more than limit blocks (0: no limit), so a
// note of countless short lines never turns into countless blocks in memory.
func markdownToBlocks(md string, limit int) (_ []domain.DocumentBlock, ok bool) {
	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	var blocks []domain.DocumentBlock
	base := 0          // level of content in the current heading section
	var headings []int // ranks (1–3) of the open headings: H2 below H1 nests one level deeper
	var indents []int  // indent widths of the open list levels
	inList := false    // the previous line belonged to a list item (for continuation lines)
	// A list right after a paragraph ("Folgende Punkte:") nests under that paragraph
	afterParagraph, listBase := false, 0
	listLevel := func(width int) int {
		if len(indents) == 0 {
			listBase = base
			if afterParagraph {
				listBase = base + 1
			}
		}
		for len(indents) > 0 && indents[len(indents)-1] > width {
			indents = indents[:len(indents)-1]
		}
		if len(indents) == 0 || indents[len(indents)-1] < width {
			indents = append(indents, width)
		}
		return listBase + len(indents) - 1
	}

	for i := 0; i < len(lines); i++ {
		if limit > 0 && len(blocks) > limit {
			return nil, false
		}
		line := lines[i]
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			inList = false
			continue
		}

		// Fenced code (also inside lists)
		if m := fenceRe.FindStringSubmatch(line); m != nil {
			fence, lang, prefix := m[2], strings.TrimSpace(m[3]), m[1]
			var code []string
			for i++; i < len(lines); i++ {
				l := lines[i]
				if strings.HasPrefix(strings.TrimSpace(l), fence) {
					break
				}
				code = append(code, strings.TrimPrefix(l, prefix))
			}
			level := base
			if prefix != "" && len(indents) > 0 {
				level = listLevel(indentWidth(prefix))
			}
			blocks = append(blocks, codeBlock(strings.Join(code, "\n"), lang, level))
			inList, afterParagraph = false, false
			continue
		}

		// A Markdown table (header, separator row, rows), also inside lists
		if blockfmt.IsTableStart(lines, i) {
			prefix := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			var rows []string
			for ; i < len(lines) && strings.TrimSpace(lines[i]) != "" && strings.Contains(lines[i], "|"); i++ {
				rows = append(rows, lines[i])
			}
			i--
			level := base
			if prefix != "" && len(indents) > 0 {
				level = listLevel(indentWidth(prefix))
			}
			blocks = append(blocks, newBlock("table", blockfmt.NormalizeTable(strings.Join(rows, "\n")), level))
			inList, afterParagraph = false, false
			continue
		}

		if m := headingRe.FindStringSubmatch(line); m != nil && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			typ := map[int]string{1: "h1", 2: "h2"}[len(m[1])]
			if typ == "" {
				typ = "h3"
			}
			rank := len(m[1])
			if rank > 3 {
				rank = 3
			}
			for len(headings) > 0 && headings[len(headings)-1] >= rank {
				headings = headings[:len(headings)-1]
			}
			blocks = append(blocks, newBlock(typ, strings.TrimSpace(m[2]), len(headings)))
			headings = append(headings, rank)
			base, indents, inList, afterParagraph = len(headings), nil, false, false
			continue
		}

		if trimmed == "---" || trimmed == "***" || trimmed == "___" {
			if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
				blocks = append(blocks, newBlock("divider", "", 0))
				base, headings, indents, inList, afterParagraph = 0, nil, nil, false, false
				continue
			}
		}

		// Quotes and Obsidian callouts (> [!note] …): one callout block; [!warning] and [!failure] keep
		// their kind as warning and error blocks
		if strings.HasPrefix(trimmed, ">") && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			var parts []string
			typ := "callout"
			for ; i < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i]), ">"); i++ {
				q := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(lines[i]), ">"))
				if m := calloutRe.FindStringSubmatch(q); m != nil {
					if len(parts) == 0 {
						typ = calloutType(m[1])
					}
					if q = strings.TrimSpace(m[2]); q == "" {
						continue
					}
				}
				parts = append(parts, q)
			}
			i--
			blocks = append(blocks, newBlock(typ, strings.Join(parts, "\n"), base))
			indents, inList, afterParagraph = nil, false, false
			continue
		}

		if m := listItemRe.FindStringSubmatch(line); m != nil {
			level := listLevel(indentWidth(m[1]))
			content := m[2]
			// A fence as the item's content ("- ```bash") opens a code block at the item's level
			if f := itemFenceRe.FindStringSubmatch(content); f != nil {
				var code string
				code, i = itemFence(lines, i, f[1]+f[3], indentWidth(line[:len(line)-len(content)]))
				blocks = append(blocks, codeBlock(code, strings.TrimSpace(f[2]+f[4]), level))
				inList, afterParagraph = false, false
				continue
			}
			typ := "bullet"
			if t := strings.TrimLeft(line, " \t"); t != "" && t[0] >= '0' && t[0] <= '9' {
				typ = "numbered"
			}
			checked := false
			if c := checkboxRe.FindStringSubmatch(content); c != nil {
				typ, checked, content = "todo", c[1] != " ", c[2]
			} else if h := headingRe.FindStringSubmatch(content); h != nil {
				typ = map[int]string{1: "h1", 2: "h2"}[len(h[1])]
				if typ == "" {
					typ = "h3"
				}
				content = strings.TrimSpace(h[2])
			} else if strings.TrimSpace(content) == "---" {
				typ, content = "divider", ""
			} else if strings.HasPrefix(content, "> ") {
				typ, content = "callout", strings.TrimPrefix(content, "> ")
				if c := calloutRe.FindStringSubmatch(content); c != nil {
					typ, content = calloutType(c[1]), c[2]
				}
			}
			b := newBlock(typ, content, level)
			b.Checked = checked
			blocks = append(blocks, b)
			inList = true
			continue
		}

		// Indented text right below a list item continues it (soft line break)
		if inList && (strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t")) && len(blocks) > 0 {
			last := &blocks[len(blocks)-1]
			last.Content += "\n" + strings.TrimPrefix(trimmed, "> ")
			continue
		}

		// Plain paragraph (consecutive lines form one block). The first line always belongs to it: an
		// indented "> …" lands here and must not end the paragraph before it starts (endless loop)
		var para []string
		for start := i; i < len(lines); i++ {
			l := strings.TrimSpace(lines[i])
			if i > start && (l == "" || headingRe.MatchString(lines[i]) || listItemRe.MatchString(lines[i]) || fenceRe.MatchString(lines[i]) || strings.HasPrefix(l, ">") || blockfmt.IsTableStart(lines, i)) {
				break
			}
			para = append(para, l)
		}
		i--
		blocks = append(blocks, newBlock("bullet", strings.Join(para, "\n"), base))
		indents, inList, afterParagraph = nil, false, true
	}
	return blocks, limit <= 0 || len(blocks) <= limit
}

var (
	recurRe    = regexp.MustCompile(`(?i)[ \t]*🔁[ \t]*every[ \t]+(weekday|day|week|month|year)\b`)
	dueRe      = regexp.MustCompile(`[ \t]*📅[ \t]*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?`)
	priorityRe = regexp.MustCompile(`[ \t]*(🔺|⏫|🔼|🔽|⏬)`)
)

// parseTaskFile reads a task list in Obsidian Tasks format as written by the export.
func parseTaskFile(body string) []Task {
	var tasks []Task
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		indented := strings.HasPrefix(line, "\t") || strings.HasPrefix(line, "  ")
		trimmed := strings.TrimSpace(line)
		if indented && len(tasks) > 0 {
			last := &tasks[len(tasks)-1]
			if strings.HasPrefix(trimmed, ">") {
				note := strings.TrimSpace(strings.TrimPrefix(trimmed, ">"))
				if last.Notes != "" {
					last.Notes += "\n"
				}
				last.Notes += note
			} else if m := listItemRe.FindStringSubmatch(trimmed); m != nil {
				if c := checkboxRe.FindStringSubmatch(m[2]); c != nil {
					last.Subtasks = append(last.Subtasks, domain.SubTask{ID: domain.NewID("st"), Title: c[2], IsCompleted: c[1] != " ", CreatedAt: domain.NowISO()})
				}
			}
			continue
		}
		m := listItemRe.FindStringSubmatch(trimmed)
		if m == nil {
			continue
		}
		t := Task{Content: m[2], Priority: "normal"}
		if c := checkboxRe.FindStringSubmatch(m[2]); c != nil {
			t.Done, t.Content = c[1] != " ", c[2]
		}
		if r := recurRe.FindStringSubmatch(t.Content); r != nil {
			t.Recurrence = map[string]string{"day": "daily", "weekday": "weekdays", "week": "weekly", "month": "monthly", "year": "yearly"}[strings.ToLower(r[1])]
			t.Content = recurRe.ReplaceAllString(t.Content, "")
		}
		if d := dueRe.FindStringSubmatch(t.Content); d != nil {
			t.Due = d[1]
			if d[2] != "" {
				t.Due += "T" + d[2]
			}
			t.Content = dueRe.ReplaceAllString(t.Content, "")
		}
		if p := priorityRe.FindStringSubmatch(t.Content); p != nil {
			t.Priority = map[string]string{"🔺": "urgent", "⏫": "high", "🔼": "high", "🔽": "low", "⏬": "low"}[p[1]]
			t.Content = priorityRe.ReplaceAllString(t.Content, "")
		}
		t.Content = strings.TrimSpace(t.Content)
		tasks = append(tasks, t)
	}
	return tasks
}

var quantityRe = regexp.MustCompile(`[ \t]*\(([^()]+)\)[ \t]*$`)

// parseListFile reads list entries "- [ ] Milk (2L) #fridge".
func parseListFile(body string) []Item {
	var items []Item
	for _, line := range strings.Split(body, "\n") {
		m := listItemRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil || strings.TrimSpace(m[2]) == "" {
			continue
		}
		it := Item{Content: m[2]}
		if c := checkboxRe.FindStringSubmatch(m[2]); c != nil {
			it.Done, it.Content = c[1] != " ", c[2]
		}
		// A trailing #Category is turned into the category by CreateListItem itself
		if q := quantityRe.FindStringSubmatch(stripTrailingTag(it.Content)); q != nil {
			it.Quantity = q[1]
			it.Content = strings.Replace(it.Content, q[0], "", 1)
		}
		it.Content = strings.TrimSpace(it.Content)
		items = append(items, it)
	}
	return items
}

func stripTrailingTag(s string) string {
	if i := strings.LastIndex(s, " #"); i >= 0 && !strings.Contains(s[i+2:], " ") {
		return s[:i]
	}
	return s
}

// folderPathOf returns the folder of a "/"-separated archive path with every part made safe.
func folderPathOf(p string) string {
	dir := path.Dir(p)
	if dir == "." || dir == "/" {
		return ""
	}
	parts := make([]string, 0)
	for _, part := range strings.Split(dir, "/") {
		if seg := Segment(part); seg != "" {
			parts = append(parts, seg)
		}
	}
	return strings.Join(parts, "/")
}

// folderList: the folder paths of an import in order, without the top level ("").
func folderList(folders map[string]bool) []string {
	delete(folders, "")
	return slices.Sorted(maps.Keys(folders))
}
