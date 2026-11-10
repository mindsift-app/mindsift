import { describe, expect, it } from 'vitest';
import {
  ArrowElement,
  ShapeElement,
  arrowGeometry,
  bendThrough,
  contentBox,
  dragSegment,
  fixedStretches,
  releaseSegment,
  settleCorners,
  dropStaleVia,
  drawingTexts,
  elementMap,
  hitTest,
  outlinePoint,
  portNear,
  parseDrawing,
  removeElements,
  serializeDrawing,
  simplifyPoints,
  spreadLabels,
} from '../model';
import { nextSize, previewLayout } from '../../../features/workspace/drawing/DrawingBlock';

const rect = (id: string, x: number, y: number, extra: Partial<ShapeElement> = {}): ShapeElement => ({
  id,
  ver: 1,
  t: 'rect',
  x,
  y,
  w: 100,
  h: 50,
  s: 'main',
  f: 'none',
  sw: 2,
  ...extra,
});

const arrow = (extra: Partial<ArrowElement> = {}): ArrowElement => ({
  id: 'a1',
  ver: 1,
  t: 'arrow',
  a: [0, 0],
  b: [100, 0],
  route: 'straight',
  head: 2,
  s: 'main',
  sw: 2,
  ...extra,
});

describe('parseDrawing', () => {
  it('reads what serializeDrawing writes', () => {
    const d = { v: 1 as const, grid: true, frame: { x: 1, y: 2, w: 300, h: 150 }, els: [rect('r1', 10, 20, { txt: 'Start' })] };
    expect(parseDrawing(serializeDrawing(d))).toEqual(d);
  });

  it('rejects text that is not a drawing', () => {
    expect(parseDrawing('Einkaufen gehen')).toBeNull();
    expect(parseDrawing('{"foo":1}')).toBeNull();
  });

  it('drops unknown elements and fixes bad values instead of failing', () => {
    const d = parseDrawing('{"v":1,"els":[{"id":"x","t":"script"},{"id":"r","t":"rect","x":"1","y":2,"w":-5,"h":3,"s":"#f00","f":"url(evil)"}]}');
    expect(d?.els).toHaveLength(1);
    expect(d?.els[0]).toMatchObject({ t: 'rect', x: 0, w: 1, s: 'main', f: 'none' });
  });
});

