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

/** A bullet the outliner shows, with what its place in the outline says about it. */
export type OutlineRow = {
  /** Index in the blocks */
  index: number;
  hasChildren: boolean;
  /** Deepest level it may be indented to: one below the bullet above */
  maxAllowedLevel: number;
  /** Another bullet on its level follows before the branch ends (an empty bullet is then not outdented by Enter) */
  siblingFollows: boolean;
  /** Its number in a numbered list ("1.", "b.") */
  listMarker?: string;
};

/** The bullets shown (none below a folded one), each with its place in the outline. */
export function outlineRows(blocks: DocumentBlock[], levelOffset = 0): OutlineRow[] {
  const labels = numberedLabels(blocks);
  const rows: OutlineRow[] = [];
  let collapsedAboveLevel: number | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const lvl = Math.max(0, b.level || 0);

    if (collapsedAboveLevel !== null) {
      if (lvl > collapsedAboveLevel) continue;
      collapsedAboveLevel = null;
    }

    const nextBlock = blocks[i + 1];
    const nextLvl = nextBlock ? Math.max(0, nextBlock.level || 0) : 0;
    const hasChildren = Boolean(nextBlock && nextLvl > lvl);

    const prevBlock = i > 0 ? blocks[i - 1] : null;
    const maxAllowedLevel = prevBlock ? Math.max(0, prevBlock.level || 0) + 1 : (levelOffset || 0);

    let siblingFollows = false;
    const level = b.level || 0;
    for (let j = i + 1; j < blocks.length; j++) {
      const l = blocks[j].level || 0;
      if (l < level) break;
      if (l === level) {
        siblingFollows = true;
        break;
      }
    }

    rows.push({ index: i, hasChildren, maxAllowedLevel, siblingFollows, listMarker: labels.get(b.id) });

    if (b.collapsed && hasChildren) {
      collapsedAboveLevel = lvl;
    }
  }

  return rows;
}

/** Whether two versions of the blocks have the same outline (ids, levels, types, folding); the texts may differ. */
export function sameOutlineShape(a: DocumentBlock[], b: DocumentBlock[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x.id !== y.id || x.level !== y.level || x.type !== y.type || x.collapsed !== y.collapsed) return false;
  }
  return true;
}

type Outlined = Pick<DocumentBlock, 'id' | 'level' | 'conflictOf'>;
const lvlOf = (b: Outlined) => Math.max(0, b.level || 0);

// A conflict copy sits right under its original (after the original's children) and belongs to it until it
// is settled: what is added under the original goes below the copy, and the copy moves along with it.

// Index after the conflict copies (with their children) that follow the bullet at idx on its level; idx + 1
// … when there are none, or right after idx's own children when there are.
function afterCopies<T extends Outlined>(blocks: T[], idx: number, from: number): number {
  const level = lvlOf(blocks[idx]);
  let end = from;
  while (end < blocks.length && lvlOf(blocks[end]) === level && blocks[end].conflictOf === blocks[idx].id) {
    end++;
    while (end < blocks.length && lvlOf(blocks[end]) > level) end++;
  }
  return end;
}

/** End (exclusive) of the bullet at start with its children and its conflict copies. */
export function branchEnd<T extends Outlined>(blocks: T[], start: number): number {
  let end = start + 1;
  while (end < blocks.length && lvlOf(blocks[end]) > lvlOf(blocks[start])) end++;
  return afterCopies(blocks, start, end);
}

/** Where a new bullet on the level of the bullet at idx goes right below it: after its conflict copies. */
export function insertBelow<T extends Outlined>(blocks: T[], idx: number): number {
  return afterCopies(blocks, idx, idx + 1);
}

/** For a conflict copy right under its original, the index of the original (else i itself). */
export function unitStart<T extends Outlined>(blocks: T[], i: number): number {
  let s = i;
  while (blocks[s].conflictOf) {
    let p = s - 1;
    while (p >= 0 && lvlOf(blocks[p]) > lvlOf(blocks[s])) p--;
    if (p < 0 || lvlOf(blocks[p]) !== lvlOf(blocks[s])) break;
    // Another copy of the same original in between is part of the same unit
    if (blocks[p].id !== blocks[s].conflictOf && blocks[p].conflictOf !== blocks[s].conflictOf) break;
    s = p;
  }
  return s;
}

// Swaps a bullet (with its children and conflict copies) with the previous (-1) or next (+1) bullet on the
// same level under the same parent. Returns the same array when there is no such sibling.
export function moveSibling<T extends Outlined>(blocks: T[], blockId: string, direction: -1 | 1): T[] {
  const lvl = lvlOf;
  const subtreeEnd = (start: number) => branchEnd(blocks, start);
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx === -1) return blocks;
  const level = lvl(blocks[idx]);
  const end = subtreeEnd(idx);
  if (direction === -1) {
    for (let i = idx - 1; i >= 0; i--) {
      if (lvl(blocks[i]) < level) return blocks; // reached the parent: already the first child
      if (lvl(blocks[i]) === level) {
        // Past a conflict copy to its original: the two stay together
        const at = unitStart(blocks, i);
        return [...blocks.slice(0, at), ...blocks.slice(idx, end), ...blocks.slice(at, idx), ...blocks.slice(end)];
      }
    }
    return blocks;
  }
  if (end >= blocks.length || lvl(blocks[end]) !== level) return blocks; // already the last child
  const nextEnd = subtreeEnd(end);
  return [...blocks.slice(0, idx), ...blocks.slice(end, nextEnd), ...blocks.slice(idx, end), ...blocks.slice(nextEnd)];
}

/** Where a dragged bullet goes: in front of a bullet, or right after one (below the last bullet shown). */
export type BranchDrop = { beforeId: string } | { afterId: string };

