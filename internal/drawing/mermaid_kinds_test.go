package drawing

import (
	"errors"
	"math"
	"strings"
	"testing"
)

// Sequence, state and git diagrams: representative inputs with German labels

const testSequence = `sequenceDiagram
    autonumber
    actor K as Kundin
    participant W as Webshop
    participant Z as Zahlungsdienst
    K->>W: Bestellung absenden
    activate W
    W->>+Z: Zahlung anfordern
    Note right of Z: Prüft Kartendaten
    alt Zahlung erfolgreich
        Z-->>W: Bestätigung
        W-->>K: Auftragsbestätigung per E-Mail
    else Zahlung abgelehnt
        Z--xW: Fehler
        W-->>K: Bitte andere Zahlart wählen
    end
    loop Jede Stunde
        W->>W: Lagerbestand prüfen
    end
    rect rgb(191, 223, 255)
        K-)W: Bewertung
    end
    Note over K,W: Bestellung abgeschlossen`

const testState = `stateDiagram-v2
    direction LR
    [*] --> Entwurf
    Entwurf --> Prüfung : einreichen
    Prüfung --> Freigegeben : annehmen
    Prüfung --> Entwurf : zurückweisen
    state Prüfung {
        [*] --> Fachlich
        Fachlich --> Rechtlich
        Rechtlich --> [*]
    }
    state Entscheidung <<choice>>
    state "Wartet auf Termin" as Geplant
    Freigegeben --> Entscheidung
    Entscheidung --> Veröffentlicht : sofort
    Entscheidung --> Geplant : später
    Geplant --> Veröffentlicht
    Veröffentlicht --> [*]
    note right of Entwurf : Nur der Autor sieht ihn
    classDef fertig fill:#9f9
    class Veröffentlicht fertig
    style Entwurf fill:orange`

const testGit = `gitGraph
    commit id: "Start"
    commit id: "Gerüst"
    branch entwicklung
    checkout entwicklung
    commit id: "Anmeldung"
    branch funktion/suche
    commit id: "Suche"
    checkout entwicklung
    commit id: "Tests"
    checkout main
    merge entwicklung id: "Zusammenführung" tag: "v1.0"
    checkout funktion/suche
    commit id: "Filter" type: HIGHLIGHT
    checkout entwicklung
    merge funktion/suche
    checkout main
    cherry-pick id: "Filter"
    commit id: "Notfall" type: REVERSE`

func elsOf(d Drawing, t string) []Element {
	var out []Element
	for _, el := range d.Els {
		if el.T == t {
			out = append(out, el)
		}
	}
	return out
}

func textsOf(d Drawing) map[string]Element {
	out := map[string]Element{}
	for _, el := range d.Els {
		if el.T == "text" {
			out[el.Txt] = el
		}
	}
	return out
}

