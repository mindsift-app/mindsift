package drawing

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

// Layout of Mermaid diagrams. Flowcharts are laid out in layers (Sugiyama): cycles broken, a layer per step
// along the arrows, helper points where an arrow skips layers, the order within a layer sorted so few lines
// cross, and right-angled lines through the gaps. Mindmaps are a tree to both sides of the root.

const (
	layoutFont     = 18.0
	layoutTextMax  = 180.0 // text wider than this wraps
	layerGap       = 80.0  // between layers, along the arrows
	nodeGap        = 40.0  // between neighbours in a layer
	laneGap        = 18.0  // room for a line passing a layer
	trackGap       = 14.0  // between lines running across the same gap
	labelFont      = 14.0
	mindColumnGap  = 60.0
	mindSiblingGap = 14.0
)

// Output elements (encoded to the same JSON the editor writes)
type outEl map[string]any

type layoutResult struct {
	els []outEl
}

func r1(v float64) float64 { return math.Round(v*10) / 10 }

func encode(res layoutResult) string {
	els := make([]map[string]any, len(res.els))
	for i, e := range res.els {
		els[i] = e
	}
	b, _ := json.Marshal(map[string]any{"v": 1, "els": els})
	return string(b)
}

type sizedNode struct {
	w, h  float64
	shape string // rect, ellipse, diamond
	round bool
}

// nodeSize makes room for the text inside the shape (the editor wraps it to a share of the width)
func nodeSize(text, shape string) sizedNode {
	lines := wrap(text, layoutFont, layoutTextMax)
	tw := 0.0
	for _, l := range lines {
		tw = math.Max(tw, textWidth(l, layoutFont))
	}
	th := float64(len(lines)) * layoutFont * 1.3
	switch shape {
	case "ellipse":
		return sizedNode{w: math.Max(110, tw/0.7+28), h: math.Max(56, (th+24)*1.4), shape: "ellipse"}
	case "diamond":
		return sizedNode{w: math.Max(130, tw/0.55+28), h: math.Max(76, (th+24)*1.8), shape: "diamond"}
	case "rounded":
		return sizedNode{w: math.Max(110, tw/0.9+28), h: math.Max(52, th+26), shape: "rect", round: true}
	default:
		return sizedNode{w: math.Max(110, tw/0.9+28), h: math.Max(52, th+26), shape: "rect"}
	}
}

func shapeEl(id string, x, y float64, s sizedNode, text, stroke, fill string) outEl {
	if stroke == "" {
		stroke = "main"
	}
	if fill == "" {
		fill = "none"
	}
	e := outEl{"id": id, "ver": 1, "t": s.shape, "x": r1(x), "y": r1(y), "w": r1(s.w), "h": r1(s.h), "s": stroke, "f": fill, "sw": 2}
	if text != "" {
		e["txt"] = text
	}
	if s.round {
		e["r"] = true
	}
	return e
}

// outline: where a ray from the centre of a shape towards a point leaves it (as the editor docks arrows)
func outline(cx, cy float64, s sizedNode, tx, ty float64) [2]float64 {
	dx, dy := tx-cx, ty-cy
	if dx == 0 && dy == 0 {
		dy = -1
	}
	hw, hh := s.w/2, s.h/2
	var t float64
	switch s.shape {
	case "ellipse":
		t = 1 / math.Sqrt(dx*dx/(hw*hw)+dy*dy/(hh*hh))
	case "diamond":
		t = 1 / (math.Abs(dx)/hw + math.Abs(dy)/hh)
	default:
		t = math.Inf(1)
		if dx != 0 {
			t = hw / math.Abs(dx)
		}
		if dy != 0 {
			t = math.Min(t, hh/math.Abs(dy))
		}
	}
	g := 4 / math.Hypot(dx, dy)
	return [2]float64{r1(cx + dx*(t+g)), r1(cy + dy*(t+g))}
}

// ---------------------------------------------------------------------------------------------------------
// Flowchart

type lnode struct {
	idx      int // index in graph.nodes, -1 for helper points
	layer    int
	pos      float64 // centre across the layers
	size     sizedNode
	along    float64 // extent along the arrows
	across   float64 // extent across
	preds    []*lnode
	succs    []*lnode
	orderKey float64
}

