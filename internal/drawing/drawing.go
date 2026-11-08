// Package drawing reads the content of drawing blocks (type "drawing"): a small JSON model written by the
// editor in the browser (frontend/src/lib/drawing/model.ts). The server checks it, takes the texts out for
// search, describes it for agents and renders it as SVG for Markdown exports.
package drawing

import (
	"encoding/json"
	"fmt"
	"html"
	"math"
	"regexp"
	"strings"
)

// BlockType is the block type of drawings
const BlockType = "drawing"

// Element is one shape, text, arrow or freehand stroke. Only the fields of its kind are set.
type Element struct {
	ID   string     `json:"id"`
	T    string     `json:"t"`
	X    float64    `json:"x"`
	Y    float64    `json:"y"`
	W    float64    `json:"w"`
	H    float64    `json:"h"`
	Txt  string     `json:"txt"`
	Fs   float64    `json:"fs"`
	S    string     `json:"s"`
	F    string     `json:"f"`
	Sw   float64    `json:"sw"`
	Dash bool       `json:"dash"`
	R    bool       `json:"r"`
	A    [2]float64 `json:"a"`
	B    [2]float64 `json:"b"`
	From string     `json:"from"`
	To   string     `json:"to"`
	// Route of arrows: straight, curve or elbow
	Route string    `json:"route"`
	Head  *int      `json:"head"`
	Bend  *float64  `json:"bend"`
	Pts   []float64 `json:"pts"`
	// Corner points of a laid out arrow
	Via [][2]float64 `json:"via"`
}

// Frame is the section a note shows
type Frame struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// Drawing is the whole model
type Drawing struct {
	V     int       `json:"v"`
	Frame *Frame    `json:"frame"`
	Grid  bool      `json:"grid"`
	Els   []Element `json:"els"`
}

// Parse reads a block's content; ok is false if it is not a drawing
func Parse(content string) (Drawing, bool) {
	var raw struct {
		Drawing
		Els *[]json.RawMessage `json:"els"`
	}
	if err := json.Unmarshal([]byte(content), &raw); err != nil || raw.Els == nil {
		return Drawing{}, false
	}
	d := Drawing{V: 1, Frame: raw.Frame, Grid: raw.Grid}
	// One broken element does not make the drawing unreadable (the editor drops it the same way)
	for _, r := range *raw.Els {
		var el Element
		if json.Unmarshal(r, &el) == nil && el.ID != "" {
			d.Els = append(d.Els, el)
		}
	}
	return d, true
}

// Valid tells whether content may stand in a drawing block. Empty content is allowed: turning a bullet
// into a drawing (or back) sends type and content as separate operations, in either order.
func Valid(content string) bool {
	if strings.TrimSpace(content) == "" {
		return true
	}
	_, ok := Parse(content)
	return ok
}

func isShape(t string) bool { return t == "rect" || t == "ellipse" || t == "diamond" }

// Texts are the words written in a drawing (search)
func Texts(content string) []string {
	d, ok := Parse(content)
	if !ok {
		return nil
	}
	var out []string
	for _, el := range d.Els {
		if (isShape(el.T) || el.T == "text" || el.T == "arrow") && strings.TrimSpace(el.Txt) != "" {
			out = append(out, el.Txt)
		}
	}
	return out
}

