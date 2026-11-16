// A bullet dragged out of the open note and dropped onto another note in the sidebar: the sidebar
// (useDocDragDrop) announces it, the editor of the source note moves the branch (DocumentEditor), since
// only it can remove the branch as an own edit that Strg+Z brings back.
export const MOVE_BRANCH_EVENT = 'mindsift:move-branch';
import { singleDragKey } from '../../lib/platform';

// What a dragged bullet carries (set by the bullet handle in OutlinerBlock)
export const BLOCK_DRAG_TYPE = 'application/mindsift-block';

// Linux (GTK), Windows and macOS turn a drag with Ctrl (macOS: Option), the key that moves a bullet without
// its children, into a copy: the "+" cursor. Had the drag offered only 'move', the browser would refuse the
// drop. So a bullet drag offers both, takes the operation the system asks for, and every drop is a move.
export const BLOCK_EFFECT_ALLOWED = 'copyMove';
export function blockDropEffect(e: { ctrlKey: boolean; altKey: boolean }): 'copy' | 'move' {
  return singleDragKey(e) ? 'copy' : 'move';
}

// Whether the bullet dragged right now goes without its children, as last seen during the drag (OutlinerTree
// keeps it up to date): a drop event may not report the key on every system
let draggingSingle = false;
export function setBlockDragSingle(single: boolean) {
  draggingSingle = single;
}
export function isSingleBlockDrop(e: { ctrlKey: boolean; altKey: boolean }): boolean {
  return singleDragKey(e) || draggingSingle;
}

export interface MoveBranchDetail {
  docId: string;
  blockId: string;
  // Empty when dropped onto the "new note" button: the branch becomes a note of its own
  targetId: string;
  targetTitle: string;
  // Ctrl (Mac: Option) held at the drop: only the bullet moves, its children stay and move up into its place
  single?: boolean;
}

export function announceMoveBranch(detail: MoveBranchDetail) {
  window.dispatchEvent(new CustomEvent(MOVE_BRANCH_EVENT, { detail }));
}
