import React, { useCallback, useEffect, useRef } from 'react';
import { DocumentBlock } from '../../lib/types';
import { branchEnd, insertBelow, moveSibling, unitStart } from '../../lib/outlineList';
import type { OutlinerTreeHandle } from './OutlinerTree';
import { getZoomedSubtree } from './zoom';
import { ensureNonEmptyBlocks } from './useDocumentSync';

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
  // inside the zoomed branch. One edit, so a single Strg+Z takes it back.
  const lvl = (b?: DocumentBlock) => Math.max(0, b?.level || 0);
  const hasCollapsed = childBlocks.some((b) => b.collapsed);
  const canCollapse = childBlocks.some((b, i) => !b.collapsed && lvl(childBlocks[i + 1]) > lvl(b) && i + 1 < childBlocks.length);
  const handleSetAllCollapsed = useCallback(
    (collapse: boolean) => {
      if (!canEdit) return;
      const scope = new Set(getZoomedSubtree(currentBlocksRef.current, zoomedBlockId).childBlocks.map((b) => b.id));
      // The bullet holding the cursor may disappear when collapsing: the cursor goes to its top-level bullet
      const focusedId = (document.activeElement as HTMLElement | null)?.closest('[data-outline-block]')?.getAttribute('data-outline-block');
      let changed = false;
      applyLocalBlocks((prev) => {
        const next = prev.map((b, i) => {
          if (!scope.has(b.id)) return b;
          const want = collapse && i + 1 < prev.length && lvl(prev[i + 1]) > lvl(b);
          if (!!b.collapsed === want) return b;
          changed = true;
          return { ...b, collapsed: want };
        });
        return changed ? next : prev;
      });
      if (!collapse || !changed || !focusedId) return;
      const all = currentBlocksRef.current;
      let i = all.findIndex((b) => b.id === focusedId);
      const top = Math.min(...childBlocks.map((b) => lvl(b)));
      while (i > 0 && lvl(all[i]) > top && scope.has(all[i - 1].id)) i--;
      if (i >= 0 && all[i]) window.setTimeout(() => outlinerTreeRef.current?.focusBlock(all[i].id), 0);
    },
    [canEdit, applyLocalBlocks, zoomedBlockId, childBlocks, currentBlocksRef, outlinerTreeRef]
  );
  const setAllCollapsedRef = useRef(handleSetAllCollapsed);
  setAllCollapsedRef.current = handleSetAllCollapsed;
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
  }, [embedded, inTrash, scrollRef]);

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
    (newBlock: DocumentBlock, afterBlockId?: string) => {
      if (!canEdit) return;
      applyLocalBlocks((prev) => {
        const next = [...prev];
        if (afterBlockId) {
          const idx = next.findIndex((b) => b.id === afterBlockId);
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

  const handleMoveBlock = useCallback(
    (blockId: string, targetIndex: number, newLevel?: number) => {
      if (!canEdit) return;
      applyLocalBlocks((prev) => {
        const fromIdx = prev.findIndex((b) => b.id === blockId);
        if (fromIdx === -1) return prev;

        const parentBlock = prev[fromIdx];
        const parentLevel = Math.max(0, parentBlock.level || 0);

        // The dragged block with its descendants and its conflict copies
        const count = branchEnd(prev, fromIdx) - fromIdx;

        // Prevent dropping inside its own subtree
        if (targetIndex >= fromIdx && targetIndex < fromIdx + count) {
          return prev;
        }

        const copy = [...prev];
        const subtree = copy.splice(fromIdx, count);

        // Adjust insertion index because removing elements from before shifts target index
        let insertIndex = targetIndex;
        if (fromIdx < targetIndex) {
          insertIndex = targetIndex - count;
        }
        insertIndex = Math.max(0, Math.min(insertIndex, copy.length));

        // Calculate level adjustments if moving to a constrained position
        const prevBlockInPosition = insertIndex > 0 ? copy[insertIndex - 1] : null;
        const maxAllowed = prevBlockInPosition
          ? Math.max(0, prevBlockInPosition.level || 0) + 1
          : 0;

        const targetLevel = newLevel !== undefined ? newLevel : parentLevel;
        const clampedLevel = Math.min(targetLevel, maxAllowed);
        const levelDelta = clampedLevel - parentLevel;
        // Never between a bullet and its conflict copies: behind them instead
        const landing = copy[insertIndex];
        if (landing?.conflictOf && clampedLevel <= Math.max(0, landing.level || 0)) {
          const start = unitStart(copy, insertIndex);
          if (start < insertIndex) insertIndex = branchEnd(copy, start);
        }

        const updatedSubtree = subtree.map((b) => ({
          ...b,
          level: Math.max(0, (b.level || 0) + levelDelta),
        }));

        copy.splice(insertIndex, 0, ...updatedSubtree);
        return ensureNonEmptyBlocks(docId, copy);
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
