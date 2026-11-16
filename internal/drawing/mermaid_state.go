package drawing

import (
	"regexp"
	"strings"
)

// State diagrams (stateDiagram, stateDiagram-v2) become a graph laid out like a flowchart: [*] as a start dot
// or an end ring, states as rounded boxes, transitions as arrows with their label. A composite state
// (state X { … }) is a box of its own; its inner start points from that box to the first inner state, its
// inner end is a ring of its own. Notes are boxes joined to their state by a dashed line.

var (
	stateTransRe = regexp.MustCompile(`^(.+?)\s*-->\s*(.+?)\s*(?::\s*(.*))?$`)
	stateAliasRe = regexp.MustCompile(`^state\s+"([^"]*)"\s+as\s+([\p{L}\p{N}_]+)\s*(\{)?\s*$`)
	stateKindRe  = regexp.MustCompile(`^state\s+([\p{L}\p{N}_]+)\s*<<\s*(\w+)\s*>>\s*$`)
	stateOpenRe  = regexp.MustCompile(`^state\s+([\p{L}\p{N}_]+)\s*\{\s*$`)
	stateDescRe  = regexp.MustCompile(`^([\p{L}\p{N}_]+)\s*:\s*(.+)$`)
	stateNoteRe  = regexp.MustCompile(`(?i)^note\s+(left|right)\s+of\s+([\p{L}\p{N}_]+)\s*(?::\s*(.*))?$`)
	stateFloatRe = regexp.MustCompile(`(?i)^note\s+"([^"]*)"\s+as\s+([\p{L}\p{N}_]+)\s*$`)
	stateIDRe    = regexp.MustCompile(`^[\p{L}\p{N}_]+$`)
)

