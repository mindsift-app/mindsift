package drawing

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

// Sequence diagrams: participants as boxes in a row (again at the bottom), joined by dashed lifelines;
// messages as level arrows from top to bottom with their text above the line, a message to oneself as a
// loop to the right with its text beside it. Notes are orange boxes; loop, alt/else, opt, par/and,
// critical and break are frames with their condition, rect <colour> a coloured band, box <colour> a group
// behind participants. activate/deactivate (and + / - on a message) are left out.

const (
	maxSeqParticipants = 40
	maxSeqItems        = 300
	seqFont            = 14.0 // messages and notes
	seqNoteMax         = 220.0
	seqSelfWidth       = 36.0
)

var (
	seqMsgRe  = regexp.MustCompile(`^([^<>:\-]+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]+?)\s*(?::(.*))?$`)
	seqNoteRe = regexp.MustCompile(`(?i)^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$`)
	seqAsRe   = regexp.MustCompile(`^(.+?)\s+as\s+(.+)$`)
	seqMetaRe = regexp.MustCompile(`@\{.*\}\s*$`)
)

type seqParticipant struct {
	id, text string
	actor    bool
	idx      int
	size     sizedNode
	cx       float64
}

type seqItem struct {
	kind     string // msg, note, open, else, end
	from, to int
	text     string
	dashed   bool
	head     int
	lost     bool   // -x: the message gets lost
	side     string // notes: left of, right of, over
	block    string // open: loop, alt, rect …
	color    string
}

type seqBox struct {
	label, color string
	members      []int
}

type seqDiagram struct {
	parts      []*seqParticipant
	byID       map[string]*seqParticipant
	items      []seqItem
	boxes      []*seqBox
	autonumber bool
}

func (sd *seqDiagram) participant(id string) *seqParticipant {
	id = strings.TrimSpace(id)
	if p, ok := sd.byID[id]; ok {
		return p
	}
	if len(sd.parts) >= maxSeqParticipants || id == "" {
		return nil
	}
	p := &seqParticipant{id: id, text: cleanText(id), idx: len(sd.parts)}
	sd.byID[id] = p
	sd.parts = append(sd.parts, p)
	return p
}

// splitColor takes a leading colour off "Aqua Gruppe", "rgb(1, 2, 3) Gruppe", "#f96 Gruppe" or "transparent"
func splitColor(s string) (color, rest string) {
	s = strings.TrimSpace(s)
	low := strings.ToLower(s)
	if strings.HasPrefix(low, "rgb") {
		if i := strings.Index(s, ")"); i >= 0 {
			return s[:i+1], strings.TrimSpace(s[i+1:])
		}
	}
	first, after, _ := strings.Cut(s, " ")
	lf := strings.ToLower(first)
	if strings.HasPrefix(lf, "#") || lf == "transparent" || roleNames[lf] != "" || lf == "white" {
		return first, strings.TrimSpace(after)
	}
	return "", s
}

