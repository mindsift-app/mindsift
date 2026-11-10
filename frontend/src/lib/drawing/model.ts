// Drawing blocks (type 'drawing'): the block content is a small JSON model, never raw SVG, so nothing in a
// note can bring its own markup or scripts. The preview and the editor render it as React SVG.

export type DrawColor = 'main' | 'muted' | 'accent' | 'red' | 'orange' | 'green' | 'blue' | 'purple';
export type DrawFill = DrawColor | 'none';
export type ShapeKind = 'rect' | 'ellipse' | 'diamond';
export type ArrowRoute = 'straight' | 'curve' | 'elbow';
export type Point = [number, number];

interface ElementBase {
  id: string;
  /** Bumped on every change of the element (groundwork for merging concurrent edits later) */
  ver: number;
  s: DrawColor;
  /** Stroke width */
  sw: number;
  dash?: boolean;
}

export interface ShapeElement extends ElementBase {
  t: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  f: DrawFill;
  txt?: string;
  /** Font size of the text inside */
  fs?: number;
  /** Rounded corners (rectangles) */
  r?: boolean;
}

export interface TextElement extends ElementBase {
  t: 'text';
  x: number;
  y: number;
  txt: string;
  fs?: number;
}

/** Where an elbow arrow meets a shape: a side and how far along it (0 = left or top end, 1 = right or bottom) */
export interface Port {
  side: Side;
  at: number;
}
export type Side = 't' | 'r' | 'b' | 'l';

export interface ArrowElement extends ElementBase {
  t: 'arrow';
  /** Start and end; for a docked end the last computed point (the shape decides where it really is) */
  a: Point;
  b: Point;
  from?: string;
  to?: string;
  route: ArrowRoute;
  /** Arrow heads: 0 none, 1 start, 2 end, 3 both */
  head: number;
  /** Curves: how far the middle bends away from the straight line, as a share of its length. Elbows (older
   * drawings only, now via): where the middle stretch lies, as a share of the way from start to end */
  bend?: number;
  /** Elbows (older drawings only): whether the line leaves sideways ('h') or up and down ('v') */
  axis?: 'h' | 'v';
  /** Corner points the line runs through: laid out from a diagram or moved by hand. Elbows keep them when a
   * docked shape moves (their ends follow), other lines lose them */
  via?: Point[];
  /** Elbows: the side and spot where the line leaves its start shape or enters its end shape (set by dragging
   * the end there); without, it takes the side facing the other end */
  fromPort?: Port;
  toPort?: Port;
  /** Label in the middle of the line ("ja", "nein") */
  txt?: string;
  fs?: number;
}

export interface FreehandElement extends ElementBase {
  t: 'draw';
  /** Flat list x0, y0, x1, y1, … */
  pts: number[];
}

export type DrawElement = ShapeElement | TextElement | ArrowElement | FreehandElement;

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Drawing {
  v: 1;
  /** Section the note shows (saved for everyone); missing = fit everything */
  frame?: Frame;
  /** Without a frame: the other size of the preview chosen with its toggle ('all': everything as large as
   * the width allows; 'readable': the recommended height, wide drawings moved sideways); missing = automatic */
  fit?: 'all' | 'readable';
  grid?: boolean;
  els: DrawElement[];
}

export const DRAW_COLORS: DrawColor[] = ['main', 'muted', 'accent', 'red', 'orange', 'green', 'blue', 'purple'];
export const FONT_SIZES = [14, 18, 28];
export const DEFAULT_FONT_SIZE = 18;
/** Labels on arrows are smaller than text in shapes */
export const ARROW_FONT_SIZE = 14;
export const GRID_SIZE = 20;
/** Language of the fenced code block a drawing becomes in Markdown (copying, export without files) */
export const DRAWING_FENCE = 'mindsift-canvas';
/** The server takes at most 100 000 bytes per block (internal/collab/ops.go) */
export const MAX_CONTENT_BYTES = 100_000;

// Theme roles instead of fixed colours, so a drawing reads well in every theme
const COLOR_VARS: Record<DrawColor, string> = {
  main: '--text-main',
  muted: '--text-muted',
  accent: '--accent-primary',
  red: '--color-danger',
  orange: '--color-warning',
  green: '--color-success',
  blue: '--color-info',
  purple: '--color-purple',
};

export function strokeColor(c: DrawColor): string {
  return `var(${COLOR_VARS[c] || COLOR_VARS.main})`;
}

export function fillColor(f: DrawFill): string {
  if (f === 'none') return 'none';
  return `color-mix(in srgb, var(${COLOR_VARS[f] || COLOR_VARS.main}) 18%, transparent)`;
}

export function emptyDrawing(): Drawing {
  return { v: 1, els: [] };
}

