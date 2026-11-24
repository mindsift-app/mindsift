import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { isFolderDrop, useDocDragDrop } from '../useDocDragDrop';
import { BLOCK_DRAG_TYPE, MOVE_BRANCH_EVENT, setBlockDragSingle, type MoveBranchDetail } from '../moveBranchEvent';
import type { Document } from '../../../lib/types';

// A bullet dragged out of the open note onto another note in the sidebar or onto the "new note" button:
// an open bullet moves alone, without its children (OutlinerTree tells at the start of the drag), a collapsed
// one with them; the drop is always a move.

vi.mock('../../../lib/api', async () => (await import('../../../test/apiMock')).stubApi());

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

function event() {
  const dataTransfer = {
    types: [BLOCK_DRAG_TYPE],
    dropEffect: 'none',
    effectAllowed: 'move',
    getData: (type: string) => (type === BLOCK_DRAG_TYPE ? JSON.stringify({ docId: 'd1', blockId: 'b1' }) : ''),
  };
  return {
    dataTransfer,
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
  it('moves an open bullet alone', () => {
    const drag = renderDrag();
    setBlockDragSingle(true);
    const props = drag.current.docDropProps('d2');
    const over = event();
    props.onDragOver!(over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer.dropEffect).toBe('move');
    props.onDrop!(event());
    expect(moved).toEqual([{ docId: 'd1', blockId: 'b1', targetId: 'd2', targetTitle: 'Einkaufsliste', single: true }]);
  });

  it('moves a collapsed bullet with its whole branch', () => {
    const drag = renderDrag();
    const props = drag.current.docDropProps('d2');
    const over = event();
    props.onDragOver!(over);
    expect(over.dataTransfer.dropEffect).toBe('move');
    props.onDrop!(event());
    expect(moved).toEqual([{ docId: 'd1', blockId: 'b1', targetId: 'd2', targetTitle: 'Einkaufsliste', single: false }]);
  });
});

describe('dropping a bullet onto the "new note" button', () => {
  it('turns an open bullet alone into a note', () => {
    const drag = renderDrag();
    setBlockDragSingle(true);
    const over = event();
    drag.current.newNoteDropProps.onDragOver!(over);
    expect(over.dataTransfer.dropEffect).toBe('move');
    drag.current.newNoteDropProps.onDrop!(event());
    expect(moved).toEqual([{ docId: 'd1', blockId: 'b1', targetId: '', targetTitle: '', single: true }]);
  });
});

// Folders take only notes and folders of the sidebar; files and text from outside get "not allowed"
describe('isFolderDrop', () => {
  const data = (types: string[]) => ({ types } as unknown as DataTransfer);
  it('takes notes and folders', () => {
    expect(isFolderDrop(data(['application/mindsift-doc-id', 'application/mindsift-doc-ids', 'text/plain']))).toBe(true);
    expect(isFolderDrop(data(['application/mindsift-folder-path', 'text/plain']))).toBe(true);
  });
  it('refuses files, outside text and other items of the app', () => {
    expect(isFolderDrop(data(['Files']))).toBe(false);
    expect(isFolderDrop(data(['text/plain', 'text/html']))).toBe(false);
    expect(isFolderDrop(data(['text/uri-list']))).toBe(false);
    expect(isFolderDrop(data([BLOCK_DRAG_TYPE, 'text/plain']))).toBe(false);
    expect(isFolderDrop(null)).toBe(false);
  });
});
