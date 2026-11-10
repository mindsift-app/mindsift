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
  /** Curves: how far the middle bends away from the straight line, as a share of its length. Elbows: where
   * the middle stretch lies, as a share of the way from start to end (set by dragging it; else it is
   * placed to go round other shapes) */
  bend?: number;
  /** Elbows with a middle stretch placed by hand: whether the line leaves sideways ('h') or up and down ('v') */
  axis?: 'h' | 'v';
  /** Corner points the line runs through (laid out diagrams); dropped when a docked shape moves */
  via?: Point[];
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
  return { v: 1, ...(frame ? { frame } : {}), ...(raw.grid ? { grid: true } : {}), els };
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
  return JSON.stringify({ v: 1, ...(frame ? { frame } : {}), ...(d.grid ? { grid: true } : {}), els });
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

// Positions of an elbow's middle stretch tried when it would cross a shape (share of the way from start to end)
const ELBOW_TRIES = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9, 0.03, 0.97];

/**
 * An elbow line in one direction: out of the side of its start shape, along to the middle stretch at share
 * t of the way, across, and into the side of its end shape. handle: middle of the middle stretch (it is
 * dragged there to move it).
 */
export function elbowPath(from: ShapeElement | undefined, to: ShapeElement | undefined, rawA: Point, rawB: Point, horizontal: boolean, t: number) {
  const a: Point = from ? sidePoint(from, horizontal ? (rawB[0] >= rawA[0] ? 'r' : 'l') : rawB[1] >= rawA[1] ? 'b' : 't') : rawA;
  const b: Point = to ? sidePoint(to, horizontal ? (rawB[0] >= rawA[0] ? 'l' : 'r') : rawB[1] >= rawA[1] ? 't' : 'b') : rawB;
  const poly: Point[] = horizontal
    ? [a, [a[0] + (b[0] - a[0]) * t, a[1]], [a[0] + (b[0] - a[0]) * t, b[1]], b]
    : [a, [a[0], a[1] + (b[1] - a[1]) * t], [b[0], a[1] + (b[1] - a[1]) * t], b];
  const clean = poly.filter((p, i) => i === 0 || p[0] !== poly[i - 1][0] || p[1] !== poly[i - 1][1]);
  const handle: Point = [(poly[1][0] + poly[2][0]) / 2, (poly[1][1] + poly[2][1]) / 2];
  return { a, b, poly: clean, handle, horizontal };
}

/** Share of the way for an elbow's middle stretch through a point (dragging its handle) */
export function elbowShareThrough(a: Point, b: Point, horizontal: boolean, p: Point): number {
  const span = horizontal ? b[0] - a[0] : b[1] - a[1];
  if (Math.abs(span) < 1) return 0.5;
  const t = ((horizontal ? p[0] - a[0] : p[1] - a[1]) / span);
  return Math.max(0, Math.min(1, t));
}

/** Whether a line of right-angled stretches passes through a shape's box (grown by margin) */
function polyHitsBox(poly: Point[], s: ShapeElement, margin: number): boolean {
  const x0 = s.x - margin, x1 = s.x + s.w + margin, y0 = s.y - margin, y1 = s.y + s.h + margin;
  for (let i = 1; i < poly.length; i++) {
    const [p, q] = [poly[i - 1], poly[i]];
    const lx = Math.min(p[0], q[0]), hx = Math.max(p[0], q[0]), ly = Math.min(p[1], q[1]), hy = Math.max(p[1], q[1]);
    if (hx >= x0 && lx <= x1 && hy >= y0 && ly <= y1) return true;
  }
  return false;
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
  /** Elbows: whether the line leaves sideways */
  horizontal?: boolean;
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

  if (el.route === 'elbow') {
    // Shapes the line should go round: every shape but its own two
    const obstacles: ShapeElement[] = [];
    for (const other of byId.values()) if (isShape(other) && other !== from && other !== to) obstacles.push(other);
    const build = (horizontal: boolean, t: number) => elbowPath(from, to, rawA, rawB, horizontal, t);
    const preferred = el.axis ? el.axis === 'h' : elbowHorizontal(from, to, rawA, rawB);
    let best = build(preferred, el.bend ?? 0.5);
    if (el.bend === undefined && obstacles.length) {
      // No middle chosen by hand: the first position of the middle stretch (from the centre outwards) that
      // crosses no other shape, else the other direction, else the one crossing the fewest
      let bestHits = Infinity;
      for (const horizontal of [preferred, !preferred]) {
        for (const t of ELBOW_TRIES) {
          const cand = build(horizontal, t);
          const hits = obstacles.filter((o) => polyHitsBox(cand.poly, o, 6)).length;
          if (hits < bestHits) {
            best = cand;
            bestHits = hits;
          }
          if (hits === 0) break;
        }
        if (bestHits === 0) break;
      }
    }
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
      horizontal: best.horizontal,
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

/** Arrows docked to shapes that moved or changed size lose their corner points (they no longer fit) */
export function dropStaleVia(els: DrawElement[], changed: Set<string>): DrawElement[] {
  return els.map((el) => {
    if (el.t !== 'arrow' || !el.via || changed.has(el.id)) return el;
    if ((el.from && changed.has(el.from)) || (el.to && changed.has(el.to))) {
      const next: ArrowElement = { ...el };
      delete next.via;
      return next;
    }
    return el;
  });
}

export const snap = (n: number, on: boolean) => (on ? Math.round(n / GRID_SIZE) * GRID_SIZE : n);
