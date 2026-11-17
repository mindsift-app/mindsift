package drawing

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Git graphs: every commit in a column of its own (in the order written), every branch on a lane with its
// own colour and its name at the start; commits are dots on their lane, joined to their parents. A new
// branch leaves its parent commit across the lanes and then runs along its own lane; a merge runs along
// the merged branch and then across to the merge commit (a ring). Commit ids and tags are written next to
// the dots. gitGraph LR: (default) runs left to right, TB: top to bottom, BT: bottom to top.

const (
	maxGitCommits = 150
	gitFont       = 14.0
	gitBeside     = 22.0 // how far a merge line runs beside a lane that is taken
)

var gitAttrRe = regexp.MustCompile(`(\w+)\s*:\s*("([^"]*)"|[^\s"]+)`)

type gitCommit struct {
	id, tag, typ string
	branch       int
	parents      []int
	pick         int // cherry-pick: the commit picked, else -1
	merge        bool
}

type gitBranch struct {
	name    string
	order   float64
	created int
	head    int // last commit, -1 none
	lane    int
}

type gitGraph struct {
	dir      string
	commits  []*gitCommit
	branches []*gitBranch
	byName   map[string]int
	byID     map[string]int
}

func gitAttrs(s string) map[string]string {
	out := map[string]string{}
	for _, m := range gitAttrRe.FindAllStringSubmatch(s, -1) {
		v := m[2]
		if strings.HasPrefix(v, `"`) {
			v = m[3]
		}
		out[strings.ToLower(m[1])] = v
	}
	return out
}

// gitName: the first word (or quoted name) of a statement's rest
func gitName(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, `"`) {
		if i := strings.Index(s[1:], `"`); i >= 0 {
			return s[1 : i+1]
		}
	}
	name, _, _ := strings.Cut(s, " ")
	return name
}

func (gg *gitGraph) branch(name string, from int) int {
	if i, ok := gg.byName[name]; ok {
		return i
	}
	b := &gitBranch{name: name, order: float64(len(gg.branches)), created: len(gg.branches), head: from}
	gg.byName[name] = len(gg.branches)
	gg.branches = append(gg.branches, b)
	return len(gg.branches) - 1
}

func (gg *gitGraph) commit(cur int, attrs map[string]string, parents []int) *gitCommit {
	c := &gitCommit{id: attrs["id"], tag: attrs["tag"], typ: strings.ToUpper(attrs["type"]), branch: cur, parents: parents, pick: -1}
	gg.commits = append(gg.commits, c)
	if c.id != "" {
		gg.byID[c.id] = len(gg.commits) - 1
	}
	gg.branches[cur].head = len(gg.commits) - 1
	return c
}

// continuesAfter: whether the branch of commit c has a later commit, so its lane goes on past c
func (gg *gitGraph) continuesAfter(c int) bool {
	for _, n := range gg.commits[c+1:] {
		if n.branch == gg.commits[c].branch {
			return true
		}
	}
	return false
}

func parseGitGraph(lines []string) *gitGraph {
	gg := &gitGraph{dir: "LR", byName: map[string]int{}, byID: map[string]int{}}
	cur := gg.branch("main", -1)
	for _, raw := range lines {
		if d, ok := strings.CutPrefix(strings.TrimSpace(raw), "%%dir "); ok {
			gg.dir = strings.TrimSpace(d)
			continue
		}
		t := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(stripComment(raw)), ";"))
		if t == "" || len(gg.commits) >= maxGitCommits {
			continue
		}
		word, rest, _ := strings.Cut(t, " ")
		parents := func() []int {
			if h := gg.branches[cur].head; h >= 0 {
				return []int{h}
			}
			return nil
		}
		switch strings.ToLower(word) {
		case "commit":
			gg.commit(cur, gitAttrs(rest), parents())
		case "branch":
			name := gitName(rest)
			if name == "" {
				continue
			}
			i := gg.branch(name, gg.branches[cur].head)
			if o, err := strconv.ParseFloat(gitAttrs(rest)["order"], 64); err == nil {
				gg.branches[i].order = o
			}
			cur = i
		case "checkout", "switch":
			if name := gitName(rest); name != "" {
				// An unknown branch is started here, as if it had been created first
				cur = gg.branch(name, gg.branches[cur].head)
			}
		case "merge":
			name := gitName(rest)
			other, ok := gg.byName[name]
			if !ok || other == cur || gg.branches[other].head < 0 {
				continue
			}
			c := gg.commit(cur, gitAttrs(rest), append(parents(), gg.branches[other].head))
			c.merge = true
		case "cherry-pick":
			attrs := gitAttrs(rest)
			src, ok := gg.byID[attrs["id"]]
			if !ok {
				continue
			}
			c := gg.commit(cur, map[string]string{"tag": attrs["tag"]}, parents())
			c.pick = src
		}
	}
	return gg
}