var kindNames = map[string]string{"rect": "Rechteck", "ellipse": "Ellipse", "diamond": "Raute", "text": "Text"}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// Describe says in one line what a drawing shows, for agents that cannot see it: shapes with their text,
// arrows between them, free texts and how many freehand strokes there are.
func Describe(content string) string {
	d, ok := Parse(content)
	if !ok {
		return "[Zeichnung]"
	}
	byID := map[string]Element{}
	for _, el := range d.Els {
		byID[el.ID] = el
	}
	label := func(id string) string {
		el, ok := byID[id]
		if !ok || !isShape(el.T) {
			return "?"
		}
		if t := oneLine(el.Txt); t != "" {
			return "„" + t + "“"
		}
		return kindNames[el.T]
	}
	var parts []string
	docked := map[string]bool{}
	for _, el := range d.Els {
		if el.T == "arrow" && el.From != "" && el.To != "" {
			docked[el.From], docked[el.To] = true, true
		}
	}
	strokes, loose, plain := 0, 0, map[string]int{}
	for _, el := range d.Els {
		switch {
		case isShape(el.T):
			// Shapes joined by arrows show up in the arrows; the rest are listed on their own
			if docked[el.ID] {
				continue
			}
			if t := oneLine(el.Txt); t != "" {
				parts = append(parts, kindNames[el.T]+" „"+t+"“")
			} else {
				plain[el.T]++
			}
		case el.T == "text":
			if t := oneLine(el.Txt); t != "" {
				parts = append(parts, "Text „"+t+"“")
			}
		case el.T == "arrow":
			if el.From == "" || el.To == "" {
				loose++
				continue
			}
			sign := "→"
			if el.Head != nil {
				switch *el.Head {
				case 0:
					sign = "—"
				case 1:
					sign = "←"
				case 3:
					sign = "↔"
				}
			}
			part := label(el.From) + " " + sign + " " + label(el.To)
			if t := oneLine(el.Txt); t != "" {
				part += " (" + t + ")"
			}
			parts = append(parts, part)
		case el.T == "draw":
			strokes++
		}
	}
	for _, k := range []string{"rect", "ellipse", "diamond"} {
		if n := plain[k]; n > 0 {
			parts = append(parts, fmt.Sprintf("%d× %s ohne Text", n, kindNames[k]))
		}
	}
	if loose > 0 {
		parts = append(parts, fmt.Sprintf("%d freie Pfeile/Linien", loose))
	}
	if strokes > 0 {
		parts = append(parts, fmt.Sprintf("%d Freihand-Striche", strokes))
	}
	if len(parts) == 0 {
		return "[Zeichnung, leer]"
	}
	return "[Zeichnung: " + strings.Join(parts, "; ") + "]"
}

// ---------------------------------------------------------------------------------------------------------
// SVG for exports: the browser uses theme colours; a file outside the app gets a fixed light palette

var palette = map[string]string{
	"main": "#1f2937", "muted": "#6b7280", "accent": "#2563eb", "red": "#dc2626",
	"orange": "#d97706", "green": "#16a34a", "blue": "#0284c7", "purple": "#7c3aed",
}

func color(c string) string {
	if v, ok := palette[c]; ok {
		return v
	}
	return palette["main"]
}

func xmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return r.Replace(s)
}

const defaultFontSize = 18

func fontSize(el Element) float64 {
	if el.Fs > 0 && el.Fs <= 64 {
		return el.Fs
	}
	return defaultFontSize
}

func strokeWidth(el Element) float64 {
	if el.Sw >= 1 && el.Sw <= 12 {
		return el.Sw
	}
	return 2
}

// textWidth guesses a text's width without fonts (about the average width of Inter)
func textWidth(s string, fs float64) float64 { return float64(len([]rune(s))) * fs * 0.55 }

func wrap(text string, fs, maxWidth float64) []string {
	var out []string
	for _, para := range strings.Split(text, "\n") {
		line := ""
		for _, word := range strings.Fields(para) {
			next := strings.TrimSpace(line + " " + word)
			if line != "" && textWidth(next, fs) > maxWidth {
				out = append(out, line)
				line = word
			} else {
				line = next
			}
		}
		out = append(out, line)
	}
	return out
}

type box struct{ x0, y0, x1, y1 float64 }

func (b *box) add(x, y float64) {
	b.x0, b.y0 = math.Min(b.x0, x), math.Min(b.y0, y)
	b.x1, b.y1 = math.Max(b.x1, x), math.Max(b.y1, y)
}

func curveControl(a, b [2]float64, bend float64) [2]float64 {
	length := math.Hypot(b[0]-a[0], b[1]-a[1])
	if length == 0 {
		length = 1
	}
	nx, ny := -(b[1]-a[1])/length, (b[0]-a[0])/length
	return [2]float64{(a[0]+b[0])/2 + nx*length*bend, (a[1]+b[1])/2 + ny*length*bend}
}

