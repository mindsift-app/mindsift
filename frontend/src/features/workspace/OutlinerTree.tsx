import React, { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import type { WikiLinkClickHandler } from '../../lib/wikiLink';
import { DocumentBlock, BlockType } from '../../lib/types';
import { OutlinerBlock, BlockLock, mapRenderedOffsetToRaw } from './OutlinerBlock';
import { parsePastedLines } from '../../lib/pasteOutline';
import { blocksToMarkdown } from '../../lib/outlineMarkdown';
import { numberedLabels } from '../../lib/outlineList';
import { flushSync } from 'react-dom';
import { MobileOutlineBar, isTouchOnly } from './MobileOutlineBar';
import { startBranchDragGhost } from './branchDragImage';
import type { ConflictChoice } from '../../lib/docSync/engine';

export interface OutlinerTreeHandle {
  focusFirstBlock: (cursor?: 'start' | 'end') => void;
  focusBlock: (blockId: string, cursor?: 'start' | 'end') => void;
}

export interface OutlinerTreeProps {
  docId: string;
  /** Smaller click area below the last bullet (journal days) */
  compact?: boolean;
  blocks: DocumentBlock[];
  canEdit: boolean;
  levelOffset?: number;
  onZoomBlock?: (blockId: string) => void;
  /** at: where the extract button was clicked, to ask there where the branch should go */
  onExtractBlock?: (blockId: string, at?: { x: number; y: number }) => void;
  onInlineBlock?: (blockId: string) => void;
  onUpdateBlock: (updated: DocumentBlock, immediate?: boolean) => void;
  onUpdateBlocks?: (updated: DocumentBlock[]) => void;
  onCreateBlock: (newBlock: DocumentBlock, afterBlockId?: string) => void;
  onInsertBlocks?: (afterBlockId: string, updatedCurrent: DocumentBlock, newBlocks: DocumentBlock[]) => void;
  onDeleteBlock: (blockId: string) => void;
  /** Deleting several bullets at once (a bullet with its children): one change, undone in one step */
  onDeleteBlocks?: (blockIds: string[]) => void;
  /** The last bullet of the note was deleted (it stays as an empty bullet); the journal removes the day then */
  onDeleteLastBlock?: () => void;
  onMoveBlock: (blockId: string, newIndex: number, level?: number) => void;
  /** Swap a bullet (with children) with its previous / next sibling (phone bar ↑ ↓) */
  onMoveSibling?: (blockId: string, direction: -1 | 1) => void;
  onOpenTask?: (taskId: string) => void;
  onTagClick?: (tag: string) => void;
  onWikiLinkClick?: WikiLinkClickHandler;
  onCopyBlockLink?: (blockId: string) => void;
  initialFocusedBlockId?: string | null;
  onFocusedBlockChange?: (blockId: string | null) => void;
  /** Work in the focused block that does not change its text yet (drawing editor open) */
  onBlockActivity?: (blockId: string) => void;
  lockedBlocks?: Map<string, BlockLock>; // blockId -> the user editing it (someone else)
  onLockedAction?: (holderName: string) => void;
  onResolveConflict?: (blockId: string, choice: ConflictChoice) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Deleting a selection over several bullets in one step: the first bullet with its new text, the
   *  bullets to delete, and children of the last bullet that move under the first */
  onReplaceRange?: (first: DocumentBlock, deleteIds: string[], movedChildren: DocumentBlock[]) => void;
  /** The empty area below the last bullet (click adds one); off where several trees stack (hashtag page) */
  trailingArea?: boolean;
}

// Blocks that a selection over several bullets copies whole, never cut at the selection's edge
const WHOLE_IN_SELECTION = ['code', 'divider', 'table', 'progress', 'callout'];

// Puts text on the clipboard from a key press: through the browser's copy event, which works on plain
// HTTP too (navigator.clipboard needs HTTPS or localhost); the clipboard API only as a fallback
function writeClipboardText(text: string) {
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
  };
  document.addEventListener('copy', onCopy);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    // not supported: fall back below
  }
  document.removeEventListener('copy', onCopy);
  if (!copied) void navigator.clipboard?.writeText(text).catch(() => {});
}