func TestSequenceDiagram(t *testing.T) {
	d := mustDrawing(t, testSequence)
	byTxt := map[string][]Element{}
	for _, el := range d.Els {
		if el.Txt != "" {
			byTxt[el.Txt] = append(byTxt[el.Txt], el)
		}
	}
	// Each participant at the top and at the bottom, an actor as an ellipse, joined by a dashed lifeline
	for _, name := range []string{"Kundin", "Webshop", "Zahlungsdienst"} {
		if len(byTxt[name]) != 2 || byTxt[name][0].X != byTxt[name][1].X || byTxt[name][0].Y >= byTxt[name][1].Y {
			t.Fatalf("participant %s: %+v", name, byTxt[name])
		}
	}
	if byTxt["Kundin"][0].T != "ellipse" || byTxt["Webshop"][0].T != "rect" {
		t.Errorf("actor shape: %s, participant shape: %s", byTxt["Kundin"][0].T, byTxt["Webshop"][0].T)
	}
	k, w, z := byTxt["Kundin"][0], byTxt["Webshop"][0], byTxt["Zahlungsdienst"][0]
	if !(k.X+k.W < w.X && w.X+w.W < z.X) {
		t.Errorf("participants overlap or out of order: %v %v %v", k, w, z)
	}
	lifelines := 0
	for _, a := range arrows(d) {
		if a.From != "" && a.Dash && a.Head != nil && *a.Head == 0 {
			lifelines++
		}
	}
	if lifelines != 3 {
		t.Errorf("lifelines: %d", lifelines)
	}
	// Messages: numbered, top to bottom, level, heads and dashes as written, the text fits between the lifelines
	msgs := map[string]Element{}
	lastY := -1.0
	for _, a := range arrows(d) {
		if a.From != "" || a.Txt == "" {
			continue
		}
		msgs[a.Txt] = a
		if a.A[1] != a.B[1] || a.A[1] <= lastY {
			t.Errorf("message %q not level or not below the one before: %v %v (last %v)", a.Txt, a.A, a.B, lastY)
		}
		lastY = a.A[1]
		if room := math.Abs(a.B[0] - a.A[0]); room < textWidth(a.Txt, 14)+10 {
			t.Errorf("label %q (%.0f px) does not fit into %.0f px", a.Txt, textWidth(a.Txt, 14), room)
		}
	}
	type want struct {
		head int
		dash bool
		s    string
	}
	for txt, w := range map[string]want{
		"1. Bestellung absenden": {2, false, "main"}, "2. Zahlung anfordern": {2, false, "main"}, "3. Bestätigung": {2, true, "main"},
		"5. Fehler": {2, true, "red"}, "8. Bewertung": {2, false, "main"},
	} {
		a, ok := msgs[txt]
		if !ok || *a.Head != w.head || a.Dash != w.dash || a.S != w.s {
			t.Errorf("message %q: %+v, want %+v (have %v)", txt, a, w, keys(msgs))
		}
	}
	// A message to oneself is a loop with its text beside it
	texts := textsOf(d)
	self, ok := texts["7. Lagerbestand prüfen"]
	if !ok {
		t.Fatalf("self message text missing: %v", keys(texts))
	}
	loops := 0
	for _, a := range arrows(d) {
		if len(a.Via) == 2 && a.A[0] == a.B[0] && self.X > a.Via[0][0] {
			loops++
		}
	}
	if loops != 1 {
		t.Errorf("self message loops: %d", loops)
	}
	// Notes, frames with their condition, the else line and the coloured band
	if n := byTxt["Prüft Kartendaten"]; len(n) != 1 || n[0].F != "orange" || n[0].X < z.X+z.W/2 {
		t.Errorf("note right of Z: %+v", n)
	}
	if n := byTxt["Bestellung abgeschlossen"]; len(n) != 1 || n[0].X > k.X+k.W/2 || n[0].X+n[0].W < w.X+w.W/2 {
		t.Errorf("note over K,W: %+v", n)
	}
	for _, label := range []string{"alt [Zahlung erfolgreich]", "[Zahlung abgelehnt]", "loop [Jede Stunde]"} {
		if _, ok := texts[label]; !ok {
			t.Errorf("frame label %q missing: %v", label, keys(texts))
		}
	}
	frames, bands := 0, 0
	for _, el := range elsOf(d, "rect") {
		switch {
		case el.Txt == "" && el.F == "none" && el.S == "muted":
			frames++
		case el.Txt == "" && el.F == "blue":
			bands++
		}
	}
	if frames != 2 || bands != 1 {
		t.Errorf("frames %d, bands %d", frames, bands)
	}
}

func keys[V any](m map[string]V) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestSequenceBoxesAndLeftovers(t *testing.T) {
	d := mustDrawing(t, `sequenceDiagram
		box Aqua Team Nord
		participant A as Anna
		participant B as Bernd
		end
		participant C
		A->>B: Hallo
		B->>C: Weiter
		C-->>A: Fertig
		opt Wenn Zeit bleibt
		A->>C: Kaffee?`)
	var group *Element
	for _, el := range elsOf(d, "rect") {
		if el.F == "blue" && el.Txt == "" {
			group = &el
		}
	}
	if group == nil {
		t.Fatal("box group missing")
	}
	byName := byText(d)
	if c := byName["C"]; c.X < group.X+group.W {
		t.Errorf("C must stand outside the group: %+v %+v", c, group)
	}
	if _, ok := textsOf(d)["Team Nord"]; !ok {
		t.Error("group label missing")
	}
	// An unclosed block ends at the bottom
	if _, ok := textsOf(d)["opt [Wenn Zeit bleibt]"]; !ok {
		t.Error("unclosed frame missing")
	}
}