func elbowPoints(a, b [2]float64) [][2]float64 {
	if math.Abs(b[0]-a[0]) >= math.Abs(b[1]-a[1]) {
		mx := (a[0] + b[0]) / 2
		return [][2]float64{a, {mx, a[1]}, {mx, b[1]}, b}
	}
	my := (a[1] + b[1]) / 2
	return [][2]float64{a, {a[0], my}, {b[0], my}, b}
}

func f(n float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.1f", n), "0"), ".")
}

func headPath(at [2]float64, angle, size float64) string {
	a1, a2 := angle+math.Pi-0.45, angle+math.Pi+0.45
	return fmt.Sprintf("M %s %s L %s %s L %s %s",
		f(at[0]+math.Cos(a1)*size), f(at[1]+math.Sin(a1)*size), f(at[0]), f(at[1]), f(at[0]+math.Cos(a2)*size), f(at[1]+math.Sin(a2)*size))
}

// Fence is the language of a fenced code block holding a drawing (clipboard, Markdown without files)
const Fence = "mindsift-canvas"

const metadataID = "mindsift-drawing"

var metadataRe = regexp.MustCompile(`(?s)<metadata id="` + metadataID + `">(.*?)</metadata>`)

// FromSVG takes the model back out of an SVG written by SVG
func FromSVG(svg []byte) (string, bool) {
	m := metadataRe.FindSubmatch(svg)
	if m == nil {
		return "", false
	}
	content := html.UnescapeString(string(m[1]))
	if _, ok := Parse(content); !ok {
		return "", false
	}
	return content, true
}

