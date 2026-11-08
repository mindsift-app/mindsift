package drawing

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// Mermaid input (for agents): a subset of flowchart/graph and mindmap. The server lays it out itself
// (layout.go), so a diagram written as text becomes an ordinary drawing the editor can change.

var (
	// ErrMermaidKind: the text is no flowchart, graph or mindmap
	ErrMermaidKind = errors.New("Mermaid: nur flowchart/graph und mindmap werden unterstützt")
	// ErrMermaidEmpty: no node could be read
	ErrMermaidEmpty = errors.New("Mermaid: keine Knoten gefunden")
)

// maxGraphNodes keeps a diagram inside the size limit of a block
const maxGraphNodes = 150

type graphNode struct {
	id, text, shape string
	stroke, fill    string // theme roles, empty = default
	classes         []string
}

type graphEdge struct {
	from, to, label string
	dashed, thick   bool
	head            int // 0 none, 1 start, 2 end, 3 both
	stroke          string
}

type graph struct {
	dir   string // TD, BT, LR, RL
	nodes []*graphNode
	byID  map[string]*graphNode
	edges []*graphEdge
}

type mindNode struct {
	text, shape string
	children    []*mindNode
	depth       int
}

// IsMermaid tells whether text looks like Mermaid this package reads
func IsMermaid(text string) bool {
	head, _ := mermaidHeader(text)
	return head != ""
}

func mermaidLines(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(text, "\n")
	// A fenced block as a whole (```mermaid … ```)
	if len(lines) > 0 && strings.HasPrefix(strings.TrimSpace(lines[0]), "```") {
		lines = lines[1:]
		if n := len(lines); n > 0 && strings.HasPrefix(strings.TrimSpace(lines[n-1]), "```") {
			lines = lines[:n-1]
		}
	}
	// Front matter (--- title: … ---)
	if len(lines) > 0 && strings.TrimSpace(lines[0]) == "---" {
		for i := 1; i < len(lines); i++ {
			if strings.TrimSpace(lines[i]) == "---" {
				lines = lines[i+1:]
				break
			}
		}
	}
	return lines
}

// mermaidHeader finds the diagram kind ("flowchart" or "mindmap") and the lines after it
func mermaidHeader(text string) (string, []string) {
	lines := mermaidLines(text)
	for i, l := range lines {
		t := strings.TrimSpace(stripComment(l))
		if t == "" {
			continue
		}
		f := strings.Fields(t)
		switch strings.ToLower(f[0]) {
		case "flowchart", "graph":
			dir := "TD"
			if len(f) > 1 {
				dir = strings.ToUpper(strings.TrimSuffix(f[1], ";"))
			}
			rest := append([]string{"%%dir " + dir}, lines[i+1:]...)
			// Statements may follow the header on the same line after ";"
			if j := strings.Index(t, ";"); j >= 0 {
				rest = append(rest, t[j+1:])
			}
			return "flowchart", rest
		case "mindmap":
			return "mindmap", lines[i+1:]
		}
		return "", nil
	}
	return "", nil
}

func stripComment(l string) string {
	if i := strings.Index(l, "%%"); i >= 0 && !strings.HasPrefix(strings.TrimSpace(l), "%%dir ") {
		return l[:i]
	}
	return l
}

// FromMermaid turns a Mermaid flowchart/graph or mindmap into drawing content, laid out
func FromMermaid(text string) (string, error) {
	kind, lines := mermaidHeader(text)
	switch kind {
	case "flowchart":
		g := parseFlowchart(lines)
		if len(g.nodes) == 0 {
			return "", ErrMermaidEmpty
		}
		return encode(layoutFlowchart(g)), nil
	case "mindmap":
		root := parseMindmap(lines)
		if root == nil {
			return "", ErrMermaidEmpty
		}
		return encode(layoutMindmap(root)), nil
	}
	return "", ErrMermaidKind
}

// ---------------------------------------------------------------------------------------------------------
// Flowchart

var (
	idRe        = regexp.MustCompile(`^[\p{L}\p{N}_]+`)
	linkTextRe  = regexp.MustCompile(`^(<)?(--|==|-\.)\s*([^-=.>|\s][^>|]*?)\s*(-{2,}|={2,}|\.+-+)([>ox]?)`)
	linkPlainRe = regexp.MustCompile(`^(<)?(-{2,}|={2,}|-\.+-|-\.)([>ox]?)`)
	linkLabelRe = regexp.MustCompile(`^\s*\|([^|]*)\|`)
	brRe        = regexp.MustCompile(`(?i)<br\s*/?>`)
	tagRe       = regexp.MustCompile(`<[^>]+>`)
)

