package drawing

import (
	"strings"
	"testing"
)

// A flow chart as the editor writes it: two shapes joined by a docked arrow, free text, one stroke
const flow = `{"v":1,"els":[
	{"id":"a","ver":1,"t":"rect","x":0,"y":0,"w":120,"h":60,"s":"main","f":"accent","sw":2,"txt":"Start"},
	{"id":"b","ver":1,"t":"diamond","x":300,"y":0,"w":120,"h":80,"s":"main","f":"none","sw":2,"txt":"Passt?"},
	{"id":"c","ver":1,"t":"arrow","a":[124,30],"b":[296,40],"from":"a","to":"b","route":"elbow","head":2,"s":"main","sw":2},
	{"id":"d","ver":1,"t":"text","x":0,"y":200,"txt":"Notiz <am> Rand","s":"red","sw":2},
	{"id":"e","ver":1,"t":"draw","pts":[0,300,10,310,20,300,30,310],"s":"blue","sw":2},
	{"id":"f","ver":1,"t":"ellipse","x":500,"y":0,"w":80,"h":80,"s":"main","f":"none","sw":2}
]}`

func TestParseAndValid(t *testing.T) {
	d, ok := Parse(flow)
	if !ok || len(d.Els) != 6 {
		t.Fatalf("parse: ok=%v els=%d", ok, len(d.Els))
	}
	for _, c := range []string{"", "  ", flow, `{"v":1,"els":[]}`} {
		if !Valid(c) {
			t.Errorf("should be valid: %q", c)
		}
	}
	for _, c := range []string{"Einkaufen", `{"v":1}`, `[1,2]`, `{"els":"x"}`} {
		if Valid(c) {
			t.Errorf("should be invalid: %q", c)
		}
	}
}

func TestTextsAndDescribe(t *testing.T) {
	if got := strings.Join(Texts(flow), "|"); got != "Start|Passt?|Notiz <am> Rand" {
		t.Fatalf("texts: %q", got)
	}
	got := Describe(flow)
	for _, want := range []string{"„Start“ → „Passt?“", "Text „Notiz <am> Rand“", "1× Ellipse ohne Text", "1 Freihand-Striche"} {
		if !strings.Contains(got, want) {
			t.Errorf("description %q lacks %q", got, want)
		}
	}
	// Shapes joined by arrows are not listed a second time
	if strings.Contains(got, "Rechteck „Start“") {
		t.Errorf("docked shape listed twice: %q", got)
	}
	if Describe(`{"v":1,"els":[]}`) != "[Zeichnung, leer]" {
		t.Error("empty drawing")
	}
}

func TestSVGCarriesTheModel(t *testing.T) {
	svg, ok := SVG(flow)
	if !ok {
		t.Fatal("no svg")
	}
	s := string(svg)
	for _, want := range []string{"<svg ", "<rect", "<polygon", "<ellipse", "Notiz &lt;am&gt; Rand", "</svg>"} {
		if !strings.Contains(s, want) {
			t.Errorf("svg lacks %q", want)
		}
	}
	if strings.Contains(s, "<am>") {
		t.Error("text must be escaped")
	}
	back, ok := FromSVG(svg)
	if !ok {
		t.Fatal("model not found in svg")
	}
	d1, _ := Parse(flow)
	d2, _ := Parse(back)
	if len(d2.Els) != len(d1.Els) || d2.Els[3].Txt != "Notiz <am> Rand" {
		t.Fatalf("round trip lost data: %+v", d2.Els)
	}
	if _, ok := FromSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`)); ok {
		t.Error("a foreign svg is no drawing")
	}
}

func TestSVGUsesTheSavedFrame(t *testing.T) {
	svg, _ := SVG(`{"v":1,"frame":{"x":10,"y":20,"w":300,"h":150},"els":[]}`)
	if !strings.Contains(string(svg), `viewBox="10 20 300 150"`) {
		t.Fatalf("frame ignored: %s", svg[:120])
	}
}

func TestElbowCornersAreRounded(t *testing.T) {
	if got := roundedPath([][2]float64{{0, 0}, {0, 40}, {6, 40}, {6, 80}}, elbowRadius); got != "M 0 0 L 0 37 Q 0 40 3 40 L 3 40 Q 6 40 6 43 L 6 80" {
		t.Errorf("short stretch: %q", got)
	}
	if got := roundedPath([][2]float64{{0, 0}, {0, 100}, {100, 100}}, 0); got != "M 0 0 L 0 100 L 100 100" {
		t.Errorf("radius 0 keeps the corner: %q", got)
	}
	svg, _ := SVG(`{"v":1,"els":[
		{"id":"e","ver":1,"t":"arrow","a":[0,0],"b":[200,100],"route":"elbow","head":2,"s":"main","sw":2},
		{"id":"v","ver":1,"t":"arrow","a":[0,200],"b":[200,300],"route":"straight","via":[[100,200],[100,300]],"head":2,"s":"main","sw":2},
		{"id":"s","ver":1,"t":"arrow","a":[0,400],"b":[200,450],"route":"straight","head":2,"s":"main","sw":2}
	]}`)
	s := string(svg)
	for _, want := range []string{
		`d="M 0 0 L 90 0 Q 100 0 100 10 L 100 90 Q 100 100 110 100 L 200 100"`,
		`d="M 0 200 L 90 200 Q 100 200 100 210 L 100 290 Q 100 300 110 300 L 200 300"`,
		`d="M 0 400 L 200 450"`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("svg lacks %s", want)
		}
	}
}