export function newElementId(): string {
  return 'e' + Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------------------------------------
// Parsing and saving

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const color = (v: unknown): DrawColor => (DRAW_COLORS.includes(v as DrawColor) ? (v as DrawColor) : 'main');
const fill = (v: unknown): DrawFill => (v === 'none' ? 'none' : DRAW_COLORS.includes(v as DrawColor) ? (v as DrawColor) : 'none');
const point = (v: unknown): Point => (Array.isArray(v) ? [num(v[0]), num(v[1])] : [0, 0]);

function parseElement(raw: any): DrawElement | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const base = { id: raw.id.slice(0, 40), ver: num(raw.ver, 1), s: color(raw.s), sw: Math.min(12, Math.max(1, num(raw.sw, 2))), ...(raw.dash ? { dash: true } : {}) };
  const txt = typeof raw.txt === 'string' ? raw.txt : undefined;
  const fs = FONT_SIZES.includes(raw.fs) ? (raw.fs as number) : undefined;
  switch (raw.t) {
    case 'rect':
    case 'ellipse':
    case 'diamond':
      return {
        ...base,
        t: raw.t,
        x: num(raw.x),
        y: num(raw.y),
        w: Math.max(1, num(raw.w, 1)),
        h: Math.max(1, num(raw.h, 1)),
        f: fill(raw.f),
        ...(txt ? { txt } : {}),
        ...(fs ? { fs } : {}),
        ...(raw.r ? { r: true } : {}),
      };
    case 'text':
      return txt ? { ...base, t: 'text', x: num(raw.x), y: num(raw.y), txt, ...(fs ? { fs } : {}) } : null;
    case 'arrow':
      return {
        ...base,
        t: 'arrow',
        a: point(raw.a),
        b: point(raw.b),
        ...(typeof raw.from === 'string' ? { from: raw.from } : {}),
        ...(typeof raw.to === 'string' ? { to: raw.to } : {}),
        // Corner points come only from the layout of Mermaid diagrams, which draws right angles; drawings
        // laid out before arrows were stored as elbows say "straight" there and would turn straight when moved
        route:
          raw.route === 'curve' || raw.route === 'elbow' ? raw.route : Array.isArray(raw.via) && raw.via.length ? 'elbow' : 'straight',
        head: [0, 1, 2, 3].includes(raw.head) ? raw.head : 2,
        ...(typeof raw.bend === 'number' && Number.isFinite(raw.bend) ? { bend: raw.bend } : {}),
        ...(raw.axis === 'h' || raw.axis === 'v' ? { axis: raw.axis } : {}),
        ...(Array.isArray(raw.via) && raw.via.length ? { via: raw.via.slice(0, 100).map(point) } : {}),
        ...(parsePort(raw.fromPort) ? { fromPort: parsePort(raw.fromPort) } : {}),
        ...(parsePort(raw.toPort) ? { toPort: parsePort(raw.toPort) } : {}),
        ...(txt ? { txt } : {}),
        ...(fs ? { fs } : {}),
      };
    case 'draw':
      if (!Array.isArray(raw.pts) || raw.pts.length < 2) return null;
      return { ...base, t: 'draw', pts: raw.pts.map((n: unknown) => num(n)) };
    default:
      return null;
  }
}

function parsePort(raw: any): Port | undefined {
  if (!raw || !['t', 'r', 'b', 'l'].includes(raw.side)) return undefined;
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? Math.max(0, Math.min(1, raw.at)) : 0.5;
  return { side: raw.side, at };
}

/** Reads a block's content; null if it is not a drawing */
export function parseDrawing(content: string): Drawing | null {
  let raw: any;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.els)) return null;
  const els = raw.els.map(parseElement).filter(Boolean) as DrawElement[];
  const f = raw.frame;
  const frame =
    f && typeof f === 'object' && num(f.w) > 0 && num(f.h) > 0 ? { x: num(f.x), y: num(f.y), w: num(f.w), h: num(f.h) } : undefined;
  const fit = raw.fit === 'all' || raw.fit === 'readable' ? raw.fit : undefined;
  return { v: 1, ...(frame ? { frame } : {}), ...(fit ? { fit } : {}), ...(raw.grid ? { grid: true } : {}), els };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Block content for a drawing: docked arrow ends get their current points, numbers are rounded */
export function serializeDrawing(d: Drawing): string {
  const byId = elementMap(d.els);
  const els = d.els.map((el) => {
    switch (el.t) {
      case 'arrow': {
        const g = arrowGeometry(el, byId);
        return {
          ...el,
          a: [round(g.start[0]), round(g.start[1])],
          b: [round(g.end[0]), round(g.end[1])],
          ...(el.via ? { via: el.via.map((p) => [round(p[0]), round(p[1])]) } : {}),
        };
      }
      case 'draw':
        return { ...el, pts: el.pts.map(Math.round) };
      case 'text':
        return { ...el, x: round(el.x), y: round(el.y) };
      default:
        return { ...el, x: round(el.x), y: round(el.y), w: round(el.w), h: round(el.h) };
    }
  });
  const frame = d.frame ? { x: round(d.frame.x), y: round(d.frame.y), w: round(d.frame.w), h: round(d.frame.h) } : undefined;
  return JSON.stringify({ v: 1, ...(frame ? { frame } : {}), ...(d.fit ? { fit: d.fit } : {}), ...(d.grid ? { grid: true } : {}), els });
}

export function contentBytes(content: string): number {
  return new TextEncoder().encode(content).length;
}

/** The texts written in a drawing (search, screen readers) */
export function drawingTexts(d: Drawing): string[] {
  return d.els.map((el) => ('txt' in el ? el.txt || '' : '')).filter((s) => s.trim() !== '');
}

// ---------------------------------------------------------------------------------------------------------
// Geometry

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function elementMap(els: DrawElement[]): Map<string, DrawElement> {
  return new Map(els.map((el) => [el.id, el]));
}

export const isShape = (el: DrawElement | undefined): el is ShapeElement =>
  !!el && (el.t === 'rect' || el.t === 'ellipse' || el.t === 'diamond');

// Text size without a DOM in tests; in the browser a canvas measures the real font
let measureCtx: CanvasRenderingContext2D | null | undefined;
export function textWidth(text: string, fs: number): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx) {
    measureCtx.font = `${fs}px "Inter Variable", Inter, system-ui, sans-serif`;
    return measureCtx.measureText(text).width;
  }
  return text.length * fs * 0.55;
}

