package drawing

import (
	"errors"
	"strings"
	"testing"
)

func mustDrawing(t *testing.T, src string) Drawing {
	t.Helper()
	content, err := FromMermaid(src)
	if err != nil {
		t.Fatalf("FromMermaid: %v", err)
	}
	d, ok := Parse(content)
	if !ok {
		t.Fatalf("not a drawing: %s", content)
	}
	return d
}

func byText(d Drawing) map[string]Element {
	out := map[string]Element{}
	for _, el := range d.Els {
		if isShape(el.T) {
			out[el.Txt] = el
		}
	}
	return out
}

func arrows(d Drawing) []Element {
	var out []Element
	for _, el := range d.Els {
		if el.T == "arrow" {
			out = append(out, el)
		}
	}
	return out
}

func TestParseFlowchart(t *testing.T) {
	g := parseFlowchart(mermaidLinesAfterHeader(t, `flowchart LR
		A[Start] --> B{Passt?}
		B -->|ja| C((Ende))
		B -- nein --> D(Nochmal) -.-> A
		E & F ==> C
		G["Text mit [Klammern]"] <--> A
		style A fill:#bbf,stroke:#f66
		classDef warn fill:orange
		class D warn
		H:::warn --- C
		linkStyle 0 stroke:green`))
	if g.dir != "LR" {
		t.Fatalf("direction %q", g.dir)
	}
	want := map[string][2]string{
		"A": {"Start", "rect"}, "B": {"Passt?", "diamond"}, "C": {"Ende", "ellipse"}, "D": {"Nochmal", "rounded"},
		"G": {"Text mit [Klammern]", "rect"},
	}
	for id, w := range want {
		n := g.byID[id]
		if n == nil || n.text != w[0] || n.shape != w[1] {
			t.Errorf("node %s: %+v, want %v", id, n, w)
		}
	}
	type e struct {
		from, to, label string
		head            int
		dashed, thick   bool
	}
	var got []e
	for _, x := range g.edges {
		got = append(got, e{x.from, x.to, x.label, x.head, x.dashed, x.thick})
	}
	wantEdges := []e{
		{"A", "B", "", 2, false, false}, {"B", "C", "ja", 2, false, false}, {"B", "D", "nein", 2, false, false},
		{"D", "A", "", 2, true, false}, {"E", "C", "", 2, false, true}, {"F", "C", "", 2, false, true},
		{"G", "A", "", 3, false, false}, {"H", "C", "", 0, false, false},
	}
	if len(got) != len(wantEdges) {
		t.Fatalf("edges: %+v", got)
	}
	for i := range got {
		if got[i] != wantEdges[i] {
			t.Errorf("edge %d: %+v, want %+v", i, got[i], wantEdges[i])
		}
	}
	if a := g.byID["A"]; a.fill != "blue" || a.stroke != "red" {
		t.Errorf("style of A: fill %q stroke %q", a.fill, a.stroke)
	}
	if d := g.byID["D"]; d.fill != "orange" || d.stroke != "orange" {
		t.Errorf("class of D: %+v", d)
	}
	if h := g.byID["H"]; h.fill != "orange" {
		t.Errorf(":::class of H: %+v", h)
	}
	if g.edges[0].stroke != "green" {
		t.Errorf("linkStyle: %q", g.edges[0].stroke)
	}
}

func mermaidLinesAfterHeader(t *testing.T, src string) []string {
	t.Helper()
	kind, lines := mermaidHeader(src)
	if kind != "flowchart" {
		t.Fatalf("kind %q", kind)
	}
	return lines
}

func TestColoursToRoles(t *testing.T) {
	cases := map[string]string{"#f00": "red", "#ff0000": "red", "#0f0": "green", "#00f": "blue", "#f9f": "purple",
		"#ffa500": "orange", "#333": "main", "#999": "muted", "#fff": "", "white": "", "accent": "accent", "teal": "green", "rgb(1,2,3)": ""}
	for in, want := range cases {
		if got := roleOf(in, true); got != want {
			t.Errorf("roleOf(%q) = %q, want %q", in, got, want)
		}
	}
}

func overlap(a, b Element) bool {
	return a.X < b.X+b.W && b.X < a.X+a.W && a.Y < b.Y+b.H && b.Y < a.Y+a.H
}

func TestFlowchartLayout(t *testing.T) {
	d := mustDrawing(t, `graph TD
		A[Idee] --> B{Machbar?}
		B -->|ja| C[Planen]
		B -->|nein| D[Verwerfen]
		C --> E[Umsetzen]
		E --> F[Fertig]
		A --> F`)
	shapes := byText(d)
	if len(shapes) != 6 || len(arrows(d)) != 6 {
		t.Fatalf("elements: %d shapes, %d arrows", len(shapes), len(arrows(d)))
	}
	// Top to bottom along the arrows
	for _, pair := range [][2]string{{"Idee", "Machbar?"}, {"Machbar?", "Planen"}, {"Planen", "Umsetzen"}, {"Umsetzen", "Fertig"}} {
		if shapes[pair[0]].Y >= shapes[pair[1]].Y {
			t.Errorf("%s should be above %s", pair[0], pair[1])
		}
	}
	// Nothing overlaps
	els := []Element{}
	for _, el := range shapes {
		els = append(els, el)
	}
	for i := range els {
		for j := i + 1; j < len(els); j++ {
			if overlap(els[i], els[j]) {
				t.Errorf("%q overlaps %q", els[i].Txt, els[j].Txt)
			}
		}
	}
	// The long edge Idee → Fertig gets corners, all docked, labels kept
	for _, a := range arrows(d) {
		if a.From == "" || a.To == "" {
			t.Errorf("arrow not docked: %+v", a)
		}
		if shapes["Idee"].ID == a.From && shapes["Fertig"].ID == a.To && len(a.Via) < 2 {
			t.Errorf("long edge without corners: %+v", a)
		}
	}
	if !strings.Contains(Describe(mustContent(t, "graph TD\nB{Machbar?} -->|ja| C[Planen]")), "„Machbar?“ → „Planen“ (ja)") {
		t.Error("label missing in description")
	}
}

