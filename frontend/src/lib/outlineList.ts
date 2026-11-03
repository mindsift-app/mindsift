import type { DocumentBlock } from './types';

// Numbered lists in the outliner: consecutive 'numbered' siblings count 1, 2, 3 …; a numbered list
// inside another one uses a, b, c, the next level i, ii, iii, then numbers again.

function alpha(n: number): string {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

const ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function roman(n: number): string {
  let s = '';
  for (const [v, r] of ROMAN) {
    while (n >= v) {
      s += r;
      n -= v;
    }
  }
  return s;
}

export function listLabel(n: number, depth: number): string {
  switch (depth % 3) {
    case 1:
      return `${alpha(n)}.`;
    case 2:
      return `${roman(n)}.`;
    default:
      return `${n}.`;
  }
}

/** Label ("1.", "b.", "iii.") for every numbered block, in document order. */
export function numberedLabels(blocks: DocumentBlock[]): Map<string, string> {
  const labels = new Map<string, string>();
  const runs = new Map<number, number>(); // level -> count of the current run
  const chain: DocumentBlock[] = []; // last block seen per level = ancestors of the next one
  for (const b of blocks) {
    const level = Math.max(0, b.level || 0);
    for (const l of Array.from(runs.keys())) {
      if (l > level) runs.delete(l);
    }
    chain.length = Math.min(chain.length, level);
    if (b.type === 'numbered') {
      const n = (runs.get(level) ?? 0) + 1;
      runs.set(level, n);
      const depth = chain.filter((a) => a && a.type === 'numbered').length;
      labels.set(b.id, listLabel(n, depth));
    } else {
      runs.delete(level);
    }
    chain[level] = b;
  }
  return labels;
}

// Swaps a bullet (with its children) with the previous (-1) or next (+1) bullet on the same level
// under the same parent. Returns the same array when there is no such sibling.
export function moveSibling<T extends Pick<DocumentBlock, 'id' | 'level'>>(blocks: T[], blockId: string, direction: -1 | 1): T[] {
  const lvl = (b: T) => Math.max(0, b.level || 0);
  const subtreeEnd = (start: number) => {
    let end = start + 1;
    while (end < blocks.length && lvl(blocks[end]) > lvl(blocks[start])) end++;
    return end;
  };
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx === -1) return blocks;
  const level = lvl(blocks[idx]);
  const end = subtreeEnd(idx);
  if (direction === -1) {
    for (let i = idx - 1; i >= 0; i--) {
      if (lvl(blocks[i]) < level) return blocks; // reached the parent: already the first child
      if (lvl(blocks[i]) === level) {
        return [...blocks.slice(0, i), ...blocks.slice(idx, end), ...blocks.slice(i, idx), ...blocks.slice(end)];
      }
    }
    return blocks;
  }
  if (end >= blocks.length || lvl(blocks[end]) !== level) return blocks; // already the last child
  const nextEnd = subtreeEnd(end);
  return [...blocks.slice(0, idx), ...blocks.slice(end, nextEnd), ...blocks.slice(idx, end), ...blocks.slice(nextEnd)];
}