// The parts of a drag: the bullet at `from`, its children (up to childEnd) and its conflict copies (up to end)
function dragParts<T extends Outlined>(blocks: T[], from: number) {
  const end = branchEnd(blocks, from);
  let childEnd = from + 1;
  while (childEnd < end && lvlOf(blocks[childEnd]) > lvlOf(blocks[from])) childEnd++;
  return { childEnd, end };
}

/**
 * Whether the bullet at `from` may be dropped in front of the bullet at `at`. With its children it cannot go
 * into its own branch; alone (single) it may go in front of one of its children, which then move up.
 */
export function canDropBefore<T extends Outlined>(blocks: T[], from: number, at: number, single = false): boolean {
  if (from < 0 || at < 0 || at >= blocks.length || at === from) return false;
  const { childEnd, end } = dragParts(blocks, from);
  if (at < from || at >= end) return true;
  return single && at < childEnd;
}

// The bullets that stay when the bullet at `from` is picked up: with its children (rest without the branch),
// or alone (single), its children moved up one level into its place
function liftOut<T extends Outlined>(blocks: T[], from: number, single: boolean) {
  const { childEnd, end } = dragParts(blocks, from);
  const moving = single ? [blocks[from], ...blocks.slice(childEnd, end)] : blocks.slice(from, end);
  const staying = single ? blocks.slice(from + 1, childEnd).map((b) => ({ ...b, level: lvlOf(b) - 1 })) : [];
  const rest = [...blocks.slice(0, from), ...staying, ...blocks.slice(end)];
  return { moving, staying, rest, childEnd, end };
}

/** The levels a dragged bullet may take at a drop: from `min` (the default) to `max`. */
export type DropLevels = { min: number; max: number };

/**
 * The levels the bullet at `from` may take when dropped in front of the bullet at `at` (at = blocks.length:
 * below the last bullet, at the end), or null when it cannot go there. The bullets around it keep their
 * parents: not shallower than the bullet it lands in front of (that one would become its child; at the end,
 * the top level shown, levelOffset), and at most one deeper than the bullet shown above it, which then gets
 * it as its last child; a folded bullet above (or one inside a folded branch) does not take it as a child,
 * where it would disappear.
 */
export function dropLevelRange<T extends Outlined & Pick<DocumentBlock, 'collapsed'>>(
  blocks: T[],
  from: number,
  at: number,
  single = false,
  levelOffset = 0
): DropLevels | null {
  if (from < 0 || from >= blocks.length) return null;
  if (at < blocks.length && !canDropBefore(blocks, from, at, single)) return null;
  const { rest, staying, end } = liftOut(blocks, from, single);
  // The same place among the bullets that stay
  let restAt: number;
  if (at >= blocks.length) restAt = rest.length;
  else if (at < from) restAt = at;
  else if (at >= end) restAt = at - (end - from) + staying.length;
  else restAt = at - 1; // single, in front of one of its own children
  const min = restAt < rest.length ? lvlOf(rest[restAt]) : levelOffset;
  if (restAt === 0) return { min, max: min };

  // The bullet shown above: the highest folded bullet the row above lies in, else that row itself
  let above = restAt - 1;
  let level = lvlOf(rest[above]);
  for (let j = above - 1; j >= 0 && level > 0; j--) {
    const l = lvlOf(rest[j]);
    if (l >= level) continue;
    level = l;
    if (rest[j].collapsed) above = j;
  }
  const max = lvlOf(rest[above]) + (rest[above].collapsed ? 0 : 1);
  return { min: Math.max(levelOffset, Math.min(min, max)), max: Math.max(levelOffset, max) };
}

/**
 * Moves the bullet blockId to `drop`, on `level` (at most one deeper than the bullet above it). Its children
 * and conflict copies come along and keep their depth below it; dragged alone (single), only its conflict
 * copies come along, and its children move up one level into its old place, in their order. Returns the same
 * array when nothing changes or the drop is not possible (into its own branch).
 */
export function moveBranch<T extends Outlined>(blocks: T[], blockId: string, drop: BranchDrop, level: number, single = false): T[] {
  const from = blocks.findIndex((b) => b.id === blockId);
  if (from === -1) return blocks;
  const own = lvlOf(blocks[from]);
  const { moving, staying, rest } = liftOut(blocks, from, single);
  const movingIds = new Set(moving.map((b) => b.id));

  let at: number;
  if ('beforeId' in drop) {
    if (movingIds.has(drop.beforeId)) return blocks;
    at = rest.findIndex((b) => b.id === drop.beforeId);
    if (at === -1) return blocks;
  } else {
    // After a moving bullet (it was the last one shown): in its old place
    const i = rest.findIndex((b) => b.id === drop.afterId);
    if (i === -1 && !movingIds.has(drop.afterId)) return blocks;
    at = i === -1 ? from + staying.length : i + 1;
  }

  const maxAllowed = at > 0 ? lvlOf(rest[at - 1]) + 1 : 0;
  const newLevel = Math.max(0, Math.min(level, maxAllowed));
  // Never between a bullet and its conflict copies: behind them instead
  const landing = rest[at];
  if (landing?.conflictOf && newLevel <= lvlOf(landing)) {
    const start = unitStart(rest, at);
    if (start < at) at = branchEnd(rest, start);
  }

  const delta = newLevel - own;
  const moved = delta === 0 ? moving : moving.map((b) => ({ ...b, level: Math.max(0, lvlOf(b) + delta) }));
  const next = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  return next.every((b, i) => b.id === blocks[i].id && lvlOf(b) === lvlOf(blocks[i])) ? blocks : next;
}