describe('arrows', () => {
  it('dock to the outline of their shapes and follow them', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 300, 0);
    const ar = arrow({ from: 'a', to: 'b' });
    const g = arrowGeometry(ar, elementMap([a, b, ar]));
    // Right edge of a (x = 100) and left edge of b (x = 300), with the small gap
    expect(g.start[0]).toBeCloseTo(104);
    expect(g.end[0]).toBeCloseTo(296);
    expect(g.start[1]).toBeCloseTo(25);

    const moved = { ...b, y: 200 };
    const g2 = arrowGeometry(ar, elementMap([a, moved, ar]));
    expect(g2.end[1]).toBeGreaterThan(150);
  });

  it('go round corners when elbowed', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 300, 200);
    const ar = arrow({ from: 'a', to: 'b', route: 'elbow' });
    const g = arrowGeometry(ar, elementMap([a, b, ar]));
    expect(g.poly).toHaveLength(4);
    // Every segment is horizontal or vertical
    for (let i = 1; i < g.poly.length; i++) {
      const [p, q] = [g.poly[i - 1], g.poly[i]];
      expect(p[0] === q[0] || p[1] === q[1]).toBe(true);
    }
  });

  it('elbowed run up and down between shapes stacked with more room above than beside', () => {
    // Below and off to the right (a branch in a diagram from top to bottom): out of the bottom, into the top,
    // although the centres lie further apart across than down
    const a = rect('a', 0, 0);
    const b = rect('b', 150, 120);
    const ar = arrow({ from: 'a', to: 'b', route: 'elbow' });
    const g = arrowGeometry(ar, elementMap([a, b, ar]));
    expect(g.start[1]).toBeGreaterThan(50);
    expect(g.end[1]).toBeLessThan(120);
    expect(g.poly[1][0]).toBe(g.start[0]);
    // Side by side with more room across: out of the right side
    const c = rect('c', 400, 30);
    const g2 = arrowGeometry({ ...ar, to: 'c' }, elementMap([a, c, ar]));
    expect(g2.start[0]).toBeGreaterThan(100);
    expect(g2.poly[1][1]).toBe(g2.start[1]);
  });

  it('laid out with corner points read as elbows, also from drawings stored as straight', () => {
    const d = parseDrawing(
      JSON.stringify({ v: 1, els: [{ id: 'e', ver: 1, t: 'arrow', a: [0, 0], b: [0, 100], route: 'straight', via: [[0, 50], [80, 50]] }] })
    );
    expect((d?.els[0] as ArrowElement).route).toBe('elbow');
    const plain = parseDrawing(JSON.stringify({ v: 1, els: [{ id: 'f', ver: 1, t: 'arrow', a: [0, 0], b: [0, 100], route: 'straight' }] }));
    expect((plain?.els[0] as ArrowElement).route).toBe('straight');
  });

  it('elbowed with corners of their own: fixed stretches between them, made-up ones to the shapes', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 300, 200);
    const ar = arrow({ from: 'a', to: 'b', route: 'elbow', via: [[50, 120], [330, 120]] });
    const g = arrowGeometry(ar, elementMap([a, b, ar]));
    // Straight down out of a, across, straight down into b: right angles at both ends
    expect(g.poly).toEqual([[50, 54], [50, 120], [330, 120], [330, 196]]);
    expect(fixedStretches(g.poly, ar.via)).toEqual([false, true, false]);
  });

  it('elbowed: moving a stretch fixes it, at an end with one more corner; a double click removes one', () => {
    const poly: [number, number][] = [[50, 54], [50, 120], [330, 120], [330, 196]];
    expect(dragSegment(poly, 1, [0, 90])).toEqual([[50, 90], [330, 90]]);
    // The first stretch moves aside: a stub stays at the end, the moved stretch is fixed at once
    const first = dragSegment(poly, 0, [20, 0]);
    expect(first).toEqual([[50, 68], [20, 68], [20, 120], [330, 120]]);
    expect(fixedStretches([poly[0], ...first, poly[3]], first)).toEqual([false, true, true, true, false]);
    // The last stretch likewise, with its stub at the end
    expect(dragSegment(poly, 2, [360, 0])).toEqual([[50, 120], [360, 120], [360, 182], [330, 182]]);
    // A straight line pulled sideways: a bracket through the pointer, stubs at both ends
    expect(dragSegment([[0, 0], [200, 0]], 0, [100, 60])).toEqual([[14, 0], [14, 60], [186, 60], [186, 0]]);
    // Removing the only fixed stretch: nothing of its own left
    expect(releaseSegment([[50, 120], [330, 120]], [50, 120], [330, 120])).toBeUndefined();
    // Removing a middle stretch: the corners on both sides are joined at a right angle
    expect(releaseSegment([[0, 50], [0, 100], [200, 100], [200, 150], [300, 150]], [0, 100], [200, 100])).toEqual([
      [0, 50],
      [0, 150],
      [300, 150],
    ]);
  });

  it('elbowed dock to the side and spot chosen for them, also left or right of the middle', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 0, 300);
    const ar = arrow({ from: 'a', to: 'b', route: 'elbow', fromPort: { side: 'l', at: 0.5 }, toPort: { side: 'l', at: 0.5 } });
    const g = arrowGeometry(ar, elementMap([a, b, ar]));
    // Out of the left of a, round on the left, into the left of b
    expect(g.start).toEqual([-4, 25]);
    expect(g.end).toEqual([-4, 325]);
    expect(Math.min(...g.poly.map((p) => p[0]))).toBeLessThan(-10);
    // Into the top of b, a quarter from its left end
    const g2 = arrowGeometry({ ...ar, fromPort: undefined, toPort: { side: 't', at: 0.25 } }, elementMap([a, b, ar]));
    expect(g2.end).toEqual([25, 296]);
    for (let i = 1; i < g2.poly.length; i++) {
      const [p, q] = [g2.poly[i - 1], g2.poly[i]];
      expect(Math.abs(p[0] - q[0]) < 0.5 || Math.abs(p[1] - q[1]) < 0.5).toBe(true);
    }
    // Dropped near a side: that side and spot, snapping to its middle; near the centre: none
    expect(portNear(a, [2, 40])).toEqual({ side: 'l', at: 0.8 });
    expect(portNear(a, [2, 27])).toEqual({ side: 'l', at: 0.5 });
    expect(portNear(a, [50, 25])).toBeUndefined();
  });

  it('elbowed: corners of a stretch without length go when letting go', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 300, 200);
    const ar = arrow({ from: 'a', to: 'b', route: 'elbow', via: [[50, 120], [150, 120], [150, 160], [330, 160]] });
    expect(settleCorners(ar, elementMap([a, b, ar]))).toBeUndefined();
    const flat = { ...ar, via: [[50, 160], [150, 160], [150, 160], [330, 160]] as [number, number][] };
    expect(settleCorners(flat, elementMap([a, b, flat]))).toEqual({ via: [[50, 160], [330, 160]] });
  });

  it('elbowed keep their corners when an end docks to another side', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 300, 200);
    const via: [number, number][] = [[50, 120], [330, 120]];
    const ar = arrow({ from: 'a', to: 'b', route: 'elbow', via, fromPort: { side: 'b', at: 0.5 }, toPort: { side: 'l', at: 0.5 } });
    const g = arrowGeometry(ar, elementMap([a, b, ar]));
    // Into the left side of b; its first corner still on the way (the second lay beyond the new entry, the line
    // does not run there and back)
    expect(g.poly).toEqual([[50, 54], [50, 120], [282, 120], [282, 225], [296, 225]]);
    for (let i = 1; i < g.poly.length; i++) {
      const [p, q] = [g.poly[i - 1], g.poly[i]];
      expect(Math.abs(p[0] - q[0]) < 0.5 || Math.abs(p[1] - q[1]) < 0.5).toBe(true);
    }
  });

  it('labels that would cover each other move aside: below a level line, up or down an upright one', () => {
    // Two level lines on top of each other, both labelled in the same place
    const one = arrow({ id: 'x', a: [0, 100], b: [200, 100], txt: 'ja' });
    const two = arrow({ id: 'y', a: [0, 100], b: [200, 100], txt: 'nein' });
    const shifts = spreadLabels([one, two]);
    expect(shifts.has('x')).toBe(false);
    expect(shifts.get('y')![1]).toBeGreaterThan(0);
    // Upright lines: the second label moves along the line
    const up1 = arrow({ id: 'u', a: [100, 0], b: [100, 200], txt: 'a' });
    const up2 = arrow({ id: 'v', a: [100, 0], b: [100, 200], txt: 'b' });
    expect(spreadLabels([up1, up2]).get('v')![0]).toBe(0);
    // Labels far apart stay where they are
    expect(spreadLabels([one, arrow({ id: 'z', a: [0, 400], b: [200, 400], txt: 'x' })]).size).toBe(0);
  });

  it('bend so their middle passes the dragged handle', () => {
    const ar = arrow({ route: 'curve', bend: 0 });
    const bend = bendThrough([0, 0], [100, 0], [50, 30]);
    const g = arrowGeometry({ ...ar, bend }, new Map());
    expect(g.mid[0]).toBeCloseTo(50);
    expect(g.mid[1]).toBeCloseTo(30);
  });

  it('keep their end as a free point when the shape is deleted', () => {
    const a = rect('a', 0, 0);
    const ar = arrow({ from: 'a', b: [300, 25] });
    const els = removeElements([a, ar], new Set(['a']));
    expect(els).toHaveLength(1);
    const left = els[0] as ArrowElement;
    expect(left.from).toBeUndefined();
    expect(left.a[0]).toBeCloseTo(104);
  });
});

