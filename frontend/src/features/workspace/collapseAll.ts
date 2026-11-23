import { DocumentBlock } from '../../lib/types';
import { getZoomedSubtree } from './zoom';

// "Collapse all" and "Expand all" of a note (note menu, Ctrl+Shift+ArrowUp / ArrowDown) in what is shown:
// the whole note, or the branch of the zoomed bullet.
// - Collapsing folds only the top level of the view (the note's top-level bullets, or the zoomed bullet's
//   direct children). Everything below keeps its state, so zooming into one of them shows its sub-bullets
//   as open or closed as before; collapse again there to fold that level.
// - Expanding opens every collapsed bullet of the view, at any depth: it is the one way to see everything.

const lvl = (b?: DocumentBlock) => Math.max(0, b?.level || 0);

// Whether the bullet at index i of the list has sub-bullets
const hasChildren = (list: DocumentBlock[], i: number) => i + 1 < list.length && lvl(list[i + 1]) > lvl(list[i]);

// The indexes of the view's top level: bullets with no bullet of a lower level before them in the view
function topLevelIndexes(view: DocumentBlock[]): number[] {
  const out: number[] = [];
  let min = Infinity;
  view.forEach((b, i) => {
    if (lvl(b) <= min) {
      min = lvl(b);
      out.push(i);
    }
  });
  return out;
}

// Something to collapse: a top-level bullet of the view that has sub-bullets and is open
export function canCollapseView(view: DocumentBlock[]): boolean {
  return topLevelIndexes(view).some((i) => !view[i].collapsed && hasChildren(view, i));
}

// Something to expand: any collapsed bullet in the view
export function canExpandView(view: DocumentBlock[]): boolean {
  return view.some((b) => b.collapsed);
}

// The note's bullets with the view collapsed or expanded; the same array when nothing changes. Only the
// bullets whose state changes are new objects, so the sync sends just those.
export function setViewCollapsed(blocks: DocumentBlock[], zoomedBlockId: string | null, collapse: boolean): DocumentBlock[] {
  const view = getZoomedSubtree(blocks, zoomedBlockId).childBlocks;
  if (view.length === 0) return blocks;
  const start = blocks.indexOf(view[0]);
  const want = new Map<number, boolean>();
  if (collapse) {
    for (const i of topLevelIndexes(view)) if (hasChildren(view, i)) want.set(start + i, true);
  } else {
    view.forEach((b, i) => {
      if (b.collapsed) want.set(start + i, false);
    });
  }
  let changed = false;
  const next = blocks.map((b, i) => {
    const w = want.get(i);
    if (w === undefined || !!b.collapsed === w) return b;
    changed = true;
    return { ...b, collapsed: w };
  });
  return changed ? next : blocks;
}

// The top-level bullet of the view above the given one (itself when it is on the top level); where the
// cursor goes when collapsing hides its bullet
export function viewTopAncestor(blocks: DocumentBlock[], zoomedBlockId: string | null, id: string): string | null {
  const view = getZoomedSubtree(blocks, zoomedBlockId).childBlocks;
  const idx = view.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  const tops = topLevelIndexes(view);
  let top = tops[0];
  for (const t of tops) if (t <= idx) top = t;
  return view[top].id;
}
