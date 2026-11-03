import { describe, it, expect } from 'vitest';
import { listLabel, moveSibling, numberedLabels } from '../outlineList';
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
