// A bullet dragged out of the open note and dropped onto another note in the sidebar: the sidebar
// (useDocDragDrop) announces it, the editor of the source note moves the branch (DocumentEditor), since
// only it can remove the branch as an own edit that Strg+Z brings back.
export const MOVE_BRANCH_EVENT = 'mindsift:move-branch';
import { singleDragKey } from '../../lib/platform';

// What a dragged bullet carries (set by the bullet handle in OutlinerBlock)
export const BLOCK_DRAG_TYPE = 'application/mindsift-block';

// Whether the bullet dragged right now goes without its children, as last seen during the drag (OutlinerTree
// keeps it up to date): a drop event may not report the key on every system
let draggingSingle = false;
export function setBlockDragSingle(single: boolean) {
  draggingSingle = single;
}
export function isSingleBlockDrop(e: { shiftKey: boolean }): boolean {
  return singleDragKey(e) || draggingSingle;
}

export interface MoveBranchDetail {
  docId: string;
  blockId: string;
  // Empty when dropped onto the "new note" button: the branch becomes a note of its own
  targetId: string;
  targetTitle: string;
  // Shift held at the drop: only the bullet moves, its children stay and move up into its place
  single?: boolean;
}

export function announceMoveBranch(detail: MoveBranchDetail) {
  window.dispatchEvent(new CustomEvent(MOVE_BRANCH_EVENT, { detail }));
}