export const lineHeight = (fs: number) => fs * 1.3;

/** Lines of a text wrapped to a width (shapes); free text only breaks at line breaks */
export function wrapText(text: string, fs: number, maxWidth?: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!maxWidth) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line.trim() !== '' && textWidth(next.trimEnd(), fs) > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

export function textBox(el: TextElement): Box {
  const fs = el.fs || DEFAULT_FONT_SIZE;
  const lines = el.txt.split('\n');
  const w = Math.max(fs, ...lines.map((l) => textWidth(l, fs)));
  return { x: el.x, y: el.y, w, h: lines.length * lineHeight(fs) };
}

export function elementBox(el: DrawElement, byId: Map<string, DrawElement>): Box {
  switch (el.t) {
    case 'text':
      return textBox(el);
    case 'arrow':
      return boxOfPoints(arrowGeometry(el, byId).poly);
    case 'draw': {
      const pts: Point[] = [];
      for (let i = 0; i + 1 < el.pts.length; i += 2) pts.push([el.pts[i], el.pts[i + 1]]);
      const b = boxOfPoints(pts);
      return { x: b.x - el.sw / 2, y: b.y - el.sw / 2, w: b.w + el.sw, h: b.h + el.sw };
    }
    default:
      return { x: el.x, y: el.y, w: el.w, h: el.h };
  }
}

export function boxOfPoints(pts: Point[]): Box {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function contentBox(d: Drawing): Box | null {
  const byId = elementMap(d.els);
  return unionBox(d.els.map((el) => elementBox(el, byId)));
}

const center = (s: ShapeElement): Point => [s.x + s.w / 2, s.y + s.h / 2];

/** Where a ray from the shape's centre towards a point leaves its outline (plus a small gap) */
export function outlinePoint(s: ShapeElement, toward: Point, gap = 4): Point {
  const [cx, cy] = center(s);
  const dx = toward[0] - cx;
  let dy = toward[1] - cy;
  if (dx === 0 && dy === 0) dy = -1;
  const hw = s.w / 2;
  const hh = s.h / 2;
  let t: number;
  if (s.t === 'ellipse') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (s.t === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  const len = Math.hypot(dx, dy);
  const g = gap / len;
  return [cx + dx * (t + g), cy + dy * (t + g)];
}

/** Middle of the side facing a direction (elbow arrows leave and enter straight) */
function sidePoint(s: ShapeElement, side: 'l' | 'r' | 't' | 'b', gap = 4): Point {
  const [cx, cy] = center(s);
  if (side === 'l') return [s.x - gap, cy];
  if (side === 'r') return [s.x + s.w + gap, cy];
  if (side === 't') return [cx, s.y - gap];
  return [cx, s.y + s.h + gap];
}

/**
 * Whether an elbow arrow runs sideways (out of the left or right side) or up and down: by the free space
 * between its shapes, so shapes stacked in a diagram from top to bottom keep vertical lines even when one
 * sits far to the side (as laid out from Mermaid). Without two shapes, or when they overlap, the longer
 * distance decides.
 */
export function elbowHorizontal(from: ShapeElement | undefined, to: ShapeElement | undefined, a: Point, b: Point): boolean {
  if (from && to) {
    const gapX = Math.max(to.x - (from.x + from.w), from.x - (to.x + to.w));
    const gapY = Math.max(to.y - (from.y + from.h), from.y - (to.y + to.h));
    if (gapX > 0 || gapY > 0) return gapX > gapY;
  }
  return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
}

/**
 * An elbow line in one direction: out of the side of its start shape, along to the middle stretch at share
 * t of the way, across, and into the side of its end shape. handle: middle of the middle stretch.
 */
export function elbowPath(from: ShapeElement | undefined, to: ShapeElement | undefined, rawA: Point, rawB: Point, horizontal: boolean, t: number) {
  const a: Point = from ? sidePoint(from, horizontal ? (rawB[0] >= rawA[0] ? 'r' : 'l') : rawB[1] >= rawA[1] ? 'b' : 't') : rawA;
  const b: Point = to ? sidePoint(to, horizontal ? (rawB[0] >= rawA[0] ? 'l' : 'r') : rawB[1] >= rawA[1] ? 't' : 'b') : rawB;
  const poly: Point[] = horizontal
    ? [a, [a[0] + (b[0] - a[0]) * t, a[1]], [a[0] + (b[0] - a[0]) * t, b[1]], b]
    : [a, [a[0], a[1] + (b[1] - a[1]) * t], [b[0], a[1] + (b[1] - a[1]) * t], b];
  const clean = poly.filter((p, i) => i === 0 || p[0] !== poly[i - 1][0] || p[1] !== poly[i - 1][1]);
  const handle: Point = [(poly[1][0] + poly[2][0]) / 2, (poly[1][1] + poly[2][1]) / 2];
  return { a, b, poly: clean, handle };
}

/** Half the extent of a shape at an offset from its centre: its half height at dx (axis 'x'), or half width at dy */
function halfExtentAt(s: ShapeElement, axis: 'x' | 'y', d: number): number {
  const [half, other] = axis === 'x' ? [s.w / 2, s.h / 2] : [s.h / 2, s.w / 2];
  const r = Math.min(1, Math.abs(d) / half);
  if (s.t === 'ellipse') return other * Math.sqrt(1 - r * r);
  if (s.t === 'diamond') return other * (1 - r);
  return other;
}

/**
 * Where a right-angled line towards a corner meets a shape (or a free end): straight up or down when the
 * corner lies above or below the shape, sideways when beside it, else out of the middle of the side facing
 * the longer way with one more corner. The first point is the end of the line.
 */
function orthoDock(s: ShapeElement | undefined, free: Point, toward: Point, gap = 4): Point[] {
  if (!s) {
    if (Math.abs(free[0] - toward[0]) < 0.5 || Math.abs(free[1] - toward[1]) < 0.5) return [free];
    return [free, [free[0], toward[1]]];
  }
  const [cx, cy] = center(s);
  const inX = toward[0] > s.x + 1 && toward[0] < s.x + s.w - 1;
  const inY = toward[1] > s.y + 1 && toward[1] < s.y + s.h - 1;
  if (inX && inY) return [outlinePoint(s, toward)];
  if (inX) {
    const off = halfExtentAt(s, 'x', toward[0] - cx) + gap;
    return [[toward[0], toward[1] < cy ? cy - off : cy + off]];
  }
  if (inY) {
    const off = halfExtentAt(s, 'y', toward[1] - cy) + gap;
    return [[toward[0] < cx ? cx - off : cx + off, toward[1]]];
  }
  if (Math.abs(toward[1] - cy) - s.h / 2 >= Math.abs(toward[0] - cx) - s.w / 2) {
    return [[cx, toward[1] < cy ? s.y - gap : s.y + s.h + gap], [cx, toward[1]]];
  }
  return [[toward[0] < cx ? s.x - gap : s.x + s.w + gap, cy], [toward[0], cy]];
}

/** Drops repeated points and corners in the middle of a straight run (the ends stay) */
function tidyCorners(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 0.5 && Math.abs(last[1] - p[1]) < 0.5) continue;
    out.push(p);
  }
  for (let i = 1; i + 1 < out.length; ) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    const straight = (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5) || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5);
    if (straight) out.splice(i, 1);
    else i++;
  }
  return out;
}

