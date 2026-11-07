import React, { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Check,
  CheckSquare,
  Trash2,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ListTodo,
  ListOrdered,
  Minus,
  MessageSquare,
  ExternalLink,
  Link as LinkIcon,
  Lock,
  AlertTriangle,
  XCircle,
  Image as ImageIcon,
  Mic,
  Shapes,
  AudioLines,
  FileOutput,
  FileInput,
  Link2,
  Type,
  Unlink,
  KeyRound,
} from 'lucide-react';
import { DocumentBlock, BlockType } from '../../lib/types';
import { LinkModal } from './LinkModal';
import { SecretChip, NewSecretSheet } from './SecretChip';
import { CodeBlockEditor, resolveLanguageId, isUnambiguousLanguageShortcut } from './CodeBlockEditor';
import { ImagePicker } from './ImagePicker';
import { ImageBlock } from './ImageBlock';
import { DrawingBlock } from './drawing/DrawingBlock';
import { emptyDrawing, serializeDrawing } from '../../lib/drawing/model';
import { AudioRecorderPicker } from './AudioRecorderPicker';
import { AudioBlock } from './AudioBlock';
import { DictationBlock } from './DictationBlock';
import { currentVoiceConfig } from '../../lib/voice';
import { LinkPreviewCard } from './LinkPreviewCard';
import { linkCardUrl, hidePreviewContent, linkHost, useLinkPreviewsEnabled } from '../../lib/linkPreview';
import { mediaContent, parseMediaContent } from '../../lib/media';
import { renderInlineMarkdown } from '../../lib/markdown';
import { api } from '../../lib/api';
import { safeHref } from '../../lib/safeUrl';
import { isNoteLinkOnly } from '../../lib/wikiLink';
import { BLOCK_DRAG_TYPE } from './moveBranchEvent';
import { caretAfterChange } from '../../lib/caret';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { UserAvatar } from '../../components/UserAvatar';
import { userColorStyles } from '../../lib/userColor';
import { showError } from '../../components/ErrorNotice';

export interface SlashCommand {
  type: BlockType | 'link' | 'secret' | 'dictation' | 'extract';
  label: string;
  readonly desc: string;
  icon: React.ReactNode;
  /** Only offered in an empty bullet; the bullet turns into an inline picker first */
  media?: boolean;
  /** Further names that find the command (e.g. German ones) */
  aliases?: string[];
}

