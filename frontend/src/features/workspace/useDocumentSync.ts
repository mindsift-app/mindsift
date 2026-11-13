import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, DocumentBlock, MoveResult } from '../../lib/types';
import { api } from '../../lib/api';
import { OfflineError } from '../../lib/offline';
import { DocSyncEngine, EngineState } from '../../lib/docSync/engine';
import { registerNoteClient } from '../../lib/docSync/noteClients';
import i18n from '../../i18n';
import type { DocSaveStatus } from './DocumentEditor';

// The bullet of this note the cursor is in, with its position on screen, held for a second after a change
// of others arrived (null: the cursor is elsewhere)
export interface CursorAnchor {
  blockId: string;
  top: number;
  until: number;
  observer?: ResizeObserver;
}
const CURSOR_HOLD_MS = 1000;
function cursorAnchor(blocks: DocumentBlock[]): CursorAnchor | null {
  const el = document.activeElement?.closest<HTMLElement>('[data-outline-block]');
  const blockId = el?.dataset.outlineBlock;
  if (!el || !blockId || !blocks.some((b) => b.id === blockId)) return null;
  return { blockId, top: el.getBoundingClientRect().top, until: performance.now() + CURSOR_HOLD_MS };
}

// What undoing the editor's server actions needs, kept with the note's undo history (lib/docSync/undoHistory.ts)
interface EditorUndoExtra {
  extract: { newDocId: string; blockId: string; link: string } | null;
  inline: { sourceId: string; blockId: string; content: string } | null;
  move: { result: MoveResult; blockId: string; link: string } | null;
}

export function ensureNonEmptyBlocks(docId: string, blocks?: DocumentBlock[]): DocumentBlock[] {
  if (!blocks || blocks.length === 0) {
    return [
      {
        id: `${docId}-b0`,
        documentId: docId,
        type: 'text',
        content: '',
        level: 0,
        position: 1000,
      },
    ];
  }
  // A block that needs nothing keeps its object, so its bullet does not render again (OutlinerBlock is memoized)
  return blocks.map((b, idx) => {
    const id = b.id || `${docId}-b${idx}`;
    const type = b.type || 'text';
    const level = Math.max(0, b.level || 0);
    const position = b.position || (idx + 1) * 1000;
    if (b.id === id && b.documentId === docId && b.type === type && b.level === level && b.position === position) return b;
    return { ...b, id, documentId: docId, type, level, position };
  });
}

function sameBlock(x: DocumentBlock, y: DocumentBlock): boolean {
  return (
    x.id === y.id &&
    x.content === y.content &&
    (x.level || 0) === (y.level || 0) &&
    x.type === y.type &&
    !!x.checked === !!y.checked &&
    !!x.collapsed === !!y.collapsed &&
    (x.lang || '') === (y.lang || '') &&
    (x.taskId || '') === (y.taskId || '') &&
    (x.subtaskOf || '') === (y.subtaskOf || '') &&
    (x.conflictOf || '') === (y.conflictOf || '') &&
    (x.conflictAuthor || '') === (y.conflictAuthor || '')
  );
}

// True if both lists show the same blocks; avoids re-rendering when the sync engine echoes a local change.
function sameBlocks(a: DocumentBlock[], b: DocumentBlock[]): boolean {
  return a.length === b.length && a.every((x, i) => sameBlock(x, b[i]));
}

// The engine's list with the objects of `prev` for blocks that did not change: a change of someone else
// renders only the bullets it touches
function keepUnchanged(prev: DocumentBlock[], next: DocumentBlock[]): DocumentBlock[] {
  const byId = new Map(prev.map((b) => [b.id, b]));
  return next.map((b) => {
    const old = byId.get(b.id);
    return old && sameBlock(old, b) ? old : b;
  });
}