// Node shapes: opening and closing marks, longest first
var shapeMarks = []struct{ open, close, shape string }{
	{"(((", ")))", "ellipse"},
	{"((", "))", "ellipse"},
	{"([", "])", "rounded"},
	{"[[", "]]", "rect"},
	{"[(", ")]", "rounded"},
	{"{{", "}}", "diamond"},
	{"[/", "/]", "rect"},
	{"[/", `\]`, "rect"},
	{`[\`, `\]`, "rect"},
	{`[\`, "/]", "rect"},
	{"[", "]", "rect"},
	{"(", ")", "rounded"},
	{"{", "}", "diamond"},
	{">", "]", "rect"},
}

func cleanText(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		s = s[1 : len(s)-1]
	}
	s = brRe.ReplaceAllString(s, "\n")
	s = tagRe.ReplaceAllString(s, "")
	s = strings.NewReplacer("#quot;", `"`, "#amp;", "&", "#lt;", "<", "#gt;", ">", "`", "").Replace(s)
	return strings.TrimSpace(s)
}

func parseFlowchart(lines []string) *graph {
	g := &graph{dir: "TD", byID: map[string]*graphNode{}}
	classDefs := map[string]map[string]string{}
	var linkStyles []struct {
		idx   []int
		props map[string]string
	}
	var classUses []struct{ ids, class string }

	for _, raw := range lines {
		for _, stmt := range strings.Split(raw, ";") {
			t := strings.TrimSpace(stripComment(stmt))
			if strings.HasPrefix(strings.TrimSpace(stmt), "%%dir ") {
				g.dir = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(stmt), "%%dir "))
				continue
			}
			if t == "" {
				continue
			}
			word := strings.ToLower(strings.Fields(t)[0])
			switch word {
			case "subgraph", "end", "direction", "click", "accTitle", "acctitle", "accdescr", "accDescr":
				continue
			case "style":
				f := strings.Fields(t)
				if len(f) >= 3 {
					n := g.node(f[1])
					applyNodeStyle(n, parseProps(strings.Join(f[2:], " ")))
				}
				continue
			case "classdef":
				f := strings.Fields(t)
				if len(f) >= 3 {
					props := parseProps(strings.Join(f[2:], " "))
					for _, name := range strings.Split(f[1], ",") {
						classDefs[name] = props
					}
				}
				continue
			case "class":
				f := strings.Fields(t)
				if len(f) >= 3 {
					classUses = append(classUses, struct{ ids, class string }{f[1], f[2]})
				}
				continue
			case "linkstyle":
				f := strings.Fields(t)
				if len(f) >= 3 {
					var idx []int
					if f[1] == "default" {
						idx = []int{-1}
					} else {
						for _, p := range strings.Split(f[1], ",") {
							if i, err := strconv.Atoi(p); err == nil {
								idx = append(idx, i)
							}
						}
					}
					linkStyles = append(linkStyles, struct {
						idx   []int
						props map[string]string
					}{idx, parseProps(strings.Join(f[2:], " "))})
				}
				continue
			}
			parseChain(t, g)
			if len(g.nodes) > maxGraphNodes {
				break
			}
		}
	}
	// Classes and link styles apply once everything is read (they may come before or after the nodes)
	for _, u := range classUses {
		for _, id := range strings.Split(u.ids, ",") {
			if n, ok := g.byID[strings.TrimSpace(id)]; ok {
				n.classes = append(n.classes, u.class)
			}
		}
	}
	for _, n := range g.nodes {
		for _, c := range n.classes {
			if props, ok := classDefs[c]; ok {
				applyNodeStyle(n, props)
			}
		}
	}
	for _, ls := range linkStyles {
		color := roleOf(ls.props["stroke"], false)
		for _, i := range ls.idx {
			for k, e := range g.edges {
				if (i == -1 || i == k) && color != "" {
					e.stroke = color
				}
			}
		}
	}
	if len(g.nodes) > maxGraphNodes {
		g.nodes = g.nodes[:maxGraphNodes]
	}
	return g
}

func (g *graph) node(id string) *graphNode {
	if n, ok := g.byID[id]; ok {
		return n
	}
	n := &graphNode{id: id, text: id, shape: "rect"}
	g.byID[id] = n
	g.nodes = append(g.nodes, n)
	return n
}