describe('geometry', () => {
  it('finds the outline of ellipses and diamonds', () => {
    const e: ShapeElement = { ...rect('e', 0, 0), t: 'ellipse', w: 100, h: 100 };
    const p = outlinePoint(e, [200, 50], 0);
    expect(p[0]).toBeCloseTo(100);
    const d: ShapeElement = { ...rect('d', 0, 0), t: 'diamond', w: 100, h: 100 };
    const q = outlinePoint(d, [50, -100], 0);
    expect(q[1]).toBeCloseTo(0);
  });

  it('hits the topmost element', () => {
    const els = [rect('below', 0, 0), rect('above', 50, 0)];
    expect(hitTest(els, [60, 10], 2)?.id).toBe('above');
    expect(hitTest(els, [500, 500], 2)).toBeNull();
  });

  it('simplifies freehand strokes but keeps their corners', () => {
    const line = Array.from({ length: 50 }, (_, i) => [i, i < 25 ? 0 : i - 25] as [number, number]);
    const out = simplifyPoints(line, 0.5);
    expect(out.length).toBeLessThan(6);
    expect(out).toContainEqual([25, 0]);
  });

  it('lists the texts of a drawing', () => {
    expect(drawingTexts({ v: 1, els: [rect('a', 0, 0, { txt: 'Ja' }), rect('b', 0, 0)] })).toEqual(['Ja']);
  });
});

