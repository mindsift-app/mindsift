import { describe, expect, it } from 'vitest';
import { Drawing, ShapeElement, serializeDrawing } from '../model';
import { LiveMerge, WireElement, applyOrder, finalDrawing, patchDrawing, wins } from '../live';

const rect = (id: string, x = 0, ver = 1, txt?: string): ShapeElement => ({
  id,
  ver,
  t: 'rect',
  x,
  y: 0,
  w: 100,
  h: 50,
  s: 'main',
  f: 'none',
  sw: 2,
  ...(txt ? { txt } : {}),
});
const wire = (el: ShapeElement, nonce: number, ver = el.ver): WireElement => ({ ...el, ver, nonce });
const drawing = (...els: ShapeElement[]): Drawing => ({ v: 1, els });

describe('Live drawing: merging by version', () => {
  it('higher version wins, a tie goes to the lower nonce', () => {
    expect(wins({ ver: 3, nonce: 99, deleted: false }, { ver: 2, nonce: 0, deleted: false })).toBe(true);
    expect(wins({ ver: 2, nonce: 5, deleted: false }, { ver: 2, nonce: 9, deleted: false })).toBe(true);
    expect(wins({ ver: 2, nonce: 9, deleted: false }, { ver: 2, nonce: 5, deleted: false })).toBe(false);
    expect(wins({ ver: 2, nonce: 5, deleted: false }, { ver: 2, nonce: 5, deleted: false })).toBe(false);
  });

  it('sends what changed here with a version above the known one', () => {
    const start = drawing(rect('a'), rect('b'));
    const m = new LiveMerge(start);
    expect(m.collect(start).els).toEqual([]);
    // Moved (the editor raises ver itself, but not always above what the session knows)
    const moved = { ...start, els: [{ ...start.els[0], x: 40 }, start.els[1]] };
    const out = m.collect(moved);
    expect(out.els).toHaveLength(1);
    expect(out.els[0]).toMatchObject({ id: 'a', ver: 2, x: 40 });
    expect(typeof out.els[0].nonce).toBe('number');
    // Nothing new: nothing goes out
    expect(m.collect(moved).els).toEqual([]);
    // Deleted: a tombstone
    const del = m.collect({ ...moved, els: [moved.els[0]] });
    expect(del.els).toEqual([expect.objectContaining({ id: 'b', ver: 2, deleted: true })]);
  });

  it('tells a new order and the grid', () => {
    const start = drawing(rect('a'), rect('b'), rect('c'));
    const m = new LiveMerge(start);
    const front = m.collect({ ...start, els: [start.els[1], start.els[2], start.els[0]] });
    expect(front.order).toEqual(['b', 'c', 'a']);
    expect(front.els).toEqual([]);
    // Adding on top is no reorder
    const added = m.collect({ ...start, els: [start.els[1], start.els[2], start.els[0], rect('d')] });
    expect(added.order).toBeUndefined();
    expect(m.collect({ ...start, els: [start.els[1], start.els[2], start.els[0], rect('d')], grid: true }).grid).toBe(true);
  });

  it('takes newer changes of others and ignores older ones and its own echo', () => {
    const start = drawing(rect('a'), rect('b'));
    const m = new LiveMerge(start);
    let { doc, applied } = m.receive(start, [wire(rect('a', 70, 3, 'Ben'), 4), wire(rect('n', 0, 1), 8)]);
    expect(applied.map((a) => a.id)).toEqual(['a', 'n']);
    expect(doc.els.map((e) => e.id)).toEqual(['a', 'b', 'n']);
    expect((doc.els[0] as ShapeElement).txt).toBe('Ben');
    // Older version: no change
    ({ doc, applied } = m.receive(doc, [wire(rect('a', 0, 2), 1)]));
    expect(applied).toEqual([]);
    // Same version, higher nonce: loses the tie
    ({ applied } = m.receive(doc, [wire(rect('a', 5, 3), 9)]));
    expect(applied).toEqual([]);
    // Taken in: nothing to send back
    expect(m.collect(doc).els).toEqual([]);
    // A tombstone removes it
    ({ doc } = m.receive(doc, [{ id: 'b', ver: 2, nonce: 1, deleted: true }]));
    expect(doc.els.map((e) => e.id)).toEqual(['a', 'n']);
    expect(m.collect(doc).els).toEqual([]);
  });

  it('keeps an element being dragged until it is let go; the drag wins', () => {
    const start = drawing(rect('a'), rect('b'));
    const m = new LiveMerge(start);
    const held = new Set(['a']);
    // Ben moves a while Anna drags it
    const r = m.receive(start, [wire(rect('a', 500, 2), 3), wire(rect('b', 9, 2), 3)], held);
    expect(r.applied.map((a) => a.id)).toEqual(['b']);
    expect((r.doc.els[0] as ShapeElement).x).toBe(0);
    expect(m.waiting('a')).toBeTruthy();
    // Anna lets go at x=40: her result goes out above Ben's version and stays
    const dragged = { ...r.doc, els: [{ ...r.doc.els[0], x: 40 }, r.doc.els[1]] };
    const { out, incoming } = m.release(dragged);
    expect(out.els).toEqual([expect.objectContaining({ id: 'a', ver: 3, x: 40 })]);
    expect(incoming.applied).toEqual([]);
    expect((incoming.doc.els[0] as ShapeElement).x).toBe(40);
  });

  it('a click without moving lets the waiting change in', () => {
    const start = drawing(rect('a'));
    const m = new LiveMerge(start);
    m.receive(start, [wire(rect('a', 500, 2), 3)], new Set(['a']));
    const { out, incoming } = m.release(start);
    expect(out.els).toEqual([]);
    expect((incoming.doc.els[0] as ShapeElement).x).toBe(500);
  });

  it('sends again what the session does not have after a lost connection', () => {
    const start = drawing(rect('a'), rect('b'));
    const m = new LiveMerge(start);
    const local = { ...start, els: [{ ...start.els[0], x: 30 }] };
    m.collect(local); // a moved, b deleted: sent, but lost on the way
    const state = { els: [wire(rect('a', 0, 1), 0), wire(rect('b', 0, 1), 0)], order: ['a', 'b'] };
    const { doc } = m.reconcile(local, state);
    expect(doc.els.map((e) => e.id)).toEqual(['a']);
    const again = m.collect(doc);
    expect(again.els.map((e) => [e.id, !!e.deleted])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('patches undo steps and orders like the server', () => {
    const step = drawing(rect('a'), rect('b'));
    const patched = patchDrawing(step, [
      { id: 'b', el: null },
      { id: 'c', el: rect('c') },
      { id: 'a', el: rect('a', 9, 4) },
    ]);
    expect(patched.els.map((e) => [e.id, (e as ShapeElement).x])).toEqual([
      ['a', 9],
      ['c', 0],
    ]);
    expect(applyOrder(drawing(rect('a'), rect('b'), rect('c')), ['c', 'x', 'a']).els.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('saves the final state without nonces and tombstones', () => {
    const els = [wire(rect('a', 0, 5), 77), { id: 'z', ver: 3, nonce: 1, deleted: true }, wire(rect('b', 0, 2), 3)];
    const saved = serializeDrawing(finalDrawing({ v: 1, els: [], grid: true }, els, ['b', 'a']));
    expect(saved).not.toContain('nonce');
    expect(saved).not.toContain('deleted');
    expect(JSON.parse(saved).els.map((e: { id: string; ver: number }) => [e.id, e.ver])).toEqual([
      ['b', 2],
      ['a', 5],
    ]);
    expect(JSON.parse(saved).grid).toBe(true);
  });
});