const samePoint = (p: Point, q: Point) => Math.abs(p[0] - q[0]) < 0.5 && Math.abs(p[1] - q[1]) < 0.5;

/**
 * Stretches of an elbow (as in Excalidraw): fixed ones run between two corners of its own (laid out or
 * dragged), the others are made up to reach the shapes. One flag per stretch of the drawn line.
 */
export function fixedStretches(poly: Point[], via: Point[] | undefined): boolean[] {
  const own = (p: Point) => !!via && via.some((q) => samePoint(p, q));
  return poly.slice(1).map((q, i) => own(poly[i]) && own(q));
}

/**
 * Corners of an elbow that are left after a change: those its drawn line still runs through (a stretch
 * without length or one running on with its neighbour drops out of the drawing, its corners go here too).
 * undefined: no change.
 */
export function settleCorners(el: ArrowElement, byId: Map<string, DrawElement>): { via?: Point[] } | undefined {
  if (el.route !== 'elbow' || !el.via) return undefined;
  const drawn = arrowGeometry(el, byId).poly;
  const via = el.via.filter((q) => drawn.some((p) => samePoint(p, q)));
  if (via.length === el.via.length) return undefined;
  return { via: via.length ? via : undefined };
}

/**
 * The corners of an elbow after removing a fixed stretch (double click on its handle): its two corners go,
 * the corners on both sides are joined at a right angle. undefined: nothing of its own is left, the line
 * runs by itself again.
 */
export function releaseSegment(via: Point[], from: Point, to: Point): Point[] | undefined {
  const i = via.findIndex((q) => samePoint(q, from));
  const j = via.findIndex((q) => samePoint(q, to));
  if (i < 0 || j < 0) return via;
  const [lo, hi] = i < j ? [i, j] : [j, i];
  const before = via.slice(0, lo);
  const after = via.slice(hi + 1);
  const prev = before[before.length - 1];
  const next = after[0];
  const join: Point[] = [];
  if (prev && next && Math.abs(prev[0] - next[0]) > 0.5 && Math.abs(prev[1] - next[1]) > 0.5) {
    // Keep the way the stretch before ran: upright on, then across (or the other way round)
    join.push(Math.abs(prev[0] - via[lo][0]) < 0.5 ? [prev[0], next[1]] : [next[0], prev[1]]);
  }
  const out = tidyCorners([...before, ...join, ...after]);
  return out.length ? out : undefined;
}

// Length of the short straight piece out of a shape (or an end) before a line turns
const STUB = 14;

/**
 * The corners of an elbow after moving stretch k of its drawn line (poly, ends included) across through p.
 * The moved stretch becomes fixed (both its corners its own). A stretch touching an end leaves a short stub
 * at that end, so the end stays where it is (as in Excalidraw); a straight line becomes a bracket.
 */
export function dragSegment(poly: Point[], k: number, p: Point): Point[] {
  const n = poly.length;
  const level = Math.abs(poly[k][1] - poly[k + 1][1]) < 0.5;
  const axis = level ? 1 : 0;
  const along = 1 - axis;
  // A point a stub away from an end, towards the other end of the stretch
  const stub = (end: Point, toward: Point): Point => {
    const q: Point = [end[0], end[1]];
    q[along] += (Math.sign(toward[along] - end[along]) || 1) * STUB;
    return q;
  };
  const moved = (q: Point): Point => {
    const r: Point = [q[0], q[1]];
    r[axis] = p[axis];
    return r;
  };
  if (n === 2) {
    const s = stub(poly[0], poly[1]);
    const e = stub(poly[1], poly[0]);
    return [s, moved(s), moved(e), e];
  }
  const inner = poly.slice(1, -1).map((q) => [q[0], q[1]] as Point);
  if (k === 0) {
    const s = stub(poly[0], poly[1]);
    return [s, moved(s), moved(inner[0]), ...inner.slice(1)];
  }
  if (k === n - 2) {
    const e = stub(poly[n - 1], poly[n - 2]);
    return [...inner.slice(0, -1), moved(inner[inner.length - 1]), moved(e), e];
  }
  inner[k - 1][axis] = p[axis];
  inner[k][axis] = p[axis];
  return inner;
}

