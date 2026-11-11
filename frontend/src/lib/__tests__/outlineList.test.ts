import { describe, it, expect } from 'vitest';
import { branchEnd, insertBelow, listLabel, moveSibling, numberedLabels, outlineRows, sameOutlineShape, unitStart } from '../outlineList';
import type { DocumentBlock } from '../types';

const blk = (id: string, level: number, type: DocumentBlock['type'] = 'numbered'): DocumentBlock => ({
  id, documentId: 'd', type, content: id, level, position: 0,
});

describe('numbered lists', () => {
  it('formats numbers, letters and roman numerals by depth', () => {
    expect(listLabel(3, 0)).toBe('3.');
    expect(listLabel(2, 1)).toBe('b.');
    expect(listLabel(27, 1)).toBe('aa.');
    expect(listLabel(4, 2)).toBe('iv.');
    expect(listLabel(1, 3)).toBe('1.');
  });

  it('counts siblings, nests and restarts after other blocks', () => {
    const labels = numberedLabels([
      blk('a', 0), blk('a1', 1), blk('a2', 1), blk('a2i', 2), blk('b', 0),
      blk('note', 0, 'text'), blk('c', 0), blk('plain', 1, 'text'), blk('c1', 2),
    ]);
    expect(Object.fromEntries(labels)).toEqual({
      a: '1.', a1: 'a.', a2: 'b.', a2i: 'i.', b: '2.', c: '1.', c1: 'a.',
    });
  });
});

describe('moveSibling (phone bar ↑ ↓)', () => {
  // A
  //   a1
  //   a2
  //     a2x
  // B
  //   b1
  // C
  const tree = [blk('A', 0), blk('a1', 1), blk('a2', 1), blk('a2x', 2), blk('B', 0), blk('b1', 1), blk('C', 0)];
  const ids = (bs: DocumentBlock[]) => bs.map((b) => b.id).join(' ');

  it('swaps with the previous sibling and takes the children along', () => {
    expect(ids(moveSibling(tree, 'B', -1))).toBe('B b1 A a1 a2 a2x C');
    expect(ids(moveSibling(tree, 'a2', -1))).toBe('A a2 a2x a1 B b1 C');
  });

  it('swaps with the next sibling, jumping over its whole branch', () => {
    expect(ids(moveSibling(tree, 'A', 1))).toBe('B b1 A a1 a2 a2x C');
    expect(ids(moveSibling(tree, 'a1', 1))).toBe('A a2 a2x a1 B b1 C');
  });

  it('never leaves its parent and stops at the ends', () => {
    expect(moveSibling(tree, 'a1', -1)).toBe(tree); // first child
    expect(moveSibling(tree, 'a2', 1)).toBe(tree); // last child
    expect(moveSibling(tree, 'A', -1)).toBe(tree);
    expect(moveSibling(tree, 'C', 1)).toBe(tree);
    expect(moveSibling(tree, 'missing', 1)).toBe(tree);
  });
});

describe('conflict copies stick to their original', () => {
  // Zwei has a child and a conflict copy (with a child of its own) right under its branch
  const tree: DocumentBlock[] = [
    blk('Eins', 0, 'bullet'),
    blk('Zwei', 0, 'bullet'),
    blk('z1', 1, 'bullet'),
    { ...blk('Kopie', 0, 'bullet'), conflictOf: 'Zwei' },
    blk('k1', 1, 'bullet'),
    blk('Drei', 0, 'bullet'),
  ];
  const ids = (list: DocumentBlock[]) => list.map((b) => b.id).join(' ');

  it('count the copy into the branch of its original', () => {
    expect(branchEnd(tree, 1)).toBe(5);
    expect(branchEnd(tree, 0)).toBe(1);
  });

  it('put a new bullet under the original below the copy', () => {
    const flat = [blk('A', 0, 'bullet'), { ...blk('A2', 0, 'bullet'), conflictOf: 'A' }, blk('B', 0, 'bullet')];
    expect(insertBelow(flat, 0)).toBe(2);
    expect(insertBelow(flat, 2)).toBe(3);
  });

  it('find the original of a copy', () => {
    expect(unitStart(tree, 3)).toBe(1);
    expect(unitStart(tree, 5)).toBe(5);
  });

  it('move the copy along with its original and never between them', () => {
    expect(ids(moveSibling(tree, 'Zwei', -1))).toBe('Zwei z1 Kopie k1 Eins Drei');
    expect(ids(moveSibling(tree, 'Zwei', 1))).toBe('Eins Drei Zwei z1 Kopie k1');
    expect(ids(moveSibling(tree, 'Drei', -1))).toBe('Eins Drei Zwei z1 Kopie k1');
    expect(ids(moveSibling(tree, 'Eins', 1))).toBe('Zwei z1 Kopie k1 Eins Drei');
  });
});

describe('outline rows', () => {
  it('leaves out what is folded and knows children, indent limit, siblings and numbers', () => {
    const blocks = [
      blk('a', 0), blk('a1', 1, 'text'), blk('b', 0, 'text'),
      { ...blk('c', 0, 'text'), collapsed: true }, blk('c1', 1, 'text'), blk('c2', 2, 'text'), blk('d', 0),
    ];
    const rows = outlineRows(blocks, 0);
    expect(rows.map((r) => blocks[r.index].id)).toEqual(['a', 'a1', 'b', 'c', 'd']);
    expect(rows.map((r) => [r.hasChildren, r.maxAllowedLevel, r.siblingFollows, r.listMarker ?? ''])).toEqual([
      [true, 0, true, '1.'],
      [false, 1, false, ''],
      [false, 2, true, ''],
      [true, 1, true, ''],
      [false, 3, false, '1.'],
    ]);
    // Inside a zoomed bullet the first one may go no deeper than the zoom level
    expect(outlineRows([blk('x', 2, 'text')], 2)[0].maxAllowedLevel).toBe(2);
  });

  it('sees the same shape when only texts change', () => {
    const blocks = [blk('a', 0), blk('b', 1)];
    expect(sameOutlineShape(blocks, [blocks[0], { ...blocks[1], content: 'neu' }])).toBe(true);
    expect(sameOutlineShape(blocks, [blocks[0], { ...blocks[1], level: 0 }])).toBe(false);
    expect(sameOutlineShape(blocks, [blocks[0], { ...blocks[1], type: 'text' }])).toBe(false);
    expect(sameOutlineShape(blocks, [blocks[0], { ...blocks[1], collapsed: true }])).toBe(false);
    expect(sameOutlineShape(blocks, [blocks[0], { ...blocks[1], id: 'c' }])).toBe(false);
    expect(sameOutlineShape(blocks, [blocks[0]])).toBe(false);
  });
});