func mustContent(t *testing.T, src string) string {
	t.Helper()
	c, err := FromMermaid(src)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestLayoutUncrossesLines(t *testing.T) {
	// In the order written, A→D and B→C cross; the layout swaps C and D
	d := mustDrawing(t, "graph TD\nA --> D\nB --> C\nA --> X\nB --> Y\nC\nD")
	s := byText(d)
	if (s["A"].X < s["B"].X) != (s["D"].X < s["C"].X) {
		t.Errorf("lines cross: A %.0f B %.0f C %.0f D %.0f", s["A"].X, s["B"].X, s["C"].X, s["D"].X)
	}
}

func TestLayoutDirectionsAndCycles(t *testing.T) {
	lr := byText(mustDrawing(t, "flowchart LR\nA --> B --> C"))
	if !(lr["A"].X < lr["B"].X && lr["B"].X < lr["C"].X) {
		t.Errorf("LR not left to right: %+v", lr)
	}
	bt := byText(mustDrawing(t, "flowchart BT\nA --> B"))
	if bt["A"].Y <= bt["B"].Y {
		t.Errorf("BT not bottom up")
	}
	cyc := mustDrawing(t, "graph TD\nA --> B --> C --> A\nC --> C")
	if len(arrows(cyc)) != 3 {
		t.Errorf("cycle: %d arrows (the loop C → C is left out)", len(arrows(cyc)))
	}
}

func TestMindmap(t *testing.T) {
	d := mustDrawing(t, `mindmap
  root((Urlaub))
    Packen
      Kleidung
      Ladekabel
    Route
      Brenner
    Budget
    Unterkunft[Hütte]`)
	s := byText(d)
	if len(s) != 8 || len(arrows(d)) != 7 {
		t.Fatalf("elements: %d shapes %d lines", len(s), len(arrows(d)))
	}
	root := s["Urlaub"]
	if root.T != "ellipse" {
		t.Errorf("root shape %q", root.T)
	}
	rootX := root.X + root.W/2
	left, right := 0, 0
	for _, name := range []string{"Packen", "Route", "Budget", "Hütte"} {
		if s[name].X+s[name].W/2 > rootX {
			right++
		} else {
			left++
		}
	}
	if left != 2 || right != 2 {
		t.Errorf("branches not split: %d left, %d right", left, right)
	}
	if s["Kleidung"].X <= s["Packen"].X {
		t.Error("child should sit further out than its parent")
	}
	if s["Packen"].F == "none" || s["Packen"].S == s["Route"].S {
		t.Error("each branch gets its own colour")
	}
	for _, a := range arrows(d) {
		if a.Head == nil || *a.Head != 0 {
			t.Error("mindmap lines have no heads")
		}
	}
}

func TestMermaidRejects(t *testing.T) {
	if _, err := FromMermaid("sequenceDiagram\nA->>B: Hallo"); !errors.Is(err, ErrMermaidKind) {
		t.Errorf("sequence diagram: %v", err)
	}
	if _, err := FromMermaid("graph TD\n%% nur ein Kommentar"); !errors.Is(err, ErrMermaidEmpty) {
		t.Errorf("empty: %v", err)
	}
	if !IsMermaid("```mermaid\nflowchart LR\nA-->B\n```") || IsMermaid(`{"v":1,"els":[]}`) {
		t.Error("IsMermaid")
	}
	// Fits into a block even when large
	var sb strings.Builder
	sb.WriteString("graph TD\n")
	for i := 0; i < 300; i++ {
		sb.WriteString("N" + strings.Repeat("x", i%5) + string(rune('a'+i%26)) + " --> M" + string(rune('a'+i%26)) + "\n")
	}
	c, err := FromMermaid(sb.String())
	if err != nil || len(c) > 100_000 {
		t.Errorf("large diagram: %v, %d bytes", err, len(c))
	}
}

func TestLinesBetweenLayersAreRightAngled(t *testing.T) {
	d := mustDrawing(t, "graph TD\nA --> B\nA --> C\nD --> D2")
	for _, a := range arrows(d) {
		pts := append(append([][2]float64{a.A}, a.Via...), a.B)
		for i := 1; i < len(pts); i++ {
			dx, dy := pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]
			if dx*dx > 1 && dy*dy > 1 {
				t.Fatalf("diagonal segment in %s: %v", a.ID, pts)
			}
		}
	}
}
