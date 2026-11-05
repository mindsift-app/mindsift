// A bullet dragged out of the open note and dropped onto another note in the sidebar: the sidebar
// (useDocDragDrop) announces it, the editor of the source note moves the branch (DocumentEditor), since
// only it can remove the branch as an own edit that Strg+Z brings back.
export const MOVE_BRANCH_EVENT = 'mindsift:move-branch';
// What a dragged bullet carries (set by the bullet handle in OutlinerBlock)
export const BLOCK_DRAG_TYPE = 'application/mindsift-block';

export interface MoveBranchDetail {
  docId: string;
  blockId: string;
  // Empty when dropped onto the "new note" button: the branch becomes a note of its own
  targetId: string;
  targetTitle: string;
}

export function announceMoveBranch(detail: MoveBranchDetail) {
  window.dispatchEvent(new CustomEvent(MOVE_BRANCH_EVENT, { detail }));
}