func layoutFlowchart(g *graph) layoutResult {
	n := len(g.nodes)
	index := map[string]int{}
	for i, nd := range g.nodes {
		index[nd.id] = i
	}
	horizontal := g.dir == "LR" || g.dir == "RL"

	// Edges between known nodes, loops left out (they would need their own routing)
	type edge struct {
		e        *graphEdge
		u, v     int
		reversed bool
	}
	var edges []edge
	adj := make([][]int, n)
	for _, e := range g.edges {
		u, ok1 := index[e.from]
		v, ok2 := index[e.to]
		if !ok1 || !ok2 || u == v {
			continue
		}
		edges = append(edges, edge{e: e, u: u, v: v})
		adj[u] = append(adj[u], len(edges)-1)
	}

	// 1. Break cycles: edges back to a node on the DFS stack point the other way while laying out
	state := make([]int, n) // 0 new, 1 on stack, 2 done
	var dfs func(int)
	dfs = func(u int) {
		state[u] = 1
		for _, ei := range adj[u] {
			v := edges[ei].v
			if state[v] == 1 {
				edges[ei].reversed = true
			} else if state[v] == 0 {
				dfs(v)
			}
		}
		state[u] = 2
	}
	for i := 0; i < n; i++ {
		if state[i] == 0 {
			dfs(i)
		}
	}

	// 2. Layers: longest path from the sources
	layer := make([]int, n)
	in := make([][]int, n)
	for _, e := range edges {
		a, b := e.u, e.v
		if e.reversed {
			a, b = b, a
		}
		in[b] = append(in[b], a)
	}
	var depth func(int, map[int]bool) int
	memo := make([]int, n)
	for i := range memo {
		memo[i] = -1
	}
	depth = func(v int, seen map[int]bool) int {
		if memo[v] >= 0 {
			return memo[v]
		}
		if seen[v] {
			return 0
		}
		seen[v] = true
		d := 0
		for _, u := range in[v] {
			d = max(d, depth(u, seen)+1)
		}
		memo[v] = d
		return d
	}
	maxLayer := 0
	for i := 0; i < n; i++ {
		layer[i] = depth(i, map[int]bool{})
		maxLayer = max(maxLayer, layer[i])
	}

	// 3. Layered graph with helper points for long edges
	nodes := make([]*lnode, n)
	layers := make([][]*lnode, maxLayer+1)
	for i, nd := range g.nodes {
		s := nodeSize(nd.text, nd.shape)
		ln := &lnode{idx: i, layer: layer[i], size: s}
		if horizontal {
			ln.along, ln.across = s.w, s.h
		} else {
			ln.along, ln.across = s.h, s.w
		}
		nodes[i] = ln
		layers[layer[i]] = append(layers[layer[i]], ln)
	}
	chains := make([][]*lnode, len(edges)) // per edge: from the upper to the lower end
	for k, e := range edges {
		a, b := nodes[e.u], nodes[e.v]
		if e.reversed {
			a, b = b, a
		}
		chain := []*lnode{a}
		prev := a
		for l := a.layer + 1; l < b.layer; l++ {
			d := &lnode{idx: -1, layer: l, across: laneGap}
			layers[l] = append(layers[l], d)
			prev.succs = append(prev.succs, d)
			d.preds = append(d.preds, prev)
			chain = append(chain, d)
			prev = d
		}
		prev.succs = append(prev.succs, b)
		b.preds = append(b.preds, prev)
		chains[k] = append(chain, b)
	}

	// 4. Order within the layers: barycentres, sweeping down and up, keeping the order with fewest crossings
	setKeys := func() {
		for _, l := range layers {
			for i, v := range l {
				v.orderKey = float64(i)
			}
		}
	}
	setKeys()
	crossings := func() int {
		total := 0
		for li := 0; li+1 < len(layers); li++ {
			type pair struct{ a, b float64 }
			var ps []pair
			for _, v := range layers[li] {
				for _, w := range v.succs {
					ps = append(ps, pair{v.orderKey, w.orderKey})
				}
			}
			for i := range ps {
				for j := i + 1; j < len(ps); j++ {
					if (ps[i].a-ps[j].a)*(ps[i].b-ps[j].b) < 0 {
						total++
					}
				}
			}
		}
		return total
	}
	snapshot := func() [][]*lnode {
		out := make([][]*lnode, len(layers))
		for i, l := range layers {
			out[i] = append([]*lnode(nil), l...)
		}
		return out
	}
	best, bestCross := snapshot(), crossings()
	for iter := 0; iter < 24 && bestCross > 0; iter++ {
		down := iter%2 == 0
		for step := 1; step < len(layers); step++ {
			li := step
			if !down {
				li = len(layers) - 1 - step
			}
			l := layers[li]
			bary := map[*lnode]float64{}
			for _, v := range l {
				nb := v.preds
				if !down {
					nb = v.succs
				}
				if len(nb) == 0 {
					bary[v] = v.orderKey
					continue
				}
				sum := 0.0
				for _, w := range nb {
					sum += w.orderKey
				}
				bary[v] = sum / float64(len(nb))
			}
			sort.SliceStable(l, func(i, j int) bool { return bary[l[i]] < bary[l[j]] })
			for i, v := range l {
				v.orderKey = float64(i)
			}
		}
		if c := crossings(); c < bestCross {
			best, bestCross = snapshot(), c
		}
	}
	layers = best
	setKeys()

	// 5. Positions across the layers: packed, then pulled towards their neighbours without overlapping
	minDist := func(a, b *lnode) float64 {
		gap := nodeGap
		if a.idx < 0 || b.idx < 0 {
			gap = laneGap / 2
		}
		return (a.across+b.across)/2 + gap
	}
	for _, l := range layers {
		total := 0.0
		for i, v := range l {
			if i > 0 {
				total += minDist(l[i-1], v)
			}
			v.pos = total
		}
		for _, v := range l {
			v.pos -= total / 2
		}
	}
	place := func(l []*lnode, want []float64) {
		m := len(l)
		if m == 0 {
			return
		}
		fwd := make([]float64, m)
		bwd := make([]float64, m)
		for i := 0; i < m; i++ {
			fwd[i] = want[i]
			if i > 0 {
				fwd[i] = math.Max(want[i], fwd[i-1]+minDist(l[i-1], l[i]))
			}
		}
		for i := m - 1; i >= 0; i-- {
			bwd[i] = want[i]
			if i < m-1 {
				bwd[i] = math.Min(want[i], bwd[i+1]-minDist(l[i], l[i+1]))
			}
		}
		for i := 0; i < m; i++ {
			l[i].pos = (fwd[i] + bwd[i]) / 2
			if i > 0 {
				l[i].pos = math.Max(l[i].pos, l[i-1].pos+minDist(l[i-1], l[i]))
			}
		}
	}
	for pass := 0; pass < 8; pass++ {
		down := pass%2 == 0
		for step := 0; step < len(layers); step++ {
			li := step
			if !down {
				li = len(layers) - 1 - step
			}
			l := layers[li]
			want := make([]float64, len(l))
			for i, v := range l {
				nb := v.preds
				if !down {
					nb = v.succs
				}
				if len(nb) == 0 {
					nb = append(append([]*lnode(nil), v.preds...), v.succs...)
				}
				if len(nb) == 0 {
					want[i] = v.pos
					continue
				}
				sum := 0.0
				for _, w := range nb {
					sum += w.pos
				}
				want[i] = sum / float64(len(nb))
			}
			place(l, want)
		}
	}

	// 5b. Tracks: between two layers every line runs across on a track of its own, so lines of different
	// sources never lie on top of each other; the lines of one source share a track (a fork). A line that
	// comes down at a place where another one leaves must cross the gap below it (vertical constraints).
	segTrack := make([][]int, len(edges)) // per edge and gap it crosses: track, -1 for a line straight across
	trackCount := make([]int, len(layers))
	for k := range edges {
		segTrack[k] = make([]int, len(chains[k])-1)
	}
	type net struct {
		lo, hi       float64
		tops, bottom []float64
		above        []int // nets that must run closer to the upper layer
		track        int
	}
	for li := range layers {
		nets := []*net{}
		bySource := map[*lnode]int{}
		type ref struct{ k, i int }
		members := map[int][]ref{}
		for k, chain := range chains {
			for i := 0; i+1 < len(chain); i++ {
				p, q := chain[i], chain[i+1]
				if p.layer != li {
					continue
				}
				segTrack[k][i] = -1
				if math.Abs(p.pos-q.pos) < 0.5 {
					continue
				}
				ni, ok := bySource[p]
				if !ok {
					ni = len(nets)
					bySource[p] = ni
					nets = append(nets, &net{lo: p.pos, hi: p.pos, tops: []float64{p.pos}})
				}
				nt := nets[ni]
				nt.lo, nt.hi = math.Min(nt.lo, q.pos), math.Max(nt.hi, q.pos)
				nt.bottom = append(nt.bottom, q.pos)
				members[ni] = append(members[ni], ref{k, i})
			}
		}
		for a, na := range nets {
			for b, nb := range nets {
				if a == b {
					continue
				}
				for _, x := range na.tops {
					for _, y := range nb.bottom {
						if math.Abs(x-y) < 1 {
							nb.above = append(nb.above, a)
						}
					}
				}
			}
		}
		// Left edge: fill one track after the other with nets that fit next to each other and whose upper
		// neighbours are placed already; a cycle of constraints takes the leftmost net anyway
		order := make([]int, len(nets))
		for i := range order {
			order[i] = i
		}
		sort.SliceStable(order, func(i, j int) bool { return nets[order[i]].lo < nets[order[j]].lo })
		placed := make([]bool, len(nets))
		left, tracks := len(nets), 0
		for left > 0 {
			var cur []int
			for _, ni := range order {
				nt := nets[ni]
				if placed[ni] {
					continue
				}
				ready := true
				for _, a := range nt.above {
					if !placed[a] {
						ready = false
					}
				}
				for _, o := range cur {
					if nt.lo < nets[o].hi+trackGap && nets[o].lo < nt.hi+trackGap {
						ready = false
					}
				}
				if ready {
					cur = append(cur, ni)
				}
			}
			if len(cur) == 0 {
				for _, ni := range order {
					if !placed[ni] {
						cur = []int{ni}
						break
					}
				}
			}
			for _, ni := range cur {
				placed[ni] = true
				nets[ni].track = tracks
				for _, m := range members[ni] {
					segTrack[m.k][m.i] = tracks
				}
				left--
			}
			tracks++
		}
		trackCount[li] = tracks
	}

	// 6. Positions along the arrows: a band per layer, wider gaps where lines carry labels or need tracks
	thick := make([]float64, len(layers))
	for li, l := range layers {
		for _, v := range l {
			thick[li] = math.Max(thick[li], v.along)
		}
	}
	gapAfter := make([]float64, len(layers))
	for li := range gapAfter {
		gapAfter[li] = math.Max(layerGap, float64(trackCount[li]+1)*trackGap*1.5)
	}
	for k, e := range edges {
		if e.e.label == "" {
			continue
		}
		top := chains[k][0].layer
		need := 40.0
		if horizontal {
			need = textWidth(e.e.label, labelFont) + 50
		} else {
			need = labelFont*1.3 + 50
		}
		gapAfter[top] = math.Max(gapAfter[top], need)
	}
	bandStart := make([]float64, len(layers))
	at := 0.0
	for li := range layers {
		bandStart[li] = at
		at += thick[li] + gapAfter[li]
	}
	center := func(v *lnode) float64 { return bandStart[v.layer] + thick[v.layer]/2 }
	gapMid := func(li int) float64 { return bandStart[li] + thick[li] + gapAfter[li]/2 }
	// The tracks of a gap spread evenly across it, the first one nearest the upper layer
	trackAt := func(li, t int) float64 {
		if t < 0 || trackCount[li] < 2 {
			return gapMid(li)
		}
		return bandStart[li] + thick[li] + gapAfter[li]*float64(t+1)/float64(trackCount[li]+1)
	}
	flip := 1.0
	if g.dir == "BT" || g.dir == "RL" {
		flip = -1
	}
	toXY := func(along, across float64) [2]float64 {
		along *= flip
		if horizontal {
			return [2]float64{along, across}
		}
		return [2]float64{across, along}
	}

	var res layoutResult
	ids := make([]string, n)
	centers := make([][2]float64, n)
	for i, nd := range g.nodes {
		v := nodes[i]
		c := toXY(center(v), v.pos)
		centers[i] = c
		ids[i] = fmt.Sprintf("n%d", i+1)
		res.els = append(res.els, shapeEl(ids[i], c[0]-v.size.w/2, c[1]-v.size.h/2, v.size, nd.text, nd.stroke, nd.fill))
	}

	// 7. Lines: right angles on their track in the gap after each layer, along the helper points
	for k, e := range edges {
		chain := chains[k]
		var via [][2]float64
		for i := 0; i+1 < len(chain); i++ {
			p, q := chain[i], chain[i+1]
			gm := trackAt(p.layer, segTrack[k][i])
			via = append(via, toXY(gm, p.pos), toXY(gm, q.pos))
		}
		via = simplifyCorners(via)
		if e.reversed {
			for i, j := 0, len(via)-1; i < j; i, j = i+1, j-1 {
				via[i], via[j] = via[j], via[i]
			}
		}
		u, v := e.u, e.v
		el := outEl{"id": fmt.Sprintf("e%d", k+1), "ver": 1, "t": "arrow", "from": ids[u], "to": ids[v], "route": "elbow", "head": e.e.head, "s": "main", "sw": 2}
		if e.e.stroke != "" {
			el["s"] = e.e.stroke
		}
		if e.e.dashed {
			el["dash"] = true
		}
		if e.e.thick {
			el["sw"] = 4
		}
		if e.e.label != "" {
			el["txt"] = e.e.label
		}
		// A line straight across (no corner) needs no points; otherwise it docks towards its first corner
		su, sv := nodes[u].size, nodes[v].size
		if len(via) == 0 {
			el["a"] = outline(centers[u][0], centers[u][1], su, centers[v][0], centers[v][1])
			el["b"] = outline(centers[v][0], centers[v][1], sv, centers[u][0], centers[u][1])
		} else {
			first, last := via[0], via[len(via)-1]
			el["a"] = outline(centers[u][0], centers[u][1], su, first[0], first[1])
			el["b"] = outline(centers[v][0], centers[v][1], sv, last[0], last[1])
			pts := make([][2]float64, len(via))
			for i, p := range via {
				pts[i] = [2]float64{r1(p[0]), r1(p[1])}
			}
			el["via"] = pts
		}
		res.els = append(res.els, el)
	}
	return res
}