func parseSequence(lines []string) *seqDiagram {
	sd := &seqDiagram{byID: map[string]*seqParticipant{}}
	// Open blocks: frames, rects and participant boxes all close with "end"
	var open []string
	var box *seqBox
	for _, raw := range lines {
		t := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(stripComment(raw)), ";"))
		if t == "" {
			continue
		}
		if len(sd.items) >= maxSeqItems {
			break
		}
		word, rest, _ := strings.Cut(t, " ")
		rest = strings.TrimSpace(rest)
		lw := strings.ToLower(word)
		if lw == "create" {
			word, rest, _ = strings.Cut(rest, " ")
			rest = strings.TrimSpace(rest)
			lw = strings.ToLower(word)
		}
		switch lw {
		case "participant", "actor":
			rest = strings.TrimSpace(seqMetaRe.ReplaceAllString(rest, ""))
			id, text := rest, rest
			if m := seqAsRe.FindStringSubmatch(rest); m != nil {
				id, text = strings.TrimSpace(m[1]), m[2]
			}
			id = strings.Trim(id, `"`)
			p := sd.participant(id)
			if p == nil {
				continue
			}
			p.text = cleanText(text)
			p.actor = lw == "actor"
			if box != nil {
				box.members = append(box.members, p.idx)
			}
			continue
		case "autonumber":
			sd.autonumber = true
			continue
		case "activate", "deactivate", "destroy", "title", "acctitle", "accdescr", "link", "links", "properties", "details":
			continue
		case "box":
			color, label := splitColor(rest)
			box = &seqBox{label: cleanText(label), color: color}
			sd.boxes = append(sd.boxes, box)
			open = append(open, "box")
			continue
		case "loop", "alt", "opt", "par", "critical", "break":
			open = append(open, lw)
			sd.items = append(sd.items, seqItem{kind: "open", block: lw, text: cleanText(rest)})
			continue
		case "rect":
			open = append(open, "rect")
			sd.items = append(sd.items, seqItem{kind: "open", block: "rect", color: rest})
			continue
		case "else", "and", "option":
			if len(open) > 0 && open[len(open)-1] != "box" && open[len(open)-1] != "rect" {
				sd.items = append(sd.items, seqItem{kind: "else", text: cleanText(rest)})
			}
			continue
		case "end":
			if len(open) == 0 {
				continue
			}
			last := open[len(open)-1]
			open = open[:len(open)-1]
			if last == "box" {
				box = nil
			} else {
				sd.items = append(sd.items, seqItem{kind: "end"})
			}
			continue
		}
		if m := seqNoteRe.FindStringSubmatch(t); m != nil {
			var who []int
			for _, id := range strings.SplitN(m[2], ",", 2) {
				if p := sd.participant(id); p != nil {
					who = append(who, p.idx)
				}
			}
			if len(who) == 0 {
				continue
			}
			it := seqItem{kind: "note", side: strings.ToLower(strings.Join(strings.Fields(m[1]), " ")), from: who[0], to: who[len(who)-1], text: cleanText(m[3])}
			if it.from > it.to {
				it.from, it.to = it.to, it.from
			}
			sd.items = append(sd.items, it)
			continue
		}
		if m := seqMsgRe.FindStringSubmatch(t); m != nil {
			a, b := sd.participant(m[1]), sd.participant(m[4])
			if a == nil || b == nil {
				continue
			}
			it := seqItem{kind: "msg", from: a.idx, to: b.idx, text: cleanText(m[5])}
			arrow := m[2]
			it.dashed = strings.Contains(strings.Trim(arrow, "<"), "--")
			switch {
			case strings.HasPrefix(arrow, "<<"):
				it.head = 3
			case strings.HasSuffix(arrow, ">>"), strings.HasSuffix(arrow, ")"):
				it.head = 2
			case strings.HasSuffix(arrow, "x"):
				it.head, it.lost = 2, true
			}
			sd.items = append(sd.items, it)
		}
	}
	// Blocks left open end at the bottom
	for _, b := range open {
		if b != "box" {
			sd.items = append(sd.items, seqItem{kind: "end"})
		}
	}
	return sd
}

func seqTextSize(text string, maxW float64) (float64, float64) {
	if text == "" {
		return 0, 0
	}
	lines := wrap(text, seqFont, maxW)
	w := 0.0
	for _, l := range lines {
		w = math.Max(w, textWidth(l, seqFont))
	}
	return w, float64(len(lines)) * seqFont * 1.3
}

// seqFrame: an open block while laying out
type seqFrame struct {
	item       seqItem
	top        float64
	minX, maxX float64
	elses      []struct {
		y    float64
		text string
	}
	depth int
}

