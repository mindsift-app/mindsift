// Turns the flat block list the editor works with (level + order) into operations against the tree.
// Same algorithm as legacyOps in internal/storage/docsync.go.
import type { DocumentBlock } from '../types';
import { keysBetween } from './orderKey';
import { Doc, Op, flatten, normProps, propsEqual } from './model';

/** Parent index (-1 = top level) for every entry of a flat list; impossible levels are clamped. */
export function parentsFromLevels(levels: number[]): number[] {
  const parents: number[] = [];
  const stack: number[] = [];
  levels.forEach((raw, i) => {
    let lvl = Math.max(0, raw || 0);
    if (lvl > stack.length) lvl = stack.length;
    stack.length = lvl;
    parents.push(lvl > 0 ? stack[lvl - 1] : -1);
    stack.push(i);
  });
  return parents;
}

/** Marks a longest strictly increasing subsequence of the non-empty keys. */
export function longestIncreasing(keys: string[]): boolean[] {
  const keep = new Array(keys.length).fill(false);
  const tails: number[] = [];
  const prev = new Array(keys.length).fill(-1);
  keys.forEach((k, i) => {
    if (!k) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[tails[mid]] < k) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  });
  if (tails.length > 0) {
    for (let i = tails[tails.length - 1]; i >= 0; i = prev[i]) keep[i] = true;
  }
  return keep;
}

/**
 * Computes the operations that turn the tree into the given flat list. newOpId creates unique op IDs.
 * Blocks that keep their place keep their order key, so only real changes become operations.
 */
export function diffFlat(d: Doc, blocks: DocumentBlock[], newOpId: () => string): Op[] {
  const list = blocks.map((b) => ({ ...b, type: b.type || 'bullet' }));
  const parentIdx = parentsFromLevels(list.map((b) => b.level || 0));
  const parentOf = list.map((_, i) => (parentIdx[i] >= 0 ? list[parentIdx[i]].id : ''));

  const byParent = new Map<string, number[]>();
  list.forEach((_, i) => {
    const p = parentOf[i];
    const arr = byParent.get(p);
    if (arr) arr.push(i);
    else byParent.set(p, [i]);
  });

  const keys: string[] = new Array(list.length);
  byParent.forEach((idxs, parent) => {
    const existing = idxs.map((i) => {
      const b = d.blocks.get(list[i].id);
      return b && !b.deleted && b.parentId === parent ? b.orderKey : '';
    });
    const keep = longestIncreasing(existing);
    let j = 0;
    while (j < idxs.length) {
      if (keep[j]) {
        keys[idxs[j]] = existing[j];
        j++;
        continue;
      }
      const start = j;
      while (j < idxs.length && !keep[j]) j++;
      const left = start > 0 ? keys[idxs[start - 1]] : '';
      const right = j < idxs.length ? existing[j] : '';
      let fresh: string[];
      try {
        fresh = keysBetween(left, right, j - start);
      } catch {
        fresh = keysBetween(left, '', j - start);
      }
      for (let k = start; k < j; k++) keys[idxs[k]] = fresh[k - start];
    }
  });

  const ops: Op[] = [];
  const push = (op: Omit<Op, 'opId'>) => ops.push({ opId: newOpId(), ...op } as Op);
  const wanted = new Set<string>();

  list.forEach((b, i) => {
    wanted.add(b.id);
    const parent = parentOf[i];
    const props = normProps({ checked: b.checked, collapsed: b.collapsed, lang: b.lang });
    const cur = d.blocks.get(b.id);
    if (!cur) {
      push({ kind: 'insert', blockId: b.id, parentId: parent, orderKey: keys[i], type: b.type, content: b.content || '', props });
      return;
    }
    if (cur.deleted) push({ kind: 'restore', ids: [b.id] });
    if (cur.deleted || cur.parentId !== parent || cur.orderKey !== keys[i]) {
      push({ kind: 'move', blockId: b.id, parentId: parent, orderKey: keys[i] });
    }
    if (cur.content !== (b.content || '')) {
      push({ kind: 'set_content', blockId: b.id, baseVersion: cur.version, content: b.content || '' });
    }
    const curProps = normProps({ checked: cur.props.checked, collapsed: cur.props.collapsed, lang: cur.props.lang });
    if (cur.type !== b.type || !propsEqual(curProps, props)) {
      push({ kind: 'set_props', blockId: b.id, patch: { type: b.type, checked: !!b.checked, collapsed: !!b.collapsed, lang: b.lang || '' } });
    }
  });

  // Deletes last, after moves have taken wanted children out of deleted branches
  for (const fb of flatten(d)) {
    if (!wanted.has(fb.id)) push({ kind: 'delete', blockId: fb.id });
  }
  return ops;
}

/** Converts the tree into the flat list used by the editor components. */
export function toDocumentBlocks(
  d: Doc,
  docId: string,
  taskLinks?: Map<string, string>,
  subtaskLinks?: Map<string, string>
): DocumentBlock[] {
  return flatten(d).map((b, i) => ({
    id: b.id,
    documentId: docId,
    type: b.type as DocumentBlock['type'],
    content: b.content,
    checked: !!b.props.checked,
    collapsed: !!b.props.collapsed,
    lang: b.props.lang || undefined,
    level: b.level,
    position: (i + 1) * 1000,
    taskId: taskLinks?.get(b.id),
    subtaskOf: subtaskLinks?.get(b.id),
    conflictOf: b.props.conflictOf,
    conflictAuthor: b.props.conflictAuthor,
  }));
}