func TestStateDiagram(t *testing.T) {
	d := mustDrawing(t, testState)
	shapes := byText(d)
	for _, name := range []string{"Entwurf", "Prüfung", "Freigegeben", "Fachlich", "Rechtlich", "Veröffentlicht", "Wartet auf Termin"} {
		if el, ok := shapes[name]; !ok || el.T != "rect" || !el.R {
			t.Errorf("state %q: %+v", name, el)
		}
	}
	if shapes["Veröffentlicht"].F != "green" || shapes["Entwurf"].F != "orange" {
		t.Errorf("colours: %q %q", shapes["Veröffentlicht"].F, shapes["Entwurf"].F)
	}
	if note := shapes["Nur der Autor sieht ihn"]; note.F != "orange" || note.R {
		t.Errorf("note: %+v", note)
	}
	// Start dots, end rings with their dot, the choice
	var dots, rings, diamonds int
	for _, el := range d.Els {
		switch {
		case el.T == "ellipse" && el.Sw == 10 && el.W == 10:
			dots++
		case el.T == "ellipse" && el.W == 28 && el.F == "none":
			rings++
		case el.T == "diamond" && el.Txt == "":
			diamonds++
		}
	}
	if dots != 1 || rings != 2 || diamonds != 1 {
		t.Errorf("start dots %d (want 1), end rings %d (want 2: outside and inside Prüfung), choices %d", dots, rings, diamonds)
	}
	ids := map[string]string{}
	for _, el := range d.Els {
		ids[el.ID] = el.Txt
	}
	type edge struct{ from, to, label string }
	found := map[edge]Element{}
	for _, a := range arrows(d) {
		found[edge{ids[a.From], ids[a.To], a.Txt}] = a
	}
	for _, e := range []edge{{"Entwurf", "Prüfung", "einreichen"}, {"Prüfung", "Entwurf", "zurückweisen"}, {"Geplant", "Veröffentlicht", ""}} {
		if e.from == "Geplant" {
			e.from = "Wartet auf Termin"
		}
		if _, ok := found[e]; !ok {
			t.Errorf("transition %v missing", e)
		}
	}
	// The inner start of the composite state: a dashed arrow from it to its first state
	if a, ok := found[edge{"Prüfung", "Fachlich", ""}]; !ok || !a.Dash {
		t.Errorf("inner start: %+v", a)
	}
	// direction LR: the start is left of the end
	if shapes["Entwurf"].X >= shapes["Veröffentlicht"].X {
		t.Error("LR: Entwurf should be left of Veröffentlicht")
	}
	for i, a := range d.Els {
		for _, b := range d.Els[i+1:] {
			if isShape(a.T) && isShape(b.T) && a.W > 20 && b.W > 20 && overlap(a, b) {
				t.Errorf("overlap: %q and %q", a.Txt, b.Txt)
			}
		}
	}
}

func TestStateForkAndMultilineNote(t *testing.T) {
	d := mustDrawing(t, `stateDiagram
		state Teilen <<fork>>
		state Warten <<join>>
		[*] --> Teilen
		Teilen --> Packen
		Teilen --> Bezahlen
		Packen --> Warten
		Bezahlen --> Warten
		Warten --> [*]
		Packen : Ware einpacken
		Packen : und wiegen
		note left of Bezahlen
		  Karte oder
		  Rechnung
		end note
		Bezahlen --> Kaputt %% ein Kommentar
		Unsinn -> ohne Pfeil
		--> Fehlt`)
	shapes := byText(d)
	if _, ok := shapes["Ware einpacken\nund wiegen"]; !ok {
		t.Errorf("description lines: %v", keys(shapes))
	}
	if n, ok := shapes["Karte oder\nRechnung"]; !ok || n.F != "orange" {
		t.Errorf("multi-line note: %v", keys(shapes))
	}
	bars := 0
	for _, el := range elsOf(d, "rect") {
		if el.Txt == "" && el.H == 4 && el.W > 50 && el.Sw == 6 {
			bars++
		}
	}
	if bars != 2 {
		t.Errorf("fork/join bars: %d", bars)
	}
	if _, ok := shapes["Kaputt"]; !ok {
		t.Error("a transition with a comment behind it is still read")
	}
}