// parseNodeRef reads "id", "id[text]", "id((text))" … with an optional ":::class"; returns the rest
func parseNodeRef(s string, g *graph) (*graphNode, string, bool) {
	s = strings.TrimLeftFunc(s, unicode.IsSpace)
	id := idRe.FindString(s)
	if id == "" {
		return nil, s, false
	}
	rest := s[len(id):]
	n := g.node(id)
	for _, m := range shapeMarks {
		if !strings.HasPrefix(rest, m.open) {
			continue
		}
		body := rest[len(m.open):]
		var text string
		end := -1
		if strings.HasPrefix(strings.TrimSpace(body), `"`) {
			// Quoted text may contain brackets
			q := strings.Index(body, `"`)
			if q2 := strings.Index(body[q+1:], `"`); q2 >= 0 {
				if c := strings.Index(body[q+1+q2+1:], m.close); c >= 0 {
					text = body[:q+1+q2+1]
					end = q + 1 + q2 + 1 + c
				}
			}
		} else if c := strings.Index(body, m.close); c >= 0 {
			text, end = body[:c], c
		}
		if end < 0 {
			continue
		}
		n.text, n.shape = cleanText(text), m.shape
		rest = body[end+len(m.close):]
		break
	}
	if strings.HasPrefix(rest, ":::") {
		cls := idRe.FindString(rest[3:])
		n.classes = append(n.classes, cls)
		rest = rest[3+len(cls):]
	}
	return n, rest, true
}

// parseNodeGroup reads "A & B & C"
func parseNodeGroup(s string, g *graph) ([]*graphNode, string) {
	var out []*graphNode
	for {
		n, rest, ok := parseNodeRef(s, g)
		if !ok {
			return out, s
		}
		out = append(out, n)
		s = rest
		trimmed := strings.TrimLeftFunc(s, unicode.IsSpace)
		if !strings.HasPrefix(trimmed, "&") {
			return out, s
		}
		s = trimmed[1:]
	}
}

// parseLink reads one link ("-->", "-.->", "== ja ==>", "-->|ja|" …)
func parseLink(s string) (*graphEdge, string, bool) {
	s = strings.TrimLeftFunc(s, unicode.IsSpace)
	e := &graphEdge{}
	var line, head, back string
	if m := linkTextRe.FindStringSubmatch(s); m != nil {
		back, line, e.label, head = m[1], m[2]+m[4], cleanText(m[3]), m[5]
		s = s[len(m[0]):]
	} else if m := linkPlainRe.FindStringSubmatch(s); m != nil {
		back, line, head = m[1], m[2], m[3]
		s = s[len(m[0]):]
	} else {
		return nil, s, false
	}
	if m := linkLabelRe.FindStringSubmatch(s); m != nil {
		e.label = cleanText(m[1])
		s = s[len(m[0]):]
	}
	e.dashed = strings.Contains(line, ".")
	e.thick = strings.Contains(line, "=")
	if head != "" {
		e.head |= 2
	}
	if back != "" {
		e.head |= 1
	}
	return e, s, true
}

func parseChain(s string, g *graph) {
	left, rest := parseNodeGroup(s, g)
	if len(left) == 0 {
		return
	}
	for {
		link, after, ok := parseLink(rest)
		if !ok {
			return
		}
		right, next := parseNodeGroup(after, g)
		if len(right) == 0 {
			return
		}
		for _, a := range left {
			for _, b := range right {
				e := *link
				e.from, e.to = a.id, b.id
				g.edges = append(g.edges, &e)
			}
		}
		left, rest = right, next
	}
}

// ---------------------------------------------------------------------------------------------------------
// Colours: Mermaid styles name CSS colours; drawings use theme roles

func parseProps(s string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(s, ",") {
		if k, v, ok := strings.Cut(part, ":"); ok {
			out[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(v), ";"))
		}
	}
	return out
}

func applyNodeStyle(n *graphNode, props map[string]string) {
	if v, ok := props["fill"]; ok {
		n.fill = roleOf(v, true)
		if n.fill == "" {
			n.fill = "none"
		}
	}
	if v, ok := props["stroke"]; ok {
		n.stroke = roleOf(v, false)
	}
	// Only a fill given: the outline and text take the same colour, which reads well in every theme
	if n.stroke == "" && n.fill != "" && n.fill != "none" {
		n.stroke = n.fill
	}
}