// The command name counts most: "/li" finds /link before /number (whose description says "Liste")
function slashRank(c: SlashCommand, q: string): number {
  if (!q) return 0;
  const name = c.label.slice(1).toLowerCase();
  if (name.startsWith(q)) return 0;
  if ((c.aliases || []).some((a) => a.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  if ((c.aliases || []).some((a) => a.includes(q))) return 3;
  return 4;
}

// How long the action bubble stays after the last mouse move over a bullet
const BUBBLE_IDLE_MS = 1000;
// On touch devices the bubble shows when a bullet gets the focus or is tapped, then hides again
const BUBBLE_TOUCH_MS = 3000;

const SLASH_COMMANDS: SlashCommand[] = [
  { type: 'todo', label: '/todo', get desc() { return i18n.t('workspace:slash.todo'); }, icon: <ListTodo className="w-3.5 h-3.5" /> },
  { type: 'numbered', label: '/number', get desc() { return i18n.t('workspace:slash.numbered'); }, icon: <ListOrdered className="w-3.5 h-3.5" />, aliases: ['nummer', 'liste', 'ol'] },
  { type: 'link', label: '/link', get desc() { return i18n.t('workspace:slash.link'); }, icon: <LinkIcon className="w-3.5 h-3.5" /> },
  { type: 'secret', label: '/secret', get desc() { return i18n.t('workspace:slash.secret'); }, icon: <KeyRound className="w-3.5 h-3.5" />, aliases: ['geheim', 'verdeckt', 'passwort', 'password', 'hidden'] },
  { type: 'bullet', label: '/text', get desc() { return i18n.t('workspace:slash.bullet'); }, icon: <Type className="w-3.5 h-3.5" />, aliases: ['p', 'paragraph', 'bullet', 'standard'] },
  { type: 'h1', label: '/h1', get desc() { return i18n.t('workspace:slash.h1'); }, icon: <Heading1 className="w-3.5 h-3.5" /> },
  { type: 'h2', label: '/h2', get desc() { return i18n.t('workspace:slash.h2'); }, icon: <Heading2 className="w-3.5 h-3.5" /> },
  { type: 'h3', label: '/h3', get desc() { return i18n.t('workspace:slash.h3'); }, icon: <Heading3 className="w-3.5 h-3.5" /> },
  { type: 'code', label: '/code', get desc() { return i18n.t('workspace:slash.code'); }, icon: <Code className="w-3.5 h-3.5" /> },
  { type: 'callout', label: '/callout', get desc() { return i18n.t('workspace:slash.callout'); }, icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { type: 'warning', label: '/warn', get desc() { return i18n.t('workspace:slash.warning'); }, icon: <AlertTriangle className="w-3.5 h-3.5 text-status-warn" />, aliases: ['warnung', 'warning', 'achtung'] },
  { type: 'error', label: '/fail', get desc() { return i18n.t('workspace:slash.error'); }, icon: <XCircle className="w-3.5 h-3.5 text-status-err" />, aliases: ['fehler', 'error', 'danger'] },
  { type: 'divider', label: '/divider', get desc() { return i18n.t('workspace:slash.divider'); }, icon: <Minus className="w-3.5 h-3.5" /> },
  { type: 'extract', label: '/extract', get desc() { return i18n.t('workspace:slash.extract'); }, icon: <FileOutput className="w-3.5 h-3.5" />, aliases: ['notiz', 'auslagern'] },
  { type: 'image', label: '/image', get desc() { return i18n.t('workspace:slash.image'); }, icon: <ImageIcon className="w-3.5 h-3.5" />, media: true, aliases: ['bild', 'foto'] },
  { type: 'drawing', label: '/canvas', get desc() { return i18n.t('workspace:slash.drawing'); }, icon: <Shapes className="w-3.5 h-3.5" />, aliases: ['draw', 'sketch', 'diagram', 'zeichnung', 'skizze'] },
  { type: 'audio', label: '/audio', get desc() { return i18n.t('workspace:slash.audio'); }, icon: <Mic className="w-3.5 h-3.5" />, media: true, aliases: ['sprachnotiz'] },
  { type: 'dictation', label: '/diktat', get desc() { return i18n.t('workspace:slash.dictation'); }, icon: <AudioLines className="w-3.5 h-3.5" />, media: true, aliases: ['dictate'] },
];

// Another user's lock on a block: name for the badge, user id for the person's color
export interface BlockLock {
  userId: string;
  name: string;
  avatarUrl?: string;
}

export interface OutlinerBlockProps {
  docId: string;
  block: DocumentBlock;
  index: number;
  isLast: boolean;
  maxAllowedLevel: number;
  hasChildren: boolean;
  isFocused: boolean;
  canEdit: boolean;
  levelOffset?: number;
  onZoomBlock?: (blockId: string) => void;
  /** Turns this bullet and its children into a note of its own */
  /** at: where the extract button was clicked, to ask there where the branch should go */
  onExtractBlock?: (blockId: string, at?: { x: number; y: number }) => void;
  onInlineBlock?: (blockId: string) => void;
  onUpdateBlock: (updated: DocumentBlock, immediate?: boolean) => void;
  onCreateBlockBelow: (afterBlockId: string, newContent?: string) => void;
  onDeleteBlock: (blockId: string, deleteSubtree?: boolean) => void;
  onMergeWithPrevious?: (blockId: string, content: string) => boolean;
  onIndentBlock: (blockId: string, delta: 1 | -1) => void;
  onNavigateFocus: (blockId: string, direction: 'up' | 'down') => void;
  onFocusBlock?: (blockId: string) => void;
  onBlurBlock?: (blockId: string) => void;
  onOpenTask?: (taskId: string) => void;
  onTagClick?: (tag: string) => void;
  onWikiLinkClick?: (pageTitle: string, blockId?: string) => void;
  /** Copies a link to this bullet ([[Notiz#^id|…]]) */
  onCopyBlockLink?: (blockId: string) => void;
  onDragStartBlock?: (index: number, e: React.DragEvent) => void;
  onDragOverBlock?: (e: React.DragEvent, index: number) => void;
  onDropBlock?: (index: number) => void;
  isDragTarget?: boolean;
  isTargeted?: boolean;
  registerTextareaRef: (blockId: string, el: HTMLTextAreaElement | null) => void;
  onPasteMultiLines?: (blockId: string, textBefore: string, textAfter: string, rawLines: string[]) => void;
  /** Number or letter of a numbered-list item ("1.", "b.", "iii.") */
  listMarker?: string;
  /** Another bullet on the same level follows: Enter in this empty bullet adds a bullet instead of outdenting */
  siblingFollows?: boolean;
  lockedBy?: BlockLock; // someone else is editing this block
  canAppendBelow?: boolean; // the user may edit the note, so Enter in a locked block still adds one below
  onResolveConflict?: (blockId: string, accept: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Part of a selection over several bullets (browsers without the CSS Highlight API tint the row) */
  inRangeSelection?: boolean;
}

// Rendered markdown only drops syntax characters (**, `, [..](url) …), so its text is a subsequence of the raw
// text. Walking both strings in parallel maps a caret offset in the rendered text back to the raw text.
export function mapRenderedOffsetToRaw(raw: string, rendered: string, renderedOffset: number): number {
  let j = 0;
  for (let i = 0; i < renderedOffset && i < rendered.length; i++) {
    const idx = raw.indexOf(rendered[i], j);
    if (idx === -1) break;
    j = idx + 1;
  }
  return Math.min(j, raw.length);
}

export const OutlinerBlock: React.FC<OutlinerBlockProps> = ({
  docId,
  block,
  index,
  hasChildren,
  isFocused,
  canEdit,
  maxAllowedLevel,
  levelOffset = 0,
  onZoomBlock,
  onExtractBlock,
  onInlineBlock,
  onUpdateBlock,
  onCreateBlockBelow,
  onDeleteBlock,
  onMergeWithPrevious,
  onIndentBlock,
  onNavigateFocus,
  onFocusBlock,
  onBlurBlock,
  onOpenTask,
  onTagClick,
  onWikiLinkClick,
  onCopyBlockLink,
  onDragStartBlock,
  onDragOverBlock,
  onDropBlock,
  isDragTarget,
  isTargeted,
  registerTextareaRef,
  onPasteMultiLines,
  listMarker,
  siblingFollows = false,
  lockedBy,
  canAppendBelow,
  onResolveConflict,
  onUndo,
  onRedo,
  inRangeSelection,
}) => {
  const { t } = useTranslation('workspace');
  const [localContent, setShownContent] = useState<string>(block.content || '');
  // The user changed the text since the field last took it over from the block. Only then may leaving the
  // field send it: an unchanged field can hold old text, e.g. while someone else types in this locked bullet.
  const editedRef = useRef(false);
  const setLocalContent = useCallback((content: string) => {
    editedRef.current = true;
    setShownContent(content);
  }, []);
  const [isLocallyFocused, setIsLocallyFocused] = useState<boolean>(false);
  const activeFocus = isFocused || isLocallyFocused;
  // A block someone else is editing can still get the cursor (read-only), e.g. to press Enter at its end
  const canFocus = canEdit || (!!lockedBy && !!canAppendBelow);
  const [slashMatchInfo, setSlashMatchInfo] = useState<{ query: string; slashStart: number; cursor: number } | null>(null);
  const slashSearch = slashMatchInfo ? slashMatchInfo.query : null;
  const linkBeforeRef = useRef<string>('');
  const linkAfterRef = useRef<string>('');
  // Where the cursor was when the link dialog opened; it goes back there when the dialog is closed
  const linkCaretRef = useRef(0);
  const dictationBeforeRef = useRef<string>('');
  const dictationAfterRef = useRef<string>('');
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const blurSlashTimerRef = useRef<number | null>(null);
  // Inline picker an empty bullet turns into after /image (local only, nothing synced until done)
  const [mediaPicker, setMediaPicker] = useState<'image' | 'audio' | 'dictation' | null>(null);
  // A drawing just made with /canvas opens its editor right away
  const [drawingAutoOpen, setDrawingAutoOpen] = useState(false);
  // Card above bullets whose entire content is a plain https address (lib/linkPreview.ts)
  const previewsOn = useLinkPreviewsEnabled();
  const previewUrl =
    previewsOn && !mediaPicker && ['bullet', 'text', 'paragraph', 'todo', 'h1', 'h2', 'h3'].includes(block.type || 'bullet')
      ? linkCardUrl(localContent)
      : null;
  const [slashIndex, setSlashIndex] = useState(0);
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [showLinkModal, setShowLinkModal] = useState<boolean>(false);
  const [showSecretSheet, setShowSecretSheet] = useState(false);

  // Action bubble with a real pointer: shown only while the mouse moves over the row (until a moment after
  // the last move), while it rests on the bubble or a menu of it is open; a resting mouse must not leave it
  // over the text. Touch devices show it at the focused bullet for a few seconds after the focus or a tap.
  const hasHover = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches, []);
  const [pointerMoving, setPointerMoving] = useState(false);
  const [pointerOnBubble, setPointerOnBubble] = useState(false);
  const pointerIdleTimerRef = useRef<number | null>(null);
  const handleRowMouseMove = () => {
    if (!hasHover) return;
    setPointerMoving(true);
    if (pointerIdleTimerRef.current !== null) window.clearTimeout(pointerIdleTimerRef.current);
    pointerIdleTimerRef.current = window.setTimeout(() => setPointerMoving(false), BUBBLE_IDLE_MS);
  };
  const handleRowMouseLeave = () => {
    if (pointerIdleTimerRef.current !== null) window.clearTimeout(pointerIdleTimerRef.current);
    pointerIdleTimerRef.current = null;
    setPointerMoving(false);
  };
  // Own timer: a tap also sends emulated mouse events, and the mouse leaving must not cancel it
  const [touchShown, setTouchShown] = useState(false);
  const touchTimerRef = useRef<number | null>(null);
  const showBubbleForTouch = () => {
    if (hasHover) return;
    setTouchShown(true);
    if (touchTimerRef.current !== null) window.clearTimeout(touchTimerRef.current);
    touchTimerRef.current = window.setTimeout(() => setTouchShown(false), BUBBLE_TOUCH_MS);
  };
  useEffect(() => () => {
    if (pointerIdleTimerRef.current !== null) window.clearTimeout(pointerIdleTimerRef.current);
    if (touchTimerRef.current !== null) window.clearTimeout(touchTimerRef.current);
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const latestBlockRef = useRef<DocumentBlock>(block);
  latestBlockRef.current = block;
  const localContentRef = useRef<string>(localContent);
  localContentRef.current = localContent;

  // Callback refs to avoid stale closures in setTimeout, debounce flush, and event listeners
  const onUpdateBlockRef = useRef(onUpdateBlock);
  onUpdateBlockRef.current = onUpdateBlock;
  const onCreateBlockBelowRef = useRef(onCreateBlockBelow);
  onCreateBlockBelowRef.current = onCreateBlockBelow;
  const onPasteMultiLinesRef = useRef(onPasteMultiLines);
  onPasteMultiLinesRef.current = onPasteMultiLines;
  const onDeleteBlockRef = useRef(onDeleteBlock);
  onDeleteBlockRef.current = onDeleteBlock;
  const onMergeWithPreviousRef = useRef(onMergeWithPrevious);
  onMergeWithPreviousRef.current = onMergeWithPrevious;
  const onIndentBlockRef = useRef(onIndentBlock);
  onIndentBlockRef.current = onIndentBlock;
  const onNavigateFocusRef = useRef(onNavigateFocus);
  onNavigateFocusRef.current = onNavigateFocus;
  const isPastingRef = useRef<boolean>(false);

  // Track if this input currently has actual focus in an active browser window
  const isFocusedRef = useRef<boolean>(false);

  const flushDebounce = useCallback(
    (contentToFlush: string, overrides?: Partial<DocumentBlock>) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const nextBlock: DocumentBlock = {
        ...latestBlockRef.current,
        content: contentToFlush,
        ...overrides,
      };
      onUpdateBlockRef.current(nextBlock, true);
    },
    []
  );

  // Right after undo/redo the focused field must show the engine's text, not keep its own
  const acceptRemoteUntilRef = useRef<number>(0);
  // ...and keep the cursor at the changed part instead of the browser's jump to the end (set after render)
  const pendingCaretRef = useRef<number | null>(null);
  const onUndoRef = useRef(onUndo);
  onUndoRef.current = onUndo;
  const onRedoRef = useRef(onRedo);
  onRedoRef.current = onRedo;

  // Sync incoming remote changes ONLY when this textarea is NOT actively being edited (or not edited at all)
  // Condition: isFocusedRef.current === true && document.hasFocus()
  useEffect(() => {
    const isActivelyEditing =
      isFocusedRef.current === true &&
      typeof document !== 'undefined' &&
      document.hasFocus() &&
      textareaRef.current !== null &&
      document.activeElement === textareaRef.current;

    const acceptAfterUndo = Date.now() < acceptRemoteUntilRef.current;
    // Also when the cursor leaves: after a conflict the field held the user's own text, which now stands
    // in the conflict copy, while the block itself keeps the other version
    if (
      (!isActivelyEditing || acceptAfterUndo || !editedRef.current) &&
      debounceTimerRef.current === null &&
      block.content !== localContentRef.current
    ) {
      if (isActivelyEditing) pendingCaretRef.current = caretAfterChange(localContentRef.current, block.content || '');
      setShownContent(block.content || '');
      localContentRef.current = block.content || '';
      editedRef.current = false;
    }
  }, [block.content, isLocallyFocused]);

  useLayoutEffect(() => {
    const pos = pendingCaretRef.current;
    if (pos === null) return;
    pendingCaretRef.current = null;
    const ta = textareaRef.current;
    if (ta && document.activeElement === ta) ta.setSelectionRange(pos, pos);
  }, [localContent]);

  // Handle window blur / focus to instantly flush debounced input and clear zombie focus
  useEffect(() => {
    const handleWindowBlur = () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        flushDebounce(localContentRef.current);
      } else if (editedRef.current && localContentRef.current !== latestBlockRef.current.content) {
        flushDebounce(localContentRef.current);
      }
      isFocusedRef.current = false;
    };

    const handleWindowFocus = () => {
      const isThisActive =
        textareaRef.current !== null &&
        document.activeElement === textareaRef.current &&
        document.hasFocus();
      isFocusedRef.current = isThisActive;
    };

    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [flushDebounce]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (blurSlashTimerRef.current !== null) {
        window.clearTimeout(blurSlashTimerRef.current);
        blurSlashTimerRef.current = null;
      }
    };
  }, []);

  // Close slash command menu on click outside
  useEffect(() => {
    if (!slashMatchInfo) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(target) &&
        textareaRef.current &&
        !textareaRef.current.contains(target)
      ) {
        setSlashMatchInfo(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [slashMatchInfo]);


  const renderedTextRef = useRef<HTMLSpanElement | null>(null);

  // Focus the textarea and place the caret where the user clicked in the rendered (markdown) text layer
  const focusAtPoint = (clientX: number, clientY: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const raw = ta.value;
    let pos = raw.length;
    const span = renderedTextRef.current;
    const doc = document as any;
    let node: Node | null = null;
    let offset = 0;
    if (typeof doc.caretPositionFromPoint === 'function') {
      const p = doc.caretPositionFromPoint(clientX, clientY);
      if (p) {
        node = p.offsetNode;
        offset = p.offset;
      }
    } else if (typeof doc.caretRangeFromPoint === 'function') {
      const r = doc.caretRangeFromPoint(clientX, clientY);
      if (r) {
        node = r.startContainer;
        offset = r.startOffset;
      }
    }
    if (span && node && span.contains(node)) pos = rawOffsetAt(node, offset);
    ta.focus();
    ta.setSelectionRange(pos, pos);
  };

  // Offset in the raw text for a point in the rendered text layer
  const rawOffsetAt = (node: Node, offset: number) => {
    const span = renderedTextRef.current;
    const raw = textareaRef.current?.value ?? '';
    if (!span) return raw.length;
    const range = document.createRange();
    range.setStart(span, 0);
    range.setEnd(node, offset);
    return mapRenderedOffsetToRaw(raw, span.textContent || '', range.toString().length);
  };

  // Text marked with the mouse in the rendered layer of a bullet without focus: the text field takes over
  // the same selection instead of only placing the caret (which dropped the marking)
  const focusWithRenderedSelection = (): boolean => {
    const ta = textareaRef.current;
    const span = renderedTextRef.current;
    const sel = window.getSelection();
    if (!ta || !span || !sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return false;
    if (!span.contains(sel.anchorNode) || !span.contains(sel.focusNode)) return false;
    const a = rawOffsetAt(sel.anchorNode, sel.anchorOffset);
    const f = rawOffsetAt(sel.focusNode, sel.focusOffset);
    if (a === f) return false;
    ta.focus();
    ta.setSelectionRange(Math.min(a, f), Math.max(a, f), f < a ? 'backward' : 'forward');
    return true;
  };

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    // The code editor sizes its field itself (room for the horizontal scrollbar)
    if (!el || el.dataset.ownHeight) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(22, el.scrollHeight)}px`;
  }, []);

  useLayoutEffect(() => {
    adjustHeight();
  }, [localContent, block.type, block.level, activeFocus, adjustHeight]);

  // Turning the block into another type (slash menu, ``` or markdown shortcut) can swap the text field
  // for a new one (e.g. the code editor); the cursor must stay in the block so typing goes on there
  const refocusAfterTypeChangeRef = useRef(false);
  useLayoutEffect(() => {
    if (!refocusAfterTypeChangeRef.current) return;
    refocusAfterTypeChangeRef.current = false;
    const ta = textareaRef.current;
    if (ta && document.activeElement !== ta) {
      ta.focus();
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
    }
  }, [block.type]);

  useEffect(() => {
    window.addEventListener('resize', adjustHeight);
    // The field can be measured while hidden (phone layout shows the editor only after selecting a note);
    // measure again whenever its width changes
    const el = textareaRef.current;
    let lastWidth = el?.clientWidth ?? 0;
    const observer =
      el && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (el.clientWidth !== lastWidth) {
              lastWidth = el.clientWidth;
              adjustHeight();
            }
          })
        : null;
    if (el) observer?.observe(el);
    return () => {
      window.removeEventListener('resize', adjustHeight);
      observer?.disconnect();
    };
  }, [adjustHeight, block.type]);

  const filteredSlashCommands = useMemo(() => {
    if (!slashMatchInfo) return [];
    const q = slashMatchInfo.query.toLowerCase();
    const cmdQuery = q.startsWith('code ') ? 'code' : q;

    const textBeforeSlash = localContent.slice(0, slashMatchInfo.slashStart);
    const textAfterCursor = localContent.slice(slashMatchInfo.cursor);
    const restOfBlock = (textBeforeSlash + textAfterCursor).trim();
    const isRestEmpty = restOfBlock === '';
    const isAtStartOrEnd = textBeforeSlash.trim() === '' || textAfterCursor.trim() === '';

    return SLASH_COMMANDS.filter((c) => {
      const matchesQuery =
        c.label.toLowerCase().includes(cmdQuery) ||
        c.desc.toLowerCase().includes(cmdQuery) ||
        (c.aliases || []).some((a) => a.includes(cmdQuery));
      if (!matchesQuery) return false;

      // /link, /secret and /dictation everywhere
      if (c.type === 'link' || c.type === 'secret') return true;
      if (c.type === 'dictation') {
        return ['server', 'browser'].includes(currentVoiceConfig().mode);
      }

      // /divider, /image, /audio only when rest of block is empty
      if (c.type === 'divider' || c.type === 'image' || c.type === 'audio' || c.type === 'drawing') {
        return isRestEmpty;
      }

      // /code also at the end of a line: the text becomes the code
      if (c.type === 'code') {
        return isRestEmpty || textAfterCursor.trim() === '';
      }

      // /extract only when note has content and is at start/end
      if (c.type === 'extract') {
        return !isRestEmpty && isAtStartOrEnd && !!onExtractBlock && !isNoteLinkOnly(restOfBlock);
      }

      // /h1, /h2, /h3, /todo, /callout, /warn, /fail, /text (type 'bullet') at start or at end
      if (
        c.type === 'h1' ||
        c.type === 'h2' ||
        c.type === 'h3' ||
        c.type === 'todo' ||
        c.type === 'numbered' ||
        c.type === 'callout' ||
        c.type === 'warning' ||
        c.type === 'error' ||
        c.type === 'bullet'
      ) {
        return isAtStartOrEnd;
      }

      return true;
    }).sort((a, b) => slashRank(a, cmdQuery) - slashRank(b, cmdQuery));
  }, [slashMatchInfo, localContent, onExtractBlock]);

  useEffect(() => {
    if (slashSearch === null) return;
    slashItemRefs.current[slashIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [slashIndex, slashSearch]);

  const applySlashCommand = (cmd: SlashCommand) => {
    if (blurSlashTimerRef.current !== null) {
      window.clearTimeout(blurSlashTimerRef.current);
      blurSlashTimerRef.current = null;
    }
    const slashStart = slashMatchInfo ? slashMatchInfo.slashStart : 0;
    const slashEnd = slashMatchInfo ? slashMatchInfo.cursor : localContent.length;
    setSlashMatchInfo(null);

    const before = localContent.slice(0, slashStart);
    const after = localContent.slice(slashEnd);
    const clean = `${before}${after}`.replace(/\s{2,}/g, ' ').trim();

    if (cmd.type === 'link') {
      linkBeforeRef.current = before;
      linkAfterRef.current = after;
      linkCaretRef.current = Math.min(before.replace(/\s{2,}/g, ' ').trimStart().length, clean.length);
      setLocalContent(clean);
      localContentRef.current = clean;
      setShowLinkModal(true);
      return;
    }

    if (cmd.type === 'secret') {
      // Goes in at the slash like a link, once the server has stored the value
      linkBeforeRef.current = before;
      linkAfterRef.current = after;
      linkCaretRef.current = Math.min(before.replace(/\s{2,}/g, ' ').trimStart().length, clean.length);
      setLocalContent(clean);
      localContentRef.current = clean;
      setShowSecretSheet(true);
      return;
    }

    if (cmd.type === 'dictation') {
      dictationBeforeRef.current = before;
      dictationAfterRef.current = after;
      setLocalContent(clean);
      localContentRef.current = clean;
      flushDebounce(clean);
      setMediaPicker('dictation');
      return;
    }

    if (cmd.type === 'extract') {
      setLocalContent(clean);
      localContentRef.current = clean;
      flushDebounce(clean);
      onExtractBlock?.(block.id);
      return;
    }

    if (cmd.type === 'drawing') {
      // The editor opens at once; closing it without drawing turns the bullet back into text
      const content = serializeDrawing(emptyDrawing());
      setLocalContent(content);
      localContentRef.current = content;
      setDrawingAutoOpen(true);
      flushDebounce(content, { type: 'drawing' });
      return;
    }

    if (cmd.media) {
      // The typed "/image" must not stay in the synced text; the block type changes only after the upload
      setLocalContent('');
      localContentRef.current = '';
      flushDebounce('');
      setMediaPicker(cmd.type as 'image' | 'audio');
      return;
    }

    const codeLangMatch = slashMatchInfo?.query.match(/^code\s+([a-z0-9_+#.-]+)$/i);
    const langOverride =
      cmd.type === 'code' && codeLangMatch
        ? resolveLanguageId(codeLangMatch[1]) || codeLangMatch[1].toLowerCase()
        : undefined;

    // Code keeps its spacing; only the typed command goes
    const nextContent = cmd.type === 'code' ? `${before}${after}`.trim() : clean;
    setLocalContent(nextContent);
    localContentRef.current = nextContent;
    if (cmd.type !== block.type) refocusAfterTypeChangeRef.current = true;
    flushDebounce(nextContent, {
      type: cmd.type as BlockType,
      ...(langOverride !== undefined ? { lang: langOverride } : {}),
      checked: cmd.type === 'todo' ? Boolean(block.checked) : false,
      ...(cmd.type === 'bullet' ? { taskId: '', checked: false } : {}),
    });
  };

  // Back into the bullet after the dialog, so typing goes on (after the dialog has let go of the focus)
  const refocusAfterLink = (pos: number) => {
    window.setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const p = Math.min(pos, ta.value.length);
      ta.setSelectionRange(p, p);
    }, 0);
  };
  const closeLinkModal = () => {
    setShowLinkModal(false);
    refocusAfterLink(linkCaretRef.current);
  };

  const handleInsertLink = (linkMarkdown: string) => {
    setShowLinkModal(false);
    const b = linkBeforeRef.current ?? '';
    const a = linkAfterRef.current ?? '';
    if (b.trim() === '' && a.trim() === '') {
      const webMatch = linkMarkdown.match(/^\[.*\]\((https?:\/\/[^\s)]+)\)$/);
      if (webMatch) {
        const bareUrl = webMatch[1];
        setLocalContent(bareUrl);
        localContentRef.current = bareUrl;
        flushDebounce(bareUrl);
        refocusAfterLink(bareUrl.length);
        return;
      }
    }
    const spaceBefore = b && !b.endsWith(' ') ? ' ' : '';
    const spaceAfter = a && !a.startsWith(' ') && a.trim() !== '' ? ' ' : '';
    const newContent = `${b}${spaceBefore}${linkMarkdown}${spaceAfter}${a}`.trim();
    setLocalContent(newContent);
    localContentRef.current = newContent;
    flushDebounce(newContent);
    refocusAfterLink(`${b}${spaceBefore}${linkMarkdown}${spaceAfter}`.trimStart().length);
  };

  const applyFormattingChange = (newVal: string, selStart: number, selEnd: number) => {
    setLocalContent(newVal);
    localContentRef.current = newVal;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      onUpdateBlockRef.current({
        ...latestBlockRef.current,
        content: newVal,
      });
    }, 150);

    const ta = textareaRef.current;
    if (ta) {
      ta.value = newVal;
      ta.setSelectionRange(selStart, selEnd);
    }
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(selStart, selEnd);
        adjustHeight();
      }
    }, 0);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!canEdit) return;
    let val = e.target.value;
    let typeOverride: BlockType | undefined;
    let checkedOverride: boolean | undefined;
    let langOverride: string | undefined;

    if (block.type !== 'code') {
      // Quick markdown shortcuts
      const fenceSpaceMatch = val.match(/^```([a-z0-9_+#.-]*)\s([\s\S]*)$/i);
      const fenceDirectMatch = val.match(/^```([a-z0-9_+#.-]+)$/i);
      const slashCodeSpaceMatch = val.match(/^\/code\s+([a-z0-9_+#.-]+)\s([\s\S]*)$/i);
      const slashCodeDirectMatch = val.match(/^\/code\s+([a-z0-9_+#.-]+)$/i);

      if (fenceSpaceMatch) {
        const rawLang = fenceSpaceMatch[1];
        val = fenceSpaceMatch[2];
        typeOverride = 'code';
        langOverride = rawLang ? resolveLanguageId(rawLang) || rawLang.toLowerCase() : '';
      } else if (fenceDirectMatch && isUnambiguousLanguageShortcut(fenceDirectMatch[1])) {
        val = '';
        typeOverride = 'code';
        langOverride = resolveLanguageId(fenceDirectMatch[1]) || fenceDirectMatch[1].toLowerCase();
      } else if (slashCodeSpaceMatch) {
        const rawLang = slashCodeSpaceMatch[1];
        val = slashCodeSpaceMatch[2];
        typeOverride = 'code';
        langOverride = resolveLanguageId(rawLang) || rawLang.toLowerCase();
      } else if (slashCodeDirectMatch && isUnambiguousLanguageShortcut(slashCodeDirectMatch[1])) {
        val = '';
        typeOverride = 'code';
        langOverride = resolveLanguageId(slashCodeDirectMatch[1]) || slashCodeDirectMatch[1].toLowerCase();
      } else if (val.startsWith('[] ') || val.startsWith('[ ] ')) {
        val = val.replace(/^\[\s?\]\s/, '');
        typeOverride = 'todo';
        checkedOverride = false;
      } else if (val.startsWith('[x] ') || val.startsWith('[X] ')) {
        val = val.replace(/^\[[xX]\]\s/, '');
        typeOverride = 'todo';
        checkedOverride = true;
      } else if (val === '- ' || val === '* ' || val === '+ ') {
        // Markdown list marker typed into an empty block: it already is a bullet, drop the marker
        val = '';
        if (!['text', 'bullet', 'paragraph'].includes(block.type || 'text')) typeOverride = 'bullet';
      } else if ((val === '1. ' || val === '1) ') && block.type !== 'numbered') {
        // "1. " typed into an empty bullet starts a numbered list
        val = '';
        typeOverride = 'numbered';
      } else if (val.startsWith('# ') && block.type !== 'h1') {
        val = val.slice(2);
        typeOverride = 'h1';
      } else if (val.startsWith('## ') && block.type !== 'h2') {
        val = val.slice(3);
        typeOverride = 'h2';
      } else if (val.startsWith('### ') && block.type !== 'h3') {
        val = val.slice(4);
        typeOverride = 'h3';
      } else if (
        (val.startsWith('/text ') ||
          val.startsWith('/p ') ||
          val.startsWith('/paragraph ') ||
          val.startsWith('/bullet ') ||
          val.startsWith('/standard ')) &&
        block.type !== 'bullet'
      ) {
        val = val.replace(/^\/(text|p|paragraph|bullet|standard)\s+/, '');
        typeOverride = 'bullet';
      }

      // Check for slash command invocation at cursor position
      const sel = e.currentTarget.selectionStart;
      const cursor = typeof sel === 'number' && sel > 0 ? sel : val.length;
      const textBefore = val.slice(0, cursor);
      const slashMatch = !typeOverride ? textBefore.match(/(^|\s)\/(code\s+[a-z0-9_+#.-]*|[a-z0-9]*)$/i) : null;
      if (slashMatch) {
        const slashStart = slashMatch.index! + slashMatch[1].length;
        setSlashMatchInfo({ query: slashMatch[2], slashStart, cursor });
        setSlashIndex(0);
      } else {
        setSlashMatchInfo(null);
      }
    } else {
      setSlashMatchInfo(null);
    }

    setLocalContent(val);
    localContentRef.current = val;

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    if (typeOverride) {
      refocusAfterTypeChangeRef.current = true;
      flushDebounce(val, {
        type: typeOverride,
        ...(langOverride !== undefined ? { lang: langOverride } : {}),
        checked: checkedOverride ?? latestBlockRef.current.checked,
        ...(typeOverride === 'bullet' ? { taskId: '', checked: false } : {}),
      });
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      onUpdateBlockRef.current({
        ...latestBlockRef.current,
        content: val,
      });
    }, 150);
  };

  const handleFocus = () => {
    if (blurSlashTimerRef.current !== null) {
      window.clearTimeout(blurSlashTimerRef.current);
      blurSlashTimerRef.current = null;
    }
    isFocusedRef.current = true;
    setIsLocallyFocused(true);
    onFocusBlock?.(block.id);
    setTimeout(adjustHeight, 0);
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    setIsLocallyFocused(false);
    onBlurBlock?.(block.id);
    if (blurSlashTimerRef.current !== null) {
      window.clearTimeout(blurSlashTimerRef.current);
    }
    blurSlashTimerRef.current = window.setTimeout(() => {
      setSlashMatchInfo(null);
    }, 150);
    if (isPastingRef.current) {
      isPastingRef.current = false;
      return;
    }
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      flushDebounce(localContentRef.current);
    } else if (editedRef.current && localContentRef.current !== latestBlockRef.current.content) {
      flushDebounce(localContentRef.current);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canEdit || block.type === 'code') return;
    const pastedText = e.clipboardData.getData('text');
    if (!pastedText || !pastedText.includes('\n')) return;

    e.preventDefault();
    const rawLines = pastedText.split(/\r?\n/);
    if (rawLines.length <= 1) return;

    const start = e.currentTarget.selectionStart ?? localContent.length;
    const end = e.currentTarget.selectionEnd ?? start;
    const textBefore = localContent.slice(0, start);
    const textAfter = localContent.slice(end);

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    isPastingRef.current = true;
    // Pasted text that stays in this block arrives as a prop change while the field has focus: take it
    acceptRemoteUntilRef.current = Date.now() + 1000;
    onPasteMultiLinesRef.current?.(block.id, textBefore, textAfter, rawLines);
  };

  // Ctrl/Cmd+Z undoes the user's own changes in the whole note (not the browser's per-field undo)
  const runHistory = (redo: boolean) => {
    if (debounceTimerRef.current !== null) {
      flushDebounce(localContentRef.current);
    }
    acceptRemoteUntilRef.current = Date.now() + 500;
    if (redo) onRedoRef.current?.();
    else onUndoRef.current?.();
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Mobile keyboards and the context menu undo via beforeinput instead of key events
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault();
        runHistory(e.inputType === 'historyRedo');
      }
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['z', 'y'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
      runHistory(e.key.toLowerCase() === 'y' || e.shiftKey);
      return;
    }
    // Enter in a block someone else is editing cannot split it (read-only), so it adds a new block below
    // without touching the locked one. (Chromium does not move the caret with End in read-only fields.)
    if (lockedBy && canAppendBelow && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onCreateBlockBelowRef.current(block.id, '');
      return;
    }
    if (!canEdit) return;

    // Formatting shortcuts (Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+L for a link) - not in code blocks. Ctrl+K
    // stays with the global search; Ctrl+L would otherwise go to the browser's address bar.
    const isMod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if (isMod && canEdit && block.type !== 'code' && ['b', 'i', 'l'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();

      const ta = textareaRef.current || e.currentTarget;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const text = ta.value;
      const hasSelection = start < end;

      if (e.key.toLowerCase() === 'l') {
        if (!hasSelection) {
          // The link goes in at the cursor (without these it replaced the whole text)
          linkBeforeRef.current = text.slice(0, start);
          linkAfterRef.current = text.slice(start);
          linkCaretRef.current = start;
          setShowLinkModal(true);
          return;
        }
        const selected = text.slice(start, end);
        const placeholder = '…';
        const before = text.slice(0, start);
        const after = text.slice(end);
        const inserted = `[${selected}](${placeholder})`;
        const newVal = before + inserted + after;
        const selStart = start + 1 + selected.length + 2;
        const selEnd = selStart + placeholder.length;
        applyFormattingChange(newVal, selStart, selEnd);
        return;
      }

      const isBold = e.key.toLowerCase() === 'b';
      const delim = isBold ? '**' : '*';

      if (!hasSelection) {
        const pair = isBold ? '****' : '**';
        const newVal = text.slice(0, start) + pair + text.slice(start);
        const newPos = start + delim.length;
        applyFormattingChange(newVal, newPos, newPos);
        return;
      }

      const selected = text.slice(start, end);

      if (isBold) {
        const isOutside =
          start >= 2 &&
          end + 2 <= text.length &&
          text.slice(start - 2, start) === '**' &&
          text.slice(end, end + 2) === '**';

        const isInside =
          selected.length >= 4 &&
          selected.startsWith('**') &&
          selected.endsWith('**');

        if (isOutside) {
          const newVal = text.slice(0, start - 2) + selected + text.slice(end + 2);
          applyFormattingChange(newVal, start - 2, end - 2);
          return;
        }
        if (isInside) {
          const unwrapped = selected.slice(2, -2);
          const newVal = text.slice(0, start) + unwrapped + text.slice(end);
          applyFormattingChange(newVal, start, start + unwrapped.length);
          return;
        }

        const newVal = text.slice(0, start) + '**' + selected + '**' + text.slice(end);
        applyFormattingChange(newVal, start + 2, end + 2);
        return;
      } else {
        const isOutside =
          start >= 1 &&
          end + 1 <= text.length &&
          text[start - 1] === '*' &&
          text[end] === '*' &&
          (start < 2 || text[start - 2] !== '*') &&
          (end + 1 >= text.length || text[end + 1] !== '*');

        const isInside =
          selected.length >= 2 &&
          selected.startsWith('*') &&
          selected.endsWith('*') &&
          (!selected.startsWith('**') || !selected.endsWith('**') || selected.length < 4);

        if (isOutside) {
          const newVal = text.slice(0, start - 1) + selected + text.slice(end + 1);
          applyFormattingChange(newVal, start - 1, end - 1);
          return;
        }
        if (isInside) {
          const unwrapped = selected.slice(1, -1);
          const newVal = text.slice(0, start) + unwrapped + text.slice(end);
          applyFormattingChange(newVal, start, start + unwrapped.length);
          return;
        }

        const newVal = text.slice(0, start) + '*' + selected + '*' + text.slice(end);
        applyFormattingChange(newVal, start + 1, end + 1);
        return;
      }
    }

    // Slash command navigation
    if (slashSearch !== null) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMatchInfo(null);
        return;
      }
      if (filteredSlashCommands.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashIndex((prev) => (prev + 1) % filteredSlashCommands.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashIndex((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const selected = filteredSlashCommands[slashIndex];
          if (selected) {
            applySlashCommand(selected);
          }
          return;
        }
      }
    }

    // 1. Tab / Shift+Tab -> Strict Indent / Outdent
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      flushDebounce(localContent);
      onIndentBlockRef.current(block.id, e.shiftKey ? -1 : 1);
      return;
    }

    // 2. Enter (without Shift) -> If block is completely empty:
    //    - If level > minLevel, outdent (Shift+Tab behaviour)
    //    - Otherwise split paragraph at cursor and create new block below
    if (e.key === 'Enter' && !e.shiftKey && block.type !== 'code') {
      e.preventDefault();
      e.stopPropagation();
      setSlashMatchInfo(null);

      const fenceMatch = localContent.match(/^```([a-z0-9_+#.-]*)$/i);
      if (fenceMatch) {
        const rawLang = fenceMatch[1];
        const resolvedLang = rawLang ? resolveLanguageId(rawLang) || rawLang.toLowerCase() : '';
        setLocalContent('');
        localContentRef.current = '';
        refocusAfterTypeChangeRef.current = true;
        flushDebounce('', {
          type: 'code',
          lang: resolvedLang,
          checked: false,
        });
        return;
      }

      const minLevel = levelOffset || 0;
      if (localContent === '') {
        if (Math.max(0, block.level || 0) > minLevel && !siblingFollows) {
          flushDebounce(localContent);
          onIndentBlockRef.current(block.id, -1);
          return;
        }
        // Enter in an empty last numbered item at the top ends the list
        if (block.type === 'numbered' && !siblingFollows) {
          flushDebounce('', { type: 'text' });
          return;
        }
      }

      const start = e.currentTarget.selectionStart ?? localContent.length;
      const end = e.currentTarget.selectionEnd ?? start;
      let beforeText = localContent.slice(0, start);
      let afterText = localContent.slice(end);

      // Clean linebreaks at the split boundary if present
      if (beforeText.endsWith('\r\n')) {
        beforeText = beforeText.slice(0, -2);
      } else if (beforeText.endsWith('\n')) {
        beforeText = beforeText.slice(0, -1);
      }
      if (afterText.startsWith('\r\n')) {
        afterText = afterText.slice(2);
      } else if (afterText.startsWith('\n')) {
        afterText = afterText.slice(1);
      }

      setLocalContent(beforeText);
      localContentRef.current = beforeText;
      flushDebounce(beforeText);
      onCreateBlockBelowRef.current(block.id, afterText);
      return;
    }

    // 3. Backspace on empty block -> IMMEDIATELY DELETE THE BLOCK (regardless of level)!
    // Outdenting is strictly done via Shift+Tab.
    if (e.key === 'Backspace' && localContent === '') {
      e.preventDefault();
      e.stopPropagation();
      setSlashMatchInfo(null);
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      onDeleteBlockRef.current(block.id);
      return;
    }

    // 3b. Backspace at the very start of a non-empty block -> append its text to the previous block
    if (
      e.key === 'Backspace' &&
      localContent !== '' &&
      block.type !== 'code' &&
      onMergeWithPreviousRef.current &&
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === 0
    ) {
      if (onMergeWithPreviousRef.current(block.id, localContent)) {
        // Text lives in the previous block afterwards, so drop this block's pending save
        if (debounceTimerRef.current !== null) {
          window.clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        e.preventDefault();
        e.stopPropagation();
        setSlashMatchInfo(null);
      }
      return;
    }

    // 4. Arrow navigation between blocks
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey) {
      const el = textareaRef.current;
      if (el && el.selectionStart === 0 && el.selectionEnd === 0) {
        e.preventDefault();
        flushDebounce(localContent);
        onNavigateFocusRef.current(block.id, 'up');
      }
      return;
    }

    if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey) {
      const el = textareaRef.current;
      if (el && el.selectionStart === localContent.length && el.selectionEnd === localContent.length) {
        e.preventDefault();
        flushDebounce(localContent);
        onNavigateFocusRef.current(block.id, 'down');
      }
      return;
    }
  };

  const level = Math.max(0, block.level || 0);
  const visualLevel = Math.max(0, level - (levelOffset || 0));
  const isEmpty = (!localContent || localContent.trim() === '') && !hasChildren;


  // Lock by someone else: the whole row gets a faint tint and a stripe in that person's color
  const lockColor = lockedBy ? userColorStyles(lockedBy.userId) : null;

  // Touch: the focus shows the bubble (timer started in the effect below)
  useEffect(() => {
    if (activeFocus) showBubbleForTouch();
    else setTouchShown(false);
    // showBubbleForTouch only sets state and the timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFocus]);
  const showBubble = hasHover ? pointerMoving || pointerOnBubble : activeFocus && touchShown;

  return (
    <div
      data-outline-block={block.id}
      onMouseMove={handleRowMouseMove}
      onMouseLeave={handleRowMouseLeave}
      onTouchStart={showBubbleForTouch}
      className={`group relative flex items-start gap-1 py-1 px-0.5 sm:px-1.5 rounded-card transition-all duration-300 ${
        inRangeSelection ? 'bg-accent/15' : ''
      } ${
        block.type === 'h1'
          ? 'mt-2.5 sm:mt-3'
          : block.type === 'h2'
          ? 'mt-1.5 sm:mt-2'
          : ''
      } ${
        isDragTarget
          ? 'border-t-2 border-accent bg-accent/10'
          : isTargeted
          ? 'bg-panel-elevated'
          : ''
      } ${block.conflictOf ? 'border-l-2 border-status-warn bg-status-warn/5' : ''}`}
      style={{
        // Tint and stripe start at the bullet's indent, not at the edge of the note
        ...(lockColor && !block.conflictOf
          ? {
              backgroundImage: `linear-gradient(${lockColor.ring}, ${lockColor.ring}), linear-gradient(${lockColor.tint}, ${lockColor.tint})`,
              backgroundSize: '3px 100%, 100% 100%',
              backgroundPosition: `calc(var(--outline-indent) * ${visualLevel}) 0`,
              backgroundRepeat: 'no-repeat',
            }
          : {}),
        // Indent per level and room kept for text come from CSS (narrower on phones, see index.css);
        // deep rows get wider than the screen and the note scrolls sideways instead of squeezing them
        paddingLeft: `calc(var(--outline-indent) * ${visualLevel} + 4px)`,
        minWidth: `calc(var(--outline-indent) * ${visualLevel} + var(--outline-min-text))`,
      }}
      onDragOver={(e) => onDragOverBlock?.(e, index)}
      onDrop={() => onDropBlock?.(index)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a, input, select')) return;
        if (!activeFocus && canFocus && textareaRef.current) {
          textareaRef.current.focus();
          const len = textareaRef.current.value.length;
          textareaRef.current.setSelectionRange(len, len);
        }
      }}
    >
      {Array.from({ length: visualLevel }, (_, k) => (
        <span key={k} aria-hidden="true" className="bullet-guide" style={{ left: `calc(var(--outline-indent) * ${k} + 28px)` }} />
      ))}
      {/* Bullet Controls: Collapse Toggle & Bullet (Drag-Handle & Zoom) / Checkbox */}
      <div className="flex items-center gap-0.5 pt-1 select-none shrink-0">
        {hasChildren ? (
          <button
            type="button"
            onClick={() =>
              flushDebounce(localContent, { collapsed: !block.collapsed })
            }
            // Same width as the spacer of rows without children (the padding is taken back), so bullets stay aligned
            className="p-0.5 -m-0.5 text-muted hover:text-accent transition-[color,opacity] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            title={block.collapsed ? t('block.expand') : t('block.collapse')}
          >
            {block.collapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-accent" />
            )}
          </button>
        ) : (
          <span className="w-3.5" />
        )}

        {/* Bullet handle for dragging and zoom focus */}
        <button
          type="button"
          draggable={canEdit}
          onDragStart={(e) => {
            if (!canEdit) return;
            // Dropped onto another note in the sidebar, the branch moves there (moveBranchEvent.ts)
            e.dataTransfer.setData(BLOCK_DRAG_TYPE, JSON.stringify({ docId: docId || block.documentId || block.docId || '', blockId: block.id }));
            onDragStartBlock?.(index, e);
          }}
          onClick={() => onZoomBlock?.(block.id)}
          className={`${
            block.type === 'numbered' && listMarker ? 'w-4 h-4 justify-end overflow-visible' : 'w-4 h-4 justify-center'
          } flex items-center rounded-btn group/bullet transition-transform ${
            canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
          }`}
          title={
            canEdit
              ? t('block.dragZoom')
              : t('block.clickZoom')
          }
        >
          {block.type === 'numbered' && listMarker ? (
            <span
              className={`text-xs tabular-nums font-medium leading-none whitespace-nowrap transition-colors ${
                activeFocus ? 'text-main' : 'text-muted group-hover/bullet:text-accent'
              }`}
            >
              {listMarker}
            </span>
          ) : block.type === 'warning' ? (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-status-warn transition-transform group-hover/bullet:scale-110" />
          ) : block.type === 'error' ? (
            <XCircle className="w-3.5 h-3.5 shrink-0 text-status-err transition-transform group-hover/bullet:scale-110" />
          ) : (
          <span
            className={`w-1.5 h-1.5 rounded-full transition-all duration-150 ${
              block.collapsed && hasChildren
                ? 'bg-accent ring-2 ring-accent/30'
                : activeFocus
                ? 'bg-main scale-125'
                : 'bg-faint group-hover/bullet:bg-accent group-hover/bullet:scale-125'
            } ${
              // Empty rows show the dot only near the pointer (to-dos keep it: the guide lines start there)
              isEmpty
                ? 'opacity-0 group-hover:opacity-100 hover:opacity-100'
                : 'opacity-100'
            }`}
          />
          )}
        </button>

        {/* If To-Do block: checkbox alongside bullet */}
        {block.type === 'todo' && (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() =>
              flushDebounce(localContent, { checked: !block.checked })
            }
            className={`w-4 h-4 checkbox-square flex items-center justify-center transition-colors border ${
              block.checked
                ? 'bg-status-ok border-status-ok text-on-accent'
                : 'border-strong hover:border-accent text-transparent'
            }`}
            title={block.checked ? t('block.markOpen') : t('block.markDone')}
          >
            <Check className="w-3 h-3 stroke-[3]" />
          </button>
        )}
      </div>

      {/* Main Block Content */}
      <div className="flex-1 min-w-0 pr-1 relative min-h-[1.5rem]">
        {previewUrl && (
          <LinkPreviewCard
            url={previewUrl}
            canEdit={canEdit}
            onHide={(title) => {
              const content = hidePreviewContent(localContent, previewUrl, title);
              setLocalContent(content);
              localContentRef.current = content;
              flushDebounce(content);
            }}
          />
        )}
        {mediaPicker === 'image' ? (
          <ImagePicker
            docId={docId}
            onDone={(media) => {
              setMediaPicker(null);
              const content = mediaContent('image', media.id);
              setLocalContent(content);
              localContentRef.current = content;
              flushDebounce(content, { type: 'image' });
            }}
            onCancel={() => {
              setMediaPicker(null);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          />
        ) : mediaPicker === 'dictation' ? (
          <DictationBlock
            onDone={(text) => {
              setMediaPicker(null);
              const b = dictationBeforeRef.current ?? '';
              const a = dictationAfterRef.current ?? '';
              const spaceBefore = b && !b.endsWith(' ') ? ' ' : '';
              const spaceAfter = a && !a.startsWith(' ') && a.trim() !== '' ? ' ' : '';
              const newContent = `${b}${spaceBefore}${text}${spaceAfter}${a}`.trim();
              setLocalContent(newContent);
              localContentRef.current = newContent;
              flushDebounce(newContent);
              requestAnimationFrame(() => {
                const ta = textareaRef.current;
                if (!ta) return;
                ta.focus();
                const pos = (b + spaceBefore + text).length;
                ta.setSelectionRange(pos, pos);
              });
            }}
            onCancel={() => {
              setMediaPicker(null);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          />
        ) : mediaPicker === 'audio' ? (
          <AudioRecorderPicker
            docId={docId}
            onDone={(media) => {
              setMediaPicker(null);
              const content = mediaContent('audio', media.id);
              setLocalContent(content);
              localContentRef.current = content;
              flushDebounce(content, { type: 'audio' });
            }}
            onCancel={() => {
              setMediaPicker(null);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          />
        ) : block.type === 'audio' ? (
          <AudioBlock
            content={localContent}
            canEdit={canEdit}
            onCaptionChange={(caption) => {
              const ref = parseMediaContent(localContent);
              if (!ref) return;
              const content = mediaContent('audio', ref.id, caption);
              setLocalContent(content);
              localContentRef.current = content;
              flushDebounce(content);
            }}
          />
        ) : block.type === 'drawing' ? (
          <DrawingBlock
            blockId={block.id}
            content={localContent}
            canEdit={canEdit}
            autoOpen={drawingAutoOpen}
            onChange={(content) => {
              setDrawingAutoOpen(false);
              setLocalContent(content);
              localContentRef.current = content;
              flushDebounce(content);
            }}
            onDiscardNew={() => {
              setDrawingAutoOpen(false);
              setLocalContent('');
              localContentRef.current = '';
              refocusAfterTypeChangeRef.current = true;
              flushDebounce('', { type: 'bullet' });
            }}
          />
        ) : block.type === 'image' ? (
          <ImageBlock
            content={localContent}
            canEdit={canEdit}
            onCaptionChange={(caption) => {
              const ref = parseMediaContent(localContent);
              if (!ref) return;
              const content = mediaContent('image', ref.id, caption);
              setLocalContent(content);
              localContentRef.current = content;
              flushDebounce(content);
            }}
          />
        ) : block.type === 'divider' ? (
          <div
            className="relative py-2 group/divider cursor-pointer w-full"
            onClick={() => {
              textareaRef.current?.focus();
            }}
          >
            <hr
              className={`border-t transition-colors ${
                activeFocus ? 'border-accent ring-1 ring-accent/30' : 'border-border'
              }`}
            />
            <textarea
              ref={(el) => {
                textareaRef.current = el;
                registerTextareaRef(block.id, el);
              }}
              rows={1}
              value=""
              readOnly={!canEdit}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onChange={() => {}}
              onKeyDown={(e) => {
                if (!canEdit) return;
                if (e.key === 'Backspace' || e.key === 'Delete') {
                  e.preventDefault();
                  refocusAfterTypeChangeRef.current = true;
                  flushDebounce('', { type: 'bullet' });
                  setLocalContent('');
                  localContentRef.current = '';
                  return;
                }
                handleKeyDown(e);
              }}
              className="sr-only"
              aria-label={t('block.divider')}
            />
          </div>
        ) : block.type === 'code' ? (
          <CodeBlockEditor
            block={block}
            content={localContent}
            canEdit={canEdit}
            textareaRef={textareaRef}
            registerTextareaRef={registerTextareaRef}
            onChangeContent={(newContent) => {
              setLocalContent(newContent);
              localContentRef.current = newContent;
              flushDebounce(newContent);
            }}
            onChangeLang={(lang) => flushDebounce(localContent, { lang })}
            onConvertToText={() => flushDebounce(localContent, { type: 'bullet' })}
            handleFocus={handleFocus}
            handleBlur={handleBlur}
            handleContentChange={handleContentChange}
            handleKeyDown={handleKeyDown}
            onIndent={() => {
              flushDebounce(localContent);
              onIndentBlockRef.current(block.id, 1);
            }}
            onOutdent={() => {
              flushDebounce(localContent);
              onIndentBlockRef.current(block.id, -1);
            }}
            canIndent={Math.max(0, block.level || 0) < maxAllowedLevel}
            canOutdent={Math.max(0, block.level || 0) > (levelOffset || 0)}
          />
        ) : block.type === 'callout' ? (
          <div className="bg-panel-elevated border-l-2 border-accent p-2 rounded-r-btn my-0.5">
            <textarea
              ref={(el) => {
                textareaRef.current = el;
                registerTextareaRef(block.id, el);
              }}
              rows={1}
              value={localContent}
              readOnly={!canEdit}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onChange={handleContentChange}
              onKeyDown={handleKeyDown}
              className="w-full resize-none bg-transparent text-sm text-main border-0 focus:outline-none focus:ring-0 leading-relaxed italic"
            />
          </div>
        ) : (
          // Warnings and errors: normal text in a tinted box with a coloured edge, like a callout
          <div
            className={
              block.type === 'warning'
                ? 'bg-status-warn-bg border-l-2 border-status-warn rounded-r-btn px-2 py-0.5 my-0.5'
                : block.type === 'error'
                ? 'bg-status-err-bg border-l-2 border-status-err rounded-r-btn px-2 py-0.5 my-0.5'
                : 'contents'
            }
          >
          <div className="relative w-full min-h-[1.5rem]">
            {/* View Layer with Inline Markdown */}
            <div
              onClick={(e) => {
                if (!activeFocus && canFocus && textareaRef.current) {
                  // Keep the row's click handler from moving the caret back to the end
                  e.stopPropagation();
                  if (!focusWithRenderedSelection()) focusAtPoint(e.clientX, e.clientY);
                }
              }}
              className={`w-full min-h-[1.5rem] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                activeFocus ? 'absolute inset-0 pointer-events-none' : 'relative cursor-text'
              } ${
                block.type === 'h1'
                  ? 'text-xl sm:text-2xl font-bold text-main tracking-tight'
                  : block.type === 'h2'
                  ? 'text-lg sm:text-xl font-semibold text-main'
                  : block.type === 'h3'
                  ? 'text-base font-semibold text-main'
                  : block.type === 'todo' && block.checked
                  ? 'text-sm text-faint line-through'
                  : 'text-sm text-main'
              }`}
            >
              {/* When actively focused, ghost text is invisible so textarea renders text/caret directly */}
              <span ref={renderedTextRef} data-outline-text className={activeFocus ? 'invisible' : ''}>
                {previewUrl && !activeFocus ? (
                  // The card above shows the page; the address itself becomes a small link marker
                  <a
                    href={safeHref(previewUrl) || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-accent bg-accent-dim hover:bg-accent/20 no-underline transition-colors"
                    title={previewUrl}
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span className="truncate max-w-[16rem]">{linkHost(previewUrl)}</span>
                  </a>
                ) : localContent ? (
                  renderInlineMarkdown(localContent, {
                    onTagClick,
                    onWikiLinkClick,
                    renderSecret: (secretId, key) => <SecretChip key={key} docId={docId} secretId={secretId} canEdit={canEdit} />,
                  })
                ) : (
                  '\u200b'
                )}
              </span>
              {/* Linked task / subtask: a short badge right after the text (inline-block, so a ticked
                  checkbox does not strike it through) */}
              {block.type === 'todo' && (block.taskId || block.subtaskOf) && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTask?.((block.taskId || block.subtaskOf) as string);
                  }}
                  className={`${block.taskId ? 'badge-accent' : 'badge-neutral'} inline-block align-middle ml-1.5 text-[9px] leading-none px-1.5 py-0.5 rounded font-medium select-none cursor-pointer hover:opacity-80 ${
                    activeFocus ? 'pointer-events-none' : 'pointer-events-auto'
                  }`}
                  title={block.taskId ? t('block.openTask') : t('block.openParentTask')}
                >
                  <CheckSquare className="w-2.5 h-2.5 inline-block align-[-1px] mr-0.5" />
                  {block.taskId ? t('block.badgeTask') : t('block.badgeSubtask')}
                </button>
              )}
            </div>

            {/* Display block: inline, the focused field would sit on a text baseline and leave a gap below
                it, so the row grew by a few pixels on every click */}
            <textarea
              ref={(el) => {
                textareaRef.current = el;
                registerTextareaRef(block.id, el);
              }}
              rows={1}
              value={localContent}
              readOnly={!canEdit}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onChange={handleContentChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onClick={() => {
                if (slashMatchInfo) {
                  const ta = textareaRef.current;
                  if (ta) {
                    const cursor = ta.selectionStart;
                    const textBefore = ta.value.slice(0, cursor);
                    const match = textBefore.match(/(^|\s)\/(code\s+[a-z0-9_+#.-]*|[a-z0-9]*)$/i);
                    if (match) {
                      const slashStart = match.index! + match[1].length;
                      setSlashMatchInfo({ query: match[2], slashStart, cursor });
                    } else {
                      setSlashMatchInfo(null);
                    }
                  }
                }
              }}
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && slashMatchInfo) {
                  const ta = textareaRef.current;
                  if (ta) {
                    const cursor = ta.selectionStart;
                    const textBefore = ta.value.slice(0, cursor);
                    const match = textBefore.match(/(^|\s)\/(code\s+[a-z0-9_+#.-]*|[a-z0-9]*)$/i);
                    if (match) {
                      const slashStart = match.index! + match[1].length;
                      setSlashMatchInfo({ query: match[2], slashStart, cursor });
                    } else {
                      setSlashMatchInfo(null);
                    }
                  }
                }
              }}
              className={`block w-full min-h-[1.5rem] resize-none overflow-hidden bg-transparent border-0 focus:outline-none focus:ring-0 leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                activeFocus ? 'relative z-0 text-main' : 'absolute inset-0 text-transparent selection:text-transparent pointer-events-none'
              } ${
                block.type === 'h1'
                  ? 'text-xl sm:text-2xl font-bold text-main tracking-tight'
                  : block.type === 'h2'
                  ? 'text-lg sm:text-xl font-semibold text-main'
                  : block.type === 'h3'
                  ? 'text-base font-semibold text-main'
                  : block.type === 'todo' && block.checked
                  ? 'text-sm text-faint line-through'
                  : 'text-sm text-main'
              }`}
            />
          </div>
          </div>
        )}

        {/* Conflict copy: text that lost against someone else's change */}
        {block.conflictOf && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-status-warn select-none">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>
              {block.conflictOf === 'title' ? t('block.titleConflict') : t('block.conflict')}
              {block.conflictAuthor ? ` ${t('block.conflictBy', { name: block.conflictAuthor })}` : ''}
            </span>
            {onResolveConflict && (
              <>
                <button
                  type="button"
                  onClick={() => onResolveConflict(block.id, true)}
                  className="px-1.5 py-0.5 rounded-btn border border-status-warn/40 hover:bg-status-warn/15 cursor-pointer"
                  title={block.conflictOf === 'title' ? t('block.takeTitle') : t('block.takeText')}
                >
                  {t('block.take')}
                </button>
                <button
                  type="button"
                  onClick={() => onResolveConflict(block.id, false)}
                  className="px-1.5 py-0.5 rounded-btn border border-border text-muted hover:text-main hover:bg-panel cursor-pointer"
                  title={t('block.dropVersion')}
                >
                  {t('common:discard')}
                </button>
              </>
            )}
          </div>
        )}

        {/* Floating Slash Commands Menu */}
        {slashSearch !== null && canEdit && (
          <div
            ref={slashMenuRef}
            className="absolute left-0 top-8 z-40 w-72 max-w-[calc(100vw-2rem)] panel-surface shadow-panel border border-border rounded-card p-1"
          >
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-faint border-b border-border mb-1">
              {t('block.chooseCommand')}
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filteredSlashCommands.map((cmd, i) => (
                <button
                  key={cmd.type}
                  ref={(el) => {
                    slashItemRefs.current[i] = el;
                  }}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySlashCommand(cmd);
                  }}
                  className={`w-full text-left px-2 py-1 rounded-btn text-xs flex items-center justify-between transition-colors ${
                    i === slashIndex
                      ? 'bg-accent-dim text-accent font-semibold'
                      : 'text-main hover:bg-panel-elevated'
                  }`}
                >
                  <div className="flex items-center gap-1.5 shrink-0">
                    {cmd.icon}
                    <span className="font-semibold whitespace-nowrap">{cmd.label}</span>
                  </div>
                  <span className="ml-3 min-w-0 truncate text-right text-[10px] opacity-75">{cmd.desc}</span>
                </button>
              ))}
              {filteredSlashCommands.length === 0 && (
                <div className="p-2 text-center text-xs text-faint">
                  {t('block.noCommand')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Someone else is editing this block */}
      {lockedBy && (
        <span
          className="shrink-0 self-start mt-0.5 h-5 inline-flex items-center gap-1 pl-0.5 pr-1.5 rounded-pill text-[10px] font-semibold bg-panel select-none max-w-[45%]"
          style={{ color: lockColor!.text, border: `1px solid ${lockColor!.border}` }}
          title={t('lock.title', { name: lockedBy.name })}
        >
          <UserAvatar
            userId={lockedBy.userId}
            name={lockedBy.name}
            avatarUrl={lockedBy.avatarUrl || ''}
            size="xxs"
            colorRing
            showTitle={false}
          />
          <span className="truncate">{lockedBy.name}</span>
          <Lock className="w-2.5 h-2.5 shrink-0 opacity-80" />
        </span>
      )}

      {/* Floating Actions Overlay Bubble (block type, enhanced task, link, extract, delete) */}
      <div
        onMouseEnter={() => setPointerOnBubble(true)}
        onMouseLeave={() => setPointerOnBubble(false)}
        className={`absolute right-1 sm:right-2 top-0.5 sm:top-1 z-20 bg-panel/90 backdrop-blur-sm border border-border shadow-xs rounded-pill px-1 sm:px-1.5 py-0.5 flex items-center gap-0.5 sm:gap-1 transition-opacity ${
          lockedBy
            ? // Someone else is editing the block: no actions, and the lock badge stays visible
              'hidden'
            : showBubble
            ? 'opacity-100 pointer-events-auto'
            : // Hidden buttons must not take clicks; keyboard focus inside still shows it
              'opacity-0 pointer-events-none focus-within:opacity-100 focus-within:pointer-events-auto'
        }`}
      >
        {/* Convert back to bullet for to-dos, headings, callouts, warnings, dividers, code and numbered items */}
        {canEdit && ['todo', 'callout', 'warning', 'error', 'h1', 'h2', 'h3', 'divider', 'code', 'numbered'].includes(block.type) && (
          <button
            type="button"
            onClick={() => {
              refocusAfterTypeChangeRef.current = true;
              flushDebounce(localContent, block.type === 'todo' ? { type: 'bullet', checked: false, taskId: '' } : { type: 'bullet', checked: false });
            }}
            className="p-1 sm:p-0.5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer"
            title={t('block.toText')}
          >
            <Type className="w-3.5 h-3.5" />
          </button>
        )}

        {/* To-do: turn it into an enhanced task, or undo the link of one */}
        {block.type === 'todo' && canEdit && !block.taskId && !block.subtaskOf && (
          <button
            type="button"
            onClick={async () => {
              try {
                const targetDocId = docId || block.documentId || block.docId || '';
                const thought = await api.createEnhancedTask(targetDocId, block.id, {
                  content: localContent || 'Aufgabe',
                  checked: Boolean(block.checked),
                });
                const updatedBlock: DocumentBlock = {
                  ...latestBlockRef.current,
                  content: localContent,
                  taskId: thought.id,
                  type: 'todo',
                };
                onUpdateBlockRef.current(updatedBlock, true);
                onOpenTask?.(thought.id);
              } catch (err: any) {
                showError(err.message || t('block.createTaskFailed'));
              }
            }}
            className="p-1 sm:p-0.5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer"
            title={t('block.toTask')}
            aria-label={t('block.toTask')}
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
        )}
        {block.type === 'todo' && canEdit && block.taskId && (
          <button
            type="button"
            onClick={async () => {
              try {
                await api.unlinkEnhancedTask(block.taskId!).catch(() => {});
                const updatedBlock: DocumentBlock = {
                  ...latestBlockRef.current,
                  content: localContent,
                  taskId: '',
                  type: 'todo',
                };
                onUpdateBlockRef.current(updatedBlock, true);
              } catch (err: any) {
                showError(err.message || t('block.unlinkFailed'));
              }
            }}
            className="p-1 sm:p-0.5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-faint hover:text-status-warn rounded-btn transition-colors cursor-pointer"
            title={t('block.unlink')}
            aria-label={t('block.unlink')}
          >
            <Unlink className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Link to this bullet */}
        {onCopyBlockLink && localContent.trim() !== '' && !mediaPicker && (
          <button
            type="button"
            onClick={() => onCopyBlockLink(block.id)}
            className="p-1 sm:p-0.5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer"
            title={t('block.copyLink')}
            aria-label={t('block.copyLink')}
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Branch into its own note */}
        {canEdit && onExtractBlock && localContent.trim() !== '' && !isNoteLinkOnly(localContent) && !mediaPicker && (
          <button
            type="button"
            onClick={(e) => onExtractBlock(block.id, { x: e.clientX, y: e.clientY })}
            className="p-1 sm:p-0.5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer"
            title={t('block.extract')}
          >
            <FileOutput className="w-3.5 h-3.5" />
          </button>
        )}

        {/* The way back: a bullet that only links to a note gets that note's bullets again */}
        {canEdit && onInlineBlock && isNoteLinkOnly(localContent) && !mediaPicker && (
          <button
            type="button"
            onClick={() => onInlineBlock(block.id)}
            className="p-1 sm:p-0.5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer"
            title={t('block.pullBackTitle')}
            aria-label={t('block.pullBack')}
          >
            <FileInput className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Delete button */}
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              // A branch goes with its children and without a question; Ctrl+Z brings it back
              if (hasChildren) {
                onDeleteBlockRef.current(block.id, true);
              } else {
                onDeleteBlockRef.current(block.id, false);
              }
            }}
            className="p-1 sm:p-0.5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-faint hover:text-status-err rounded-btn transition-colors cursor-pointer"
            title={t('block.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showSecretSheet && (
        <NewSecretSheet
          docId={docId}
          onClose={() => {
            setShowSecretSheet(false);
            refocusAfterLink(linkCaretRef.current);
          }}
          onCreated={(ref) => {
            setShowSecretSheet(false);
            handleInsertLink(ref);
          }}
        />
      )}

      {/* Link Insertion Modal */}
      {showLinkModal && (
        <LinkModal
          isOpen={showLinkModal}
          onClose={closeLinkModal}
          onInsertLink={handleInsertLink}
        />
      )}
    </div>
  );
};
