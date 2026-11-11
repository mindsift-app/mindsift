import React, { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { buildBlockLink, WikiLinkClickHandler } from '../../lib/wikiLink';
import { MOVE_BRANCH_EVENT } from './moveBranchEvent';
import { onDocFocusRequest, takeDocFocus } from '../../lib/docFocusRequest';
import {
  Pin,
  Users,
  Trash2,
  RotateCcw,
  Download,
  Maximize2,
  FileText,
  Loader2,
  ArrowLeft,
  Lock,
  Home,
  ChevronRight,
  ChevronsUpDown,
  ChevronsDownUp,
  Minimize2,
  Plus,
  Check,
  CloudOff,
  AlertTriangle,
  GitMerge,
  Undo2,
  Redo2,
  MoreHorizontal,
  CalendarDays,
  SmilePlus,
  Link2,
} from 'lucide-react';
import { Document, DocumentBlock, MoveResult, User } from '../../lib/types';
import { api } from '../../lib/api';
import { OfflineError } from '../../lib/offline';
import { ConflictChoice, DocSyncEngine, EngineState } from '../../lib/docSync/engine';
import { Presence } from '../../lib/docSync/transport';
import { OutlinerTree, OutlinerTreeHandle } from './OutlinerTree';
import type { BlockLock } from './OutlinerBlock';
import { extractHashtags } from '../../lib/hashtags';
import { branchEnd, insertBelow, moveSibling, unitStart } from '../../lib/outlineList';
import { reportNav, onNavStep, restoringNavPlace } from '../../lib/navHistory';
import { readNotePlace, writeNotePlace } from '../../lib/notePlace';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

export type DocSaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export interface DocHeaderStatus {
  showLive: boolean;
  channel: 'ws' | 'sse' | 'longpoll' | 'interval';
  otherPeople: Presence[];
  avatarsById: Map<string, string>;
}

export interface DocumentEditorProps {
  docId: string;
  currentUser?: User | null;
  initialDoc?: Document | null;
  availableFolders: string[];
  autoFocusTitle?: boolean;
  initialFocusedBlockId?: string | null;
  onDocMetadataChange: (updated: Document) => void;
  onDeleteDoc: (docId: string) => void;
  onRestoreDoc?: (docId: string) => void;
  onOpenShareModal: (doc: Document) => void;
  onSelectTag: (tag: string) => void;
  onWikiLinkClick?: WikiLinkClickHandler;
  onOpenDocBlock?: (docId: string, blockId?: string) => void;
  onBackMobile?: () => void;
  onOpenTask?: (taskId: string) => void;
  onSaveStatusChange?: (status: DocSaveStatus, errorMsg?: string) => void;
  onHeaderStatusChange?: (status: DocHeaderStatus | null) => void;
  /** Opens the dialog to merge this note into another one (own notes only) */
  onRequestMerge?: (doc: Document) => void;
  /** A note was created from this one (extract) or removed again (undo); keeps the sidebar current */
  onDocCreated?: (doc: Document) => void;
  onDocRemoved?: (docId: string) => void;
  /** Notes a branch can be moved into (writable, not this one): the choice when extracting a bullet */
  moveTargets?: ExtractTarget[];
  /** 'journal': one day inside the journal list – no own scrolling, header or backlinks, fixed title.
   *  'tag': inside a hashtag page – the title as a fixed heading, below only the branches with tagFilter */
  variant?: 'page' | 'journal' | 'tag';
  /** variant 'tag': the hashtag (without #) whose bullets are shown */
  tagFilter?: string;
  /** Large screens: the action buttons render into this element (the workspace tab bar) */
  actionsTarget?: HTMLElement | null;
  /** Distraction-free mode: full window, the note as wide as without the sidebar, menu entry to leave it */
  focusMode?: boolean;
  /** Focus mode: the header at the top edge is pinned (the pane already starts below it) */
  focusBarPinned?: boolean;
  onToggleFocusMode?: () => void;
  /** variant 'journal': the day's last bullet was deleted, the day leaves the journal */
  onEmptied?: () => void;
}

// The bullet of this note the cursor is in, with its position on screen, held for a second after a change
// of others arrived (null: the cursor is elsewhere)
interface CursorAnchor {
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

// The element that scrolls el (the note, or the journal with its days)
function scrollParent(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

// What undoing the editor's server actions needs, kept with the note's undo history (lib/docSync/undoHistory.ts)
interface EditorUndoExtra {
  extract: { newDocId: string; blockId: string; link: string } | null;
  inline: { sourceId: string; blockId: string; content: string } | null;
  move: { result: MoveResult; blockId: string; link: string } | null;
}

// Large screens (lg) put the note's actions into the workspace tab bar and drop the editor header
const LARGE_QUERY = '(min-width: 1024px)';
function subscribeLarge(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(LARGE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
function isLargeScreen() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(LARGE_QUERY).matches;
}

import { EmojiPickerModal } from './EmojiPickerModal';
import { ExtractPopover, ExtractTarget } from './ExtractPopover';
import { BacklinksSection } from './BacklinksSection';
import { useKeyboardInset } from '../../lib/useKeyboardInset';
import { blockTitle, computeBreadcrumbs, getZoomedSubtree, isTitleFromKind } from './zoom';

// Height of the outline bar that sits on the keyboard (MobileOutlineBar), with a little air
const KEYBOARD_BAR_SPACE = 64;

function ensureNonEmptyBlocks(docId: string, blocks?: DocumentBlock[]): DocumentBlock[] {
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
  return blocks.map((b, idx) => ({
    ...b,
    id: b.id || `${docId}-b${idx}`,
    documentId: docId,
    type: b.type || 'text',
    level: Math.max(0, b.level || 0),
    position: b.position || (idx + 1) * 1000,
  }));
}

// True if both lists show the same blocks; avoids re-rendering when the sync engine echoes a local change.
function sameBlocks(a: DocumentBlock[], b: DocumentBlock[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.content !== y.content ||
      (x.level || 0) !== (y.level || 0) ||
      x.type !== y.type ||
      !!x.checked !== !!y.checked ||
      !!x.collapsed !== !!y.collapsed ||
      (x.lang || '') !== (y.lang || '') ||
      (x.taskId || '') !== (y.taskId || '') ||
      (x.subtaskOf || '') !== (y.subtaskOf || '') ||
      (x.conflictOf || '') !== (y.conflictOf || '')
    ) {
      return false;
    }
  }
  return true;
}


export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  docId,
  currentUser,
  initialDoc,
  autoFocusTitle,
  initialFocusedBlockId,
  onDocMetadataChange,
  onDeleteDoc,
  onRestoreDoc,
  onOpenDocBlock,
  onOpenShareModal,
  onSelectTag,
  onWikiLinkClick,
  onBackMobile,
  onOpenTask,
  onSaveStatusChange,
  onHeaderStatusChange,
  onRequestMerge,
  onDocCreated,
  onDocRemoved,
  moveTargets,
  variant = 'page',
  tagFilter,
  actionsTarget,
  focusMode = false,
  focusBarPinned = false,
  onToggleFocusMode,
  onEmptied,
}) => {
  const { t } = useTranslation('workspace');
  const inJournal = variant === 'journal';
  const inTagPage = variant === 'tag';
  // Embedded in a list of notes (journal, hashtag page): no own scrolling, action bar or backlinks
  const embedded = inJournal || inTagPage;
  const large = useSyncExternalStore(subscribeLarge, isLargeScreen, () => false);
  // The journal's active day puts its actions into the tab bar as well
  const desktopBar = (!embedded || inJournal) && large && Boolean(actionsTarget);
  const [doc, setDoc] = useState<Document | null>(initialDoc || null);
  const [title, setTitle] = useState<string>(initialDoc?.title || '');
  const [blocks, setBlocks] = useState<DocumentBlock[]>(() =>
    ensureNonEmptyBlocks(docId, initialDoc?.blocks)
  );
  const [loading, setLoading] = useState<boolean>(!initialDoc);
  const [error, setError] = useState<string | null>(null);
  // The note could not be fetched for lack of connection; the sync engine may still have a copy on this device
  const [loadedOffline, setLoadedOffline] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  // Where the user last was in this note (zoom, scroll), unless a link points to a bullet in it
  const [savedPlace] = useState(() =>
    !embedded && !initialFocusedBlockId ? readNotePlace(docId) : null
  );
  // Zoomed bullet; coming here by the browser's back/forward it is the zoom of that step, else the one
  // the note had when the user last left it
  const [zoomedBlockId, setZoomedBlockId] = useState<string | null>(() => {
    const place = restoringNavPlace();
    if (inJournal || inTagPage) return null;
    if (place?.docId === docId) return place.zoom ?? null;
    return savedPlace?.zoom ?? null;
  });
  const [showActionsMenu, setShowActionsMenu] = useState<boolean>(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

  // Sync engine (operation log): stores every change locally and syncs it with the server
  const engineRef = useRef<DocSyncEngine | null>(null);
  const [engineState, setEngineState] = useState<EngineState | null>(null);


  const titleInputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Focus mode keeps the note at the height it has in the workspace, so the text does not move when it
  // starts; the room below lets the end of the note scroll up into the upper third
  const workspaceTopRef = useRef(0);
  const [focusTopGap, setFocusTopGap] = useState(0);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    if (!focusMode) {
      workspaceTopRef.current = root.getBoundingClientRect().top;
      return;
    }
    // The fixed pane starts at the top edge; offsetTop ignores its zoom-in animation (a transform).
    // Unpinned, the header slides in over the note: at least its height (45 px) plus 16 px stay free
    const top = root.offsetTop;
    setFocusTopGap(Math.max(focusBarPinned ? 0 : 41, workspaceTopRef.current - top));
  }, [focusMode, focusBarPinned]);
  // After a page load the note is still loading when that runs (no pane yet), and the bars above it may
  // appear later: measured once the pane is there and again whenever it changes (otherwise focus mode would
  // start too high)
  const showsLoading = loading && !engineState?.ready;
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || focusMode || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      workspaceTopRef.current = root.getBoundingClientRect().top;
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [focusMode, showsLoading]);

  // Sideways the note moves to the middle in focus mode and gets wider (and back): it glides and grows
  // from where it was instead of jumping, the lines rewrap along the way
  const contentRef = useRef<HTMLDivElement | null>(null);
  const contentBoxRef = useRef<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    const from = contentBoxRef.current;
    contentBoxRef.current = { left, width };
    if (
      !from ||
      (Math.abs(from.left - left) < 1 && Math.abs(from.width - width) < 1) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const parentLeft = el.parentElement?.getBoundingClientRect().left ?? 0;
    el.animate(
      [
        { marginLeft: `${from.left - parentLeft}px`, width: `${from.width}px` },
        { marginLeft: `${left - parentLeft}px`, width: `${width}px` },
      ],
      { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
    );
  }, [focusMode]);

  // Keeps the bullet being typed in above the keyboard (and the outline bar on it): the browser only
  // scrolls it into the visible part if the note can scroll that far, hence also the room at the end
  const { inset: keyboardInset, keyboardOpen, visibleHeight } = useKeyboardInset();
  useEffect(() => {
    // Without visualViewport the keyboard is unknown (counts as open): nothing to measure against
    if (!keyboardOpen || embedded || !window.visualViewport) return;
    const root = scrollRef.current;
    if (!root) return;
    const reveal = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !root.contains(el) || el.tagName !== 'TEXTAREA') return;
      const vv = window.visualViewport;
      const visibleBottom = (vv ? vv.offsetTop : 0) + visibleHeight - KEYBOARD_BAR_SPACE;
      const over = el.getBoundingClientRect().bottom + 12 - visibleBottom;
      if (over > 0) root.scrollBy({ top: over });
    };
    reveal();
    root.addEventListener('focusin', reveal);
    root.addEventListener('input', reveal);
    return () => {
      root.removeEventListener('focusin', reveal);
      root.removeEventListener('input', reveal);
    };
  }, [keyboardOpen, visibleHeight, embedded]);
  // The header repeats the title only once the big title has scrolled out of view
  const [titleScrolledAway, setTitleScrolledAway] = useState(false);
  const outlinerTreeRef = useRef<OutlinerTreeHandle | null>(null);
  const docRef = useRef<Document | null>(doc);
  docRef.current = doc;

  const currentTitleRef = useRef<string>(title);
  currentTitleRef.current = title;
  const currentBlocksRef = useRef<DocumentBlock[]>(blocks);
  currentBlocksRef.current = blocks;

  // The bullet with the cursor stays where it is on screen when changes of others arrive above it. New
  // text of a bullet above reaches its field only in a later render (and only then it wraps onto another
  // line), so for a moment every change of the list's size is evened out too, before it is painted
  const cursorAnchorRef = useRef<CursorAnchor | null>(null);
  const keepCursorInPlace = useCallback(() => {
    const anchor = cursorAnchorRef.current;
    if (!anchor) return;
    const el = document.querySelector(`[data-outline-block="${anchor.blockId}"]`);
    // Time is up, or the cursor went elsewhere: the user moves on, nothing to hold any more
    if (!el || performance.now() > anchor.until || document.activeElement?.closest('[data-outline-block]') !== el) {
      cursorAnchorRef.current = null;
      anchor.observer?.disconnect();
      return;
    }
    const shift = el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(shift) >= 1) scrollParent(el)?.scrollBy({ top: shift, behavior: 'instant' });
    if (!anchor.observer && el.parentElement && typeof ResizeObserver !== 'undefined') {
      anchor.observer = new ResizeObserver(keepCursorInPlace);
      anchor.observer.observe(el.parentElement);
    }
  }, []);
  useLayoutEffect(keepCursorInPlace, [blocks, keepCursorInPlace]);
  useEffect(() => () => cursorAnchorRef.current?.observer?.disconnect(), []);

  useEffect(() => {
    const root = scrollRef.current;
    const el = titleInputRef.current;
    if (embedded || !root || !el || typeof IntersectionObserver === 'undefined') {
      setTitleScrolledAway(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setTitleScrolledAway(!entry.isIntersecting),
      // the sticky header covers the top of the scroll area
      { root, rootMargin: '-56px 0px 0px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [zoomedBlockId, doc?.id, embedded]);

  useEffect(() => {
    if (!loading && (autoFocusTitle || (doc?.title === i18n.t('workspace:editor.newNote') && (!doc?.blocks || doc?.blocks.length <= 1)))) {
      const focusTitle = () => {
        if (titleInputRef.current) {
          titleInputRef.current.focus();
          titleInputRef.current.select();
        }
      };
      focusTitle();
      const t1 = setTimeout(focusTitle, 50);
      const t2 = setTimeout(focusTitle, 150);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    // Only when the note opens: a later change of its title or bullets must not pull the cursor into the title
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, autoFocusTitle, doc?.id]);

  useEffect(() => {
    if (!loading && zoomedBlockId && !blocks.some((b) => b.id === zoomedBlockId)) {
      setZoomedBlockId(null);
    }
  }, [blocks, zoomedBlockId, loading]);

  // Remember zoom and scroll position (lib/notePlace.ts); the scroll position belongs to the zoom it was
  // taken in, so it is restored only when the note opens in that zoom again
  const zoomForPlaceRef = useRef(zoomedBlockId);
  useEffect(() => {
    if (embedded) return;
    if (zoomForPlaceRef.current !== zoomedBlockId) {
      zoomForPlaceRef.current = zoomedBlockId;
      writeNotePlace(docId, { zoom: zoomedBlockId, scroll: 0 });
    }
  }, [zoomedBlockId, docId, embedded]);
  useEffect(() => {
    const root = scrollRef.current;
    if (embedded || !root) return;
    let timer: number | null = null;
    const save = () => {
      timer = null;
      writeNotePlace(docId, { zoom: zoomForPlaceRef.current, scroll: root.scrollTop });
    };
    const onScroll = () => {
      if (timer === null) timer = window.setTimeout(save, 200);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (timer !== null) {
        window.clearTimeout(timer);
        save();
      }
    };
    // the note's scroll area exists only once it has loaded
  }, [docId, embedded, loading]);
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (loading || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    const root = scrollRef.current;
    const target = savedPlace && savedPlace.zoom === zoomedBlockId ? savedPlace.scroll : 0;
    if (!root || target <= 0) return;
    // Images and code blocks may still grow the note for a few frames
    let frames = 0;
    let raf = 0;
    const apply = () => {
      root.scrollTop = target;
      if (Math.abs(root.scrollTop - target) > 1 && ++frames < 30) raf = requestAnimationFrame(apply);
    };
    raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
    // only once, when the note's content is first there
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Zooming in and out are steps of the browser history: back zooms out again (lib/navHistory.ts)
  useEffect(() => {
    if (!embedded) reportNav({ zoom: zoomedBlockId });
  }, [zoomedBlockId, embedded]);
  useEffect(
    () =>
      onNavStep((place) => {
        if (!embedded && place.docId === docId) setZoomedBlockId(place.zoom ?? null);
      }),
    [embedded, docId]
  );

  const { zoomedBlock, childBlocks, levelOffset } = useMemo(() => {
    return getZoomedSubtree(blocks, zoomedBlockId);
  }, [blocks, zoomedBlockId]);

  const breadcrumbs = useMemo(() => {
    return computeBreadcrumbs(title || doc?.title || t('editor.untitled'), blocks, zoomedBlockId);
  }, [title, doc?.title, blocks, zoomedBlockId, t]);

  // Owner and editors may edit; the role comes from the server via the sync engine
  const inTrash = Boolean(doc?.isArchived);
  const canEdit = useMemo(() => {
    if (doc?.isArchived) return false;
    if (engineState?.role) return engineState.role === 'owner' || engineState.role === 'editor';
    if (!doc) return false;
    return Boolean(doc.isOwner || doc.permission === 'owner' || doc.permission === 'write');
  }, [doc, engineState?.role]);

  // Extract all #tags present across the current blocks
  const extractedTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const b of blocks) {
      for (const tag of extractHashtags(b.content)) tagSet.add(tag);
    }
    return Array.from(tagSet);
  }, [blocks]);


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
    // Undo of the editor's server actions from the last time the note was open (kept with the engine's steps)
    const kept = engine.undoExtra as EditorUndoExtra | undefined;
    lastExtractRef.current = kept?.extract ?? null;
    lastInlineRef.current = kept?.inline ?? null;
    lastMoveRef.current = kept?.move ?? null;
    const unsubscribe = engine.subscribe((state) => {
      setEngineState(state);
      if (!state.ready) return;
      const next = ensureNonEmptyBlocks(docId, state.blocks);
      if (!sameBlocks(currentBlocksRef.current, next)) {
        // Changes of others (own edits are in currentBlocksRef already): remember where the bullet with the
        // cursor is, so bullets added or removed above it do not move it (layout effect below)
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

  const otherPeople = useMemo(
    () => (engineState?.presence || []).filter((p) => p.userId !== currentUser?.id),
    [engineState?.presence, currentUser?.id]
  );

  // Presence only carries names; profile pictures come from the user directory, loaded once
  // the first time someone else shows up (avatars can be data URLs, too big for every sync)
  const [avatarsById, setAvatarsById] = useState<Map<string, string>>(new Map());
  const avatarsRequestedRef = useRef(false);
  useEffect(() => {
    if (otherPeople.length === 0 || avatarsRequestedRef.current) return;
    avatarsRequestedRef.current = true;
    api.getUsersDirectory()
      .then((users) => {
        const m = new Map<string, string>();
        for (const u of users) if (u.avatarUrl) m.set(u.id, u.avatarUrl);
        setAvatarsById(m);
      })
      .catch(() => {});
  }, [otherPeople.length]);

  // Blocks other users are editing right now (blockId -> who, with color key and profile picture)
  const lockedBlocks = useMemo(() => {
    const m = new Map<string, BlockLock>();
    for (const l of engineState?.lockedByOthers || []) {
      m.set(l.blockId, { userId: l.userId, name: l.name || t('lock.someone'), avatarUrl: avatarsById.get(l.userId) });
    }
    return m;
  }, [engineState?.lockedByOthers, avatarsById, t]);

  const showLive = Boolean(engineState && (engineState.shared || engineState.sessions > 1));
  const liveChannel = engineState?.channel || 'ws';
  useEffect(() => {
    onHeaderStatusChange?.({ showLive, channel: liveChannel, otherPeople, avatarsById });
  }, [showLive, liveChannel, otherPeople, avatarsById, onHeaderStatusChange]);

  useEffect(() => {
    return () => {
      onHeaderStatusChange?.(null);
    };
  }, [onHeaderStatusChange]);

  useEffect(() => {
    if (!showActionsMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowActionsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showActionsMenu]);

  // Short hint at the bottom of the editor (blocked actions, skipped undo), optionally with one action
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeActions, setNoticeActions] = useState<{ label: string; run: () => void }[]>([]);
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = useCallback((message: string, actions: { label: string; run: () => void }[] = []) => {
    setNotice(message);
    setNoticeActions(actions);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      setNoticeActions([]);
    }, actions.length ? 8000 : 3500);
  }, []);

  // Link to a single bullet: [[Titel#doc_id^blk_id]] into the clipboard
  const handleCopyBlockLink = useCallback(
    (blockId: string) => {
      const link = buildBlockLink(title || doc?.title || i18n.t('workspace:link.note'), docId, blockId);
      const done = () => showNotice(i18n.t('workspace:editor.linkCopied'));
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link).then(done, () => showNotice(i18n.t('workspace:editor.copyFailed', { link })));
      } else {
        showNotice(i18n.t('workspace:editor.copyFailed', { link }));
      }
    },
    [docId, title, doc?.title, showNotice]
  );

  // Link to the whole note (?note=…, like the links of the MCP server): opens it in the app, for everyone
  // who can see it
  const handleCopyNoteLink = useCallback(() => {
    const link = `${window.location.origin}/?note=${encodeURIComponent(docId)}`;
    const done = () => showNotice(i18n.t('workspace:editor.noteLinkCopied'));
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(done, () => showNotice(i18n.t('workspace:editor.copyFailed', { link })));
    } else {
      showNotice(i18n.t('workspace:editor.copyFailed', { link }));
    }
  }, [docId, showNotice]);

  // Opened from the search: cursor at the end of the first bullet, so one ArrowDown goes on to the next
  // (lib/docFocusRequest.ts). A short delay, so the closing search does not take the focus along.
  useEffect(() => {
    if (embedded || loading) return;
    let timer = 0;
    const take = () => {
      if (!takeDocFocus(docId)) return;
      timer = window.setTimeout(() => outlinerTreeRef.current?.focusFirstBlock(), 30);
    };
    take();
    const off = onDocFocusRequest(take);
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [docId, embedded, loading]);

  // A link pointed to a bullet that is gone (moved, extracted, deleted): the note opens with a hint
  const blocksForTargetRef = useRef(blocks);
  blocksForTargetRef.current = blocks;
  useEffect(() => {
    if (!initialFocusedBlockId || !doc?.id) return;
    const timer = window.setTimeout(() => {
      if (!blocksForTargetRef.current.some((b) => b.id === initialFocusedBlockId)) {
        showNotice(i18n.t('workspace:editor.blockGone'));
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [initialFocusedBlockId, doc?.id, showNotice]);

  // The last extraction, so undoing it (toast or Strg+Z) also puts the new note into the trash
  const lastExtractRef = useRef<{ newDocId: string; blockId: string; link: string } | null>(null);
  // The last note brought back, so undoing it also takes the note out of the trash again
  const lastInlineRef = useRef<{ sourceId: string; blockId: string; content: string } | null>(null);
  // The last branch moved into another note, so undoing it here also takes it out of the target again
  const lastMoveRef = useRef<{ result: MoveResult; blockId: string; link: string } | null>(null);
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
  }, [docId, onDocCreated, onDocRemoved, showNotice]);
  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  const handleLockedAction = useCallback(
    (holder: string) => showNotice(i18n.t('workspace:lock.notice', { name: holder })),
    [showNotice]
  );
  const handleUndo = useCallback(() => {
    const res = engineRef.current?.undo();
    if (res?.message) showNotice(res.message);
    if (res?.ok) finishUndoExtract();
  }, [showNotice, finishUndoExtract]);

  const handleRedo = useCallback(() => {
    const res = engineRef.current?.redo();
    if (res?.message) showNotice(res.message);
  }, [showNotice]);

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
  }, [embedded, actionsTarget]);
  const handleResolveConflict = useCallback(
    (blockId: string, choice: ConflictChoice) => {
      const res = engineRef.current?.resolveConflict(blockId, choice);
      if (res?.message) showNotice(res.message);
    },
    [showNotice]
  );

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
    [canEdit, applyLocalBlocks, zoomedBlockId, childBlocks]
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
  }, [embedded, inTrash]);

  // A bullet with its children becomes a note of its own. The server only creates the note; the branch
  // is replaced here as an ordinary own edit, so it shows at once, syncs like typing and Strg+Z works.
  // withLink false (dragged onto the "new note" button): the branch just leaves, like a move.
  const handleExtractBlock = useCallback(
    async (blockId: string, withLink = true) => {
      const engine = engineRef.current;
      if (!engine) return;
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
    [docId, onOpenDocBlock, onDocCreated, showNotice, handleUndo, applyLocalBlocks]
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
    [docId, canEdit, onOpenDocBlock, showNotice, handleUndo, applyLocalBlocks]
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
  const [extractAt, setExtractAt] = useState<{ blockId: string; x: number; y: number } | null>(null);
  const handleExtractRequest = useCallback(
    (blockId: string, at?: { x: number; y: number }) => {
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
      if (!engine) return;
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
    [docId, onDocRemoved, showNotice, handleUndo, applyLocalBlocks]
  );

  // Keep parent sidebar metadata in sync when blocks/tags change
  useEffect(() => {
    if (!docRef.current) return;
    const updatedDoc: Document = {
      ...docRef.current,
      title,
      blocks,
      tags: extractedTags,
      updatedAt: new Date().toISOString(),
    };
    docRef.current = updatedDoc;
    onDocMetadataChange(updatedDoc);
    // Runs when title, bullets or tags change, not when the parent hands in another callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, extractedTags, title]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!canEdit) return;
    setTitle(e.target.value);
    engineRef.current?.setTitle(e.target.value);
  };

  const handleTitleBlur = () => {
    void engineRef.current?.syncNow();
  };

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

  // --- Hashtag page (variant 'tag') ---
  // Shown are the bullets carrying the hashtag with all their children. The bullet with the cursor (and
  // the bullets above it) and bullets just created here stay even without the hashtag, so typing never
  // pulls the text away; once the cursor leaves, a bullet without the hashtag disappears.
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
  }, []);
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

  const handleTogglePin = async () => {
    if (!doc) return;
    try {
      const updated = await api.updateDocument(doc.id, { isPinned: !doc.isPinned });
      setDoc(updated);
      onDocMetadataChange(updated);
    } catch {
      // ignore
    }
  };

  const handleSelectIcon = async (icon: string) => {
    setShowEmojiPicker(false);
    if (!doc || !canEdit) return;
    try {
      const updated = await api.updateDocument(doc.id, { icon });
      setDoc(updated);
      onDocMetadataChange(updated);
    } catch {
      // ignore
    }
  };

  const handleExportMarkdown = () => {
    const lines: string[] = [`# ${title || i18n.t('workspace:editor.untitled')}`, ''];
    for (const b of blocks) {
      const indent = '  '.repeat(Math.max(0, b.level || 0));
      if (b.type === 'todo') {
        lines.push(`${indent}- [${b.checked ? 'x' : ' '}] ${b.content}`);
      } else if (b.type === 'h1') {
        lines.push(`${indent}- # ${b.content}`);
      } else if (b.type === 'h2') {
        lines.push(`${indent}- ## ${b.content}`);
      } else if (b.type === 'h3') {
        lines.push(`${indent}- ### ${b.content}`);
      } else if (b.type === 'code') {
        lines.push(`${indent}- \`\`\`${b.lang || ''}\n${b.content}\n${indent}  \`\`\``);
      } else if (b.type === 'divider') {
        lines.push(`${indent}- ---`);
      } else if (b.type === 'numbered') {
        lines.push(`${indent}1. ${b.content}`);
      } else {
        lines.push(`${indent}- ${b.content}`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || i18n.t('workspace:editor.fileName')).toLowerCase().replace(/[^\p{L}\p{N}_-]+/giu, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Offline with a copy on this device: edit it, the sync engine sends the changes later
  const offlineCopy = loadedOffline && Boolean(engineState?.ready);

  if (showsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2 text-accent" />
        <span className="text-xs">{t('editor.loading')}</span>
      </div>
    );
  }

  if (error && !offlineCopy) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <p className="text-xs text-status-err font-medium mb-2">{error}</p>
        {onBackMobile && (
          <button
            type="button"
            onClick={onBackMobile}
            className="btn-action px-3 py-1.5 text-xs text-main"
          >
            {t('editor.backToOverview')}
          </button>
        )}
      </div>
    );
  }

  const breadcrumbNav = (
    <nav
      aria-label={t('editor.breadcrumb')}
      className="flex items-center flex-wrap gap-1 text-xs text-muted"
    >
      <button
        type="button"
        onClick={() => setZoomedBlockId(null)}
        className="hover:text-accent inline-flex items-center gap-1 font-medium transition-colors cursor-pointer"
        title={t('editor.backToMain')}
      >
        <Home className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="truncate max-w-[130px]">
          {title || doc?.title || t('editor.untitled')}
        </span>
      </button>

      {breadcrumbs.slice(1).map((crumb, idx) => {
        const isCurrent = idx === breadcrumbs.length - 2;
        return (
          <React.Fragment key={crumb.id || idx}>
            <ChevronRight className="w-3 h-3 text-faint shrink-0" />
            {isCurrent ? (
              <span
                className="font-bold text-accent truncate max-w-[160px]"
                title={crumb.title}
              >
                {crumb.title || t('editor.untitledBullet')}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setZoomedBlockId(crumb.id)}
                className="hover:text-main truncate max-w-[120px] transition-colors cursor-pointer"
                title={t('editor.zoomTo', { title: crumb.title })}
              >
                {crumb.title || t('editor.untitledBullet')}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );

  // Undo/redo, share and the menu; on large screens they sit in the workspace tab bar instead
  const actionsBlock = (
    <div className="flex shrink-0 items-center gap-1.5">
      {!inTrash && (
        <>
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canEdit || !engineState?.canUndo}
            className="btn-icon h-11 w-11 sm:h-7 sm:w-7 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('editor.undo')}
            aria-label={t('editor.undo')}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canEdit || !engineState?.canRedo}
            className="btn-icon h-11 w-11 sm:h-7 sm:w-7 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('editor.redo')}
            aria-label={t('editor.redo')}
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}

      {/* Large screens: focus mode one click away; sharing moves into the menu (a shared note also has
          its share pill in the tab bar). Phones keep the share button. In focus mode its header has the
          way out already. */}
      {desktopBar ? (
        onToggleFocusMode &&
        !focusMode && (
          <button
            type="button"
            onClick={onToggleFocusMode}
            className="btn-icon h-11 w-11 sm:h-7 sm:w-7"
            title={`${t('editor.startFocusTitle')} (${t('editor.focusShortcut')})`}
            aria-label={t('editor.startFocusTitle')}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )
      ) : (
        doc &&
        !inTrash && (
          <button
            type="button"
            onClick={() => onOpenShareModal(doc)}
            className="btn-icon h-11 w-11 sm:h-7 sm:w-7"
            title={t('editor.share')}
            aria-label={t('editor.share')}
          >
            <Users className="w-3.5 h-3.5" />
          </button>
        )
      )}

      <div className="relative" ref={actionsMenuRef}>
        <button
          type="button"
          onClick={() => setShowActionsMenu((prev) => !prev)}
          aria-expanded={showActionsMenu}
          aria-haspopup="menu"
          aria-label={t('editor.more')}
          title={t('editor.more')}
          className="btn-icon h-11 w-11 sm:h-7 sm:w-7"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {showActionsMenu && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 w-max min-w-60 max-w-[calc(100vw-2rem)] rounded-card bg-panel border border-border shadow-lg p-1 z-30 text-xs origin-top-right animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150"
          >
            {desktopBar && doc && !inTrash && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowActionsMenu(false);
                  onOpenShareModal(doc);
                }}
                className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn hover:bg-panel-elevated text-left text-main font-medium flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Users className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>{t('editor.shareMenu')}</span>
              </button>
            )}

            {!inTrash && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowActionsMenu(false);
                  void handleTogglePin();
                }}
                className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn hover:bg-panel-elevated text-left text-main font-medium flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Pin
                  className={`w-3.5 h-3.5 shrink-0 ${
                    doc?.isPinned ? 'text-status-warn' : 'text-accent'
                  }`}
                />
                <span>{doc?.isPinned ? t('editor.unpin') : t('editor.pin')}</span>
              </button>
            )}

            {!inTrash && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowActionsMenu(false);
                  handleCopyNoteLink();
                }}
                className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn hover:bg-panel-elevated text-left text-main font-medium flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>{t('editor.copyNoteLink')}</span>
              </button>
            )}

            {onRequestMerge && doc?.isOwner && !inTrash && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowActionsMenu(false);
                  onRequestMerge(doc);
                }}
                className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn hover:bg-panel-elevated text-left text-main font-medium flex items-center gap-2 transition-colors cursor-pointer"
              >
                <GitMerge className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>{t('editor.merge')}</span>
              </button>
            )}

            {onToggleFocusMode && !desktopBar && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowActionsMenu(false);
                  onToggleFocusMode();
                }}
                className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn hover:bg-panel-elevated text-left text-main font-medium flex items-center gap-2 transition-colors cursor-pointer"
              >
                {focusMode ? (
                  <Minimize2 className="w-3.5 h-3.5 text-accent shrink-0" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5 text-accent shrink-0" />
                )}
                <span className="flex-1">{focusMode ? t('editor.exitFocusTitle') : t('editor.startFocusTitle')}</span>
                <kbd className="hidden sm:inline text-[10px] text-faint font-mono">{t('editor.focusShortcut')}</kbd>
              </button>
            )}

            {/* Always shown, so they can be found; greyed out while there is nothing to do */}
            {canEdit && !inTrash && (
              <>
              <button
                type="button"
                role="menuitem"
                disabled={!hasCollapsed}
                onClick={() => {
                  setShowActionsMenu(false);
                  handleSetAllCollapsed(false);
                }}
                className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn enabled:hover:bg-panel-elevated text-left text-main font-medium flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                <ChevronsUpDown className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="flex-1 whitespace-nowrap">{t('editor.expandAll')}</span>
                <kbd className="hidden sm:inline text-[10px] text-faint font-mono whitespace-nowrap">{t('editor.expandAllShortcut')}</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!canCollapse}
                onClick={() => {
                  setShowActionsMenu(false);
                  handleSetAllCollapsed(true);
                }}
                className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn enabled:hover:bg-panel-elevated text-left text-main font-medium flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                <ChevronsDownUp className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="flex-1 whitespace-nowrap">{t('editor.collapseAll')}</span>
                <kbd className="hidden sm:inline text-[10px] text-faint font-mono whitespace-nowrap">{t('editor.collapseAllShortcut')}</kbd>
              </button>
              </>
            )}


            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setShowActionsMenu(false);
                handleExportMarkdown();
              }}
              className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn hover:bg-panel-elevated text-left text-main font-medium flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-accent shrink-0" />
              <span>{t('editor.exportMd')}</span>
            </button>

            {canEdit && (doc?.isOwner || doc?.permission === 'owner') && (
              <>
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowActionsMenu(false);
                    onDeleteDoc(docId);
                  }}
                  className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 rounded-btn hover:bg-status-err/10 text-left text-status-err font-medium flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-status-err shrink-0" />
                  <span>{t('editor.delete')}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // The note scrolls on its own; at its end the scroll must not pass on to the page, where phones would show
  // and hide the address bar, resize the app (100dvh) and make the bars at the bottom flicker
  return (
    <div
      ref={scrollRef}
      className={embedded ? 'flex flex-col bg-editor' : 'flex-1 flex flex-col h-full min-h-0 bg-editor overflow-y-auto overscroll-y-contain'}
      data-sync-channel={engineState?.channel}
    >
      {desktopBar && actionsTarget && createPortal(actionsBlock, actionsTarget)}

      {extractAt && (
        <ExtractPopover
          x={extractAt.x}
          y={extractAt.y}
          notes={moveTargets || []}
          onNewNote={() => {
            setExtractAt(null);
            void handleExtractBlock(extractAt.blockId);
          }}
          onExisting={(note) => {
            setExtractAt(null);
            void handleMoveBranch(extractAt.blockId, note, true);
          }}
          onCancel={() => setExtractAt(null)}
        />
      )}

      {/* Top Document Action Bar (the journal has one for all days; large screens use the tab bar) */}
      {!embedded && !desktopBar && (
      <div className="sticky top-0 z-20 flex items-center justify-between gap-2 px-4 sm:px-6 py-2 bg-editor border-b border-border">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          {onBackMobile && (
            <button
              type="button"
              onClick={onBackMobile}
              className="lg:hidden btn-icon shrink-0 h-11 w-11 sm:h-7 sm:w-7"
              title={t('editor.backToSidebar')}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Breadcrumbs Navigation (Fokus-Modus) or Doc Indicator */}
          {zoomedBlock && breadcrumbs.length > 0 ? (
            breadcrumbNav
          ) : (
            <div
              className={`flex min-w-0 items-center gap-1.5 text-xs text-muted transition-opacity duration-200 ${
                titleScrolledAway ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              aria-hidden={!titleScrolledAway}
            >
              <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="truncate max-w-[180px] font-medium text-main">
                {title || doc?.title || t('editor.untitled')}
              </span>
            </div>
          )}

          {/* Save status on phones (the desktop shows it above the workspace) */}
          {engineState && (
            <span
              className="sm:hidden inline-flex items-center shrink-0"
              title={
                engineState.status === 'saving'
                  ? t('editor.saving')
                  : engineState.status === 'offline'
                  ? t('editor.offline')
                  : engineState.status === 'error'
                  ? engineState.errorMessage || t('editor.saveFailed')
                  : 'Gespeichert'
              }
              aria-label={t('editor.saveStatus')}
            >
              {engineState.status === 'saving' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
              ) : engineState.status === 'offline' ? (
                <CloudOff className="w-3.5 h-3.5 text-status-warn" />
              ) : engineState.status === 'error' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-status-err" />
              ) : (
                <Check className="w-3.5 h-3.5 text-status-ok" />
              )}
            </span>
          )}

          {/* Read-only indicator */}
          {!canEdit && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-btn text-[11px] font-medium bg-status-warn/10 text-status-warn border border-status-warn/30">
              <Lock className="w-3 h-3" />
              {t('editor.readOnly')}
            </span>
          )}
        </div>

        {!desktopBar && actionsBlock}
      </div>
      )}

      {/* In the trash: read-only with a way back */}
      {inTrash && (
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2 bg-status-err/10 border-b border-status-err/25 text-status-err text-xs">
          <Trash2 className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 min-w-0">{t('editor.inTrash')}</span>
          {onRestoreDoc && (
            <button
              type="button"
              onClick={() => onRestoreDoc(docId)}
              className="btn-action h-11 sm:h-7 px-3 text-xs text-main inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-accent" />
              {t('common:restore')}
            </button>
          )}
        </div>
      )}

      {/* Read-only notification banner */}
      {!canEdit && !inTrash && (
        <div className="flex items-center gap-2 px-4 sm:px-6 py-2 bg-status-warn/10 border-b border-status-warn/25 text-status-warn text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>{t('editor.sharedReadOnly')}</span>
        </div>
      )}

      {/* Main Content Area */}
      {/* Phones: almost no side margin; very deep outlines scroll sideways (rows keep a minimum width) */}
      {/* shrink-0: the sideways scroll area must keep its full height, so only the editor scrolls vertically */}
      {/* Focus mode: as wide as the note in the workspace with the sidebar hidden (max-w-6xl less the page padding and the pane border, App.tsx) */}
      <div
        ref={contentRef}
        className={`w-full pl-2 pr-1 sm:px-8 flex-auto shrink-0 overflow-x-auto sm:overflow-x-visible [-webkit-overflow-scrolling:touch] ${
          inTagPage ? 'py-2' : inJournal ? 'py-3' : 'py-5'
        } ${focusMode ? 'max-w-[calc(theme(maxWidth.6xl)-2rem-2px)] mx-auto' : ''}`}
        style={focusMode && desktopBar && !embedded ? { paddingTop: `calc(1.25rem + ${focusTopGap}px)`, paddingBottom: '60vh' } : undefined}
      >
        {desktopBar && zoomedBlock && breadcrumbs.length > 0 && <div className="mb-3">{breadcrumbNav}</div>}
        {zoomedBlock ? (
          /* =========================================================================
             FOKUS-MODUS & ZOOM-IN (HOISTED SUBTREE VIEW)
             ========================================================================= */
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3 pb-4 mb-2 border-b border-border">
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  // A drawing, image … has no text title: its kind and words, not to be edited here
                  value={isTitleFromKind(zoomedBlock) ? blockTitle(zoomedBlock) : zoomedBlock.content}
                  onChange={(e) => {
                    handleUpdateBlock({ ...zoomedBlock, content: e.target.value });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const firstChild: DocumentBlock = {
                        id: `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
                        documentId: docId,
                        type: 'text',
                        content: '',
                        level: levelOffset,
                        position: (zoomedBlock.position || 1000) + 10,
                      };
                      handleCreateBlock(firstChild, zoomedBlock.id);
                    }
                  }}
                  placeholder={t('editor.branchTitle')}
                  readOnly={!canEdit || isTitleFromKind(zoomedBlock)}
                  className={`w-full text-2xl sm:text-3xl font-light text-main bg-transparent border-0 focus:outline-none focus:ring-0 tracking-tight leading-tight ${
                    isTitleFromKind(zoomedBlock) ? 'text-ellipsis' : ''
                  }`}
                />
              </div>

              <button
                type="button"
                onClick={() => setZoomedBlockId(null)}
                className="btn-action inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted hover:text-main shrink-0 mt-1"
                title={t('editor.exitFocusTitle')}
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('editor.exitFocus')}</span>
              </button>
            </div>

            {childBlocks.length === 0 ? (
              <div className="py-8 text-center text-xs text-faint border border-dashed border-border rounded-card my-2">
                <p className="mb-2">{t('editor.noChildren')}</p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      const firstChild: DocumentBlock = {
                        id: `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
                        documentId: docId,
                        type: 'text',
                        content: '',
                        level: levelOffset,
                        position: (zoomedBlock.position || 1000) + 10,
                      };
                      handleCreateBlock(firstChild, zoomedBlock.id);
                    }}
                    className="btn-action inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent font-medium hover:bg-accent/10"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('editor.firstChild')}</span>
                  </button>
                )}
              </div>
            ) : (
              <OutlinerTree
                compact={inJournal}
                docId={docId}
                blocks={childBlocks}
                canEdit={canEdit}
                levelOffset={levelOffset}
                onZoomBlock={setZoomedBlockId}
                onExtractBlock={canEdit ? handleExtractRequest : undefined}
              onInlineBlock={canEdit ? handleInlineBlock : undefined}
                onUpdateBlock={handleUpdateBlock}
                onUpdateBlocks={handleUpdateBlocks}
                onCreateBlock={handleCreateBlock}
                onInsertBlocks={handleInsertBlocks}
                onDeleteBlock={handleDeleteBlock}
                onDeleteBlocks={handleDeleteBlocks}
                onReplaceRange={handleReplaceRange}
                onMoveBlock={handleMoveBlock}
                onMoveSibling={handleMoveSibling}
                onOpenTask={onOpenTask}
                onTagClick={onSelectTag}
                onWikiLinkClick={onWikiLinkClick}
                onCopyBlockLink={handleCopyBlockLink}
                initialFocusedBlockId={initialFocusedBlockId}
                onFocusedBlockChange={(id) => engineRef.current?.focusBlock(id)}
                onBlockActivity={(id) => engineRef.current?.touchBlock(id)}
                lockedBlocks={lockedBlocks}
                onLockedAction={handleLockedAction}
                onResolveConflict={handleResolveConflict}
                onUndo={handleUndo}
                onRedo={handleRedo}
              />
            )}
          </div>
        ) : (
          /* =========================================================================
             STANDARD GESAMTDOKUMENT-ANSICHT
             ========================================================================= */
          inTagPage ? (
            /* Hashtag page: the note's title as a fixed heading, below the branches with the hashtag,
               edited right in this note */
            tagGroups.length > 0 ? (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => onOpenDocBlock?.(docId)}
                  className="flex items-center gap-2 min-w-0 max-w-full text-left text-lg font-semibold text-main hover:text-accent transition-colors cursor-pointer"
                  title={t('editor.openNote')}
                >
                  {doc?.icon && <span className="shrink-0">{doc.icon}</span>}
                  <span className="truncate">{title || i18n.t('workspace:editor.untitled')}</span>
                  {doc?.folderPath && <span className="shrink-0 text-[11px] font-normal text-faint">{doc.folderPath}</span>}
                </button>
                {tagGroups.map((group) => (
                  <OutlinerTree
                    key={group[0].id}
                    compact
                    trailingArea={false}
                    docId={docId}
                    blocks={group}
                    canEdit={canEdit}
                    levelOffset={Math.min(...group.map((b) => Math.max(0, b.level || 0)))}
                    onZoomBlock={(id) => onOpenDocBlock?.(docId, id)}
                    onUpdateBlock={handleUpdateBlock}
                    onUpdateBlocks={handleUpdateBlocks}
                    onCreateBlock={handleTagCreateBlock}
                    onInsertBlocks={handleTagInsertBlocks}
                    onDeleteBlock={handleDeleteBlock}
                    onDeleteBlocks={handleDeleteBlocks}
                    onReplaceRange={handleReplaceRange}
                    onMoveBlock={tagMoveBlock(group)}
                    onMoveSibling={handleMoveSibling}
                    onOpenTask={onOpenTask}
                    onTagClick={onSelectTag}
                    onWikiLinkClick={onWikiLinkClick}
                    onCopyBlockLink={handleCopyBlockLink}
                    onFocusedBlockChange={handleTagFocusChange}
                    lockedBlocks={lockedBlocks}
                    onLockedAction={handleLockedAction}
                    onResolveConflict={handleResolveConflict}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                  />
                ))}
              </div>
            ) : null
          ) : (
          <>
            {/* Document Icon + Title Header */}
            <div className="flex items-center gap-3 mb-4 relative">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => canEdit && !inJournal && setShowEmojiPicker((prev) => !prev)}
                  className={`text-2xl sm:text-3xl transition-opacity select-none leading-none bg-transparent border-0 outline-none p-0 focus:outline-none focus:ring-0 shadow-none ${
                    inJournal ? 'cursor-default' : 'hover:opacity-80 cursor-pointer'
                  }`}
                  title={inJournal ? undefined : t('editor.changeIcon')}
                >
                  {/* Journal days: a quiet calendar in the theme's text colour instead of the colourful emoji;
                      a note without an icon shows a faint "choose icon" to editors only */}
                  {inJournal ? (
                    <CalendarDays className="w-6 h-6 sm:w-7 sm:h-7 text-muted" strokeWidth={1.75} />
                  ) : doc?.icon ? (
                    doc.icon
                  ) : canEdit ? (
                    <SmilePlus className="w-6 h-6 sm:w-7 sm:h-7 text-faint" strokeWidth={1.5} aria-label={t('editor.chooseIcon')} />
                  ) : null}
                </button>
                {showEmojiPicker && canEdit && (
                  <EmojiPickerModal
                    currentIcon={doc?.icon}
                    onSelectEmoji={handleSelectIcon}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                )}
              </div>

              <textarea
                ref={(el) => {
                  titleInputRef.current = el;
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                rows={1}
                value={title}
                readOnly={!canEdit || inJournal}
                autoFocus={autoFocusTitle}
                onChange={(e) => {
                  handleTitleChange(e);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && !e.altKey && ['z', 'y'].includes(e.key.toLowerCase())) {
                    e.preventDefault();
                    if (e.key.toLowerCase() === 'y' || e.shiftKey) handleRedo();
                    else handleUndo();
                    return;
                  }
                  // Tab after the title goes on into the text, like Enter (not to the first bullet's handle)
                  if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                    e.preventDefault();
                    enterFromTitle();
                  }
                }}
                onBlur={handleTitleBlur}
                placeholder={t('editor.titlePlaceholder')}
                className="flex-1 min-w-0 text-2xl sm:text-3xl font-light text-main bg-transparent border-0 focus:outline-none focus:ring-0 tracking-tight resize-none leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
              />
            </div>

            {/* Logseq Outliner Tree */}
            <OutlinerTree
                compact={inJournal}
              ref={outlinerTreeRef}
              docId={docId}
              blocks={blocks}
              canEdit={canEdit}
              levelOffset={0}
              onZoomBlock={setZoomedBlockId}
              onExtractBlock={canEdit ? handleExtractRequest : undefined}
              onInlineBlock={canEdit ? handleInlineBlock : undefined}
              onUpdateBlock={handleUpdateBlock}
              onUpdateBlocks={handleUpdateBlocks}
              onCreateBlock={handleCreateBlock}
              onInsertBlocks={handleInsertBlocks}
              onDeleteBlock={handleDeleteBlock}
              onDeleteBlocks={handleDeleteBlocks}
              onDeleteLastBlock={inJournal ? onEmptied : undefined}
                onReplaceRange={handleReplaceRange}
              onMoveBlock={handleMoveBlock}
                onMoveSibling={handleMoveSibling}
              onOpenTask={onOpenTask}
              onTagClick={onSelectTag}
              onWikiLinkClick={onWikiLinkClick}
              onCopyBlockLink={handleCopyBlockLink}
              initialFocusedBlockId={initialFocusedBlockId}
              onFocusedBlockChange={(id) => engineRef.current?.focusBlock(id)}
              onBlockActivity={(id) => engineRef.current?.touchBlock(id)}
              lockedBlocks={lockedBlocks}
              onLockedAction={handleLockedAction}
              onResolveConflict={handleResolveConflict}
              onUndo={handleUndo}
              onRedo={handleRedo}
            />

            {onOpenDocBlock && !inTrash && !embedded && <BacklinksSection docId={docId} title={title} onOpen={onOpenDocBlock} />}
          </>
          )
        )}
      </div>

      {/* On-screen keyboard open: room below the last bullet, so it can scroll above the keyboard and the
          bar on top of it (the note itself keeps its height, the keyboard only covers it) */}
      {keyboardOpen && keyboardInset > 0 && !embedded && <div aria-hidden style={{ height: keyboardInset + KEYBOARD_BAR_SPACE, flexShrink: 0 }} />}

      {notice && (
        <div
          role="status"
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-1.5rem)] sm:w-auto sm:max-w-[90vw] flex flex-col sm:block pl-4 pr-1 pt-3 pb-1 sm:px-3 sm:py-2 rounded-card text-sm sm:text-xs text-main bg-panel-elevated border border-border shadow-panel"
        >
          {/* Phones: text on top (two lines at most), buttons below; desktop: one line */}
          <span className="max-sm:pr-3 max-sm:line-clamp-2">{notice}</span>
          {noticeActions.length > 0 && (
            <span className="flex justify-end sm:inline">
              {noticeActions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setNoticeActions([]);
                    a.run();
                  }}
                  className="h-11 px-3 sm:h-auto sm:px-0 sm:ml-3 font-semibold text-accent hover:underline"
                >
                  {a.label}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
