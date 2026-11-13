import React, { useCallback, useEffect, useRef, useState } from 'react';
import { buildBlockLink } from '../../lib/wikiLink';
import { Document } from '../../lib/types';
import { api } from '../../lib/api';
import i18n from '../../i18n';
import { MOVE_BRANCH_EVENT } from './moveBranchEvent';
import type { ExtractTarget } from './ExtractPopover';
import { ensureNonEmptyBlocks, useDocumentSync } from './useDocumentSync';

type DocumentSync = ReturnType<typeof useDocumentSync>;

// Undo and redo of the note (buttons, Strg+Z / Strg+Y) together with the editor's server actions on a
// branch: extracting it into a note of its own, moving it into another note and pulling a linked note
// back in. Undoing such a step also undoes it on the server.
export function useBranchActions({
  docId,
  canEdit,
  embedded,
  actionsTarget,
  scrollRef,
  moveTargets,
  sync: { engineRef, currentBlocksRef, lastExtractRef, lastInlineRef, lastMoveRef, applyLocalBlocks },
  showNotice,
  onOpenDocBlock,
  onDocCreated,
  onDocRemoved,
}: {
  docId: string;
  canEdit: boolean;
  embedded: boolean;
  actionsTarget?: HTMLElement | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  moveTargets?: ExtractTarget[];
  sync: Pick<DocumentSync, 'engineRef' | 'currentBlocksRef' | 'lastExtractRef' | 'lastInlineRef' | 'lastMoveRef' | 'applyLocalBlocks'>;
  showNotice: (message: string, actions?: { label: string; run: () => void }[]) => void;
  onOpenDocBlock?: (docId: string, blockId?: string) => void;
  onDocCreated?: (doc: Document) => void;
  onDocRemoved?: (docId: string) => void;
}) {
  const finishUndoExtract = useCallback(() => {
    const move = lastMoveRef.current;
    if (move) {
      const block = currentBlocksRef.current.find((b) => b.id === move.blockId);
      // Undone when the bullet is back as it was (without a link, or no longer the link)
      if (block && (!move.link || block.content !== move.link)) {
        lastMoveRef.current = null;
        api
          .undoMove(docId, move.result, engineRef.current?.clientId || '')
          .catch((err: any) => showNotice(err?.message || i18n.t('workspace:editor.moveFailed')));
      }
    }
    const inlined = lastInlineRef.current;
    if (inlined) {
      const block = currentBlocksRef.current.find((b) => b.id === inlined.blockId);
      if (!block || block.content !== inlined.content) {
        lastInlineRef.current = null;
        api
          .restoreDocument(inlined.sourceId)
          .then(() => api.getDocument(inlined.sourceId))
          .then((restored) => onDocCreated?.(restored))
          .catch((err: any) => showNotice(err?.message || i18n.t('workspace:editor.restoreFailed')));
      }
    }
    const info = lastExtractRef.current;
    if (!info) return;
    const block = currentBlocksRef.current.find((b) => b.id === info.blockId);
    // The undone step was something else: the link (or, without one, the gap of the branch) is still there
    if (info.link ? block?.content === info.link : !block) return;
    lastExtractRef.current = null;
    api
      .undoExtract(info.newDocId)
      .then(() => onDocRemoved?.(info.newDocId))
      .catch((err: any) => showNotice(err?.message || i18n.t('workspace:editor.removeExtractedFailed')));
  }, [docId, onDocCreated, onDocRemoved, showNotice, currentBlocksRef, engineRef, lastExtractRef, lastInlineRef, lastMoveRef]);

  const handleUndo = useCallback(() => {
    const res = engineRef.current?.undo();
    if (res?.message) showNotice(res.message);
    if (res?.ok) finishUndoExtract();
  }, [showNotice, finishUndoExtract, engineRef]);

  const handleRedo = useCallback(() => {
    const res = engineRef.current?.redo();
    if (res?.message) showNotice(res.message);
  }, [showNotice, engineRef]);

  // Strg+Z / Strg+Y with the focus outside the text fields (e.g. after a click on a bullet's delete button,
  // on the undo button or into empty space): the bullets and the title handle the keys themselves
  const historyKeyRef = useRef({ handleUndo, handleRedo });
  historyKeyRef.current = { handleUndo, handleRedo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !['z', 'y'].includes(e.key.toLowerCase())) return;
      const el = e.target as HTMLElement | null;
      if (!el || el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      const root = scrollRef.current;
      if (!root) return;
      const inEditor = root.contains(el) || !!actionsTarget?.contains(el);
      // Nothing focused: only the note that fills the view, not one of the journal's embedded days
      const onPage = el === document.body && !embedded && root.offsetParent !== null;
      if (!inEditor && !onPage) return;
      e.preventDefault();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) historyKeyRef.current.handleRedo();
      else historyKeyRef.current.handleUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, actionsTarget, scrollRef]);

  // A bullet with its children becomes a note of its own. The server only creates the note; the branch
  // is replaced here as an ordinary own edit, so it shows at once, syncs like typing and Strg+Z works.
  // withLink false (dragged onto the "new note" button): the branch just leaves, like a move.
  const handleExtractBlock = useCallback(
    async (blockId: string, withLink = true) => {
      const engine = engineRef.current;
      if (!engine || !canEdit) return;
      try {
        await engine.syncNow(); // the server reads the branch as typed so far
        const { document: created, link } = await api.extractBranch(docId, blockId, engine.clientId);
        // The focused field keeps its own text while typing; leave it so it shows the link
        (document.activeElement as HTMLElement | null)?.blur?.();
        const prev = currentBlocksRef.current;
        const i = prev.findIndex((b) => b.id === blockId);
        if (i >= 0) {
          const level = prev[i].level || 0;
          let end = i + 1;
          while (end < prev.length && (prev[end].level || 0) > level) end++;
          applyLocalBlocks(
            withLink
              ? // The bullet itself went into the note: a plain bullet with the link stays (not a drawing, to-do …)
                [...prev.slice(0, i), { ...prev[i], type: 'bullet', checked: false, taskId: '', content: link }, ...prev.slice(end)]
              : ensureNonEmptyBlocks(docId, [...prev.slice(0, i), ...prev.slice(end)])
          );
        }
        lastInlineRef.current = null;
        lastExtractRef.current = { newDocId: created.id, blockId, link: withLink ? link : '' };
        onDocCreated?.(created);
        showNotice(i18n.t(withLink ? 'workspace:editor.extracted' : 'workspace:editor.moved', { title: created.title }), [
          { label: i18n.t('workspace:editor.open'), run: () => onOpenDocBlock?.(created.id) },
          { label: i18n.t('common:sync.undo'), run: () => handleUndo() },
        ]);
      } catch (err: any) {
        showNotice(err?.message || i18n.t('workspace:editor.convertFailed'));
      }
    },
    [docId, canEdit, onOpenDocBlock, onDocCreated, showNotice, handleUndo, applyLocalBlocks, currentBlocksRef, engineRef, lastExtractRef, lastInlineRef]
  );

  // A bullet with its children goes to the end of another note (dragged onto it in the sidebar, or chosen
  // when extracting). The server copies it there; here it is removed as an own edit, like extracting, so
  // Strg+Z brings it back (and takes it out of the target again). withLink: a link to the bullet in the
  // target note stays behind instead.
  const handleMoveBranch = useCallback(
    async (blockId: string, target: ExtractTarget, withLink: boolean) => {
      const engine = engineRef.current;
      if (!engine || !canEdit) return;
      try {
        await engine.syncNow(); // the server reads the branch as typed so far
        const result = await api.moveBranch(docId, blockId, target.id, engine.clientId);
        (document.activeElement as HTMLElement | null)?.blur?.();
        const prev = currentBlocksRef.current;
        const i = prev.findIndex((b) => b.id === blockId);
        let link = '';
        if (i >= 0) {
          const level = prev[i].level || 0;
          let end = i + 1;
          while (end < prev.length && (prev[end].level || 0) > level) end++;
          if (withLink) {
            link = buildBlockLink(result.targetTitle || target.title, result.targetId, result.rootId);
            applyLocalBlocks([...prev.slice(0, i), { ...prev[i], type: 'bullet', checked: false, taskId: '', content: link }, ...prev.slice(end)]);
          } else {
            applyLocalBlocks(ensureNonEmptyBlocks(docId, [...prev.slice(0, i), ...prev.slice(end)]));
          }
        }
        lastExtractRef.current = null;
        lastInlineRef.current = null;
        lastMoveRef.current = { result, blockId, link };
        const name = result.targetTitle || target.title;
        showNotice(i18n.t(withLink ? 'workspace:editor.extractedInto' : 'workspace:editor.moved', { title: name }), [
          { label: i18n.t('workspace:editor.open'), run: () => onOpenDocBlock?.(result.targetId, result.rootId) },
          { label: i18n.t('common:sync.undo'), run: () => handleUndo() },
        ]);
      } catch (err: any) {
        showNotice(err?.message || i18n.t('workspace:editor.moveFailed'));
      }
    },
    [docId, canEdit, onOpenDocBlock, showNotice, handleUndo, applyLocalBlocks, currentBlocksRef, engineRef, lastExtractRef, lastInlineRef, lastMoveRef]
  );

  // A bullet dragged out of this note onto another note in the sidebar (useDocDragDrop)
  const handleMoveBranchRef = useRef(handleMoveBranch);
  handleMoveBranchRef.current = handleMoveBranch;
  const handleExtractBlockRef = useRef(handleExtractBlock);
  handleExtractBlockRef.current = handleExtractBlock;
  useEffect(() => {
    const onMove = (e: Event) => {
      const { docId: from, blockId, targetId, targetTitle } = (e as CustomEvent).detail || {};
      if (from !== docId || embedded) return;
      if (!targetId) void handleExtractBlockRef.current(blockId, false);
      else void handleMoveBranchRef.current(blockId, { id: targetId, title: targetTitle }, false);
    };
    window.addEventListener(MOVE_BRANCH_EVENT, onMove);
    return () => window.removeEventListener(MOVE_BRANCH_EVENT, onMove);
  }, [docId, embedded]);

  // The extract button asks where to: a new note (as before) or an existing one
  const [extractAt, setExtractAt] = useState<{ blockId: string; x: number; y: number; align?: 'left' | 'right' } | null>(null);
  const handleExtractRequest = useCallback(
    (blockId: string, at?: { x: number; y: number; align?: 'left' | 'right' }) => {
      if (at && moveTargets && moveTargets.length > 0) setExtractAt({ blockId, ...at });
      else void handleExtractBlock(blockId);
    },
    [moveTargets, handleExtractBlock]
  );

  // The way back: a bullet that only links to a note gets that note's bullets below it again, the note
  // goes to the trash. Inserted here as an own edit like extracting, so Strg+Z brings the link back.
  const handleInlineBlock = useCallback(
    async (blockId: string) => {
      const engine = engineRef.current;
      if (!engine || !canEdit) return;
      try {
        await engine.syncNow();
        const res = await api.inlineNote(docId, blockId);
        (document.activeElement as HTMLElement | null)?.blur?.();
        const prev = currentBlocksRef.current;
        const i = prev.findIndex((b) => b.id === blockId);
        if (i >= 0) {
          const level = prev[i].level || 0;
          const inserted = res.blocks.map((b) => ({ ...b, level: level + 1 + (b.level || 0) }));
          // An extracted note's first bullet takes the link's place again, as a drawing, to-do …
          const head = res.head
            ? { ...prev[i], type: res.head.type, checked: res.head.checked, collapsed: res.head.collapsed, lang: res.head.lang }
            : prev[i];
          // Above any bullets added below the link meanwhile
          applyLocalBlocks([...prev.slice(0, i), { ...head, content: res.content }, ...inserted, ...prev.slice(i + 1)]);
        }
        lastExtractRef.current = null;
        lastInlineRef.current = { sourceId: res.sourceId, blockId, content: res.content };
        onDocRemoved?.(res.sourceId);
        showNotice(i18n.t('workspace:editor.pulledBack'), [{ label: i18n.t('common:sync.undo'), run: () => handleUndo() }]);
      } catch (err: any) {
        showNotice(err?.message || i18n.t('workspace:editor.pullBackFailed'));
      }
    },
    [docId, canEdit, onDocRemoved, showNotice, handleUndo, applyLocalBlocks, currentBlocksRef, engineRef, lastExtractRef, lastInlineRef]
  );

  return {
    handleUndo,
    handleRedo,
    handleExtractBlock,
    handleMoveBranch,
    handleExtractRequest,
    handleInlineBlock,
    extractAt,
    setExtractAt,
  };
}