describe('preview layout', () => {
  const d = { v: 1 as const, els: [rect('a', 0, 0), rect('b', 0, 2000)] };

  it('fits everything, but does not grow beyond the automatic height', () => {
    const l = previewLayout(d, 800);
    expect(l.h).toBeLessThanOrEqual(420);
    const box = contentBox(d)!;
    // The whole height of the content is in view
    expect(l.y).toBeLessThanOrEqual(box.y);
    expect(l.y + l.h / l.z).toBeGreaterThanOrEqual(box.y + box.h);
  });

  it('shows small drawings at their size', () => {
    expect(previewLayout({ v: 1, els: [rect('a', 0, 0)] }, 800).z).toBe(1);
  });

  it('scales a saved frame with the width', () => {
    const framed = { ...d, frame: { x: 0, y: 0, w: 400, h: 200 } };
    expect(previewLayout(framed, 800)).toMatchObject({ z: 2, h: 400 });
    expect(previewLayout(framed, 400)).toMatchObject({ z: 1, h: 200 });
  });
});

describe('laid out arrows', () => {
  it('run through their corners, dock towards the first and last, and carry a label', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 200, 200);
    const ar = arrow({ from: 'a', to: 'b', via: [[150, 25], [150, 225]], txt: 'ja' });
    const back = parseDrawing(serializeDrawing({ v: 1, els: [a, b, ar] }))!;
    const parsed = back.els[2] as ArrowElement;
    expect(parsed.via).toEqual([[150, 25], [150, 225]]);
    expect(parsed.txt).toBe('ja');
    const g = arrowGeometry(parsed, elementMap(back.els));
    // Right edge of a at its middle, left edge of b at its middle
    expect(g.start[0]).toBeCloseTo(104);
    expect(g.start[1]).toBeCloseTo(25);
    expect(g.end[0]).toBeCloseTo(196);
    expect(g.end[1]).toBeCloseTo(225);
    expect(g.poly).toHaveLength(4);
    // Lines of a fork share their first stretches; the label sits on the one that leads into b
    expect(g.labelAt[0]).toBeCloseTo(173);
  });

  it('lose their corners when a docked shape moves, but not when they move along', () => {
    const ar = arrow({ id: 'x', from: 'a', to: 'b', via: [[1, 1]] });
    expect((dropStaleVia([ar], new Set(['a']))[0] as ArrowElement).via).toBeUndefined();
    expect((dropStaleVia([ar], new Set(['a', 'x']))[0] as ArrowElement).via).toEqual([[1, 1]]);
    expect((dropStaleVia([ar], new Set(['c']))[0] as ArrowElement).via).toEqual([[1, 1]]);
  });
});

describe('preview sizes', () => {
  const tall = { v: 1 as const, els: [rect('a', 0, 0, { w: 200, h: 1200 })] };
  const wide = { v: 1 as const, els: [rect('a', 0, 0, { w: 2400, h: 100 })] };

  it('a tall drawing: recommended height, or all as large as the width allows', () => {
    const auto = previewLayout(tall, 600);
    expect(auto.h).toBeCloseTo(420);
    expect(nextSize(tall, 600)).toBe('all');
    const all = previewLayout({ ...tall, fit: 'all' }, 600);
    expect(all.h).toBeGreaterThan(auto.h);
    expect(nextSize({ ...tall, fit: 'all' }, 600)).toBe('auto');
  });

  it('a wide drawing: all of it flat, or the readable height starting at its left', () => {
    const auto = previewLayout(wide, 600);
    expect(nextSize(wide, 600)).toBe('readable');
    const readable = previewLayout({ ...wide, fit: 'readable' }, 600);
    expect(readable.z).toBeGreaterThan(auto.z);
    expect(readable.x).toBeLessThan(0);
    expect(readable.h).toBeGreaterThan(auto.h);
  });

  it('follows the width: a wider note gives a taller preview', () => {
    expect(previewLayout({ ...tall, fit: 'all' }, 900).h).toBeGreaterThan(previewLayout({ ...tall, fit: 'all' }, 600).h);
  });
});