export const OutlinerTree = forwardRef<OutlinerTreeHandle, OutlinerTreeProps>(({
  docId,
  compact = false,
  blocks,
  canEdit,
  levelOffset = 0,
  onZoomBlock,
  onExtractBlock,
  onInlineBlock,
  onUpdateBlock,
  onUpdateBlocks,
  onCreateBlock,
  onInsertBlocks,
  onDeleteBlock,
  onDeleteBlocks,
  onDeleteLastBlock,
  onMoveBlock,
  onMoveSibling,
  onOpenTask,
  onTagClick,
  onWikiLinkClick,
  onCopyBlockLink,
  initialFocusedBlockId,
  onFocusedBlockChange,
  onBlockActivity,
  lockedBlocks,
  onLockedAction,
  onResolveConflict,
  onUndo,
  onRedo,
  onReplaceRange,
  trailingArea = true,
}, ref) => {
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

  const onFocusedBlockChangeRef = useRef(onFocusedBlockChange);
  onFocusedBlockChangeRef.current = onFocusedBlockChange;
  useEffect(() => {
    onFocusedBlockChangeRef.current?.(focusedBlockId);
  }, [focusedBlockId]);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(
    initialFocusedBlockId || null
  );
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Leaving a block (click into empty space) must drop its focus highlight; a focus move to
  // another block has already set the new id, so only clear if it's still this one
  const handleBlurBlock = useCallback((blockId: string) => {
    setFocusedBlockId((cur) => (cur === blockId ? null : cur));
  }, []);

  const textareaMapRef = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const pendingFocusRef = useRef<{ blockId: string; cursor: 'start' | 'end' | 'select' | number } | null>(null);

  const focusBlockInput = useCallback(
    (blockId: string, cursor: 'start' | 'end' | 'select' | number = 'end') => {
      setFocusedBlockId(blockId);
      const el = textareaMapRef.current.get(blockId);
      if (el) {
        const apply = () => {
          el.focus();
          try {
            if (cursor === 'select') {
              el.select();
            } else {
              const pos =
                typeof cursor === 'number'
                  ? Math.min(cursor, el.value.length)
                  : cursor === 'end'
                  ? el.value.length
                  : 0;
              el.setSelectionRange(pos, pos);
            }
          } catch {
            // ignore
          }
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        // A numeric position refers to content that was just changed, so wait one extra frame for it to render
        requestAnimationFrame(() => (typeof cursor === 'number' ? requestAnimationFrame(apply) : apply()));
      } else {
        pendingFocusRef.current = { blockId, cursor };
      }
    },
    []
  );

  useImperativeHandle(
    ref,
    () => ({
      focusFirstBlock: (cursor: 'start' | 'end' = 'end') => {
        if (blocks.length > 0) {
          focusBlockInput(blocks[0].id, cursor);
        } else {
          const firstBlock: DocumentBlock = {
            id: `blk_${Date.now().toString(36)}_0`,
            documentId: docId,
            type: 'text',
            content: '',
            level: levelOffset || 0,
            position: 1000,
          };
          pendingFocusRef.current = { blockId: firstBlock.id, cursor: 'end' };
          onCreateBlock(firstBlock);
        }
      },
      focusBlock: (blockId: string, cursor: 'start' | 'end' = 'end') => {
        focusBlockInput(blockId, cursor);
      },
    }),
    [blocks, docId, levelOffset, onCreateBlock, focusBlockInput]
  );

  const registerTextareaRef = useCallback((blockId: string, el: HTMLTextAreaElement | null) => {
    if (el) {
      textareaMapRef.current.set(blockId, el);
      if (pendingFocusRef.current && pendingFocusRef.current.blockId === blockId) {
        const target = pendingFocusRef.current;
        pendingFocusRef.current = null;
        // Focus right away (the element is already in the DOM): keystrokes typed directly after Enter
        // must land in the new block, not in the previous one
        setFocusedBlockId(blockId);
        el.focus();
        try {
          if (target.cursor === 'select') {
            el.select();
          } else {
            const pos =
              typeof target.cursor === 'number'
                ? Math.min(target.cursor, el.value.length)
                : target.cursor === 'end'
                ? el.value.length
                : 0;
            el.setSelectionRange(pos, pos);
          }
        } catch {
          // ignore
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      textareaMapRef.current.delete(blockId);
    }
  }, []);

  // Jump target (search, a link to a bullet, a mention in the notification center, a task): scrolled to and
  // lit up once, as soon as its block is loaded. No cursor goes into it: that would lock the bullet for
  // everyone else although nobody types. Running again on later block changes would pull the view back.
  const focusedTargetRef = useRef<string | null>(null);
  const targetLoaded = !!initialFocusedBlockId && blocks.some((b) => b.id === initialFocusedBlockId);
  useEffect(() => {
    if (!initialFocusedBlockId) focusedTargetRef.current = null;
    if (initialFocusedBlockId && targetLoaded && focusedTargetRef.current !== initialFocusedBlockId) {
      focusedTargetRef.current = initialFocusedBlockId;
      setHighlightedBlockId(initialFocusedBlockId);
      // Again a little later: images and the layout above it may still move the bullet
      const scrollTo = () =>
        document
          .querySelector(`[data-outline-block="${CSS.escape(initialFocusedBlockId)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrollTo();
      const timer = setTimeout(scrollTo, 70);
      const timer2 = setTimeout(scrollTo, 200);
      const fadeTimer = setTimeout(() => {
        setHighlightedBlockId(null);
      }, 2800);
      return () => {
        clearTimeout(timer);
        clearTimeout(timer2);
        clearTimeout(fadeTimer);
      };
    }
  }, [initialFocusedBlockId, targetLoaded]);

  // Compute visibility based on collapsed ancestor blocks
  const visibleEntries = useMemo(() => {
    const result: {
      block: DocumentBlock;
      index: number;
      hasChildren: boolean;
      maxAllowedLevel: number;
    }[] = [];

    let collapsedAboveLevel: number | null = null;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const lvl = Math.max(0, b.level || 0);

      if (collapsedAboveLevel !== null) {
        if (lvl > collapsedAboveLevel) {
          continue;
        } else {
          collapsedAboveLevel = null;
        }
      }

      const nextBlock = blocks[i + 1];
      const nextLvl = nextBlock ? Math.max(0, nextBlock.level || 0) : 0;
      const hasChildren = Boolean(nextBlock && nextLvl > lvl);

      const prevBlock = i > 0 ? blocks[i - 1] : null;
      const maxAllowedLevel = prevBlock ? Math.max(0, prevBlock.level || 0) + 1 : (levelOffset || 0);

      result.push({
        block: b,
        index: i,
        hasChildren,
        maxAllowedLevel,
      });

      if (b.collapsed && hasChildren) {
        collapsedAboveLevel = lvl;
      }
    }

    return result;
  }, [blocks, levelOffset]);

  const listLabels = useMemo(() => numberedLabels(blocks), [blocks]);

  // Whether another bullet on the same level follows (before the branch ends); an empty bullet
  // is then not outdented by Enter
  const siblingFollows = useCallback(
    (index: number) => {
      const level = blocks[index]?.level || 0;
      for (let i = index + 1; i < blocks.length; i++) {
        const l = blocks[i].level || 0;
        if (l < level) return false;
        if (l === level) return true;
      }
      return false;
    },
    [blocks]
  );

  const handleCreateBlockBelow = useCallback(
    (afterBlockId: string, newContent: string = '') => {
      if (!canEdit) return;
      const idx = blocks.findIndex((b) => b.id === afterBlockId);
      const currentBlock = idx >= 0 ? blocks[idx] : null;
      const isHeading =
        (currentBlock?.type === 'h1' || currentBlock?.type === 'h2' || currentBlock?.type === 'h3') &&
        !currentBlock.collapsed;
      const currentLevel = currentBlock ? Math.max(0, currentBlock.level || 0) : 0;
      const nextBlock = idx >= 0 ? blocks[idx + 1] : undefined;
      // Enter on an open bullet with children puts the new one first among them (Tab would take the
      // other children along); likewise an open heading starts its section
      const opensChildren =
        !!currentBlock && !currentBlock.collapsed && !!nextBlock && Math.max(0, nextBlock.level || 0) > currentLevel;
      const level = currentBlock ? currentLevel + (isHeading || opensChildren ? 1 : 0) : 0;
      // Numbered lists continue on Enter (an empty item ends the list, see OutlinerBlock)
      const inheritedType: BlockType = currentBlock?.type === 'numbered' ? 'numbered' : 'text';

      const newBlock: DocumentBlock = {
        id: `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        documentId: docId,
        type: inheritedType,
        content: newContent,
        level,
        checked: false,
        collapsed: false,
        position: ((idx >= 0 ? idx + 2 : blocks.length + 1) * 1000),
      };

      pendingFocusRef.current = { blockId: newBlock.id, cursor: 'start' };
      setFocusedBlockId(newBlock.id);
      onCreateBlock(newBlock, afterBlockId);
    },
    [blocks, canEdit, docId, onCreateBlock]
  );

  const handlePasteMultiLines = useCallback(
    (blockId: string, textBefore: string, textAfter: string, rawLines: string[]) => {
      if (!canEdit || rawLines.length === 0) return;
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) return;

      const currentBlock = blocks[idx];
      const baseLevel = Math.max(0, currentBlock.level || 0);

      const parsed = parsePastedLines(rawLines);

      if (parsed.length === 0) return;

      const line0 = parsed[0];
      const baseIndent = line0.indent;
      const isSingle = parsed.length === 1;
      const line0Content = textBefore + line0.content + (isSingle ? textAfter : '');

      const isCurrentEmpty = (currentBlock.content || '').trim() === '';
      const adoptedType = line0.type !== 'text' ? line0.type : (isCurrentEmpty ? 'text' : currentBlock.type);
      const adoptedChecked = line0.type === 'todo' ? (line0.checked ?? false) : currentBlock.checked;

      const updatedCurrentBlock: DocumentBlock = {
        ...currentBlock,
        content: line0Content,
        type: adoptedType,
        checked: adoptedChecked,
      };

      const newBlocks: DocumentBlock[] = [];
      const nowBase = Date.now().toString(36);

      for (let j = 1; j < parsed.length; j++) {
        const p = parsed[j];
        const isLastLine = j === parsed.length - 1;
        const lineContent = isLastLine ? (p.content + textAfter) : p.content;
        const lineLevel = Math.max(0, baseLevel + (p.indent - baseIndent));

        newBlocks.push({
          id: `blk_${nowBase}_${j}_${Math.random().toString(36).slice(2, 6)}`,
          documentId: docId,
          type: p.type,
          checked: p.checked || false,
          content: lineContent,
          level: lineLevel,
          collapsed: false,
          position: (currentBlock.position || 1000) + j * 10,
        });
      }

      const lastTargetId = newBlocks.length > 0 ? newBlocks[newBlocks.length - 1].id : currentBlock.id;
      const existingEl = textareaMapRef.current.get(lastTargetId);
      if (existingEl) {
        pendingFocusRef.current = null;
        focusBlockInput(lastTargetId, 'end');
      } else {
        pendingFocusRef.current = { blockId: lastTargetId, cursor: 'end' };
      }
      setFocusedBlockId(lastTargetId);

      if (onInsertBlocks) {
        onInsertBlocks(currentBlock.id, updatedCurrentBlock, newBlocks);
      } else {
        onUpdateBlock(updatedCurrentBlock, true);
        for (let k = 0; k < newBlocks.length; k++) {
          const afterId = k === 0 ? currentBlock.id : newBlocks[k - 1].id;
          onCreateBlock(newBlocks[k], afterId);
        }
      }
    },
    [blocks, canEdit, docId, focusBlockInput, onCreateBlock, onInsertBlocks, onUpdateBlock]
  );

  // Name of the other user holding the block (or, withBranch, any block below it); structural actions on
  // such blocks are not started at all, so they cannot end up half applied
  const lockHolder = useCallback(
    (blockId: string, withBranch = false): string | undefined => {
      if (!lockedBlocks || lockedBlocks.size === 0) return undefined;
      const direct = lockedBlocks.get(blockId)?.name;
      if (direct || !withBranch) return direct;
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx < 0) return undefined;
      const level = blocks[idx].level || 0;
      for (let i = idx + 1; i < blocks.length && (blocks[i].level || 0) > level; i++) {
        const name = lockedBlocks.get(blocks[i].id)?.name;
        if (name) return name;
      }
      return undefined;
    },
    [blocks, lockedBlocks]
  );

  const onDeleteLastBlockRef = useRef(onDeleteLastBlock);
  onDeleteLastBlockRef.current = onDeleteLastBlock;
  const handleDeleteBlock = useCallback(
    (blockId: string, deleteSubtree = false) => {
      if (!canEdit) return;
      const holder = lockHolder(blockId, true);
      if (holder) {
        onLockedAction?.(holder);
        return;
      }
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) return;

      // If this is the only block in the document (and not in an isolated zoom subtree), clear instead of deleting
      if (blocks.length <= 1 && !levelOffset) {
        const only = blocks[0];
        onUpdateBlock(
          {
            ...only,
            content: '',
            type: 'text',
            level: 0,
            checked: false,
          },
          true
        );
        onDeleteLastBlockRef.current?.();
        return;
      }

      const targetFocusBlock = idx > 0 ? blocks[idx - 1] : blocks[idx + 1];
      if (targetFocusBlock) {
        focusBlockInput(targetFocusBlock.id, 'end');
      }

      if (deleteSubtree) {
        const rootLevel = blocks[idx].level || 0;
        const idsToDelete = [blockId];
        for (let j = idx + 1; j < blocks.length; j++) {
          if ((blocks[j].level || 0) > rootLevel) {
            idsToDelete.push(blocks[j].id);
          } else {
            break;
          }
        }
        if (onDeleteBlocks) {
          onDeleteBlocks(idsToDelete);
        } else {
          for (const id of idsToDelete) {
            onDeleteBlock(id);
          }
        }
        if (idsToDelete.length === blocks.length && !levelOffset) onDeleteLastBlockRef.current?.();
      } else {
        onDeleteBlock(blockId);
      }
    },
    [blocks, canEdit, focusBlockInput, levelOffset, onDeleteBlock, onDeleteBlocks, onUpdateBlock, lockHolder, onLockedAction]
  );

  // Backspace at the start of a non-empty block: append its text to the previous visible block
  const handleMergeWithPrevious = useCallback(
    (blockId: string, content: string) => {
      if (!canEdit) return false;
      const notMergeable = ['code', 'divider', 'table', 'progress'];
      const visIdx = visibleEntries.findIndex((e) => e.block.id === blockId);
      if (visIdx <= 0) return false;
      const prev = visibleEntries[visIdx - 1].block;
      const idx = blocks.findIndex((b) => b.id === blockId);
      const cur = blocks[idx];
      if (!cur || notMergeable.includes(prev.type) || notMergeable.includes(cur.type)) return false;
      const holder = lockHolder(cur.id, true) || lockHolder(prev.id);
      if (holder) {
        onLockedAction?.(holder);
        return true;
      }

      // Children of the merged block move up so they become children of the previous block
      const curLevel = Math.max(0, cur.level || 0);
      const delta = Math.max(0, prev.level || 0) - curLevel;
      const movedChildren: DocumentBlock[] = [];
      for (let j = idx + 1; j < blocks.length; j++) {
        const lvl = Math.max(0, blocks[j].level || 0);
        if (lvl <= curLevel) break;
        movedChildren.push({ ...blocks[j], level: Math.max(levelOffset || 0, lvl + delta) });
      }

      const joinPos = (prev.content || '').length;
      const mergedPrev: DocumentBlock = { ...prev, content: (prev.content || '') + content };
      if (movedChildren.length > 0 && onUpdateBlocks) {
        onUpdateBlocks([mergedPrev, ...movedChildren]);
      } else {
        onUpdateBlock(mergedPrev, true);
        movedChildren.forEach((c) => onUpdateBlock(c));
      }
      onDeleteBlock(cur.id);
      focusBlockInput(prev.id, joinPos);
      return true;
    },
    [blocks, canEdit, focusBlockInput, levelOffset, onDeleteBlock, onUpdateBlock, onUpdateBlocks, visibleEntries, lockHolder, onLockedAction]
  );

  const handleIndentBlock = useCallback(
    (blockId: string, delta: 1 | -1) => {
      if (!canEdit) return;
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) return;
      const holder = lockHolder(blockId);
      if (holder) {
        onLockedAction?.(holder);
        return;
      }

      const current = blocks[idx];
      const currentLevel = Math.max(0, current.level || 0);
      const prevLevel = idx > 0 ? Math.max(0, blocks[idx - 1].level || 0) : 0;
      const minLevel = levelOffset || 0;
      const maxLevel = idx === 0 ? minLevel : prevLevel + 1;

      const nextLevel =
        delta === 1
          ? Math.min(maxLevel, currentLevel + 1)
          : Math.max(minLevel, currentLevel - 1);

      if (nextLevel === currentLevel) return;

      const actualDelta = nextLevel - currentLevel;

      // Find all contiguous children / descendants:
      // contiguous blocks with level > currentLevel
      let count = 1;
      for (let i = idx + 1; i < blocks.length; i++) {
        if (Math.max(0, blocks[i].level || 0) > currentLevel) {
          count++;
        } else {
          break;
        }
      }

      const updatedBlocks: DocumentBlock[] = [];
      for (let i = idx; i < idx + count; i++) {
        const b = blocks[i];
        const newLvl = Math.max(minLevel, (b.level || 0) + actualDelta);
        updatedBlocks.push({
          ...b,
          level: newLvl,
        });
      }

      if (onUpdateBlocks) {
        onUpdateBlocks(updatedBlocks);
      } else {
        for (const b of updatedBlocks) {
          onUpdateBlock(b, true);
        }
      }
    },
    [blocks, canEdit, levelOffset, onUpdateBlock, onUpdateBlocks, lockHolder, onLockedAction]
  );

  // Ctrl/Cmd + click on a bullet's arrow: every bullet of the branch that has children folds with it (one edit)
  const handleToggleBranch = useCallback(
    (updated: DocumentBlock) => {
      const idx = blocks.findIndex((b) => b.id === updated.id);
      if (idx === -1) return;
      const level = Math.max(0, updated.level || 0);
      const changed: DocumentBlock[] = [updated];
      for (let i = idx + 1; i < blocks.length && Math.max(0, blocks[i].level || 0) > level; i++) {
        const b = blocks[i];
        const want = !!updated.collapsed && i + 1 < blocks.length && Math.max(0, blocks[i + 1].level || 0) > Math.max(0, b.level || 0);
        if (!!b.collapsed !== want) changed.push({ ...b, collapsed: want });
      }
      if (onUpdateBlocks) {
        onUpdateBlocks(changed);
      } else {
        for (const b of changed) {
          onUpdateBlock(b, true);
        }
      }
    },
    [blocks, onUpdateBlock, onUpdateBlocks]
  );

  const handleNavigateFocus = useCallback(
    (blockId: string, direction: 'up' | 'down') => {
      const visIdx = visibleEntries.findIndex((e) => e.block.id === blockId);
      if (visIdx === -1) return;
      const targetEntry =
        direction === 'up' ? visibleEntries[visIdx - 1] : visibleEntries[visIdx + 1];
      if (targetEntry) {
        focusBlockInput(
          targetEntry.block.id,
          direction === 'up' ? 'end' : 'start'
        );
      }
    },
    [focusBlockInput, visibleEntries]
  );

  const handleDragStartBlock = useCallback((index: number, e: React.DragEvent) => {
    setDraggedIndex(index);
    const level = Math.max(0, blocks[index]?.level || 0);
    let end = index + 1;
    while (end < blocks.length && Math.max(0, blocks[end].level || 0) > level) end++;
    startBranchDragGhost(e, blocks.slice(index, end));
  }, [blocks]);

  const handleDragOverBlock = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (draggedIndex !== null) {
        const parentLevel = Math.max(0, blocks[draggedIndex]?.level || 0);
        let count = 1;
        for (let i = draggedIndex + 1; i < blocks.length; i++) {
          if (Math.max(0, blocks[i].level || 0) > parentLevel) {
            count++;
          } else {
            break;
          }
        }
        // Do not allow dropping inside its own subtree (self or descendants)
        if (index >= draggedIndex && index < draggedIndex + count) {
          setDragOverIndex(null);
          return;
        }
      }
      setDragOverIndex(index);
    },
    [blocks, draggedIndex]
  );

  const handleDropBlock = useCallback(
    (targetIndex: number) => {
      if (draggedIndex === null || draggedIndex === targetIndex) {
        setDraggedIndex(null);
        setDragOverIndex(null);
        return;
      }
      const parentLevel = Math.max(0, blocks[draggedIndex]?.level || 0);
      let count = 1;
      for (let i = draggedIndex + 1; i < blocks.length; i++) {
        if (Math.max(0, blocks[i].level || 0) > parentLevel) {
          count++;
        } else {
          break;
        }
      }
      if (targetIndex >= draggedIndex && targetIndex < draggedIndex + count) {
        setDraggedIndex(null);
        setDragOverIndex(null);
        return;
      }
      const movingBlock = blocks[draggedIndex];
      const holder = movingBlock ? lockHolder(movingBlock.id) : undefined;
      if (holder) {
        onLockedAction?.(holder);
      } else if (movingBlock) {
        onMoveBlock(movingBlock.id, targetIndex, movingBlock.level);
      }
      setDraggedIndex(null);
      setDragOverIndex(null);
    },
    [blocks, draggedIndex, onMoveBlock, lockHolder, onLockedAction]
  );

  // Phone bar: runs the action at once and puts the focus back into the same bullet within the same tap
  // (React may move the field in the DOM, which drops the focus; iOS reopens the keyboard only inside a tap)
  const runOnFocused = (action: (blockId: string) => void) => {
    const id = focusedBlockId;
    if (!id) return;
    const holder = lockHolder(id);
    if (holder) {
      onLockedAction?.(holder);
      return;
    }
    const before = textareaMapRef.current.get(id);
    const caret = before ? before.selectionStart : null;
    flushSync(() => action(id));
    const el = textareaMapRef.current.get(id);
    if (!el) return;
    if (document.activeElement !== el) {
      el.focus({ preventScroll: true });
      if (caret !== null) {
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          // ignore
        }
      }
    }
    // Keep the bullet visible above the bar (about 56 px) and the keyboard
    const vv = window.visualViewport;
    const visibleBottom = (vv ? vv.height + vv.offsetTop : window.innerHeight) - 64;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > visibleBottom || rect.top < 0) el.scrollIntoView({ block: 'center' });
  };
  const showMobileBar = isTouchOnly && canEdit && !!focusedBlockId && blocks.some((b) => b.id === focusedBlockId);

  useEffect(() => {
    const clearDrag = () => {
      setDraggedIndex(null);
      setDragOverIndex(null);
    };
    window.addEventListener('dragend', clearDrag);
    return () => window.removeEventListener('dragend', clearDrag);
  }, []);

  // --- Selection over several bullets ---
  // Each bullet is a text field of its own, so the browser cannot select across them. Dragging from one
  // bullet into another is tracked here instead: start (anchor) and end (focus) as bullet + position in
  // its raw text. The start bullet keeps the browser's own selection; the others are highlighted with the
  // CSS Highlight API (rows are tinted where it is missing). Delete/Backspace removes the selected text
  // like a text editor in one step (Strg+Z brings it back), a typed character replaces it, Strg+C copies
  // it as Markdown. A second Strg+A in a bullet selects the whole note.
  type RangeSel = { anchorId: string; anchorOffset: number; focusId: string; focusOffset: number; focusNode?: Node; focusNodeOffset?: number };
  const [rangeSel, setRangeSel] = useState<RangeSel | null>(null);
  const rangeSelRef = useRef<RangeSel | null>(null);
  rangeSelRef.current = rangeSel;
  const treeRootRef = useRef<HTMLDivElement>(null);
  const dragAnchorRef = useRef<{ id: string; offset: number } | null>(null);
  const highlightSupported = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof (window as any).Highlight === 'function';

  const caretAtPoint = (x: number, y: number): { node: Node; offset: number } | null => {
    const doc = document as any;
    if (typeof doc.caretPositionFromPoint === 'function') {
      const p = doc.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (typeof doc.caretRangeFromPoint === 'function') {
      const r = doc.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
  };

  // Position in the raw text of a bullet for a point in its rendered text (outside it: start or end).
  // Blocks without a text layer (callouts, code …) count whole when `whole` says from which side
  const rawOffsetAtPoint = (row: HTMLElement, id: string, x: number, y: number, whole?: 'start' | 'end') => {
    const raw = textareaMapRef.current.get(id)?.value ?? blocks.find((b) => b.id === id)?.content ?? '';
    const span = row.querySelector<HTMLElement>('[data-outline-text]');
    if (!span && whole) return { offset: whole === 'start' ? 0 : raw.length };
    const caret = caretAtPoint(x, y);
    if (span && caret && span.contains(caret.node)) {
      const range = document.createRange();
      range.setStart(span, 0);
      range.setEnd(caret.node, caret.offset);
      return { offset: mapRenderedOffsetToRaw(raw, span.textContent || '', range.toString().length), node: caret.node, nodeOffset: caret.offset };
    }
    const rect = (span || row).getBoundingClientRect();
    const before = y < rect.top || (y <= rect.bottom && x < rect.left);
    return { offset: before ? 0 : raw.length };
  };

  const clearRangeSel = useCallback(() => {
    dragAnchorRef.current = null;
    setRangeSel(null);
  }, []);

  // Selected blocks without a text layer to highlight (callouts, code, images …): tinted as a whole row
  const [wholeRowIds, setWholeRowIds] = useState<Set<string> | null>(null);

  // Highlight the selected text of the bullets other than the start one
  useEffect(() => {
    if (!highlightSupported) return;
    const registry = (CSS as any).highlights;
    const setWholeRows = (ids: string[]) =>
      setWholeRowIds((prev) => (ids.length === 0 ? null : prev && prev.size === ids.length && ids.every((id) => prev.has(id)) ? prev : new Set(ids)));
    if (!rangeSel || !treeRootRef.current) {
      registry.delete('outline-range');
      setWholeRows([]);
      return;
    }
    const order = visibleEntries.map((e) => e.block.id);
    const a = order.indexOf(rangeSel.anchorId);
    const f = order.indexOf(rangeSel.focusId);
    if (a < 0 || f < 0) {
      registry.delete('outline-range');
      setWholeRows([]);
      return;
    }
    const ranges: Range[] = [];
    const whole: string[] = [];
    const spanOf = (id: string) =>
      treeRootRef.current!.querySelector<HTMLElement>(`[data-outline-block="${id}"] [data-outline-text]`);
    for (let i = Math.min(a, f); i <= Math.max(a, f); i++) {
      const id = order[i];
      const span = spanOf(id);
      if (!span) {
        whole.push(id);
        continue;
      }
      if (id === rangeSel.anchorId) continue; // shown by the browser in its text field
      const r = document.createRange();
      r.selectNodeContents(span);
      if (id === rangeSel.focusId && rangeSel.focusNode && span.contains(rangeSel.focusNode)) {
        if (f > a) r.setEnd(rangeSel.focusNode, rangeSel.focusNodeOffset ?? 0);
        else r.setStart(rangeSel.focusNode, rangeSel.focusNodeOffset ?? 0);
      }
      ranges.push(r);
    }
    registry.set('outline-range', new (window as any).Highlight(...ranges));
    setWholeRows(whole);
    return () => registry.delete('outline-range');
  }, [rangeSel, visibleEntries, highlightSupported]);

  // Mouse: a drag that leaves its bullet becomes a selection over several bullets
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = dragAnchorRef.current;
      if (!start || !(e.buttons & 1)) return;
      const root = treeRootRef.current;
      if (!root) return;
      let row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-outline-block]');
      let edge: 'start' | 'end' | null = null;
      if (!row || !root.contains(row)) {
        // Above the first bullet (e.g. on the title) the selection reaches its start, below the last its end,
        // as in a text editor
        const rows = root.querySelectorAll<HTMLElement>('[data-outline-block]');
        if (rows.length === 0) return;
        if (e.clientY < rows[0].getBoundingClientRect().top) [row, edge] = [rows[0], 'start'];
        else if (e.clientY > rows[rows.length - 1].getBoundingClientRect().bottom) [row, edge] = [rows[rows.length - 1], 'end'];
        else return;
      }
      const id = row.dataset.outlineBlock!;
      if (id === start.id) {
        if (rangeSelRef.current) setRangeSel(null);
        return;
      }
      // Dragging upwards the bullet under the pointer is the selection's first one, else its last
      const startRow = root.querySelector(`[data-outline-block="${start.id}"]`);
      const upwards = !!startRow && !!(row.compareDocumentPosition(startRow) & Node.DOCUMENT_POSITION_FOLLOWING);
      const raw = textareaMapRef.current.get(id)?.value ?? blocks.find((b) => b.id === id)?.content ?? '';
      const at = edge
        ? { offset: edge === 'start' ? 0 : raw.length }
        : rawOffsetAtPoint(row, id, e.clientX, e.clientY, upwards ? 'start' : 'end');
      setRangeSel({ anchorId: start.id, anchorOffset: start.offset, focusId: id, focusOffset: at.offset, focusNode: at.node, focusNodeOffset: at.nodeOffset });
    };
    const onUp = () => {
      dragAnchorRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // rawOffsetAtPoint only reads refs and blocks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  const handleTreeMouseDownCapture = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // After a selection over several bullets (e.g. Ctrl+A twice) the start bullet's text is still selected;
    // pressing on it would make the browser drag that text instead of starting a new selection
    if (rangeSelRef.current) {
      const active = document.activeElement as HTMLTextAreaElement | null;
      if (active?.tagName === 'TEXTAREA' && active.selectionStart !== active.selectionEnd) {
        active.setSelectionRange(active.selectionStart, active.selectionStart);
      }
    }
    setRangeSel(null);
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-outline-block]');
    // Not on a bullet (e.g. the empty area below the last one): the press below the note handles it
    if (!row) return;
    // Buttons (e.g. the action bubble that shows on hover at the row's right) may start a selection too;
    // a plain click on them still works, only a drag into another bullet turns into a selection
    if (!row || target.closest('a, input, select, [contenteditable="true"]')) {
      dragAnchorRef.current = null;
      return;
    }
    const id = row.dataset.outlineBlock!;
    // The bullet's own handler places the caret first; read it right after
    dragAnchorRef.current = { id, offset: rawOffsetAtPoint(row, id, e.clientX, e.clientY).offset };
    requestAnimationFrame(() => {
      const ta = textareaMapRef.current.get(id);
      if (dragAnchorRef.current?.id === id && ta && document.activeElement === ta) {
        dragAnchorRef.current = { id, offset: ta.selectionStart };
      }
    });
  };

  // A press in the empty space below the last bullet (inside the note or just below it) starts at the end
  // of that bullet, so dragging upwards from "nothing" selects like in a text editor
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const root = treeRootRef.current;
      const target = e.target as HTMLElement | null;
      if (!root || !target || target.closest('[data-outline-block], a, input, select, textarea, button, [contenteditable="true"]')) return;
      const area = root.closest<HTMLElement>('[data-sync-channel]') ?? root.parentElement;
      if (!area?.contains(target)) return;
      const rows = root.querySelectorAll<HTMLElement>('[data-outline-block]');
      const last = rows[rows.length - 1];
      if (!last) return;
      const rowRect = last.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      if (e.clientY <= rowRect.bottom || e.clientX < rootRect.left || e.clientX > rootRect.right) return;
      const id = last.dataset.outlineBlock!;
      const raw = textareaMapRef.current.get(id)?.value ?? blocks.find((b) => b.id === id)?.content ?? '';
      dragAnchorRef.current = { id, offset: raw.length };
      setRangeSel(null);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [blocks]);

  // The selection in text order: first bullet + offset, last bullet + offset, bullets in between
  const resolveRangeSel = (sel: RangeSel) => {
    const order = visibleEntries.map((en) => en.block.id);
    const a = order.indexOf(sel.anchorId);
    const f = order.indexOf(sel.focusId);
    if (a < 0 || f < 0 || a === f) return null;
    const [firstId, firstOffset, lastId, lastOffset] =
      a < f ? [sel.anchorId, sel.anchorOffset, sel.focusId, sel.focusOffset] : [sel.focusId, sel.focusOffset, sel.anchorId, sel.anchorOffset];
    const fIdx = blocks.findIndex((b) => b.id === firstId);
    const lIdx = blocks.findIndex((b) => b.id === lastId);
    if (fIdx < 0 || lIdx < 0 || lIdx <= fIdx) return null;
    return { first: blocks[fIdx], firstOffset, last: blocks[lIdx], lastOffset, fIdx, lIdx };
  };

  // The selection as Markdown (lib/outlineMarkdown.ts): pasted elsewhere it is a proper list, pasted
  // back into a note it becomes the same bullets again. Code blocks (and other blocks that are not plain
  // text) at either end come whole: half a code block from where the drag started is no use
  const selectedText = (sel: RangeSel) => {
    const r = resolveRangeSel(sel);
    if (!r) return '';
    const whole = (b: DocumentBlock) => WHOLE_IN_SELECTION.includes(b.type);
    return blocksToMarkdown([
      whole(r.first) ? r.first : { ...r.first, content: (r.first.content || '').slice(r.firstOffset) },
      ...blocks.slice(r.fIdx + 1, r.lIdx),
      whole(r.last) ? r.last : { ...r.last, content: (r.last.content || '').slice(0, r.lastOffset) },
    ]);
  };

  // Ctrl/Cmd+A a second time (the bullet's own text is selected already): the whole note, ready for
  // Ctrl+C as Markdown
  const handleTreeKeyDownCapture = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'a') return;
    const ta = e.target as HTMLTextAreaElement;
    if (ta.tagName !== 'TEXTAREA' || ta.selectionStart !== 0 || ta.selectionEnd !== ta.value.length) return;
    if (visibleEntries.length < 2) return;
    e.preventDefault();
    const first = visibleEntries[0].block;
    const last = visibleEntries[visibleEntries.length - 1].block;
    focusBlockInput(first.id, 'select');
    setRangeSel({ anchorId: first.id, anchorOffset: 0, focusId: last.id, focusOffset: (last.content || '').length });
  };

  const deleteRangeSel = (sel: RangeSel, insert = '') => {
    const r = resolveRangeSel(sel);
    if (!r || !canEdit) return false;
    const notMergeable = ['code', 'divider', 'table', 'progress'];
    if (notMergeable.includes(r.first.type) || notMergeable.includes(r.last.type)) return false;
    const deleted = blocks.slice(r.fIdx + 1, r.lIdx + 1);
    const holder = [r.first, ...deleted].map((b) => lockHolder(b.id)).find(Boolean);
    if (holder) {
      onLockedAction?.(holder);
      return true;
    }
    // Children of the last bullet stay and move under the first, like merging two bullets
    const lastLevel = Math.max(0, r.last.level || 0);
    const delta = Math.max(0, r.first.level || 0) - lastLevel;
    const moved: DocumentBlock[] = [];
    for (let j = r.lIdx + 1; j < blocks.length; j++) {
      const lvl = Math.max(0, blocks[j].level || 0);
      if (lvl <= lastLevel) break;
      moved.push({ ...blocks[j], level: Math.max(levelOffset || 0, lvl + delta) });
    }
    const merged: DocumentBlock = {
      ...r.first,
      content: (r.first.content || '').slice(0, r.firstOffset) + insert + (r.last.content || '').slice(r.lastOffset),
    };
    const deleteIds = deleted.map((b) => b.id);
    if (onReplaceRange) {
      onReplaceRange(merged, deleteIds, moved);
    } else {
      if (onUpdateBlocks) onUpdateBlocks([merged, ...moved]);
      else [merged, ...moved].forEach((b) => onUpdateBlock(b, true));
      deleteIds.forEach((id) => onDeleteBlock(id));
    }
    clearRangeSel();
    focusBlockInput(r.first.id, r.firstOffset + insert.length);
    return true;
  };

  // Keys while a selection over several bullets exists
  const deleteRangeSelRef = useRef(deleteRangeSel);
  deleteRangeSelRef.current = deleteRangeSel;
  const selectedTextRef = useRef(selectedText);
  selectedTextRef.current = selectedText;
  useEffect(() => {
    if (!rangeSel) return;
    const onKey = (e: KeyboardEvent) => {
      const sel = rangeSelRef.current;
      if (!sel) return;
      const mod = e.ctrlKey || e.metaKey;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod && (e.key === 'c' || e.key === 'x')) {
        stop();
        writeClipboardText(selectedTextRef.current(sel));
        if (e.key === 'x') deleteRangeSelRef.current(sel);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        stop();
        deleteRangeSelRef.current(sel);
        return;
      }
      if (!mod && !e.altKey && e.key.length === 1) {
        stop();
        deleteRangeSelRef.current(sel, e.key);
        return;
      }
      if (!['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) clearRangeSel();
    };
    // A press outside the note ends the selection, so Ctrl+C there does not copy it
    const onDown = (e: MouseEvent) => {
      if (!treeRootRef.current?.contains(e.target as Node)) clearRangeSel();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [rangeSel, clearRangeSel]);

  // The browser's own selection over several bullets (e.g. started outside the note or on its title)
  // as a selection here, so copying it gives Markdown too instead of the rendered text
  const nativeRangeSel = (root: HTMLElement): RangeSel | null => {
    const s = document.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) return null;
    const range = s.getRangeAt(0); // start and end in document order
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-outline-block]'));
    if (rows.length < 2 || !range.intersectsNode(root)) return null;
    // The bullet a boundary lies in; one outside every bullet (on the note itself, its title, the page)
    // stands for the first bullet at the start and the last at the end
    const rowOf = (n: Node, side: 'start' | 'end') => {
      const el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
      const row = el?.closest<HTMLElement>('[data-outline-block]');
      if (row && root.contains(row)) return row;
      return side === 'start' ? rows[0] : rows[rows.length - 1];
    };
    const offsetIn = (row: HTMLElement, node: Node, nodeOffset: number, side: 'start' | 'end') => {
      const id = row.dataset.outlineBlock!;
      const raw = textareaMapRef.current.get(id)?.value ?? blocks.find((b) => b.id === id)?.content ?? '';
      const span = row.querySelector<HTMLElement>('[data-outline-text]');
      if (!span || !span.contains(node)) return side === 'start' ? 0 : raw.length;
      const r = document.createRange();
      r.setStart(span, 0);
      r.setEnd(node, nodeOffset);
      return mapRenderedOffsetToRaw(raw, span.textContent || '', r.toString().length);
    };
    const startRow = rowOf(range.startContainer, 'start');
    const endRow = rowOf(range.endContainer, 'end');
    if (startRow === endRow) return null;
    return {
      anchorId: startRow.dataset.outlineBlock!,
      anchorOffset: offsetIn(startRow, range.startContainer, range.startOffset, 'start'),
      focusId: endRow.dataset.outlineBlock!,
      focusOffset: offsetIn(endRow, range.endContainer, range.endOffset, 'end'),
    };
  };
  const nativeRangeSelRef = useRef(nativeRangeSel);
  nativeRangeSelRef.current = nativeRangeSel;

  // Copying through the menu or a native selection: the same Markdown as Ctrl+C on a selection here
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const root = treeRootRef.current;
      if (!root || e.defaultPrevented) return;
      // A selection here counts while the note has the focus; otherwise only what the browser selected
      const own = rangeSelRef.current && root.contains(document.activeElement) ? rangeSelRef.current : null;
      const sel = own ?? nativeRangeSelRef.current(root);
      const text = sel ? selectedTextRef.current(sel) : '';
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  const rangeRowIds = useMemo(() => {
    if (!rangeSel || highlightSupported) return null;
    const order = visibleEntries.map((e) => e.block.id);
    const a = order.indexOf(rangeSel.anchorId);
    const f = order.indexOf(rangeSel.focusId);
    if (a < 0 || f < 0) return null;
    return new Set(order.slice(Math.min(a, f), Math.max(a, f) + 1));
  }, [rangeSel, visibleEntries, highlightSupported]);

  return (
    <div
      className="space-y-0.5"
      ref={treeRootRef}
      onMouseDownCapture={handleTreeMouseDownCapture}
      onKeyDownCapture={handleTreeKeyDownCapture}
    >
      {visibleEntries.map(({ block, index, hasChildren, maxAllowedLevel }, entryIdx) => {
        const isLast = entryIdx === visibleEntries.length - 1;
        return (
          <OutlinerBlock
            key={block.id}
            docId={docId}
            block={block}
            index={index}
            isLast={isLast}
            siblingFollows={siblingFollows(index)}
            maxAllowedLevel={maxAllowedLevel}
            hasChildren={hasChildren}
            isFocused={focusedBlockId === block.id}
            canEdit={canEdit && !lockedBlocks?.has(block.id)}
            lockedBy={lockedBlocks?.get(block.id)}
            originalLockedBy={block.conflictOf && block.conflictOf !== 'title' ? lockedBlocks?.get(block.conflictOf) : undefined}
            canAppendBelow={canEdit}
            onResolveConflict={canEdit ? onResolveConflict : undefined}
            onUndo={onUndo}
            onRedo={onRedo}
            levelOffset={levelOffset}
            onZoomBlock={onZoomBlock}
            onExtractBlock={onExtractBlock}
            onInlineBlock={onInlineBlock}
            onUpdateBlock={onUpdateBlock}
            onCreateBlockBelow={handleCreateBlockBelow}
            onPasteMultiLines={handlePasteMultiLines}
            listMarker={listLabels.get(block.id)}
            onDeleteBlock={handleDeleteBlock}
            onMergeWithPrevious={handleMergeWithPrevious}
            onIndentBlock={handleIndentBlock}
            onToggleBranch={handleToggleBranch}
            onNavigateFocus={handleNavigateFocus}
            onFocusBlock={setFocusedBlockId}
            onBlurBlock={handleBlurBlock}
            onBlockActivity={onBlockActivity}
            onOpenTask={onOpenTask}
            onTagClick={onTagClick}
            onWikiLinkClick={onWikiLinkClick}
            onCopyBlockLink={onCopyBlockLink}
            onDragStartBlock={handleDragStartBlock}
            onDragOverBlock={handleDragOverBlock}
            onDropBlock={handleDropBlock}
            isDragTarget={dragOverIndex === index && draggedIndex !== index}
            isTargeted={highlightedBlockId === block.id}
            registerTextareaRef={registerTextareaRef}
            inRangeSelection={rangeRowIds?.has(block.id) || wholeRowIds?.has(block.id)}
          />
        );
      })}

      {canEdit && trailingArea && (
        <div
          className={`${compact ? 'min-h-[2.5rem]' : 'min-h-[14rem]'} pt-2 pl-2 transition-colors cursor-text ${
            dragOverIndex === blocks.length ? 'border-t-2 border-accent bg-accent/10 rounded' : ''
          }`}
          onClick={(e) => {
            if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('button, a, input, textarea, select')) {
              return;
            }
            if (blocks.length === 0) {
              const firstBlock: DocumentBlock = {
                id: `blk_${Date.now().toString(36)}_0`,
                documentId: docId,
                type: 'text',
                content: '',
                level: levelOffset || 0,
                position: 1000,
              };
              pendingFocusRef.current = { blockId: firstBlock.id, cursor: 'start' };
              onCreateBlock(firstBlock);
            } else {
              const lastBlock = blocks[blocks.length - 1];
              if (lastBlock.content && lastBlock.content.trim() !== '') {
                handleCreateBlockBelow(lastBlock.id, '');
              } else {
                focusBlockInput(lastBlock.id, 'end');
              }
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (draggedIndex !== null) {
              setDragOverIndex(blocks.length);
            }
          }}
          onDrop={() => handleDropBlock(blocks.length)}
        />
      )}
      {showMobileBar && (
        <MobileOutlineBar
          onOutdent={() => runOnFocused((id) => handleIndentBlock(id, -1))}
          onIndent={() => runOnFocused((id) => handleIndentBlock(id, 1))}
          onMoveUp={() => runOnFocused((id) => onMoveSibling?.(id, -1))}
          onMoveDown={() => runOnFocused((id) => onMoveSibling?.(id, 1))}
        />
      )}
    </div>
  );
});
