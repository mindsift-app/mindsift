import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocDragDrop } from '../useDocDragDrop';
import { BLOCK_DRAG_TYPE, MOVE_BRANCH_EVENT, setBlockDragSingle, type MoveBranchDetail } from '../moveBranchEvent';
import type { Document } from '../../../lib/types';

// A bullet dragged out of the open note onto another note in the sidebar or onto the "new note" button:
// with Ctrl held, Linux and Windows ask for a copy, which the drop has to accept and still treat as a move.

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

function event(mods: { ctrlKey?: boolean } = {}) {
  const dataTransfer = {
    types: [BLOCK_DRAG_TYPE],
    dropEffect: 'none',
    effectAllowed: 'copyMove',
    getData: (type: string) => (type === BLOCK_DRAG_TYPE ? JSON.stringify({ docId: 'd1', blockId: 'b1' }) : ''),
  };
  return {
    dataTransfer,
    ctrlKey: !!mods.ctrlKey,
    altKey: false,
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
  it('accepts the copy the system asks for with Ctrl and moves the bullet alone', () => {
    const drag = renderDrag();
    const props = drag.current.docDropProps('d2');
    const over = event({ ctrlKey: true });
    props.onDragOver!(over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer.dropEffect).toBe('copy');
    const drop = event({ ctrlKey: true });
    drop.dataTransfer.dropEffect = 'copy';
    props.onDrop!(drop);
    expect(moved).toEqual([{ docId: 'd1', blockId: 'b1', targetId: 'd2', targetTitle: 'Einkaufsliste', single: true }]);
  });

  it('moves the whole branch without Ctrl', () => {
    const drag = renderDrag();
    const props = drag.current.docDropProps('d2');
    const over = event();
    props.onDragOver!(over);
    expect(over.dataTransfer.dropEffect).toBe('move');
    props.onDrop!(event());
    expect(moved).toEqual([{ docId: 'd1', blockId: 'b1', targetId: 'd2', targetTitle: 'Einkaufsliste', single: false }]);
  });

  it('takes Ctrl as seen during the drag when the drop event does not report it', () => {
    const drag = renderDrag();
    setBlockDragSingle(true);
    drag.current.docDropProps('d2').onDrop!(event());
    expect(moved[0].single).toBe(true);
  });
});

describe('dropping a bullet onto the "new note" button', () => {
  it('accepts a copy with Ctrl and turns the bullet alone into a note', () => {
    const drag = renderDrag();
    const over = event({ ctrlKey: true });
    drag.current.newNoteDropProps.onDragOver!(over);
    expect(over.dataTransfer.dropEffect).toBe('copy');
    drag.current.newNoteDropProps.onDrop!(event({ ctrlKey: true }));
    expect(moved).toEqual([{ docId: 'd1', blockId: 'b1', targetId: '', targetTitle: '', single: true }]);
  });
});