const SIDE_DIR: Record<Side, Point> = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] };

/** The point on a shape's outline at a port (a little outside it), and the way out of it */
export function portPoint(s: ShapeElement, port: Port, gap = 4): { at: Point; dir: Point } {
  const [cx, cy] = center(s);
  const dir = SIDE_DIR[port.side];
  if (port.side === 't' || port.side === 'b') {
    const x = s.x + s.w * port.at;
    const off = halfExtentAt(s, 'x', x - cx) + gap;
    return { at: [x, port.side === 't' ? cy - off : cy + off], dir };
  }
  const y = s.y + s.h * port.at;
  const off = halfExtentAt(s, 'y', y - cy) + gap;
  return { at: [port.side === 'l' ? cx - off : cx + off, y], dir };
}

/**
 * The port an end dragged to p docks to: the nearest side and the spot on it, snapping to the middle of
 * the side; undefined near the shape's centre (the line takes the side facing the other end).
 */
export function portNear(s: ShapeElement, p: Point): Port | undefined {
  const dl = p[0] - s.x, dr = s.x + s.w - p[0], dt = p[1] - s.y, db = s.y + s.h - p[1];
  const reach = Math.max(10, Math.min(s.w, s.h) * 0.3);
  const near = Math.min(Math.abs(dl), Math.abs(dr), Math.abs(dt), Math.abs(db));
  if (near > reach && dl > 0 && dr > 0 && dt > 0 && db > 0) return undefined;
  const side: Side = near === Math.abs(dt) ? 't' : near === Math.abs(db) ? 'b' : near === Math.abs(dl) ? 'l' : 'r';
  let at = side === 't' || side === 'b' ? (p[0] - s.x) / s.w : (p[1] - s.y) / s.h;
  at = Math.max(0.08, Math.min(0.92, at));
  if (Math.abs(at - 0.5) < 0.1) at = 0.5;
  return { side, at: Math.round(at * 100) / 100 };
}

/**
 * A plain right-angled line between two ports (or a port and a free end): straight out of each by a short
 * stub, then the shortest of a few ways with one or two corners that never turns back on itself and stays
 * out of the two shapes. No searching round other shapes.
 */
function connectPorts(a: Point, da: Point, b: Point, db: Point, own: ShapeElement[]): Point[] {
  const s: Point = [a[0] + da[0] * STUB, a[1] + da[1] * STUB];
  const e: Point = [b[0] + db[0] * STUB, b[1] + db[1] * STUB];
  const xs = [(s[0] + e[0]) / 2, Math.min(s[0], e[0]), Math.max(s[0], e[0])];
  const ys = [(s[1] + e[1]) / 2, Math.min(s[1], e[1]), Math.max(s[1], e[1])];
  const middles: Point[][] = [[[e[0], s[1]]], [[s[0], e[1]]], ...xs.map((m): Point[] => [[m, s[1]], [m, e[1]]]), ...ys.map((m): Point[] => [[s[0], m], [e[0], m]])];
  const inside = (p: Point, q: Point) =>
    own.some((o) => {
      const [x0, x1, y0, y1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])];
      return x1 > o.x + 1 && x0 < o.x + o.w - 1 && y1 > o.y + 1 && y0 < o.y + o.h - 1;
    });
  let best: Point[] = tidyCorners([a, s, [e[0], s[1]], e, b]);
  let bestCost = Infinity;
  for (const mid of middles) {
    const poly = tidyCorners([a, s, ...mid, e, b]);
    let cost = 0;
    let ok = true;
    for (let i = 1; i < poly.length; i++) {
      const [p, q] = [poly[i - 1], poly[i]];
      cost += Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + (i > 1 ? 40 : 0);
      // Out of a never back against its way out, into b never against its way in
      if (i === 1 && ((q[0] - p[0]) * da[0] < -0.5 || (q[1] - p[1]) * da[1] < -0.5)) ok = false;
      if (i === poly.length - 1 && ((p[0] - q[0]) * db[0] < -0.5 || (p[1] - q[1]) * db[1] < -0.5)) ok = false;
      if (i > 1 && i < poly.length - 1 && inside(p, q)) cost += 1000;
    }
    if (ok && cost < bestCost) {
      best = poly;
      bestCost = cost;
    }
  }
  return best;
}

/** Where an arrow's label sits: on the line, or just above it on a level stretch */
export function arrowLabelBox(el: ArrowElement, g: ArrowGeometry): Box & { level: boolean } {
  const fs = el.fs || ARROW_FONT_SIZE;
  const lines = (el.txt || '').split('\n');
  const w = Math.max(...lines.map((l) => textWidth(l, fs))) + 10;
  const h = lines.length * lineHeight(fs) + 4;
  const level = levelAt(g.poly, g.labelAt);
  const cy = level ? g.labelAt[1] - h / 2 - 2 : g.labelAt[1];
  return { x: g.labelAt[0] - w / 2, y: cy - h / 2, w, h, level };
}

/**
 * Labels of arrows that would cover each other move aside: on a level line below it instead of above, on
 * an upright one a little up or down. One pass in drawing order, a few tries per label; worked out when a
 * change is done, not while dragging. Result: shifts by arrow id (none: where it is).
 */