// simplifyCorners drops repeated points and points in the middle of a straight run
func simplifyCorners(pts [][2]float64) [][2]float64 {
	var out [][2]float64
	for _, p := range pts {
		if len(out) > 0 && math.Abs(out[len(out)-1][0]-p[0]) < 0.5 && math.Abs(out[len(out)-1][1]-p[1]) < 0.5 {
			continue
		}
		out = append(out, p)
	}
	for i := 1; i+1 < len(out); {
		a, b, c := out[i-1], out[i], out[i+1]
		if (math.Abs(a[0]-b[0]) < 0.5 && math.Abs(b[0]-c[0]) < 0.5) || (math.Abs(a[1]-b[1]) < 0.5 && math.Abs(b[1]-c[1]) < 0.5) {
			out = append(out[:i], out[i+1:]...)
			continue
		}
		i++
	}
	// One point left: both ends sit on the same line across the layers, which runs straight
	if len(out) < 2 {
		return nil
	}
	return out
}

// ---------------------------------------------------------------------------------------------------------
// Mindmap

var branchColors = []string{"accent", "green", "orange", "purple", "blue", "red"}

type placedMind struct {
	node   *mindNode
	size   sizedNode
	cx, cy float64
	color  string
}

func layoutMindmap(root *mindNode) layoutResult {
	shapeOf := func(n *mindNode) string {
		if n.shape != "" {
			return n.shape
		}
		if n.depth == 0 {
			return "ellipse"
		}
		return "rounded"
	}
	var placed []*placedMind
	parentOf := map[*placedMind]*placedMind{}

	// Height a subtree needs (children stacked beside each other)
	var height func(n *mindNode) float64
	height = func(n *mindNode) float64 {
		own := nodeSize(n.text, shapeOf(n)).h
		if len(n.children) == 0 {
			return own
		}
		sum := 0.0
		for i, c := range n.children {
			if i > 0 {
				sum += mindSiblingGap
			}
			sum += height(c)
		}
		return math.Max(own, sum)
	}

	rootSize := nodeSize(root.text, shapeOf(root))
	rp := &placedMind{node: root, size: rootSize, cx: 0, cy: 0, color: "main"}
	placed = append(placed, rp)

	var place func(n *mindNode, parent *placedMind, side float64, top float64, color string)
	place = func(n *mindNode, parent *placedMind, side float64, top float64, color string) {
		s := nodeSize(n.text, shapeOf(n))
		h := height(n)
		cx := parent.cx + side*(parent.size.w/2+mindColumnGap+s.w/2)
		p := &placedMind{node: n, size: s, cx: cx, cy: top + h/2, color: color}
		placed = append(placed, p)
		parentOf[p] = parent
		// Children centred on this node's span
		sum := 0.0
		for i, c := range n.children {
			if i > 0 {
				sum += mindSiblingGap
			}
			sum += height(c)
		}
		y := top + (h-sum)/2
		for _, c := range n.children {
			place(c, p, side, y, color)
			y += height(c) + mindSiblingGap
		}
	}
	// Branches to the right first, the rest to the left, each side centred on the root
	kids := root.children
	right := kids[:(len(kids)+1)/2]
	left := kids[(len(kids)+1)/2:]
	for _, part := range []struct {
		list []*mindNode
		side float64
		off  int
	}{{right, 1, 0}, {left, -1, len(right)}} {
		total := 0.0
		for i, c := range part.list {
			if i > 0 {
				total += mindSiblingGap * 2
			}
			total += height(c)
		}
		y := -total / 2
		for i, c := range part.list {
			place(c, rp, part.side, y, branchColors[(part.off+i)%len(branchColors)])
			y += height(c) + mindSiblingGap*2
		}
	}

	var res layoutResult
	ids := map[*placedMind]string{}
	for i, p := range placed {
		ids[p] = fmt.Sprintf("n%d", i+1)
		stroke, fill := p.color, "none"
		switch p.node.depth {
		case 0:
			fill = "accent"
			stroke = "accent"
		case 1:
			fill = p.color
		}
		res.els = append(res.els, shapeEl(ids[p], p.cx-p.size.w/2, p.cy-p.size.h/2, p.size, p.node.text, stroke, fill))
	}
	k := 0
	for _, p := range placed {
		parent, ok := parentOf[p]
		if !ok {
			continue
		}
		k++
		// Curved branch that arrives level at the child: the bend puts the control point at its height
		dx, dy := p.cx-parent.cx, p.cy-parent.cy
		bend := 0.0
		if math.Abs(dx) > 1 {
			bend = math.Max(-1.5, math.Min(1.5, dy/(2*dx)))
		}
		length := math.Hypot(dx, dy)
		ctrl := [2]float64{(parent.cx + p.cx) / 2, (parent.cy + p.cy) / 2}
		if length > 0 {
			ctrl[0] += -dy * bend
			ctrl[1] += dx * bend
		}
		sw := 2
		if p.node.depth == 1 {
			sw = 3
		}
		res.els = append(res.els, outEl{
			"id": fmt.Sprintf("e%d", k), "ver": 1, "t": "arrow", "from": ids[parent], "to": ids[p], "route": "curve",
			"bend": math.Round(bend*1000) / 1000, "head": 0, "s": p.color, "sw": sw,
			"a": outline(parent.cx, parent.cy, parent.size, ctrl[0], ctrl[1]),
			"b": outline(p.cx, p.cy, p.size, ctrl[0], ctrl[1]),
		})
	}
	return res
}
