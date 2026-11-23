import { describe, expect, it } from 'vitest';
import { DocumentBlock } from '../../../lib/types';
import { canCollapseView, canExpandView, setViewCollapsed, viewTopAncestor } from '../collapseAll';

const b = (id: string, level: number, collapsed = false, type: DocumentBlock['type'] = 'text'): DocumentBlock => ({
  id,
  documentId: 'doc',
  type,
  content: id,
  level,
  position: 0,
  collapsed,
});

// Projekt (H1)
//   Planung (H2)
//     Termine (H3)
//       Montag
//     Budget
//   Umsetzung (H2)
//     Aufgabe
// Notizen
const note = () => [
  b('projekt', 0, false, 'h1'),
  b('planung', 1, false, 'h2'),
  b('termine', 2, false, 'h3'),
  b('montag', 3),
  b('budget', 2),
  b('umsetzung', 1, false, 'h2'),
  b('aufgabe', 2),
  b('notizen', 0),
];

const collapsedIds = (blocks: DocumentBlock[]) => blocks.filter((x) => x.collapsed).map((x) => x.id);

describe('setViewCollapsed', () => {
  it('collapses only the top level of the whole note', () => {
    const next = setViewCollapsed(note(), null, true);
    expect(collapsedIds(next)).toEqual(['projekt']);
  });

  it('keeps the state of deeper bullets when collapsing', () => {
    const blocks = note();
    blocks[2] = { ...blocks[2], collapsed: true }; // Termine was closed
    const next = setViewCollapsed(blocks, null, true);
    expect(collapsedIds(next)).toEqual(['projekt', 'termine']);
    // Zooming into Projekt shows Planung and Umsetzung open, Termine closed as before
    expect(next.find((x) => x.id === 'planung')?.collapsed).toBe(false);
  });

  it('collapses the direct children of the zoomed bullet only', () => {
    const next = setViewCollapsed(note(), 'projekt', true);
    expect(collapsedIds(next)).toEqual(['planung', 'umsetzung']);
    const deeper = setViewCollapsed(note(), 'planung', true);
    expect(collapsedIds(deeper)).toEqual(['termine']);
  });

  it('changes only the bullets whose state changes', () => {
    const blocks = note();
    const next = setViewCollapsed(blocks, null, true);
    next.forEach((x, i) => {
      if (x.id !== 'projekt') expect(x).toBe(blocks[i]);
    });
    expect(setViewCollapsed(next, null, true)).toBe(next);
  });

  it('expands every collapsed bullet of the view at any depth', () => {
    const blocks = note().map((x) => (['projekt', 'termine', 'umsetzung'].includes(x.id) ? { ...x, collapsed: true } : x));
    expect(collapsedIds(setViewCollapsed(blocks, null, false))).toEqual([]);
    // Zoomed: the zoomed bullet itself and bullets outside stay as they are
    expect(collapsedIds(setViewCollapsed(blocks, 'planung', false))).toEqual(['projekt', 'umsetzung']);
  });

  it('takes a deeper first bullet as the top level of the view', () => {
    const blocks = [b('a', 0), b('x', 2), b('y', 3), b('z', 1), b('w', 2)];
    expect(collapsedIds(setViewCollapsed(blocks, 'a', true))).toEqual(['x', 'z']);
  });
});

describe('canCollapseView / canExpandView', () => {
  it('looks only at the top level for collapsing', () => {
    const view = note().slice(1, 7); // inside Projekt
    expect(canCollapseView(view)).toBe(true);
    const done = view.map((x) => (x.level === 1 ? { ...x, collapsed: true } : x));
    expect(canCollapseView(done)).toBe(false);
    expect(canExpandView(done)).toBe(true);
    expect(canExpandView(view)).toBe(false);
  });
});

describe('viewTopAncestor', () => {
  it('finds the top-level bullet of the view above a bullet', () => {
    expect(viewTopAncestor(note(), null, 'montag')).toBe('projekt');
    expect(viewTopAncestor(note(), 'projekt', 'montag')).toBe('planung');
    expect(viewTopAncestor(note(), 'projekt', 'umsetzung')).toBe('umsetzung');
    expect(viewTopAncestor(note(), 'projekt', 'notizen')).toBeNull();
  });
});