export function spreadLabels(els: DrawElement[]): Map<string, Point> {
  const byId = elementMap(els);
  const placed: Box[] = [];
  const out = new Map<string, Point>();
  const hits = (b: Box) => placed.some((o) => b.x < o.x + o.w + 2 && o.x < b.x + b.w + 2 && b.y < o.y + o.h + 2 && o.y < b.y + b.h + 2);
  for (const el of els) {
    if (el.t !== 'arrow' || !el.txt) continue;
    const box = arrowLabelBox(el, arrowGeometry(el, byId));
    const step = box.h + 4;
    const tries: Point[] = box.level ? [[0, 0], [0, step], [0, -step], [0, 2 * step]] : [[0, 0], [0, -step], [0, step], [0, -2 * step], [0, 2 * step]];
    const shift = tries.find(([dx, dy]) => !hits({ ...box, x: box.x + dx, y: box.y + dy })) || [0, 0];
    placed.push({ ...box, x: box.x + shift[0], y: box.y + shift[1] });
    if (shift[0] || shift[1]) out.set(el.id, shift);
  }
  return out;
}

/** Whether the stretch of a line that a point lies on runs level (a label sits above it then) */
export function levelAt(poly: Point[], at: Point): boolean {
  let best = Infinity;
  let level = false;
  for (let i = 1; i < poly.length; i++) {
    const [p, q] = [poly[i - 1], poly[i]];
    const lx = Math.min(p[0], q[0]), hx = Math.max(p[0], q[0]), ly = Math.min(p[1], q[1]), hy = Math.max(p[1], q[1]);
    const d = Math.hypot(at[0] - Math.max(lx, Math.min(hx, at[0])), at[1] - Math.max(ly, Math.min(hy, at[1])));
    if (d < best) {
      best = d;
      level = Math.abs(q[1] - p[1]) < 0.5 && Math.abs(q[0] - p[0]) > 0.5;
    }
  }
  return level;
}

export interface ArrowGeometry {
  start: Point;
  end: Point;
  /** SVG path of the line */
  d: string;
  /** The line as points (hit test, bounds) */
  poly: Point[];
  /** Directions the heads point in, in radians */
  startAngle: number;
  endAngle: number;
  /** Curves: the point the middle handle sits on */
  mid: Point;
  /** Where the label sits: halfway along the line */
  labelAt: Point;
}

/** Point halfway along a line of points */
export function halfway(poly: Point[]): Point {
  let total = 0;
  for (let i = 1; i < poly.length; i++) total += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  let left = total / 2;
  for (let i = 1; i < poly.length; i++) {
    const len = Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    if (len >= left && len > 0) {
      const t = left / len;
      return [poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * t, poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * t];
    }
    left -= len;
  }
  return poly[0] || [0, 0];
}

export const DEFAULT_BEND = 0.25;

