import { describe, expect, it } from 'vitest';
import {
  ArrowElement,
  ShapeElement,
  arrowGeometry,
  bendThrough,
  contentBox,
  dropStaleVia,
  drawingTexts,
  elementMap,
  hitTest,
  outlinePoint,
  parseDrawing,
  removeElements,
  serializeDrawing,
  simplifyPoints,
} from '../model';
import { previewLayout } from '../../../features/workspace/drawing/DrawingBlock';

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
    expect(g.labelAt[0]).toBeCloseTo(150);
  });

  it('lose their corners when a docked shape moves, but not when they move along', () => {
    const ar = arrow({ id: 'x', from: 'a', to: 'b', via: [[1, 1]] });
    expect((dropStaleVia([ar], new Set(['a']))[0] as ArrowElement).via).toBeUndefined();
    expect((dropStaleVia([ar], new Set(['a', 'x']))[0] as ArrowElement).via).toEqual([[1, 1]]);
    expect((dropStaleVia([ar], new Set(['c']))[0] as ArrowElement).via).toEqual([[1, 1]]);
  });
});