func parseState(lines []string) *graph {
	g := &graph{dir: "TD", byID: map[string]*graphNode{}}
	classDefs := map[string]map[string]string{}
	var classUses []struct{ ids, class string }
	described := map[string]bool{}
	var scopes []string // composite states we are inside of
	notes := 0
	// A note over several lines: its state and the lines so far
	var noteFor string
	var noteLines []string
	inNote := false

	scope := func() string {
		if len(scopes) == 0 {
			return ""
		}
		return scopes[len(scopes)-1]
	}
	// ref resolves a state as written in a transition; [*] is the start or end of the current scope
	ref := func(s string, isTarget bool) *graphNode {
		s = strings.TrimSpace(s)
		cls := ""
		if i := strings.Index(s, ":::"); i >= 0 {
			s, cls = strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+3:])
		}
		if s == "[*]" {
			sc := scope()
			if !isTarget && sc != "" {
				// The inner start of a composite state: the arrow leaves the composite state itself
				return g.node(sc)
			}
			id, shape := sc+"[*]start", "start"
			if isTarget {
				id, shape = sc+"[*]end", "end"
			}
			n := g.node(id)
			n.shape, n.text, n.stroke, n.fill = shape, "", "main", "main"
			if shape == "end" {
				n.fill = "none"
			}
			return n
		}
		if !stateIDRe.MatchString(s) {
			return nil
		}
		n := g.stateNode(s)
		if cls != "" {
			n.classes = append(n.classes, cls)
		}
		return n
	}

	for _, raw := range lines {
		t := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(stripComment(raw)), ";"))
		if strings.HasPrefix(strings.TrimSpace(raw), "%%dir ") {
			continue
		}
		if inNote {
			if strings.EqualFold(t, "end note") {
				inNote = false
				g.addNote(noteFor, strings.Join(noteLines, "\n"), &notes)
				continue
			}
			noteLines = append(noteLines, t)
			continue
		}
		if t == "" || t == "--" {
			continue
		}
		f := strings.Fields(t)
		switch strings.ToLower(f[0]) {
		case "direction":
			if len(f) > 1 && len(scopes) == 0 {
				g.dir = strings.ToUpper(f[1])
			}
			continue
		case "hide", "scale", "title", "acctitle", "accdescr", "click":
			continue
		case "classdef":
			if len(f) >= 3 {
				props := parseProps(strings.Join(f[2:], " "))
				for _, name := range strings.Split(f[1], ",") {
					classDefs[name] = props
				}
			}
			continue
		case "class":
			if len(f) >= 3 {
				classUses = append(classUses, struct{ ids, class string }{f[1], f[2]})
			}
			continue
		case "style":
			if len(f) >= 3 && stateIDRe.MatchString(f[1]) {
				applyNodeStyle(g.stateNode(f[1]), parseProps(strings.Join(f[2:], " ")))
			}
			continue
		case "}":
			if len(scopes) > 0 {
				scopes = scopes[:len(scopes)-1]
			}
			continue
		}
		if m := stateNoteRe.FindStringSubmatch(t); m != nil {
			if m[3] != "" {
				g.addNote(m[2], m[3], &notes)
			} else {
				inNote, noteFor, noteLines = true, m[2], nil
			}
			continue
		}
		if m := stateFloatRe.FindStringSubmatch(t); m != nil {
			n := g.node(m[2])
			n.text, n.shape, n.stroke, n.fill = cleanText(m[1]), "rect", "orange", "orange"
			continue
		}
		if m := stateAliasRe.FindStringSubmatch(t); m != nil {
			n := g.stateNode(m[2])
			n.text = cleanText(m[1])
			described[m[2]] = true
			if m[3] != "" {
				scopes = append(scopes, m[2])
			}
			continue
		}
		if m := stateKindRe.FindStringSubmatch(t); m != nil {
			n := g.stateNode(m[1])
			switch strings.ToLower(m[2]) {
			case "choice":
				n.shape = "choice"
			case "fork", "join":
				n.shape, n.stroke, n.fill = "bar", "main", "main"
			}
			continue
		}
		if m := stateOpenRe.FindStringSubmatch(t); m != nil {
			g.stateNode(m[1])
			scopes = append(scopes, m[1])
			continue
		}
		if m := stateTransRe.FindStringSubmatch(t); m != nil {
			from, to := ref(m[1], false), ref(m[2], true)
			if from == nil || to == nil {
				continue
			}
			e := &graphEdge{from: from.id, to: to.id, label: cleanText(m[3]), head: 2}
			// The inner start of a composite state
			if strings.TrimSpace(m[1]) == "[*]" && scope() != "" {
				e.dashed = true
			}
			g.edges = append(g.edges, e)
		} else if m := stateDescRe.FindStringSubmatch(t); m != nil {
			// "S : text": what the state says; several such lines are joined
			n := g.stateNode(m[1])
			if text := cleanText(m[2]); text != "" {
				if described[m[1]] {
					n.text += "\n" + text
				} else {
					n.text = text
				}
				described[m[1]] = true
			}
		} else if stateIDRe.MatchString(t) {
			g.stateNode(t)
		} else if strings.HasPrefix(t, "state ") && stateIDRe.MatchString(strings.TrimSpace(t[6:])) {
			g.stateNode(strings.TrimSpace(t[6:]))
		}
		if len(g.nodes) > maxGraphNodes {
			break
		}
	}
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
	if len(g.nodes) > maxGraphNodes {
		g.nodes = g.nodes[:maxGraphNodes]
	}
	return g
}

// stateNode: a state, a rounded box named by its id until a description says more
func (g *graph) stateNode(id string) *graphNode {
	_, known := g.byID[id]
	n := g.node(id)
	if !known {
		n.shape = "rounded"
	}
	return n
}

// addNote puts a note beside a state, joined to it by a dashed line without head
func (g *graph) addNote(stateID, text string, count *int) {
	text = cleanText(text)
	if text == "" || !stateIDRe.MatchString(stateID) {
		return
	}
	*count++
	n := g.node("[note]" + strings.Repeat("·", *count))
	n.text, n.shape, n.stroke, n.fill = text, "rect", "orange", "orange"
	st := g.stateNode(stateID)
	g.edges = append(g.edges, &graphEdge{from: st.id, to: n.id, dashed: true, thin: true, stroke: "orange"})
}