var roleNames = map[string]string{
	"main": "main", "muted": "muted", "accent": "accent", "red": "red", "orange": "orange", "green": "green",
	"blue": "blue", "purple": "purple",
	"black": "main", "gray": "muted", "grey": "muted", "silver": "muted", "darkgray": "muted", "lightgray": "muted",
	"crimson": "red", "tomato": "red", "darkred": "red", "firebrick": "red", "salmon": "red", "pink": "red", "hotpink": "red",
	"gold": "orange", "yellow": "orange", "amber": "orange", "darkorange": "orange", "coral": "orange", "khaki": "orange",
	"lime": "green", "limegreen": "green", "olive": "green", "darkgreen": "green", "seagreen": "green", "lightgreen": "green", "teal": "green",
	"navy": "blue", "skyblue": "blue", "lightblue": "blue", "cyan": "blue", "aqua": "blue", "royalblue": "blue", "steelblue": "blue", "dodgerblue": "blue",
	"violet": "purple", "magenta": "purple", "fuchsia": "purple", "indigo": "purple", "orchid": "purple", "plum": "purple", "lavender": "purple",
}

// roleOf maps a CSS colour to the nearest theme role; "" if it means no colour (white, transparent …)
func roleOf(v string, isFill bool) string {
	v = strings.ToLower(strings.TrimSpace(v))
	switch v {
	case "", "none", "transparent", "white", "#fff", "#ffffff":
		return ""
	}
	if r, ok := roleNames[v]; ok {
		return r
	}
	r, g, b, ok := hexRGB(v)
	if !ok {
		return ""
	}
	h, s, l := hsl(r, g, b)
	if s < 0.18 || l < 0.1 || l > 0.93 {
		if l > 0.85 && isFill {
			return ""
		}
		if l < 0.35 {
			return "main"
		}
		return "muted"
	}
	switch {
	case h < 15 || h >= 335:
		return "red"
	case h < 70:
		return "orange"
	case h < 170:
		return "green"
	case h < 255:
		return "blue"
	default:
		return "purple"
	}
}

func hexRGB(v string) (float64, float64, float64, bool) {
	if !strings.HasPrefix(v, "#") {
		return 0, 0, 0, false
	}
	h := v[1:]
	if len(h) == 3 || len(h) == 4 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if len(h) == 8 {
		h = h[:6]
	}
	if len(h) != 6 {
		return 0, 0, 0, false
	}
	n, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return 0, 0, 0, false
	}
	return float64(n>>16&0xff) / 255, float64(n>>8&0xff) / 255, float64(n&0xff) / 255, true
}

func hsl(r, g, b float64) (h, s, l float64) {
	maxC, minC := math.Max(r, math.Max(g, b)), math.Min(r, math.Min(g, b))
	l = (maxC + minC) / 2
	d := maxC - minC
	if d == 0 {
		return 0, 0, l
	}
	s = d / (1 - math.Abs(2*l-1))
	switch maxC {
	case r:
		h = math.Mod((g-b)/d, 6)
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	h *= 60
	if h < 0 {
		h += 360
	}
	return h, s, l
}

// ---------------------------------------------------------------------------------------------------------
// Mindmap: the tree comes from the indentation

var mindShapeRe = regexp.MustCompile(`^[\p{L}\p{N}_]*(\(\(|\)\)|\(|\[|\{\{|\))(.*?)(\)\)|\(\(|\)|\]|\}\}|\()$`)

func parseMindmap(lines []string) *mindNode {
	type entry struct {
		indent int
		node   *mindNode
	}
	var stack []entry
	var root *mindNode
	count := 0
	for _, raw := range lines {
		l := stripComment(raw)
		t := strings.TrimSpace(l)
		if t == "" || strings.HasPrefix(t, "::icon") || strings.HasPrefix(t, ":::") {
			continue
		}
		indent := 0
		for _, c := range l {
			if c == ' ' {
				indent++
			} else if c == '\t' {
				indent += 4
			} else {
				break
			}
		}
		n := &mindNode{text: t, shape: ""}
		if m := mindShapeRe.FindStringSubmatch(t); m != nil {
			n.text = m[2]
			switch m[1] {
			case "((", "))":
				n.shape = "ellipse"
			case "[":
				n.shape = "rect"
			case "{{":
				n.shape = "diamond"
			default:
				n.shape = "rounded"
			}
		}
		n.text = cleanText(n.text)
		if n.text == "" {
			continue
		}
		count++
		if count > maxGraphNodes {
			break
		}
		if root == nil {
			root = n
			stack = []entry{{indent, n}}
			continue
		}
		for len(stack) > 1 && stack[len(stack)-1].indent >= indent {
			stack = stack[:len(stack)-1]
		}
		parent := stack[len(stack)-1].node
		n.depth = parent.depth + 1
		parent.children = append(parent.children, n)
		stack = append(stack, entry{indent, n})
	}
	return root
}