export function arrowGeometry(el: ArrowElement, byId: Map<string, DrawElement>): ArrowGeometry {
  const fromEl = el.from ? byId.get(el.from) : undefined;
  const toEl = el.to ? byId.get(el.to) : undefined;
  const from = isShape(fromEl) ? fromEl : undefined;
  const to = isShape(toEl) ? toEl : undefined;
  // Raw ends: centres of docked shapes, otherwise the stored points
  const rawA: Point = from ? center(from) : el.a;
  const rawB: Point = to ? center(to) : el.b;

  if (el.route === 'elbow' && el.via && el.via.length) {
    // Corners of its own (laid out or dragged): the ends meet their shapes at right angles wherever they sit now
    const via = el.via;
    const head = (sh: ShapeElement | undefined, port: Port | undefined, free: Point, corner: Point): Point[] => {
      if (!sh || !port) return orthoDock(sh, free, corner);
      // Straight out of the port; a corner elsewhere is reached after a short stub
      const pp = portPoint(sh, port);
      // A corner straight ahead (within a few pixels: stored spots are rounded) is reached in a straight line
      const ahead =
        pp.dir[0] !== 0
          ? Math.abs(corner[1] - pp.at[1]) < 3 && (corner[0] - pp.at[0]) * pp.dir[0] > 0
          : Math.abs(corner[0] - pp.at[0]) < 3 && (corner[1] - pp.at[1]) * pp.dir[1] > 0;
      if (ahead) return [pp.dir[0] !== 0 ? [pp.at[0], corner[1]] : [corner[0], pp.at[1]]];
      const out: Point = [pp.at[0] + pp.dir[0] * STUB, pp.at[1] + pp.dir[1] * STUB];
      const turn: Point = pp.dir[0] !== 0 ? [out[0], corner[1]] : [corner[0], out[1]];
      return [pp.at, out, turn];
    };
    const poly = tidyCorners([...head(from, el.fromPort, el.a, via[0]), ...via, ...head(to, el.toPort, el.b, via[via.length - 1]).reverse()]);
    const n = poly.length;
    const angle = (p: Point, q: Point) => Math.atan2(q[1] - p[1], q[0] - p[0]);
    // The label sits on the last stretch: lines of a fork share their first ones
    const labelAt: Point = n >= 3 ? [(poly[n - 2][0] + poly[n - 1][0]) / 2, (poly[n - 2][1] + poly[n - 1][1]) / 2] : halfway(poly);
    return {
      start: poly[0],
      end: poly[n - 1],
      d: 'M ' + poly.map((p) => `${p[0]} ${p[1]}`).join(' L '),
      poly,
      startAngle: n > 1 ? angle(poly[1], poly[0]) : 0,
      endAngle: n > 1 ? angle(poly[n - 2], poly[n - 1]) : 0,
      mid: halfway(poly),
      labelAt,
    };
  }

  if (el.via && el.via.length) {
    // Laid out line: from the shape's edge towards the first corner, through the corners, into the target
    const via = el.via;
    const a = from ? outlinePoint(from, via[0]) : el.a;
    const b = to ? outlinePoint(to, via[via.length - 1]) : el.b;
    const poly: Point[] = [a, ...via, b];
    const n = poly.length;
    return {
      start: a,
      end: b,
      d: 'M ' + poly.map((p) => `${p[0]} ${p[1]}`).join(' L '),
      poly,
      startAngle: Math.atan2(a[1] - poly[1][1], a[0] - poly[1][0]),
      endAngle: Math.atan2(b[1] - poly[n - 2][1], b[0] - poly[n - 2][0]),
      mid: halfway(poly),
      labelAt: halfway(poly),
    };
  }

  if (el.route === 'elbow' && ((from && el.fromPort) || (to && el.toPort))) {
    // Docked to chosen sides: the other end faces it, a plain way between the two
    const A = from && el.fromPort ? portPoint(from, el.fromPort) : null;
    const B = to && el.toPort ? portPoint(to, el.toPort) : null;
    const facingSide = (p: Point, q: Point): Side => (Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) ? (q[0] >= p[0] ? 'r' : 'l') : q[1] >= p[1] ? 'b' : 't');
    const a = A || (from ? portPoint(from, { side: facingSide(rawA, B!.at), at: 0.5 }) : { at: el.a, dir: SIDE_DIR[facingSide(el.a, B!.at)] });
    const b = B || (to ? portPoint(to, { side: facingSide(rawB, A!.at), at: 0.5 }) : { at: el.b, dir: SIDE_DIR[facingSide(el.b, A!.at)] });
    const poly = connectPorts(a.at, a.dir, b.at, b.dir, [from, to].filter((x): x is ShapeElement => !!x));
    const n = poly.length;
    const angle = (p: Point, q: Point) => Math.atan2(q[1] - p[1], q[0] - p[0]);
    return {
      start: poly[0],
      end: poly[n - 1],
      d: 'M ' + poly.map((p) => `${p[0]} ${p[1]}`).join(' L '),
      poly,
      startAngle: angle(poly[1], poly[0]),
      endAngle: angle(poly[n - 2], poly[n - 1]),
      mid: halfway(poly),
      labelAt: halfway(poly),
    };
  }

  if (el.route === 'elbow') {
    // Middle stretch halfway (older drawings: where it was dragged to); no searching round shapes
    const horizontal = el.axis ? el.axis === 'h' : elbowHorizontal(from, to, rawA, rawB);
    const best = elbowPath(from, to, rawA, rawB, horizontal, el.bend ?? 0.5);
    const clean = best.poly;
    const angle = (p: Point, q: Point) => Math.atan2(q[1] - p[1], q[0] - p[0]);
    return {
      start: best.a,
      end: best.b,
      d: 'M ' + clean.map((p) => `${p[0]} ${p[1]}`).join(' L '),
      poly: clean,
      startAngle: clean.length > 1 ? angle(clean[1], clean[0]) : 0,
      endAngle: clean.length > 1 ? angle(clean[clean.length - 2], clean[clean.length - 1]) : 0,
      mid: best.handle,
      labelAt: best.handle,
    };
  }

  if (el.route === 'curve') {
    const bend = el.bend ?? DEFAULT_BEND;
    const control = (p: Point, q: Point): Point => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const nx = -(q[1] - p[1]) / len;
      const ny = (q[0] - p[0]) / len;
      return [(p[0] + q[0]) / 2 + nx * len * bend, (p[1] + q[1]) / 2 + ny * len * bend];
    };
    // Dock towards the control point, so the line leaves the shape in the direction it curves
    const c0 = control(rawA, rawB);
    const a = from ? outlinePoint(from, c0) : rawA;
    const b = to ? outlinePoint(to, c0) : rawB;
    const c = control(a, b);
    // Quadratic curve through the handle: control = 2·mid − (a + b)/2
    const m: Point = [(a[0] + b[0]) / 4 + c[0] / 2, (a[1] + b[1]) / 4 + c[1] / 2];
    const poly: Point[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const u = 1 - t;
      poly.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
    return {
      start: a,
      end: b,
      d: `M ${a[0]} ${a[1]} Q ${c[0]} ${c[1]} ${b[0]} ${b[1]}`,
      poly,
      startAngle: Math.atan2(a[1] - c[1], a[0] - c[0]),
      endAngle: Math.atan2(b[1] - c[1], b[0] - c[0]),
      mid: m,
      labelAt: m,
    };
  }

  const a = from ? outlinePoint(from, rawB) : rawA;
  const b = to ? outlinePoint(to, a) : rawB;
  return {
    start: a,
    end: b,
    d: `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`,
    poly: [a, b],
    startAngle: Math.atan2(a[1] - b[1], a[0] - b[0]),
    endAngle: Math.atan2(b[1] - a[1], b[0] - a[0]),
    mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    labelAt: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
  };
}

/** Bend of a curve so its middle passes through a point (dragging the middle handle) */
export function bendThrough(a: Point, b: Point, p: Point): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  // The curve's middle lies halfway between the chord and the control point
  return (((p[0] - mx) * nx + (p[1] - my) * ny) * 2) / len;
}