func layoutSequence(sd *seqDiagram) layoutResult {
	n := len(sd.parts)
	// Message numbers go in front of the text, so the widths below count them
	num := 0
	for i := range sd.items {
		if it := &sd.items[i]; it.kind == "msg" && sd.autonumber {
			num++
			it.text = strings.TrimSpace(fmt.Sprintf("%d. %s", num, it.text))
		}
	}

	// 1. Columns: boxes side by side, gaps widened until every message text fits between its lifelines
	head := 0.0
	for _, p := range sd.parts {
		shape := "rect"
		if p.actor {
			shape = "ellipse"
		}
		p.size = nodeSize(p.text, shape)
		head = math.Max(head, p.size.h)
	}
	gaps := make([]float64, n) // gaps[i]: from column i to i+1
	for i := 0; i+1 < n; i++ {
		gaps[i] = (sd.parts[i].size.w+sd.parts[i+1].size.w)/2 + 40
	}
	type need struct {
		lo, hi int
		width  float64
	}
	var needs []need
	for _, it := range sd.items {
		switch it.kind {
		case "msg":
			w, _ := seqTextSize(it.text, math.Inf(1))
			if it.from == it.to {
				if it.from+1 < n {
					needs = append(needs, need{it.from, it.from + 1, seqSelfWidth + w + 40})
				}
				continue
			}
			lo, hi := min(it.from, it.to), max(it.from, it.to)
			needs = append(needs, need{lo, hi, w + 50})
		case "note":
			w, _ := seqTextSize(it.text, seqNoteMax)
			w = w/0.9 + 28
			switch it.side {
			case "right of":
				if it.from+1 < n {
					needs = append(needs, need{it.from, it.from + 1, w + 30})
				}
			case "left of":
				if it.from > 0 {
					needs = append(needs, need{it.from - 1, it.from, w + 30})
				}
			}
		}
	}
	sort.SliceStable(needs, func(i, j int) bool { return needs[i].hi-needs[i].lo < needs[j].hi-needs[j].lo })
	for _, nd := range needs {
		have := 0.0
		for i := nd.lo; i < nd.hi; i++ {
			have += gaps[i]
		}
		if have < nd.width {
			gaps[nd.hi-1] += nd.width - have
		}
	}
	x := 0.0
	for i, p := range sd.parts {
		if i > 0 {
			x += gaps[i-1]
		}
		p.cx = x
	}

	// 2. Rows from top to bottom
	var back, lines, front []outEl
	ids := 0
	nextID := func(prefix string) string {
		ids++
		return fmt.Sprintf("%s%d", prefix, ids)
	}
	var frames []*seqFrame
	widen := func(x0, x1 float64) {
		for _, f := range frames {
			f.minX, f.maxX = math.Min(f.minX, x0), math.Max(f.maxX, x1)
		}
	}
	y := head + 34
	for _, it := range sd.items {
		switch it.kind {
		case "msg":
			a, b := sd.parts[it.from], sd.parts[it.to]
			color := "main"
			if it.lost {
				color = "red"
			}
			if it.from == it.to {
				w, h := seqTextSize(it.text, math.Inf(1))
				y += 10
				loop := math.Max(30, h+6)
				el := outEl{"id": nextID("m"), "ver": 1, "t": "arrow", "a": [2]float64{r1(a.cx), r1(y)}, "b": [2]float64{r1(a.cx), r1(y + loop)},
					"via":   [][2]float64{{r1(a.cx + seqSelfWidth), r1(y)}, {r1(a.cx + seqSelfWidth), r1(y + loop)}},
					"route": "elbow", "head": it.head, "s": color, "sw": 2}
				if it.dashed {
					el["dash"] = true
				}
				front = append(front, el)
				if it.text != "" {
					front = append(front, outEl{"id": nextID("t"), "ver": 1, "t": "text", "x": r1(a.cx + seqSelfWidth + 10), "y": r1(y + loop/2 - h/2), "txt": it.text, "fs": seqFont, "s": color, "sw": 2})
				}
				widen(a.cx, a.cx+seqSelfWidth+10+w)
				y += loop + 22
				continue
			}
			_, h := seqTextSize(it.text, math.Inf(1))
			if h > 0 {
				y += h + 10
			} else {
				y += 12
			}
			el := outEl{"id": nextID("m"), "ver": 1, "t": "arrow", "a": [2]float64{r1(a.cx), r1(y)}, "b": [2]float64{r1(b.cx), r1(y)},
				"route": "straight", "head": it.head, "s": color, "sw": 2}
			if it.dashed {
				el["dash"] = true
			}
			if it.text != "" {
				el["txt"] = it.text
			}
			front = append(front, el)
			widen(math.Min(a.cx, b.cx), math.Max(a.cx, b.cx))
			y += 20
		case "note":
			w, h := seqTextSize(it.text, seqNoteMax)
			// The editor wraps text in a box to 90 % of its width
			w, h = w/0.9+28, h+16
			a, b := sd.parts[it.from], sd.parts[it.to]
			var x0 float64
			switch it.side {
			case "right of":
				x0 = a.cx + 12
			case "left of":
				x0 = a.cx - 12 - w
			default:
				if it.from != it.to {
					w = math.Max(w, b.cx-a.cx+80)
				}
				w = math.Max(w, 80)
				x0 = (a.cx+b.cx)/2 - w/2
			}
			y += 8
			lines = append(lines, outEl{"id": nextID("n"), "ver": 1, "t": "rect", "x": r1(x0), "y": r1(y), "w": r1(w), "h": r1(h),
				"txt": it.text, "fs": seqFont, "s": "orange", "f": "orange", "sw": 1.5})
			widen(x0, x0+w)
			y += h + 14
		case "open":
			y += 12
			frames = append(frames, &seqFrame{item: it, top: y, minX: math.Inf(1), maxX: math.Inf(-1), depth: len(frames)})
			if it.block != "rect" {
				y += seqFont*1.3 + 14
			}
		case "else":
			if len(frames) == 0 {
				continue
			}
			f := frames[len(frames)-1]
			y += 10
			f.elses = append(f.elses, struct {
				y    float64
				text string
			}{y, it.text})
			y += seqFont*1.3 + 12
		case "end":
			if len(frames) == 0 {
				continue
			}
			f := frames[len(frames)-1]
			frames = frames[:len(frames)-1]
			y += 12
			if math.IsInf(f.minX, 1) {
				f.minX, f.maxX = sd.parts[0].cx, sd.parts[n-1].cx
			}
			pad := math.Max(16, 56-float64(f.depth)*12)
			x0, x1 := f.minX-pad, f.maxX+pad
			label := f.item.block
			if f.item.text != "" {
				label += " [" + f.item.text + "]"
			}
			if f.item.block != "rect" {
				lw, _ := seqTextSize(label, math.Inf(1))
				x1 = math.Max(x1, x0+lw+20)
				for _, e := range f.elses {
					ew, _ := seqTextSize("["+e.text+"]", math.Inf(1))
					x1 = math.Max(x1, x0+ew+20)
				}
			}
			// The outer frames take this one in
			widen(x0-1, x1+1)
			if f.item.block == "rect" {
				color := roleOf(f.item.color, true)
				if color == "" {
					color = "muted"
				}
				back = append(back, outEl{"id": nextID("r"), "ver": 1, "t": "rect", "x": r1(x0), "y": r1(f.top), "w": r1(x1 - x0), "h": r1(y - f.top),
					"s": color, "f": color, "sw": 1})
			} else {
				back = append(back, outEl{"id": nextID("f"), "ver": 1, "t": "rect", "x": r1(x0), "y": r1(f.top), "w": r1(x1 - x0), "h": r1(y - f.top),
					"s": "muted", "f": "none", "sw": 1.5})
				front = append(front, outEl{"id": nextID("t"), "ver": 1, "t": "text", "x": r1(x0 + 8), "y": r1(f.top + 6), "txt": label, "fs": seqFont, "s": "muted", "sw": 2})
				for _, e := range f.elses {
					front = append(front, outEl{"id": nextID("l"), "ver": 1, "t": "arrow", "a": [2]float64{r1(x0), r1(e.y)}, "b": [2]float64{r1(x1), r1(e.y)},
						"route": "straight", "head": 0, "s": "muted", "sw": 1.5, "dash": true})
					if e.text != "" {
						front = append(front, outEl{"id": nextID("t"), "ver": 1, "t": "text", "x": r1(x0 + 8), "y": r1(e.y + 5), "txt": "[" + e.text + "]", "fs": seqFont, "s": "muted", "sw": 2})
					}
				}
			}
			y += 6
		}
	}
	bottom := y + 30

	// 3. Participants at the top and the bottom, lifelines between them; groups (box) behind them
	var res layoutResult
	for _, b := range sd.boxes {
		if len(b.members) == 0 {
			continue
		}
		x0, x1 := math.Inf(1), math.Inf(-1)
		for _, i := range b.members {
			p := sd.parts[i]
			x0, x1 = math.Min(x0, p.cx-p.size.w/2-14), math.Max(x1, p.cx+p.size.w/2+14)
		}
		color := roleOf(b.color, true)
		if color == "" {
			color = "muted"
		}
		top := -14.0
		if b.label != "" {
			top = -14 - seqFont*1.3 - 8
			lw, _ := seqTextSize(b.label, math.Inf(1))
			x1 = math.Max(x1, x0+lw+20)
			front = append(front, outEl{"id": nextID("t"), "ver": 1, "t": "text", "x": r1(x0 + 8), "y": r1(top + 6), "txt": b.label, "fs": seqFont, "s": color, "sw": 2})
		}
		res.els = append(res.els, outEl{"id": nextID("g"), "ver": 1, "t": "rect", "x": r1(x0), "y": r1(top), "w": r1(x1 - x0), "h": r1(bottom + head + 14 - top),
			"s": color, "f": color, "sw": 1})
	}
	res.els = append(res.els, back...)
	for _, p := range sd.parts {
		color := "accent"
		if p.actor {
			color = "purple"
		}
		top, low := fmt.Sprintf("p%d", p.idx+1), fmt.Sprintf("q%d", p.idx+1)
		res.els = append(res.els,
			shapeEl(top, p.cx-p.size.w/2, (head-p.size.h)/2, p.size, p.text, color, color),
			shapeEl(low, p.cx-p.size.w/2, bottom+(head-p.size.h)/2, p.size, p.text, color, color))
		res.els = append(res.els, outEl{"id": fmt.Sprintf("v%d", p.idx+1), "ver": 1, "t": "arrow", "from": top, "to": low,
			"a": outline(p.cx, head/2, p.size, p.cx, bottom), "b": outline(p.cx, bottom+head/2, p.size, p.cx, 0),
			"route": "straight", "head": 0, "s": "muted", "sw": 1.5, "dash": true})
	}
	res.els = append(res.els, lines...)
	res.els = append(res.els, front...)
	return res
}