func layoutGitGraph(gg *gitGraph) layoutResult {
	vertical := gg.dir == "TB" || gg.dir == "BT"
	// Lanes: by order, then as created; branches without a commit stay out unless they are main
	used := map[int]bool{0: true}
	for _, c := range gg.commits {
		used[c.branch] = true
	}
	var lanes []*gitBranch
	for i, b := range gg.branches {
		if used[i] {
			lanes = append(lanes, b)
		}
	}
	sort.SliceStable(lanes, func(i, j int) bool { return lanes[i].order < lanes[j].order })
	for i, b := range lanes {
		b.lane = i
	}
	color := func(branch int) string { return branchColors[gg.branches[branch].lane%len(branchColors)] }

	// Room for ids and tags beside the dots
	idW, tagW := 0.0, 0.0
	for _, c := range gg.commits {
		if c.id != "" {
			idW = math.Max(idW, textWidth(c.id, gitFont))
		}
		if c.tag != "" {
			tagW = math.Max(tagW, textWidth(c.tag, gitFont)/0.9+20)
		}
	}
	var step, laneGap float64
	if vertical {
		step = 56
		laneGap = math.Max(90, idW+tagW+60)
	} else {
		step = math.Max(64, math.Max(idW, tagW)+18)
		laneGap = 64
		if idW > 0 {
			laneGap += 22
		}
		if tagW > 0 {
			laneGap += 32
		}
	}
	flip := 1.0
	if gg.dir == "BT" {
		flip = -1
	}
	// pos: the centre of commit column col on lane
	pos := func(col int, lane int) [2]float64 {
		along, across := float64(col+1)*step, float64(lane)*laneGap
		if vertical {
			return [2]float64{across, along * flip}
		}
		return [2]float64{along, across}
	}
	last := len(gg.commits)

	var res layoutResult
	// Lanes: the branch name at the start, a thin dashed line before its first and after its last commit (in
	// between the commits are joined by solid lines)
	first, final := map[int]int{}, map[int]int{}
	for i, c := range gg.commits {
		if _, ok := first[c.branch]; !ok {
			first[c.branch] = i
		}
		final[c.branch] = i
	}
	lane := 0
	dashed := func(col string, a, b [2]float64) {
		lane++
		res.els = append(res.els, outEl{"id": fmt.Sprintf("l%d", lane), "ver": 1, "t": "arrow", "a": [2]float64{r1(a[0]), r1(a[1])},
			"b": [2]float64{r1(b[0]), r1(b[1])}, "route": "straight", "head": 0, "s": col, "sw": 1, "dash": true})
	}
	// short moves a point along the lane by d (towards the end for d > 0)
	short := func(p [2]float64, d float64) [2]float64 {
		if vertical {
			return [2]float64{p[0], p[1] + d*flip}
		}
		return [2]float64{p[0] + d, p[1]}
	}
	for _, b := range lanes {
		bi := gg.byName[b.name]
		col := color(bi)
		start, end := pos(-1, b.lane), pos(last, b.lane)
		size := nodeSize(b.name, "rounded")
		size.h = 32
		size.w = textWidth(b.name, gitFont)/0.9 + 24
		var x, y float64
		if vertical {
			x, y = start[0]-size.w/2, start[1]-size.h/2-flip*size.h/2
			start[1] += flip * size.h / 2
		} else {
			x, y = start[0]-size.w-6, start[1]-size.h/2
		}
		label := shapeEl(fmt.Sprintf("b%d", b.lane+1), x, y, size, b.name, col, col)
		label["fs"] = gitFont
		res.els = append(res.els, label)
		f, ok := first[bi]
		if !ok {
			dashed(col, start, end)
			continue
		}
		dashed(col, start, short(pos(f, b.lane), -14))
		dashed(col, short(pos(final[bi], b.lane), 14), end)
	}

	// Commits
	centers := make([][2]float64, len(gg.commits))
	sizes := make([]sizedNode, len(gg.commits))
	ids := make([]string, len(gg.commits))
	var dots, texts []outEl
	for i, c := range gg.commits {
		col := color(c.branch)
		p := pos(i, gg.branches[c.branch].lane)
		centers[i], ids[i] = p, fmt.Sprintf("c%d", i+1)
		// A small shape drawn filled by a line as wide as itself
		s, stroke, fill := sizedNode{w: 10, h: 10, shape: "ellipse", sw: 10}, col, col
		switch {
		case c.typ == "HIGHLIGHT":
			s = sizedNode{w: 10, h: 10, shape: "rect", sw: 10}
		case c.typ == "REVERSE":
			s, stroke, fill = sizedNode{w: 18, h: 18, shape: "ellipse", sw: 3}, "red", "red"
		case c.merge:
			s, fill = sizedNode{w: 18, h: 18, shape: "ellipse", sw: 4}, "none"
		}
		sizes[i] = s
		dots = append(dots, shapeEl(ids[i], p[0]-s.w/2, p[1]-s.h/2, s, "", stroke, fill))
		// Id and tag on the side away from the lines: lines leave a commit towards the later lanes (below in
		// LR, to the right in TB), so the texts go above or to the left
		idW := 0.0
		if c.id != "" {
			idW = textWidth(c.id, gitFont)
			x, y := p[0]-idW/2, p[1]-14-gitFont*1.3
			if vertical {
				x, y = p[0]-16-idW, p[1]-gitFont*0.65
			}
			texts = append(texts, outEl{"id": ids[i] + "t", "ver": 1, "t": "text", "x": r1(x), "y": r1(y), "txt": c.id, "fs": gitFont, "s": "muted", "sw": 2})
		}
		if c.tag != "" {
			s := sizedNode{w: textWidth(c.tag, gitFont)/0.9 + 20, h: 24, shape: "rect", round: true, sw: 1.5}
			x, y := p[0]-s.w/2, p[1]-14-s.h
			if c.id != "" {
				y -= gitFont*1.3 + 4
			}
			if vertical {
				x, y = p[0]-16-s.w, p[1]-s.h/2
				if c.id != "" {
					x -= idW + 8
				}
			}
			tag := shapeEl(ids[i]+"g", x, y, s, c.tag, "muted", "muted")
			tag["fs"] = gitFont
			texts = append(texts, tag)
		}
	}

	// Lines to the parents: along a lane straight, across lanes with one corner
	k := 0
	link := func(from, to int, col string, dashed bool, acrossFirst bool) {
		k++
		a, b := centers[from], centers[to]
		el := outEl{"id": fmt.Sprintf("k%d", k), "ver": 1, "t": "arrow", "from": ids[from], "to": ids[to], "head": 0, "s": col, "sw": 3}
		if dashed {
			el["dash"], el["sw"] = true, 2
		}
		if math.Abs(a[0]-b[0]) < 0.5 || math.Abs(a[1]-b[1]) < 0.5 {
			el["route"] = "straight"
			el["a"] = outline(a[0], a[1], sizes[from], b[0], b[1])
			el["b"] = outline(b[0], b[1], sizes[to], a[0], a[1])
			res.els = append(res.els, el)
			return
		}
		// The corner: leave the parent across the lanes (a new branch) or run along the lane first (a merge)
		var corner [2]float64
		if acrossFirst == vertical {
			corner = [2]float64{b[0], a[1]}
		} else {
			corner = [2]float64{a[0], b[1]}
		}
		via := [][2]float64{corner}
		// A merge from a branch that goes on after it: its own lane is taken up to its next commit, so the
		// line runs beside the lanes instead, just past the one nearer the top (left), where no ids or tags sit
		if !acrossFirst && gg.continuesAfter(from) {
			if vertical {
				x := math.Min(a[0], b[0]) + gitBeside
				via = [][2]float64{{x, a[1]}, {x, b[1]}}
			} else {
				y := math.Min(a[1], b[1]) + gitBeside
				via = [][2]float64{{a[0], y}, {b[0], y}}
			}
		}
		el["route"] = "elbow"
		vias := make([][2]float64, len(via))
		for n, v := range via {
			vias[n] = [2]float64{r1(v[0]), r1(v[1])}
		}
		el["via"] = vias
		enter, leave := via[0], via[len(via)-1]
		el["fromPort"] = portToward(a, sizes[from], enter)
		el["toPort"] = portToward(b, sizes[to], leave)
		el["a"] = outline(a[0], a[1], sizes[from], enter[0], enter[1])
		el["b"] = outline(b[0], b[1], sizes[to], leave[0], leave[1])
		res.els = append(res.els, el)
	}
	for i, c := range gg.commits {
		for j, p := range c.parents {
			if j == 0 {
				// The first parent: the commit before on this branch, or where the branch was started
				link(p, i, color(c.branch), false, true)
			} else {
				link(p, i, color(gg.commits[p].branch), false, false)
			}
		}
		if c.pick >= 0 {
			link(c.pick, i, "muted", true, false)
		}
	}
	res.els = append(res.els, dots...)
	res.els = append(res.els, texts...)
	return res
}
