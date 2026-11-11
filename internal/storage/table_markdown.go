package storage

import "strings"

// Tables in notes (block type "table"): the content is a Markdown table in GitHub's style (header,
// separator row, rows), the block's lang its line mode. Counterpart of frontend/src/lib/markdownTable.ts:
// a "|" in a cell is written "\|", reading takes away only the backslash right in front of a pipe.

// splitTableRow returns the cells of one table line (outer pipes optional, cells trimmed).
func splitTableRow(line string) []string {
	s := strings.TrimSpace(line)
	s = strings.TrimPrefix(s, "|")
	if strings.HasSuffix(s, "|") && !strings.HasSuffix(s, `\|`) {
		s = strings.TrimSuffix(s, "|")
	}
	var cells []string
	var cur strings.Builder
	for i := 0; i < len(s); i++ {
		switch {
		case s[i] == '\\' && i+1 < len(s) && s[i+1] == '|':
			cur.WriteByte('|')
			i++
		case s[i] == '|':
			cells = append(cells, strings.TrimSpace(cur.String()))
			cur.Reset()
		default:
			cur.WriteByte(s[i])
		}
	}
	return append(cells, strings.TrimSpace(cur.String()))
}

// isTableSeparator: every cell dashes, optionally with colons for the alignment ("| --- | :-: |").
func isTableSeparator(line string) bool {
	if !strings.Contains(line, "-") {
		return false
	}
	for _, c := range splitTableRow(line) {
		c = strings.TrimSuffix(strings.TrimPrefix(c, ":"), ":")
		if c == "" || strings.Trim(c, "-") != "" {
			return false
		}
	}
	return true
}

// IsTableStart: a Markdown table starts at lines[i] (a line with a pipe, then a separator row with pipes
// and as many cells; a plain "---" below a line is a divider or a heading).
func IsTableStart(lines []string, i int) bool {
	if i+1 >= len(lines) {
		return false
	}
	head, sep := lines[i], lines[i+1]
	if !strings.Contains(head, "|") || !strings.Contains(sep, "|") || !isTableSeparator(sep) {
		return false
	}
	return len(splitTableRow(head)) == len(splitTableRow(sep))
}

// tableRows reads a table leniently: the line below the header is the separator when it looks like one,
// rows get as many cells as the widest one. Also returns the separator cells (alignment).
func tableRows(content string) (rows [][]string, separator []string) {
	var lines []string
	for _, l := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) == 0 {
		return [][]string{{""}}, []string{"---"}
	}
	body := lines[1:]
	if len(body) > 0 && isTableSeparator(body[0]) {
		separator = splitTableRow(body[0])
		body = body[1:]
	}
	cols := len(separator)
	for _, l := range append([]string{lines[0]}, body...) {
		r := splitTableRow(l)
		rows = append(rows, r)
		if len(r) > cols {
			cols = len(r)
		}
	}
	for i := range rows {
		for len(rows[i]) < cols {
			rows[i] = append(rows[i], "")
		}
	}
	for len(separator) < cols {
		separator = append(separator, "---")
	}
	for i, c := range separator {
		switch left, right := strings.HasPrefix(c, ":"), strings.HasSuffix(c, ":"); {
		case left && right:
			separator[i] = ":---:"
		case left:
			separator[i] = ":---"
		case right:
			separator[i] = "---:"
		default:
			separator[i] = "---"
		}
	}
	return rows, separator
}

// NormalizeTable writes a table the way the editor does: "| a | b |", the separator row, the rows, every
// row with the same number of cells and pipes in cells escaped.
func NormalizeTable(content string) string {
	rows, separator := tableRows(content)
	line := func(cells []string) string {
		out := make([]string, len(cells))
		for i, c := range cells {
			out[i] = strings.ReplaceAll(strings.ReplaceAll(c, "\n", " "), "|", `\|`)
		}
		return "| " + strings.Join(out, " | ") + " |"
	}
	lines := []string{line(rows[0]), "| " + strings.Join(separator, " | ") + " |"}
	for _, r := range rows[1:] {
		lines = append(lines, line(r))
	}
	return strings.Join(lines, "\n")
}

// TableText is the table as plain text (search results): cells joined by " · ", one row per line.
func TableText(content string) string {
	rows, _ := tableRows(content)
	var out []string
	for _, r := range rows {
		var cells []string
		for _, c := range r {
			if c != "" {
				cells = append(cells, c)
			}
		}
		if len(cells) > 0 {
			out = append(out, strings.Join(cells, " · "))
		}
	}
	return strings.Join(out, "\n")
}
