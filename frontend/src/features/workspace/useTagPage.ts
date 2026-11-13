import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentBlock } from '../../lib/types';
import { DocSyncEngine } from '../../lib/docSync/engine';
import { extractHashtags } from '../../lib/hashtags';

// Hashtag page (DocumentEditor variant 'tag'): the runs of bullets of the note that are shown there.
// Shown are the bullets carrying the hashtag with all their children. The bullet with the cursor (and
// the bullets above it) and bullets just created here stay even without the hashtag, so typing never
// pulls the text away; once the cursor leaves, a bullet without the hashtag disappears.
export function useTagPage({
  inTagPage,
  tagFilter,
  blocks,
  engineRef,
  currentBlocksRef,
  handleCreateBlock,
  handleInsertBlocks,
  handleMoveBlock,
}: {
  inTagPage: boolean;
  tagFilter?: string;
  blocks: DocumentBlock[];
  engineRef: React.MutableRefObject<DocSyncEngine | null>;
  currentBlocksRef: React.MutableRefObject<DocumentBlock[]>;
  handleCreateBlock: (newBlock: DocumentBlock, afterBlockId?: string) => void;
  handleInsertBlocks: (afterBlockId: string, updatedCurrentBlock: DocumentBlock, newBlocks: DocumentBlock[]) => void;
  handleMoveBlock: (blockId: string, targetIndex: number, newLevel?: number) => void;
}) {
  const [tagFocusId, setTagFocusId] = useState<string | null>(null);
  const [tagFreshIds, setTagFreshIds] = useState<Set<string>>(() => new Set());
  const tagBlurTimerRef = useRef<number | null>(null);
  const handleTagFocusChange = useCallback((id: string | null) => {
    engineRef.current?.focusBlock(id);
    if (tagBlurTimerRef.current !== null) window.clearTimeout(tagBlurTimerRef.current);
    tagBlurTimerRef.current = null;
    if (id === null) {
      // Moving from one bullet to the next blurs first; only a real leave counts
      tagBlurTimerRef.current = window.setTimeout(() => {
        setTagFocusId(null);
        setTagFreshIds((prev) => (prev.size === 0 ? prev : new Set()));
      }, 150);
      return;
    }
    setTagFocusId(id);
    setTagFreshIds((prev) => (prev.size === 0 || prev.has(id) ? prev : new Set()));
  }, [engineRef]);
  useEffect(() => () => {
    if (tagBlurTimerRef.current !== null) window.clearTimeout(tagBlurTimerRef.current);
  }, []);
  // What was shown last time: of the bullets above the cursor only those stay that were already shown
  // (adding a heading above would start the branch anew and lose the cursor)
  const tagShownRef = useRef<Set<string>>(new Set());
  const tagGroups = useMemo(() => {
    if (!inTagPage || !tagFilter) return [] as DocumentBlock[][];
    const tag = tagFilter.replace(/^#/, '').toLowerCase();
    const keep = new Set<string>(tagFreshIds);
    const fIdx = tagFocusId ? blocks.findIndex((b) => b.id === tagFocusId) : -1;
    if (fIdx >= 0) {
      keep.add(blocks[fIdx].id);
      let lvl = Math.max(0, blocks[fIdx].level || 0);
      for (let i = fIdx - 1; i >= 0 && lvl > 0; i--) {
        const l = Math.max(0, blocks[i].level || 0);
        if (l < lvl) {
          if (!tagShownRef.current.has(blocks[i].id)) break;
          keep.add(blocks[i].id);
          lvl = l;
        }
      }
    }
    // Runs of shown bullets: a shown bullet brings its children; gaps start a new run
    const groups: DocumentBlock[][] = [];
    let current: DocumentBlock[] | null = null;
    let insideLevel: number | null = null;
    for (const b of blocks) {
      const lvl = Math.max(0, b.level || 0);
      if (insideLevel !== null && lvl <= insideLevel) insideLevel = null;
      const shown = insideLevel !== null || keep.has(b.id) || extractHashtags(b.content).includes(tag);
      if (!shown) {
        current = null;
        continue;
      }
      if (!current) {
        current = [];
        groups.push(current);
      }
      current.push(b);
      if (insideLevel === null) insideLevel = lvl;
    }
    tagShownRef.current = new Set(groups.flat().map((b) => b.id));
    return groups;
  }, [inTagPage, tagFilter, blocks, tagFocusId, tagFreshIds]);
  const handleTagCreateBlock = useCallback(
    (newBlock: DocumentBlock, afterBlockId?: string) => {
      setTagFreshIds((prev) => new Set(prev).add(newBlock.id));
      handleCreateBlock(newBlock, afterBlockId);
    },
    [handleCreateBlock]
  );
  const handleTagInsertBlocks = useCallback(
    (afterBlockId: string, updatedCurrent: DocumentBlock, newBlocks: DocumentBlock[]) => {
      setTagFreshIds((prev) => {
        const next = new Set(prev);
        newBlocks.forEach((b) => next.add(b.id));
        return next;
      });
      handleInsertBlocks(afterBlockId, updatedCurrent, newBlocks);
    },
    [handleInsertBlocks]
  );
  // Dragging inside one run: its positions are positions in the whole note
  const tagMoveBlock = (group: DocumentBlock[]) => (blockId: string, targetIndex: number, newLevel?: number) => {
    const anchor = targetIndex < group.length ? group[targetIndex] : group[group.length - 1];
    const idx = currentBlocksRef.current.findIndex((b) => b.id === anchor.id);
    if (idx < 0) return;
    handleMoveBlock(blockId, targetIndex < group.length ? idx : idx + 1, newLevel);
  };

  return { tagGroups, handleTagFocusChange, handleTagCreateBlock, handleTagInsertBlocks, tagMoveBlock };
}