/** Path of the two strokes of an arrow head at a point */
export function arrowHeadPath(at: Point, angle: number, size: number): string {
  const a1 = angle + Math.PI - 0.45;
  const a2 = angle + Math.PI + 0.45;
  return `M ${at[0] + Math.cos(a1) * size} ${at[1] + Math.sin(a1) * size} L ${at[0]} ${at[1]} L ${at[0] + Math.cos(a2) * size} ${at[1] + Math.sin(a2) * size}`;
}

/** Smooth path through freehand points (midpoints as curve ends) */
export function freehandPath(pts: number[]): string {
  const n = Math.floor(pts.length / 2);
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0]} ${pts[1]} l 0.01 0`;
  if (n === 2) return `M ${pts[0]} ${pts[1]} L ${pts[2]} ${pts[3]}`;
  let d = `M ${pts[0]} ${pts[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    const mx = (x + pts[i * 2 + 2]) / 2;
    const my = (y + pts[i * 2 + 3]) / 2;
    d += ` Q ${x} ${y} ${mx} ${my}`;
  }
  d += ` L ${pts[(n - 1) * 2]} ${pts[(n - 1) * 2 + 1]}`;
  return d;
}

/** Ramer–Douglas–Peucker: drops points that lie within epsilon of the line, keeps the shape */
export function simplifyPoints(pts: Point[], epsilon: number): Point[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function distToPolyline(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) best = Math.min(best, distToSegment(p, poly[i], poly[i + 1]));
  return poly.length === 1 ? Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]) : best;
}

/** Is a point inside a shape's outline (grown by a margin)? */
export function insideShape(s: ShapeElement, p: Point, margin = 0): boolean {
  const hw = s.w / 2 + margin;
  const hh = s.h / 2 + margin;
  const dx = p[0] - (s.x + s.w / 2);
  const dy = p[1] - (s.y + s.h / 2);
  if (s.t === 'ellipse') return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1;
  if (s.t === 'diamond') return Math.abs(dx) / hw + Math.abs(dy) / hh <= 1;
  return Math.abs(dx) <= hw && Math.abs(dy) <= hh;
}

/** Topmost element at a point; tol in drawing units */
export function hitTest(els: DrawElement[], p: Point, tol: number): DrawElement | null {
  const byId = elementMap(els);
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (isShape(el)) {
      if (insideShape(el, p, tol)) return el;
    } else if (el.t === 'text') {
      const b = textBox(el);
      if (p[0] >= b.x - tol && p[0] <= b.x + b.w + tol && p[1] >= b.y - tol && p[1] <= b.y + b.h + tol) return el;
    } else if (el.t === 'arrow') {
      if (distToPolyline(p, arrowGeometry(el, byId).poly) <= tol + el.sw) return el;
    } else {
      const poly: Point[] = [];
      for (let k = 0; k + 1 < el.pts.length; k += 2) poly.push([el.pts[k], el.pts[k + 1]]);
      if (distToPolyline(p, poly) <= tol + el.sw / 2) return el;
    }
  }
  return null;
}

/** Topmost shape under a point, for docking arrow ends */
export function shapeAt(els: DrawElement[], p: Point, margin: number, exclude?: string): ShapeElement | null {
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (isShape(el) && el.id !== exclude && insideShape(el, p, margin)) return el;
  }
  return null;
}

export function boxContains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Moves elements; docked arrow ends follow their shapes by themselves */
export function moveElement(el: DrawElement, dx: number, dy: number): DrawElement {
  switch (el.t) {
    case 'arrow':
      return {
        ...el,
        a: [el.a[0] + dx, el.a[1] + dy],
        b: [el.b[0] + dx, el.b[1] + dy],
        ...(el.via ? { via: el.via.map((p) => [p[0] + dx, p[1] + dy] as Point) } : {}),
        ver: el.ver + 1,
      };
    case 'draw':
      return { ...el, pts: el.pts.map((n, i) => n + (i % 2 === 0 ? dx : dy)), ver: el.ver + 1 };
    default:
      return { ...el, x: el.x + dx, y: el.y + dy, ver: el.ver + 1 };
  }
}

/** Removes elements; arrows docked to them keep their current end as a free point */
export function removeElements(els: DrawElement[], ids: Set<string>): DrawElement[] {
  const byId = elementMap(els);
  return els
    .filter((el) => !ids.has(el.id))
    .map((el) => {
      if (el.t !== 'arrow' || (!(el.from && ids.has(el.from)) && !(el.to && ids.has(el.to)))) return el;
      const g = arrowGeometry(el, byId);
      const next: ArrowElement = { ...el, a: g.start, b: g.end, ver: el.ver + 1 };
      if (el.from && ids.has(el.from)) delete next.from;
      if (el.to && ids.has(el.to)) delete next.to;
      return next;
    });
}

/** Zoom factor for a wheel step: a mouse notch about 20 %, trackpad pinches in small steps */
export function wheelZoom(deltaY: number): number {
  return Math.exp(-Math.max(-50, Math.min(50, deltaY)) * 0.004);
}

/** Arrows other than elbows docked to shapes that moved lose their corner points; elbows keep theirs, their ends follow */
export function dropStaleVia(els: DrawElement[], changed: Set<string>): DrawElement[] {
  return els.map((el) => {
    if (el.t !== 'arrow' || !el.via || el.route === 'elbow' || changed.has(el.id)) return el;
    if ((el.from && changed.has(el.from)) || (el.to && changed.has(el.to))) {
      const next: ArrowElement = { ...el };
      delete next.via;
      return next;
    }
    return el;
  });
}

export const snap = (n: number, on: boolean) => (on ? Math.round(n / GRID_SIZE) * GRID_SIZE : n);
