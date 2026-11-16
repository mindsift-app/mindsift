import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocDragDrop } from '../useDocDragDrop';
import { BLOCK_DRAG_TYPE, MOVE_BRANCH_EVENT, setBlockDragSingle, type MoveBranchDetail } from '../moveBranchEvent';
import type { Document } from '../../../lib/types';

// A bullet dragged out of the open note onto another note in the sidebar or onto the "new note" button:
// with Shift held only the bullet moves, without its children; the drop is always a move.

vi.mock('../../../lib/api', () => ({ api: {}, triggerHaptic: () => {} }));

const doc = (id: string, title: string): Document =>
  ({ id, title, isOwner: true, isArchived: false } as unknown as Document);

function renderDrag() {
  const noop = () => {};
  return renderHook(() =>
    useDocDragDrop({
      docs: [doc('d1', 'Projekte'), doc('d2', 'Einkaufsliste')],
      setDocs: noop,
      setFolders: noop,
      selectedDocId: 'd1',
      setSelectedDocId: noop,
      setMobileShowDetail: noop,
      setExpandedFolders: noop,
      setMergeDialog: noop,
      treeRef: { current: null },
      showToast: noop,
      reloadDocList: async () => {},
      reloadTrash: noop,
      onStatsChange: noop,
    })
  ).result;
}

function event(mods: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) {
  const dataTransfer = {
    types: [BLOCK_DRAG_TYPE],
    dropEffect: 'none',
    effectAllowed: 'move',
    getData: (type: string) => (type === BLOCK_DRAG_TYPE ? JSON.stringify({ docId: 'd1', blockId: 'b1' }) : ''),
  };
  return {
    dataTransfer,
    shiftKey: !!mods.shiftKey,
    ctrlKey: !!mods.ctrlKey,
    altKey: !!mods.altKey,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.DragEvent<HTMLDivElement> & React.DragEvent<HTMLButtonElement>;
}

let moved: MoveBranchDetail[] = [];
const onMove = (e: Event) => moved.push((e as CustomEvent<MoveBranchDetail>).detail);
beforeEach(() => {
  moved = [];
  window.addEventListener(MOVE_BRANCH_EVENT, onMove);
});
afterEach(() => {
  window.removeEventListener(MOVE_BRANCH_EVENT, onMove);
  setBlockDragSingle(false);
});

describe('dropping a bullet onto a note in the sidebar', () => {
  it('moves the bullet alone with Shift held', () => {
    const drag = renderDrag();
    const props = drag.current.docDropProps('d2');
    const over = event({ shiftKey: true });
    props.onDragOver!(over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer.dropEffect).toBe('move');
    props.onDrop!(event({ shiftKey: true }));
    expect(moved).toEqual([{ docId: 'd1', blockId: 'b1', targetId: 'd2', targetTitle: 'Einkaufsliste', single: true }]);
  });

  it('moves the whole branch without Shift, also with Ctrl or Alt (Option) held', () => {
    const drag = renderDrag();
    const props = drag.current.docDropProps('d2');
    const over = event();
    props.onDragOver!(over);
    expect(over.dataTransfer.dropEffect).toBe('move');
    props.onDrop!(event());
    expect(moved).toEqual([{ docId: 'd1', blockId: 'b1', targetId: 'd2', targetTitle: 'Einkaufsliste', single: false }]);
    moved = [];
    props.onDrop!(event({ ctrlKey: true }));
    props.onDrop!(event({ altKey: true }));
    expect(moved.map((m) => m.single)).toEqual([false, false]);
  });

  it('takes Shift as seen during the drag when the drop event does not report it', () => {
    const drag = renderDrag();
    setBlockDragSingle(true);
    drag.current.docDropProps('d2').onDrop!(event());
    expect(moved[0].single).toBe(true);
  });
});

describe('dropping a bullet onto the "new note" button', () => {
  it('turns the bullet alone into a note with Shift held', () => {
    const drag = renderDrag();
    const over = event({ shiftKey: true });
    drag.current.newNoteDropProps.onDragOver!(over);
    expect(over.dataTransfer.dropEffect).toBe('move');
    drag.current.newNoteDropProps.onDrop!(event({ shiftKey: true }));
    expect(moved).toEqual([{ docId: 'd1', blockId: 'b1', targetId: '', targetTitle: '', single: true }]);
  });
});