// SVG renders a drawing as a standalone SVG file (light background, fixed colours)
func SVG(content string) ([]byte, bool) {
	d, ok := Parse(content)
	if !ok {
		return nil, false
	}
	bounds := box{math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)}
	var body strings.Builder
	for _, el := range d.Els {
		stroke := color(el.S)
		sw := strokeWidth(el)
		dash := ""
		if el.Dash {
			dash = fmt.Sprintf(` stroke-dasharray="%s %s"`, f(sw*4), f(sw*3))
		}
		switch {
		case isShape(el.T):
			fill := `fill="none"`
			if el.F != "" && el.F != "none" {
				fill = fmt.Sprintf(`fill="%s" fill-opacity="0.18"`, color(el.F))
			}
			attrs := fmt.Sprintf(`stroke="%s" stroke-width="%s" stroke-linejoin="round" %s%s`, stroke, f(sw), fill, dash)
			cx, cy := el.X+el.W/2, el.Y+el.H/2
			switch el.T {
			case "ellipse":
				fmt.Fprintf(&body, `<ellipse cx="%s" cy="%s" rx="%s" ry="%s" %s/>`, f(cx), f(cy), f(el.W/2), f(el.H/2), attrs)
			case "diamond":
				fmt.Fprintf(&body, `<polygon points="%s,%s %s,%s %s,%s %s,%s" %s/>`, f(cx), f(el.Y), f(el.X+el.W), f(cy), f(cx), f(el.Y+el.H), f(el.X), f(cy), attrs)
			default:
				r := 0.0
				if el.R {
					r = math.Min(14, math.Min(el.W/4, el.H/4))
				}
				fmt.Fprintf(&body, `<rect x="%s" y="%s" width="%s" height="%s" rx="%s" %s/>`, f(el.X), f(el.Y), f(el.W), f(el.H), f(r), attrs)
			}
			bounds.add(el.X, el.Y)
			bounds.add(el.X+el.W, el.Y+el.H)
			if strings.TrimSpace(el.Txt) != "" {
				fs := fontSize(el)
				inner := map[string]float64{"rect": 0.9, "ellipse": 0.7, "diamond": 0.55}[el.T]
				lines := wrap(el.Txt, fs, math.Max(fs, el.W*inner-8))
				top := cy - float64(len(lines))*fs*1.3/2
				writeText(&body, lines, cx, top, fs, stroke, "middle")
			}
		case el.T == "text":
			fs := fontSize(el)
			lines := strings.Split(el.Txt, "\n")
			writeText(&body, lines, el.X, el.Y, fs, stroke, "start")
			w := 0.0
			for _, l := range lines {
				w = math.Max(w, textWidth(l, fs))
			}
			bounds.add(el.X, el.Y)
			bounds.add(el.X+w, el.Y+float64(len(lines))*fs*1.3)
		case el.T == "arrow":
			a, b := el.A, el.B
			var path string
			labelAt := [2]float64{(a[0] + b[0]) / 2, (a[1] + b[1]) / 2}
			startAngle, endAngle := math.Atan2(a[1]-b[1], a[0]-b[0]), math.Atan2(b[1]-a[1], b[0]-a[0])
			switch {
			case len(el.Via) > 0:
				pts := append(append([][2]float64{a}, el.Via...), b)
				var sb strings.Builder
				for i, p := range pts {
					if i == 0 {
						sb.WriteString("M ")
					} else {
						sb.WriteString(" L ")
					}
					sb.WriteString(f(p[0]) + " " + f(p[1]))
				}
				path = sb.String()
				n := len(pts)
				startAngle = math.Atan2(pts[0][1]-pts[1][1], pts[0][0]-pts[1][0])
				endAngle = math.Atan2(pts[n-1][1]-pts[n-2][1], pts[n-1][0]-pts[n-2][0])
				for _, p := range el.Via {
					bounds.add(p[0], p[1])
				}
				labelAt = halfway(pts)
			case el.Route == "curve":
				bend := 0.25
				if el.Bend != nil {
					bend = *el.Bend
				}
				c := curveControl(a, b, bend)
				path = fmt.Sprintf("M %s %s Q %s %s %s %s", f(a[0]), f(a[1]), f(c[0]), f(c[1]), f(b[0]), f(b[1]))
				startAngle, endAngle = math.Atan2(a[1]-c[1], a[0]-c[0]), math.Atan2(b[1]-c[1], b[0]-c[0])
				bounds.add(c[0], c[1])
				labelAt = [2]float64{(a[0]+b[0])/4 + c[0]/2, (a[1]+b[1])/4 + c[1]/2}
			case el.Route == "elbow":
				pts := elbowPoints(a, b)
				var sb strings.Builder
				for i, p := range pts {
					if i == 0 {
						sb.WriteString("M ")
					} else {
						sb.WriteString(" L ")
					}
					sb.WriteString(f(p[0]) + " " + f(p[1]))
				}
				path = sb.String()
				startAngle = math.Atan2(pts[0][1]-pts[1][1], pts[0][0]-pts[1][0])
				endAngle = math.Atan2(pts[3][1]-pts[2][1], pts[3][0]-pts[2][0])
				labelAt = halfway(pts)
			default:
				path = fmt.Sprintf("M %s %s L %s %s", f(a[0]), f(a[1]), f(b[0]), f(b[1]))
			}
			head := 2
			if el.Head != nil {
				head = *el.Head
			}
			size := 8 + sw*2
			fmt.Fprintf(&body, `<g fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"><path d="%s"%s/>`, stroke, f(sw), path, dash)
			if head&1 != 0 {
				fmt.Fprintf(&body, `<path d="%s"/>`, headPath(a, startAngle, size))
			}
			if head&2 != 0 {
				fmt.Fprintf(&body, `<path d="%s"/>`, headPath(b, endAngle, size))
			}
			body.WriteString(`</g>`)
			if strings.TrimSpace(el.Txt) != "" {
				fs := 14.0
				if el.Fs > 0 && el.Fs <= 64 {
					fs = el.Fs
				}
				lines := strings.Split(el.Txt, "\n")
				w := 0.0
				for _, l := range lines {
					w = math.Max(w, textWidth(l, fs))
				}
				w += 10
				h := float64(len(lines))*fs*1.3 + 4
				fmt.Fprintf(&body, `<rect x="%s" y="%s" width="%s" height="%s" rx="4" fill="#ffffff"/>`, f(labelAt[0]-w/2), f(labelAt[1]-h/2), f(w), f(h))
				writeText(&body, lines, labelAt[0], labelAt[1]-h/2+2, fs, stroke, "middle")
			}
			bounds.add(a[0], a[1])
			bounds.add(b[0], b[1])
		case el.T == "draw":
			if len(el.Pts) < 2 {
				continue
			}
			fmt.Fprintf(&body, `<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"%s/>`, freehandPath(el.Pts), stroke, f(sw), dash)
			for i := 0; i+1 < len(el.Pts); i += 2 {
				bounds.add(el.Pts[i], el.Pts[i+1])
			}
		}
	}
	var x, y, w, h float64
	switch {
	case d.Frame != nil && d.Frame.W > 0 && d.Frame.H > 0:
		x, y, w, h = d.Frame.X, d.Frame.Y, d.Frame.W, d.Frame.H
	case math.IsInf(bounds.x0, 1):
		x, y, w, h = 0, 0, 400, 200
	default:
		const pad = 24
		x, y, w, h = bounds.x0-pad, bounds.y0-pad, bounds.x1-bounds.x0+2*pad, bounds.y1-bounds.y0+2*pad
	}
	var out strings.Builder
	fmt.Fprintf(&out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" width="%s" height="%s" font-family="Inter, system-ui, sans-serif">`, f(x), f(y), f(w), f(h), f(w), f(h))
	// The model rides along, so importing the file gives back an editable drawing
	fmt.Fprintf(&out, `<metadata id="%s">%s</metadata>`, metadataID, xmlEscape(strings.TrimSpace(content)))
	fmt.Fprintf(&out, `<rect x="%s" y="%s" width="%s" height="%s" fill="#ffffff"/>`, f(x), f(y), f(w), f(h))
	out.WriteString(body.String())
	out.WriteString("</svg>\n")
	return []byte(out.String()), true
}