// The note's content and its sync: fetches the note, runs the sync engine (operation log) that stores every
// change locally and syncs it with the server, reports the save status and applies local edits
export function useDocumentSync(
  docId: string,
  initialDoc: Document | null | undefined,
  onDocMetadataChange: (updated: Document) => void,
  onSaveStatusChange?: (status: DocSaveStatus, errorMsg?: string) => void
) {
  const [doc, setDoc] = useState<Document | null>(initialDoc || null);
  const [title, setTitle] = useState<string>(initialDoc?.title || '');
  const [blocks, setBlocks] = useState<DocumentBlock[]>(() =>
    ensureNonEmptyBlocks(docId, initialDoc?.blocks)
  );
  const [loading, setLoading] = useState<boolean>(!initialDoc);
  const [error, setError] = useState<string | null>(null);
  // The note could not be fetched for lack of connection; the sync engine may still have a copy on this device
  const [loadedOffline, setLoadedOffline] = useState(false);

  // Sync engine (operation log): stores every change locally and syncs it with the server
  const engineRef = useRef<DocSyncEngine | null>(null);
  const [engineState, setEngineState] = useState<EngineState | null>(null);

  const currentTitleRef = useRef<string>(title);
  currentTitleRef.current = title;
  const currentBlocksRef = useRef<DocumentBlock[]>(blocks);
  currentBlocksRef.current = blocks;

  // The bullet with the cursor stays where it is on screen when changes of others arrive above it
  // (keepCursorInPlace); set here when such a change comes in
  const cursorAnchorRef = useRef<CursorAnchor | null>(null);

  // The last extraction, so undoing it (toast or Strg+Z) also puts the new note into the trash
  const lastExtractRef = useRef<EditorUndoExtra['extract']>(null);
  // The last note brought back, so undoing it also takes the note out of the trash again
  const lastInlineRef = useRef<EditorUndoExtra['inline']>(null);
  // The last branch moved into another note, so undoing it here also takes it out of the target again
  const lastMoveRef = useRef<EditorUndoExtra['move']>(null);

  // Fetch document on mount
  useEffect(() => {
    let isCancelled = false;
    if (!initialDoc) {
      setLoading(true);
    }
    setError(null);
    setLoadedOffline(false);

    api
      .getDocument(docId)
      .then((fetched) => {
        if (isCancelled) return;
        const normalized = ensureNonEmptyBlocks(docId, fetched.blocks);
        setDoc(fetched);
        if (!engineRef.current?.getState().ready) {
          setTitle(fetched.title || i18n.t('workspace:editor.untitled'));
          currentBlocksRef.current = normalized;
          setBlocks(normalized);
        }
        const links = new Map<string, string>();
        const subtaskLinks = new Map<string, string>();
        for (const b of fetched.blocks || []) {
          if (b.taskId) links.set(b.id, b.taskId);
          if (b.subtaskOf) subtaskLinks.set(b.id, b.subtaskOf);
        }
        engineRef.current?.setTaskLinks(links, subtaskLinks);
        setLoading(false);
        onDocMetadataChange(fetched);

      })
      .catch((err: any) => {
        if (isCancelled) return;
        if (err instanceof OfflineError) {
          setLoadedOffline(true);
          setError(i18n.t('workspace:editor.notAvailableOffline'));
        } else {
          setError(err?.message || i18n.t('workspace:editor.loadFailed'));
        }
        setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
    // Fetched once per note; initialDoc only decides whether the loading state shows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // Start the sync engine for this note: shows stored state immediately (also offline), then syncs
  useEffect(() => {
    const engine = new DocSyncEngine(docId);
    engineRef.current = engine;
    const unregisterClient = registerNoteClient(docId, engine.clientId);
    // Undo of the editor's server actions from the last time the note was open (kept with the engine's steps)
    const kept = engine.undoExtra as EditorUndoExtra | undefined;
    lastExtractRef.current = kept?.extract ?? null;
    lastInlineRef.current = kept?.inline ?? null;
    lastMoveRef.current = kept?.move ?? null;
    const unsubscribe = engine.subscribe((state) => {
      setEngineState(state);
      if (!state.ready) return;
      const next = keepUnchanged(currentBlocksRef.current, ensureNonEmptyBlocks(docId, state.blocks));
      if (!sameBlocks(currentBlocksRef.current, next)) {
        // Changes of others (own edits are in currentBlocksRef already): remember where the bullet with the
        // cursor is, so bullets added or removed above it do not move it (keepCursorInPlace)
        cursorAnchorRef.current?.observer?.disconnect();
        cursorAnchorRef.current = cursorAnchor(currentBlocksRef.current);
        currentBlocksRef.current = next;
        setBlocks(next);
      }
      if (state.title && state.title !== currentTitleRef.current) {
        setTitle(state.title);
      }
    });
    void engine.start();
    return () => {
      unsubscribe();
      unregisterClient();
      const extra: EditorUndoExtra = { extract: lastExtractRef.current, inline: lastInlineRef.current, move: lastMoveRef.current };
      engine.undoExtra = extra.extract || extra.inline || extra.move ? extra : undefined;
      engine.stop();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [docId]);

  useEffect(() => {
    if (!engineState) return;
    switch (engineState.status) {
      case 'saving':
        onSaveStatusChange?.('saving');
        break;
      case 'offline':
        onSaveStatusChange?.('unsaved', i18n.t('workspace:editor.offlineSaved'));
        break;
      case 'error':
        onSaveStatusChange?.('error', engineState.errorMessage);
        break;
      default:
        onSaveStatusChange?.('saved');
    }
    // Reports a change of the save status, not every step of the sync (engineState) or render of the
    // parent (its callback is new each time)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState?.status, engineState?.errorMessage]);

  // Every local block change goes to the engine, which turns it into operations
  const applyLocalBlocks = useCallback(
    (update: DocumentBlock[] | ((prev: DocumentBlock[]) => DocumentBlock[])) => {
      const prev = currentBlocksRef.current;
      const next = typeof update === 'function' ? update(prev) : update;
      if (next === prev) return;
      currentBlocksRef.current = next;
      setBlocks(next);
      engineRef.current?.applyFlat(next);
    },
    []
  );

  return {
    doc,
    setDoc,
    title,
    setTitle,
    blocks,
    loading,
    error,
    loadedOffline,
    engineRef,
    engineState,
    currentBlocksRef,
    cursorAnchorRef,
    lastExtractRef,
    lastInlineRef,
    lastMoveRef,
    applyLocalBlocks,
  };
}
