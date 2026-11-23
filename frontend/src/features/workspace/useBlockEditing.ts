import React, { useCallback, useEffect } from 'react';
import { DocumentBlock } from '../../lib/types';
import { insertBelow, moveBranch, moveSibling, unitStart, type BranchDrop } from '../../lib/outlineList';
import type { OutlinerTreeHandle } from './OutlinerTree';
import { canCollapseView, canExpandView, setViewCollapsed, viewTopAncestor } from './collapseAll';
import { ensureNonEmptyBlocks } from './useDocumentSync';
import { useLatestRef } from '../../lib/useLatestRef';

// Editing the bullets of the note: every change of the outline (typing, new bullets, deleting, moving,
// expanding and collapsing all) as one own edit for the sync engine (applyLocalBlocks)
export function useBlockEditing({
  docId,
  canEdit,
  inTrash,
  embedded,
  zoomedBlockId,
  childBlocks,
  scrollRef,
  outlinerTreeRef,
  currentBlocksRef,
  applyLocalBlocks,
}: {
  docId: string;
  canEdit: boolean;
  inTrash: boolean;
  embedded: boolean;
  zoomedBlockId: string | null;
  childBlocks: DocumentBlock[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  outlinerTreeRef: React.RefObject<OutlinerTreeHandle | null>;
  currentBlocksRef: React.RefObject<DocumentBlock[]>;
  applyLocalBlocks: (update: DocumentBlock[] | ((prev: DocumentBlock[]) => DocumentBlock[])) => void;
}) {
  // "Expand / collapse all bullets" (note menu, Ctrl+Shift+ArrowDown / ArrowUp) in what is shown, i.e. only
  // inside the zoomed branch; collapsing folds only its top level (collapseAll.ts). One edit, so a single
  // Strg+Z takes it back.
  const hasCollapsed = canExpandView(childBlocks);
  const canCollapse = canCollapseView(childBlocks);
  const handleSetAllCollapsed = useCallback(
    (collapse: boolean) => {
      if (!canEdit) return;
      // The bullet holding the cursor may disappear when collapsing: the cursor goes to its top-level bullet
      const focusedId = (document.activeElement as HTMLElement | null)?.closest('[data-outline-block]')?.getAttribute('data-outline-block');
      let changed = false;
      applyLocalBlocks((prev) => {
        const next = setViewCollapsed(prev, zoomedBlockId, collapse);
        changed = next !== prev;
        return next;
      });
      if (!collapse || !changed || !focusedId) return;
      const target = viewTopAncestor(currentBlocksRef.current, zoomedBlockId, focusedId);
      if (target) window.setTimeout(() => outlinerTreeRef.current?.focusBlock(target), 0);
    },
    [canEdit, applyLocalBlocks, zoomedBlockId, currentBlocksRef, outlinerTreeRef]
  );
  const setAllCollapsedRef = useLatestRef(handleSetAllCollapsed);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      const el = e.target as HTMLElement | null;
      const root = scrollRef.current;
      if (!root || inTrash) return;
      // In this note, or nothing focused and this is the note that fills the view (not a journal day)
      const inEditor = !!el && root.contains(el);
      if (!inEditor && (embedded || (el && el !== document.body))) return;
      e.preventDefault();
      setAllCollapsedRef.current(e.key === 'ArrowUp');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, inTrash, scrollRef, setAllCollapsedRef]);

  const handleUpdateBlock = useCallback(
    (updatedBlock: DocumentBlock) => {
      if (!canEdit) return;
      applyLocalBlocks((prev) => prev.map((b) => (b.id === updatedBlock.id ? updatedBlock : b)));
    },
    [canEdit, applyLocalBlocks]
  );

  const handleUpdateBlocks = useCallback(
    (updatedBlocks: DocumentBlock[]) => {
      if (!canEdit || updatedBlocks.length === 0) return;
      const map = new Map<string, DocumentBlock>();
      for (const b of updatedBlocks) {
        map.set(b.id, b);
      }
      applyLocalBlocks((prev) => prev.map((b) => map.get(b.id) || b));
    },
    [canEdit, applyLocalBlocks]
  );

  const handleCreateBlock = useCallback(
    (newBlock: DocumentBlock, afterBlockId?: string, placement: 'after' | 'before' = 'after') => {
      if (!canEdit) return;
      applyLocalBlocks((prev) => {
        const next = [...prev];
        if (afterBlockId) {
          const idx = next.findIndex((b) => b.id === afterBlockId);
          if (idx >= 0 && placement === 'before') {
            // Above the bullet, and above its original when it is a conflict copy (they stick together)
            next.splice(unitStart(next, idx), 0, newBlock);
            return ensureNonEmptyBlocks(docId, next);
          }
          if (idx >= 0) {
            // A new bullet on the same level comes below the conflict copies of this one (they stick to it)
            const at = (newBlock.level || 0) <= Math.max(0, next[idx].level || 0) ? insertBelow(next, idx) : idx + 1;
            next.splice(at, 0, newBlock);
            return ensureNonEmptyBlocks(docId, next);
          }
        }
        next.push(newBlock);
        return ensureNonEmptyBlocks(docId, next);
      });
    },
    [docId, canEdit, applyLocalBlocks]
  );

  const handleInsertBlocks = useCallback(
    (afterBlockId: string, updatedCurrentBlock: DocumentBlock, newBlocks: DocumentBlock[]) => {
      if (!canEdit) return;
      applyLocalBlocks((prev) => {
        const next = [...prev];
        const idx = next.findIndex((b) => b.id === afterBlockId);
        if (idx >= 0) {
          next[idx] = updatedCurrentBlock;
          const sameLevel = newBlocks.length > 0 && (newBlocks[0].level || 0) <= Math.max(0, updatedCurrentBlock.level || 0);
          next.splice(sameLevel ? insertBelow(next, idx) : idx + 1, 0, ...newBlocks);
        } else {
          next.push(updatedCurrentBlock, ...newBlocks);
        }
        return ensureNonEmptyBlocks(docId, next);
      });
    },
    [docId, canEdit, applyLocalBlocks]
  );

  // Enter (or Tab) in the title: into the first bullet when that is an empty text bullet, otherwise a new
  // empty bullet goes first, so a drawing or image at the top can still get something in front of it
  const enterFromTitle = () => {
    const first = currentBlocksRef.current[0];
    const emptyText = !!first && first.type === 'text' && !(first.content || '').trim() && !(first.level || 0);
    if (!canEdit || !first || emptyText || zoomedBlockId) {
      outlinerTreeRef.current?.focusFirstBlock();
      return;
    }
    const block: DocumentBlock = {
      id: `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      documentId: docId,
      type: 'text',
      content: '',
      level: 0,
      checked: false,
      collapsed: false,
      position: 0,
    };
    applyLocalBlocks((prev) => [block, ...prev]);
    outlinerTreeRef.current?.focusBlock(block.id, 'start');
  };

  const handleDeleteBlock = useCallback(
    (blockId: string) => {
      if (!canEdit) return;
      applyLocalBlocks((prev) => ensureNonEmptyBlocks(docId, prev.filter((b) => b.id !== blockId)));
    },
    [docId, canEdit, applyLocalBlocks]
  );

  const handleDeleteBlocks = useCallback(
    (blockIds: string[]) => {
      if (!canEdit) return;
      const gone = new Set(blockIds);
      applyLocalBlocks((prev) => ensureNonEmptyBlocks(docId, prev.filter((b) => !gone.has(b.id))));
    },
    [docId, canEdit, applyLocalBlocks]
  );

  // A selection over several bullets was deleted (OutlinerTree): one change, so Strg+Z undoes it at once
  const handleReplaceRange = useCallback(
    (first: DocumentBlock, deleteIds: string[], movedChildren: DocumentBlock[]) => {
      if (!canEdit) return;
      const changed = new Map([first, ...movedChildren].map((b) => [b.id, b]));
      const gone = new Set(deleteIds);
      applyLocalBlocks((prev) =>
        ensureNonEmptyBlocks(docId, prev.filter((b) => !gone.has(b.id)).map((b) => changed.get(b.id) || b))
      );
    },
    [docId, canEdit, applyLocalBlocks]
  );

  // Swaps a bullet (with its children) with the previous or next one on the same level, within the same
  // parent. By id, not by index, so it also works while zoomed into a branch (the tree then sees a slice).
  const handleMoveSibling = useCallback(
    (blockId: string, direction: -1 | 1) => {
      if (!canEdit) return;
      applyLocalBlocks((prev) => moveSibling(prev, blockId, direction));
    },
    [canEdit, applyLocalBlocks]
  );

  // A bullet dragged to another place (OutlinerTree): by id, so it works the same in a zoomed branch and on a
  // tag page (both show a slice of the note). One change, so Strg+Z takes the whole move back at once.
  const handleMoveBlock = useCallback(
    (blockId: string, drop: BranchDrop, level: number, single = false) => {
      if (!canEdit) return;
      applyLocalBlocks((prev) => {
        const next = moveBranch(prev, blockId, drop, level, single);
        return next === prev ? prev : ensureNonEmptyBlocks(docId, next);
      });
    },
    [docId, canEdit, applyLocalBlocks]
  );

  return {
    hasCollapsed,
    canCollapse,
    handleSetAllCollapsed,
    handleUpdateBlock,
    handleUpdateBlocks,
    handleCreateBlock,
    handleInsertBlocks,
    enterFromTitle,
    handleDeleteBlock,
    handleDeleteBlocks,
    handleReplaceRange,
    handleMoveSibling,
    handleMoveBlock,
  };
}