func TestGitGraph(t *testing.T) {
	d := mustDrawing(t, testGit)
	texts := textsOf(d)
	shapes := byText(d)
	for _, b := range []string{"main", "entwicklung", "funktion/suche"} {
		if _, ok := shapes[b]; !ok {
			t.Errorf("branch label %q missing: %v", b, keys(shapes))
		}
	}
	if tag, ok := shapes["v1.0"]; !ok || !tag.R {
		t.Errorf("tag: %+v", tag)
	}
	// Commits: one column each, in the order written; one lane per branch
	pos := map[string][2]float64{}
	for _, id := range []string{"Start", "Gerüst", "Anmeldung", "Suche", "Tests", "Zusammenführung", "Filter", "Notfall"} {
		tx, ok := texts[id]
		if !ok {
			t.Fatalf("commit id %q missing: %v", id, keys(texts))
		}
		pos[id] = [2]float64{tx.X + textWidth(id, 14)/2, tx.Y}
	}
	order := []string{"Start", "Gerüst", "Anmeldung", "Suche", "Tests", "Zusammenführung", "Filter"}
	for i := 1; i < len(order); i++ {
		if pos[order[i]][0] <= pos[order[i-1]][0] {
			t.Errorf("%s should be right of %s", order[i], order[i-1])
		}
	}
	if pos["Start"][1] != pos["Zusammenführung"][1] || pos["Anmeldung"][1] != pos["Tests"][1] || pos["Suche"][1] != pos["Filter"][1] ||
		pos["Start"][1] == pos["Anmeldung"][1] || pos["Anmeldung"][1] == pos["Suche"][1] {
		t.Errorf("lanes: %v", pos)
	}
	// Dots: filled commits, rings for merges, a square for HIGHLIGHT, red for REVERSE
	var dots, rings, squares, red int
	for _, el := range d.Els {
		switch {
		case el.T == "ellipse" && el.Sw == 10:
			dots++
		case el.T == "ellipse" && el.F == "none":
			rings++
		case el.T == "rect" && el.Txt == "" && el.Sw == 10:
			squares++
		case el.T == "ellipse" && el.S == "red":
			red++
		}
	}
	if dots != 6 || rings != 2 || squares != 1 || red != 1 {
		t.Errorf("dots %d rings %d squares %d red %d", dots, rings, squares, red)
	}
	// Lines: a branch leaves across the lanes, a merge runs along its branch first; the cherry-pick is dashed
	var bends, picks int
	for _, a := range arrows(d) {
		if len(a.Via) == 1 {
			bends++
		}
		if a.From != "" && a.Dash && a.S == "muted" {
			picks++
		}
	}
	if bends < 4 || picks != 1 {
		t.Errorf("bends %d, cherry-picks %d", bends, picks)
	}
}

func TestGitGraphTopToBottom(t *testing.T) {
	d := mustDrawing(t, "gitGraph TB:\ncommit id: \"Eins\"\nbranch neu\ncommit id: \"Zwei\"\ncheckout main\ncommit id: \"Drei\"\nmerge neu")
	texts := textsOf(d)
	if !(texts["Eins"].Y < texts["Zwei"].Y && texts["Zwei"].Y < texts["Drei"].Y) || texts["Eins"].X == texts["Zwei"].X {
		t.Errorf("TB: %+v %+v %+v", texts["Eins"], texts["Zwei"], texts["Drei"])
	}
}