func writeText(sb *strings.Builder, lines []string, x, top, fs float64, fill, anchor string) {
	fmt.Fprintf(sb, `<text font-size="%s" fill="%s" text-anchor="%s" xml:space="preserve">`, f(fs), fill, anchor)
	for i, line := range lines {
		fmt.Fprintf(sb, `<tspan x="%s" y="%s">%s</tspan>`, f(x), f(top+float64(i)*fs*1.3+fs*0.95), xmlEscape(line))
	}
	sb.WriteString(`</text>`)
}

// halfway is the point halfway along a line of points
func halfway(pts [][2]float64) [2]float64 {
	total := 0.0
	for i := 1; i < len(pts); i++ {
		total += math.Hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1])
	}
	left := total / 2
	for i := 1; i < len(pts); i++ {
		l := math.Hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1])
		if l >= left && l > 0 {
			t := left / l
			return [2]float64{pts[i-1][0] + (pts[i][0]-pts[i-1][0])*t, pts[i-1][1] + (pts[i][1]-pts[i-1][1])*t}
		}
		left -= l
	}
	return pts[0]
}

// freehandPath: the same smoothing as the browser (midpoints as curve ends)
func freehandPath(pts []float64) string {
	n := len(pts) / 2
	switch n {
	case 1:
		return fmt.Sprintf("M %s %s l 0.01 0", f(pts[0]), f(pts[1]))
	case 2:
		return fmt.Sprintf("M %s %s L %s %s", f(pts[0]), f(pts[1]), f(pts[2]), f(pts[3]))
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "M %s %s", f(pts[0]), f(pts[1]))
	for i := 1; i < n-1; i++ {
		x, y := pts[i*2], pts[i*2+1]
		fmt.Fprintf(&sb, " Q %s %s %s %s", f(x), f(y), f((x+pts[i*2+2])/2), f((y+pts[i*2+3])/2))
	}
	fmt.Fprintf(&sb, " L %s %s", f(pts[(n-1)*2]), f(pts[(n-1)*2+1]))
	return sb.String()
}