func TestMermaidKindsMalformed(t *testing.T) {
	for _, src := range []string{"sequenceDiagram\n%% leer", "sequenceDiagram\nend\nelse\n->>: x", "stateDiagram-v2\n-->\n}", "gitGraph\nmerge nix\ncherry-pick id: \"fehlt\"\ncheckout"} {
		if _, err := FromMermaid(src); !errors.Is(err, ErrMermaidEmpty) {
			t.Errorf("%q: %v, want ErrMermaidEmpty", src, err)
		}
	}
	// Whatever is cut off or garbled: never a panic, always a drawing or an error
	for _, src := range []string{testSequence, testState, testGit} {
		for i := 0; i <= len(src); i += 3 {
			if !strings.HasPrefix(src[:i], strings.Fields(src)[0]) {
				continue
			}
			for _, cut := range []string{src[:i], src[:i] + "\nend\n}\nend", strings.ReplaceAll(src[:i], ":", "")} {
				content, err := FromMermaid(cut)
				if err == nil {
					if _, ok := Parse(content); !ok {
						t.Fatalf("not a drawing from %q", cut)
					}
				} else if !errors.Is(err, ErrMermaidEmpty) {
					t.Fatalf("%q: %v", cut, err)
				}
			}
		}
	}
	// Large diagrams stay inside the size limit of a block
	var sb strings.Builder
	sb.WriteString("sequenceDiagram\n")
	for i := 0; i < 1000; i++ {
		sb.WriteString("Teilnehmer" + string(rune('A'+i%30)) + "->>Teilnehmer" + string(rune('A'+(i+7)%30)) + ": Nachricht mit etwas Text\n")
	}
	if c, err := FromMermaid(sb.String()); err != nil || len(c) > 100_000 {
		t.Errorf("large sequence: %v, %d bytes", err, len(c))
	}
	sb.Reset()
	sb.WriteString("gitGraph\n")
	for i := 0; i < 1000; i++ {
		sb.WriteString("commit id: \"Commit mit Namen\" tag: \"Version 1.0.0\"\n")
		if i%10 == 0 {
			sb.WriteString("branch z" + strings.Repeat("x", i%7) + string(rune('a'+i%26)) + "\n")
		}
	}
	if c, err := FromMermaid(sb.String()); err != nil || len(c) > 100_000 {
		t.Errorf("large git graph: %v, %d bytes", err, len(c))
	}
}

// A → B and B → A run side by side, straight or with corners, never on top of each other
func TestLinesBothWaysSideBySide(t *testing.T) {
	for _, src := range []string{"flowchart LR\nA[Hin] --> B[Her]\nB --> A", "flowchart TD\nA[Oben] --> B[Mitte] --> C[Unten]\nA --> C\nC --> A\nA --> X[Seite]", testState} {
		d := mustDrawing(t, src)
		ids := map[string]string{}
		for _, el := range d.Els {
			ids[el.ID] = el.Txt
		}
		paths := map[string][][2]float64{}
		for _, a := range arrows(d) {
			key := ids[a.From] + "→" + ids[a.To]
			paths[key] = append(append([][2]float64{a.A}, a.Via...), a.B)
		}
		for k1, p1 := range paths {
			for k2, p2 := range paths {
				if k1 >= k2 || !(strings.Contains(k1, "→") && reverseKey(k1) == k2) {
					continue
				}
				for i := 1; i < len(p1); i++ {
					for j := 1; j < len(p2); j++ {
						if sharedStretch(p1[i-1], p1[i], p2[j-1], p2[j]) {
							t.Errorf("%s: %s and %s overlap: %v / %v", strings.Fields(src)[0], k1, k2, p1, p2)
						}
					}
				}
			}
		}
	}
}

func reverseKey(k string) string {
	a, b, _ := strings.Cut(k, "→")
	return b + "→" + a
}

// sharedStretch: two level or upright stretches on the same line that overlap by more than a few pixels
func sharedStretch(a, b, c, d [2]float64) bool {
	near := func(x, y float64) bool { return math.Abs(x-y) < 1 }
	overlap := func(a0, a1, b0, b1 float64) bool {
		return math.Min(math.Max(a0, a1), math.Max(b0, b1))-math.Max(math.Min(a0, a1), math.Min(b0, b1)) > 4
	}
	if near(a[1], b[1]) && near(c[1], d[1]) && near(a[1], c[1]) {
		return overlap(a[0], b[0], c[0], d[0])
	}
	if near(a[0], b[0]) && near(c[0], d[0]) && near(a[0], c[0]) {
		return overlap(a[1], b[1], c[1], d[1])
	}
	return false
}

// Agents read a sequence diagram back with its messages (free arrows with a label)
func TestDescribeSequence(t *testing.T) {
	got := Describe(mustContent(t, testSequence))
	for _, want := range []string{"Pfeil „1. Bestellung absenden“", "Pfeil „5. Fehler“", "Rechteck „Prüft Kartendaten“"} {
		if !strings.Contains(got, want) {
			t.Errorf("description %q lacks %q", got, want)
		}
	}
}
