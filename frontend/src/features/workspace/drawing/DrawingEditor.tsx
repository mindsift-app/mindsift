import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  Circle,
  Copy,
  CornerDownRight,
  Diamond,
  Eraser,
  Grid3x3,
  Hand,
  Maximize,
  Minimize2,
  Minus,
  MousePointer2,
  MoveRight,
  Pencil,
  Redo2,
  SlidersHorizontal,
  Spline,
  Square,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ArrowElement,
  ArrowRoute,
  Box,
  DEFAULT_FONT_SIZE,
  DRAW_COLORS,
  DrawColor,
  DrawElement,
  DrawFill,
  Drawing,
  FONT_SIZES,
  GRID_SIZE,
  MAX_CONTENT_BYTES,
  Point,
  Port,
  ShapeElement,
  ShapeKind,
  TextElement,
  arrowGeometry,
  bendThrough,
  boxContains,
  contentBox,
  contentBytes,
  dragSegment,
  elementBox,
  elementMap,
  fixedStretches,
  fillColor,
  hitTest,
  isShape,
  lineHeight,
  moveElement,
  portNear,
  portPoint,
  releaseSegment,
  newElementId,
  parseDrawing,
  removeElements,
  serializeDrawing,
  settleCorners,
  spreadLabels,
  shapeAt,
  simplifyPoints,
  snap,
  strokeColor,
  textBox,
  wheelZoom,
  wrapText,
  dropStaleVia,
  ARROW_FONT_SIZE,
} from '../../../lib/drawing/model';
import { DrawingElements } from './DrawingElements';
import { ConfirmPopover } from '../../../components/ConfirmPopover';

type Tool = 'select' | 'hand' | ShapeKind | 'arrow' | 'draw' | 'text' | 'eraser';
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface View {
  x: number;
  y: number;
  z: number;
}

interface Style {
  s: DrawColor;
  f: DrawFill;
  sw: number;
  dash: boolean;
  fs: number;
  r: boolean;
  route: ArrowRoute;
  head: number;
}

type Action =
  | { k: 'pan'; sx: number; sy: number; view: View }
  | { k: 'move'; start: Point; orig: Drawing; ids: string[]; box: Box | null }
  | { k: 'resize'; handle: Handle; orig: Drawing; el: ShapeElement }
  | { k: 'band'; start: Point }
  | { k: 'create'; id: string; start: Point; orig: Drawing }
  | { k: 'arrow'; id: string; orig: Drawing }
  | { k: 'arrowEnd'; id: string; end: 'a' | 'b'; orig: Drawing; from: Point; started?: boolean }
  | { k: 'bend'; id: string; orig: Drawing }
  | { k: 'segment'; id: string; index: number; poly: Point[]; orig: Drawing }
  | { k: 'draw'; id: string; pts: Point[]; orig: Drawing }
  | { k: 'erase'; ids: Set<string> };

interface TextEdit {
  id: string;
  isNew: boolean;
  x: number;
  y: number;
  orig: Drawing;
}

/** An elbow with other corners of its own (none: it runs by itself again) */
function withCorners(el: ArrowElement, c: { via?: Point[] }): ArrowElement {
  const next: ArrowElement = { ...el, ver: el.ver + 1 };
  if (c.via) next.via = c.via;
  else delete next.via;
  return next;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const HISTORY_LIMIT = 200;
const DRAFT_PREFIX = 'mindsift_drawing_draft:';
const SHAPE_SIZE: Record<ShapeKind, [number, number]> = { rect: [140, 70], ellipse: [120, 80], diamond: [130, 90] };

// Copied elements survive closing the editor, so they can go into another drawing
let clipboard: DrawElement[] = [];

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function fitView(box: Box | null, width: number, height: number, maxZoom = 1): View {
  if (!box || width <= 0 || height <= 0) return { x: -40, y: -40, z: 1 };
  const pad = 48;
  const z = clampZoom(Math.min(maxZoom, (width - pad * 2) / Math.max(box.w, 1), (height - pad * 2) / Math.max(box.h, 1)));
  return { x: box.x + box.w / 2 - width / (2 * z), y: box.y + box.h / 2 - height / (2 * z), z };
}

/** Copies of elements with fresh ids; arrows keep their docks only to copied shapes */
function cloneElements(els: DrawElement[], all: DrawElement[], dx: number, dy: number): DrawElement[] {
  const ids = new Map(els.map((el) => [el.id, newElementId()]));
  const byId = elementMap(all);
  return els.map((el) => {
    let copy: DrawElement = { ...moveElement(el, dx, dy), id: ids.get(el.id)!, ver: 1 };
    if (copy.t === 'arrow' && el.t === 'arrow') {
      const g = arrowGeometry(el, byId);
      const arrow: ArrowElement = { ...copy, a: [g.start[0] + dx, g.start[1] + dy], b: [g.end[0] + dx, g.end[1] + dy] };
      delete arrow.from;
      delete arrow.to;
      if (el.from && ids.has(el.from)) arrow.from = ids.get(el.from);
      if (el.to && ids.has(el.to)) arrow.to = ids.get(el.to);
      copy = arrow;
    }
    return copy;
  });
}

export interface DrawingEditorProps {
  initial: Drawing;
  /** Block content when the editor opened (to tell whether anything changed, and for drafts) */
  baseContent: string;
  draftKey: string;
  /** Only look: move and zoom, nothing else */
  readOnly?: boolean;
  /** Called now and then while drawing (keeps the bullet held) */
  onActivity?: () => void;
  /** null = nothing changed */
  onClose: (content: string | null) => void;
}

// Full-screen drawing editor. Changes stay local until it closes; meanwhile a draft is kept in this browser.
export const DrawingEditor: React.FC<DrawingEditorProps> = ({ initial, baseContent, draftKey, readOnly = false, onActivity, onClose }) => {
  const { t } = useTranslation('workspace');
  const [doc, setDocState] = useState<Drawing>(initial);
  const docRef = useRef(doc);
  const [view, setViewState] = useState<View>({ x: -40, y: -40, z: 1 });
  const viewRef = useRef(view);
  // Opens with the hand: the view moves, nothing in the drawing moves by accident; an empty drawing starts
  // with selecting, ready to draw
  const [tool, setTool] = useState<Tool>(readOnly || initial.els.length > 0 ? 'hand' : 'select');
  // Closing without saving while there are changes: the question where the close button was clicked
  const [confirmDiscard, setConfirmDiscard] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelectedState] = useState<string[]>([]);
  const selectedRef = useRef(selected);
  const [style, setStyle] = useState<Style>({ s: 'main', f: 'none', sw: 2, dash: false, fs: DEFAULT_FONT_SIZE, r: true, route: 'straight', head: 2 });
  const [band, setBand] = useState<Box | null>(null);
  const [faded, setFaded] = useState<Set<string>>(new Set());
  const [dockTarget, setDockTarget] = useState<string | null>(null);
  // While an elbow's end is dragged onto a shape: the side and spot it will dock to
  const [dockPort, setDockPort] = useState<{ id: string; port: Port } | null>(null);
  const [textEdit, setTextEditState] = useState<TextEdit | null>(null);
  const [textValue, setTextValueState] = useState('');
  // Refs as well: Esc commits and the field's blur that follows must not commit a second time
  const textEditRef = useRef<TextEdit | null>(null);
  const textValueRef = useRef('');
  const setTextEdit = (edit: TextEdit | null) => {
    textEditRef.current = edit;
    setTextEditState(edit);
  };
  const setTextValue = (value: string) => {
    textValueRef.current = value;
    setTextValueState(value);
  };
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ content: string; at: number } | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const past = useRef<Drawing[]>([]);
  const future = useRef<Drawing[]>([]);
  const actionRef = useRef<Action | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; cx: number; cy: number; view: View } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const draftTimer = useRef<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Phones: line, fill and arrow options only on request, so they do not cover the canvas
  const [panelOpen, setPanelOpen] = useState(false);

  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const lastActivity = useRef(0);
  const setDoc = useCallback((next: Drawing) => {
    docRef.current = next;
    setDocState(next);
    if (Date.now() - lastActivity.current > 5000) {
      lastActivity.current = Date.now();
      onActivityRef.current?.();
    }
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(saveDraft, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);
  const setSelected = useCallback((ids: string[]) => {
    selectedRef.current = ids;
    setSelectedState(ids);
  }, []);
  // A drawing tool starts something new: the selection goes, so the panel shows that tool's options
  const chooseTool = (next: Tool) => {
    setTool(next);
    if (next !== 'select' && next !== 'hand') setSelected([]);
  };
  const remember = useCallback((prev: Drawing) => {
    past.current.push(prev);
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    setHistoryTick((n) => n + 1);
  }, []);

  function saveDraft() {
    draftTimer.current = null;
    const content = serializeDrawing(docRef.current);
    try {
      if (content === baseContent) localStorage.removeItem(DRAFT_PREFIX + draftKey);
      else localStorage.setItem(DRAFT_PREFIX + draftKey, JSON.stringify({ content, base: baseContent, at: Date.now() }));
    } catch {
      /* storage full or blocked: the drawing still saves on close */
    }
  }

  // A draft left behind (tab closed or crashed while drawing) can be taken back
  useEffect(() => {
    if (readOnly) return;
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d?.content === 'string' && d.content !== baseContent) setDraft({ content: d.content, at: Number(d.at) || 0 });
      else localStorage.removeItem(DRAFT_PREFIX + draftKey);
    } catch {
      /* ignore broken drafts */
    }
    const onHide = () => document.visibilityState === 'hidden' && saveDraft();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start on everything there is (the saved section is what the note shows)
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setSize({ w: width, h: height });
    setView(fitView(contentBox(initial), width, height));
    // Only a real change renders the editor again (the first report repeats the size measured here)
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(([entry]) => {
            const { width: w, height: h } = entry.contentRect;
            setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
          })
        : null;
    ro?.observe(el);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId = useMemo(() => elementMap(doc.els), [doc]);
  const gridOn = !!doc.grid;

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [v.x + (clientX - rect.left) / v.z, v.y + (clientY - rect.top) / v.z];
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const z = clampZoom(v.z * factor);
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wx = v.x + sx / v.z;
    const wy = v.y + sy / v.z;
    setView({ x: wx - sx / z, y: wy - sy / z, z });
  };
  const zoomCenter = (factor: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const fitAll = () => {
    const rect = containerRef.current!.getBoundingClientRect();
    setView(fitView(contentBox(docRef.current), rect.width, rect.height));
  };

  // Mouse wheel moves the canvas, with Ctrl (or a trackpad pinch) it zooms
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, wheelZoom(e.deltaY));
      } else {
        const v = viewRef.current;
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
        setView({ ...v, x: v.x + dx / v.z, y: v.y + dy / v.z });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------------------------------------------
  // Changing elements

  const updateElements = (ids: string[], change: (el: DrawElement) => DrawElement, withHistory = true) => {
    const prev = docRef.current;
    const set = new Set(ids);
    const next = { ...prev, els: prev.els.map((el) => (set.has(el.id) ? { ...change(el), ver: el.ver + 1 } : el)) };
    if (withHistory) remember(prev);
    setDoc(next);
  };

  const deleteSelected = () => {
    const ids = selectedRef.current;
    if (ids.length === 0) return;
    const prev = docRef.current;
    remember(prev);
    setDoc({ ...prev, els: removeElements(prev.els, new Set(ids)) });
    setSelected([]);
  };

  const addElements = (els: DrawElement[]) => {
    const prev = docRef.current;
    remember(prev);
    setDoc({ ...prev, els: [...prev.els, ...els] });
    setSelected(els.map((el) => el.id));
  };

  const duplicateSelected = () => {
    const set = new Set(selectedRef.current);
    const els = docRef.current.els.filter((el) => set.has(el.id));
    if (els.length) addElements(cloneElements(els, docRef.current.els, 20, 20));
  };

  const copySelected = () => {
    const set = new Set(selectedRef.current);
    const els = docRef.current.els.filter((el) => set.has(el.id));
    if (els.length) clipboard = cloneElements(els, docRef.current.els, 0, 0);
  };

  const paste = () => {
    if (clipboard.length) {
      addElements(cloneElements(clipboard, clipboard, 20, 20));
      clipboard = cloneElements(clipboard, clipboard, 20, 20);
    }
  };

  const reorder = (toFront: boolean) => {
    const set = new Set(selectedRef.current);
    if (set.size === 0) return;
    const prev = docRef.current;
    const picked = prev.els.filter((el) => set.has(el.id));
    const rest = prev.els.filter((el) => !set.has(el.id));
    remember(prev);
    setDoc({ ...prev, els: toFront ? [...rest, ...picked] : [...picked, ...rest] });
  };

  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(docRef.current);
    setDoc(prev);
    setSelected(selectedRef.current.filter((id) => prev.els.some((el) => el.id === id)));
    setHistoryTick((n) => n + 1);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(docRef.current);
    setDoc(next);
    setHistoryTick((n) => n + 1);
  };

  const toggleGrid = () => {
    const prev = docRef.current;
    setDoc({ ...prev, ...(prev.grid ? { grid: undefined } : { grid: true }) });
  };

  // Style changes go to the selection and become the default for new elements
  const applyStyle = (patch: Partial<Style>) => {
    setStyle((s) => ({ ...s, ...patch }));
    const ids = selectedRef.current;
    if (ids.length === 0) return;
    updateElements(ids, (el) => {
      const next: any = { ...el };
      if (patch.s !== undefined) next.s = patch.s;
      if (patch.sw !== undefined) next.sw = patch.sw;
      if (patch.dash !== undefined) next.dash = patch.dash || undefined;
      if (isShape(el)) {
        if (patch.f !== undefined) next.f = patch.f;
        if (patch.r !== undefined && el.t === 'rect') next.r = patch.r || undefined;
      }
      if ((isShape(el) || el.t === 'text') && patch.fs !== undefined) next.fs = patch.fs === DEFAULT_FONT_SIZE ? undefined : patch.fs;
      if (el.t === 'arrow') {
        if (patch.route !== undefined) {
          next.route = patch.route;
          delete next.via;
          // A curve's bend and an elbow's middle mean different things
          if (patch.route !== el.route) {
            delete next.bend;
            delete next.axis;
          }
        }
        if (patch.head !== undefined) next.head = patch.head;
      }
      return next;
    });
  };

  // ------------------------------------------------------------------------------------------------------
  // Text

  const startTextEdit = (el: ShapeElement | TextElement | ArrowElement | null, at?: Point) => {
    if (el) {
      setTextEdit({ id: el.id, isNew: false, x: el.t === 'arrow' ? 0 : el.x, y: el.t === 'arrow' ? 0 : el.y, orig: docRef.current });
      setTextValue(el.txt || '');
      setSelected([el.id]);
    } else if (at) {
      setTextEdit({ id: newElementId(), isNew: true, x: at[0], y: at[1], orig: docRef.current });
      setTextValue('');
      setSelected([]);
    }
  };

  const commitText = () => {
    const edit = textEditRef.current;
    if (!edit) return;
    setTextEdit(null);
    const value = textValueRef.current.replace(/\s+$/, '');
    const prev = docRef.current;
    let next: Drawing = prev;
    if (edit.isNew) {
      if (value.trim() === '') return;
      const el: TextElement = { id: edit.id, ver: 1, t: 'text', x: edit.x, y: edit.y, txt: value, s: style.s, sw: 2, ...(style.fs !== DEFAULT_FONT_SIZE ? { fs: style.fs } : {}) };
      next = { ...prev, els: [...prev.els, el] };
      setSelected([el.id]);
    } else {
      const el = prev.els.find((e) => e.id === edit.id);
      if (!el || !(isShape(el) || el.t === 'text' || el.t === 'arrow')) return;
      if (el.t === 'text' && value.trim() === '') {
        next = { ...prev, els: removeElements(prev.els, new Set([el.id])) };
        setSelected([]);
      } else if ((el as ShapeElement | TextElement | ArrowElement).txt !== value) {
        next = { ...prev, els: prev.els.map((e) => (e.id === el.id ? ({ ...e, txt: value || undefined, ver: e.ver + 1 } as DrawElement) : e)) };
      }
    }
    if (next !== prev) {
      remember(edit.orig);
      setDoc(next);
    }
  };

  useEffect(() => {
    if (!textEdit) return;
    const ta = textRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [textEdit]);

  // ------------------------------------------------------------------------------------------------------
  // Closing

  const close = () => {
    if (readOnly) return onClose(null);
    if (textEdit) commitText();
    const content = serializeDrawing(docRef.current);
    if (contentBytes(content) > MAX_CONTENT_BYTES) {
      setError(t('drawing.tooLarge'));
      return;
    }
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    try {
      localStorage.removeItem(DRAFT_PREFIX + draftKey);
    } catch {
      /* ignore */
    }
    onClose(content === baseContent ? null : content);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Close without saving; with changes it asks first (Verwerfen / Abbrechen)
  const discard = () => {
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    try {
      localStorage.removeItem(DRAFT_PREFIX + draftKey);
    } catch {
      /* ignore */
    }
    onClose(null);
  };
  // The drawing as it was opened, written the editor's way (the stored text may be written differently)
  const openedAs = useMemo(() => serializeDrawing(initial), [initial]);
  const onDiscardClick = (e: React.MouseEvent) => {
    const changed = !!textEdit || serializeDrawing(docRef.current) !== openedAs;
    if (changed) setConfirmDiscard({ x: e.clientX, y: e.clientY });
    else discard();
  };

  // ------------------------------------------------------------------------------------------------------
  // Keyboard: while the editor is open, every key belongs to it (the note behind must not react)

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    // The question about discarding takes its own keys (Enter, Escape)
    if (confirmDiscard) return;
    e.stopPropagation();
    if (textEdit) {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        commitText();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const handled = () => e.preventDefault();
    if (readOnly) {
      if (e.key === 'Escape') return handled(), closeRef.current();
      if (mod && (key === '+' || key === '=')) return handled(), zoomCenter(1.25);
      if (mod && key === '-') return handled(), zoomCenter(0.8);
      if (mod && key === '0') return handled(), fitAll();
      return;
    }
    if (e.key === ' ') {
      handled();
      setSpaceHeld(true);
      return;
    }
    if (e.key === 'Escape') {
      handled();
      if (selectedRef.current.length) setSelected([]);
      else if (tool !== 'select') setTool('select');
      else closeRef.current();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      handled();
      deleteSelected();
      return;
    }
    if (mod && key === 'z') {
      handled();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'y') return handled(), redo();
    if (mod && key === 'a') return handled(), setSelected(docRef.current.els.map((el) => el.id));
    if (mod && key === 'd') return handled(), duplicateSelected();
    if (mod && key === 'c') return handled(), copySelected();
    if (mod && key === 'x') return handled(), copySelected(), deleteSelected();
    if (mod && key === 'v') return handled(), paste();
    if (mod && (key === '+' || key === '=')) return handled(), zoomCenter(1.25);
    if (mod && key === '-') return handled(), zoomCenter(0.8);
    if (mod && key === '0') return handled(), fitAll();
    if (mod || e.altKey) return;
    if (e.key === 'Enter' && selectedRef.current.length === 1) {
      const el = byId.get(selectedRef.current[0]);
      if (el && (isShape(el) || el.t === 'text' || el.t === 'arrow')) {
        handled();
        startTextEdit(el);
      }
      return;
    }
    if (e.key.startsWith('Arrow') && selectedRef.current.length) {
      handled();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      updateElements(selectedRef.current, (el) => moveElement(el, dx, dy));
      return;
    }
    const tools: Record<string, Tool> = { v: 'select', '1': 'select', h: 'hand', r: 'rect', o: 'ellipse', d: 'diamond', a: 'arrow', p: 'draw', x: 'draw', t: 'text', e: 'eraser' };
    if (tools[key]) {
      handled();
      chooseTool(tools[key]);
      return;
    }
    if (key === 'g') return handled(), toggleGrid();
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => keyHandler.current(e);
    const up = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === ' ') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, []);

  // ------------------------------------------------------------------------------------------------------
  // Pointer

  const tol = () => 6 / viewRef.current.z;
  const snapOn = (e: { altKey: boolean }) => !!docRef.current.grid && !e.altKey;

  const handleAt = (
    p: Point
  ): { kind: 'resize'; handle: Handle } | { kind: 'end'; end: 'a' | 'b' } | { kind: 'bend' } | { kind: 'segment'; index: number; poly: Point[]; fixed: boolean } | null => {
    if (selectedRef.current.length !== 1) return null;
    const el = docRef.current.els.find((e) => e.id === selectedRef.current[0]);
    if (!el) return null;
    const r = 9 / viewRef.current.z;
    const near = (q: Point) => Math.abs(p[0] - q[0]) <= r && Math.abs(p[1] - q[1]) <= r;
    if (el.t === 'arrow') {
      const g = arrowGeometry(el, elementMap(docRef.current.els));
      // The handle nearest the pointer wins: on a short last stretch its handle sits close to the end
      type Hit = ReturnType<typeof handleAt>;
      let best: { d: number; hit: Hit } | null = null;
      const offer = (q: Point, hit: Hit) => {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (near(q) && (!best || d < best.d)) best = { d, hit };
      };
      offer(g.start, { kind: 'end', end: 'a' });
      offer(g.end, { kind: 'end', end: 'b' });
      if (el.route === 'curve') offer(g.mid, { kind: 'bend' });
      // Elbows: a handle on every stretch (fixed ones full, made-up ones grey)
      if (el.route === 'elbow') {
        const fixed = fixedStretches(g.poly, el.via);
        for (let i = 0; i + 1 < g.poly.length; i++) {
          offer([(g.poly[i][0] + g.poly[i + 1][0]) / 2, (g.poly[i][1] + g.poly[i + 1][1]) / 2], { kind: 'segment', index: i, poly: g.poly, fixed: fixed[i] });
        }
      }
      return best ? (best as { d: number; hit: Hit }).hit : null;
    }
    if (!isShape(el)) return null;
    for (const [h, q] of handlePoints(el)) if (near(q)) return { kind: 'resize', handle: h };
    return null;
  };

  const abortAction = () => {
    const a = actionRef.current;
    if (a && 'orig' in a) setDoc(a.orig);
    actionRef.current = null;
    setBand(null);
    setFaded(new Set());
    setDockTarget(null);
    setDockPort(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Otherwise the browser moves the focus to the page after this press, and a text field the press
    // just opened loses it at once (and with it the empty new text)
    e.preventDefault();
    if (textEdit) {
      commitText();
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Second finger: pinch to zoom and move; whatever the first finger started is undone
      abortAction();
      const [p1, p2] = [...pointers.current.values()];
      pinchRef.current = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2, view: viewRef.current };
      return;
    }
    if (pointers.current.size > 2) return;
    const p = toWorld(e.clientX, e.clientY);
    const doc0 = docRef.current;

    if (readOnly || tool === 'hand' || spaceHeld || e.button === 1) {
      actionRef.current = { k: 'pan', sx: e.clientX, sy: e.clientY, view: viewRef.current };
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'select') {
      const h = handleAt(p);
      const id = selectedRef.current[0];
      if (h?.kind === 'resize') {
        actionRef.current = { k: 'resize', handle: h.handle, orig: doc0, el: doc0.els.find((x) => x.id === id) as ShapeElement };
        return;
      }
      if (h?.kind === 'end') {
        actionRef.current = { k: 'arrowEnd', id, end: h.end, orig: doc0, from: [e.clientX, e.clientY] };
        return;
      }
      if (h?.kind === 'bend') {
        actionRef.current = { k: 'bend', id, orig: doc0 };
        return;
      }
      if (h?.kind === 'segment') {
        actionRef.current = { k: 'segment', id, index: h.index, poly: h.poly, orig: doc0 };
        return;
      }
      const hit = hitTest(doc0.els, p, tol());
      if (hit) {
        let ids = selectedRef.current;
        if (e.shiftKey) {
          ids = ids.includes(hit.id) ? ids.filter((x) => x !== hit.id) : [...ids, hit.id];
          setSelected(ids);
          return;
        }
        if (!ids.includes(hit.id)) ids = [hit.id];
        setSelected(ids);
        const set = new Set(ids);
        const box = elementBox(hit, byId);
        actionRef.current = { k: 'move', start: p, orig: doc0, ids: doc0.els.filter((x) => set.has(x.id)).map((x) => x.id), box };
        return;
      }
      if (!e.shiftKey) setSelected([]);
      actionRef.current = { k: 'band', start: p };
      setBand({ x: p[0], y: p[1], w: 0, h: 0 });
      return;
    }

    if (tool === 'rect' || tool === 'ellipse' || tool === 'diamond') {
      const start: Point = [snap(p[0], snapOn(e)), snap(p[1], snapOn(e))];
      const el: ShapeElement = {
        id: newElementId(),
        ver: 1,
        t: tool,
        x: start[0],
        y: start[1],
        w: 1,
        h: 1,
        s: style.s,
        f: style.f,
        sw: style.sw,
        ...(style.dash ? { dash: true } : {}),
        ...(style.fs !== DEFAULT_FONT_SIZE ? { fs: style.fs } : {}),
        ...(tool === 'rect' && style.r ? { r: true } : {}),
      };
      setDoc({ ...doc0, els: [...doc0.els, el] });
      actionRef.current = { k: 'create', id: el.id, start, orig: doc0 };
      return;
    }

    if (tool === 'arrow') {
      const from = shapeAt(doc0.els, p, 8 / viewRef.current.z);
      const start: Point = from ? p : [snap(p[0], snapOn(e)), snap(p[1], snapOn(e))];
      const el: ArrowElement = {
        id: newElementId(),
        ver: 1,
        t: 'arrow',
        a: start,
        b: start,
        ...(from ? { from: from.id } : {}),
        route: style.route,
        head: style.head,
        s: style.s,
        sw: style.sw,
        ...(style.dash ? { dash: true } : {}),
      };
      setDoc({ ...doc0, els: [...doc0.els, el] });
      actionRef.current = { k: 'arrow', id: el.id, orig: doc0 };
      return;
    }

    if (tool === 'draw') {
      const el: DrawElement = { id: newElementId(), ver: 1, t: 'draw', pts: [p[0], p[1]], s: style.s, sw: style.sw, ...(style.dash ? { dash: true } : {}) };
      setDoc({ ...doc0, els: [...doc0.els, el] });
      actionRef.current = { k: 'draw', id: el.id, pts: [p], orig: doc0 };
      return;
    }

    if (tool === 'eraser') {
      const hit = hitTest(doc0.els, p, tol());
      const ids = new Set<string>(hit ? [hit.id] : []);
      actionRef.current = { k: 'erase', ids };
      setFaded(new Set(ids));
      return;
    }

    if (tool === 'text') {
      const hit = hitTest(doc0.els, p, tol());
      if (hit && (isShape(hit) || hit.t === 'text' || hit.t === 'arrow')) startTextEdit(hit);
      else startTextEdit(null, [snap(p[0], snapOn(e)), snap(p[1], snapOn(e))]);
      setTool('select');
    }
  };

  const replaceEl = (base: Drawing, id: string, change: (el: any) => DrawElement): Drawing => ({
    ...base,
    els: base.els.map((el) => (el.id === id ? change(el) : el)),
  });

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinch = pinchRef.current;
    if (pinch && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;
      const rect = containerRef.current!.getBoundingClientRect();
      const v0 = pinch.view;
      const z = clampZoom(v0.z * (dist / Math.max(pinch.dist, 1)));
      // The point between the fingers stays under them
      const wx = v0.x + (pinch.cx - rect.left) / v0.z;
      const wy = v0.y + (pinch.cy - rect.top) / v0.z;
      setView({ x: wx - (cx - rect.left) / z, y: wy - (cy - rect.top) / z, z });
      return;
    }
    const a = actionRef.current;
    if (!a) return;
    const p = toWorld(e.clientX, e.clientY);
    const sn = snapOn(e);

    switch (a.k) {
      case 'pan': {
        const v = a.view;
        setView({ ...v, x: v.x - (e.clientX - a.sx) / v.z, y: v.y - (e.clientY - a.sy) / v.z });
        break;
      }
      case 'band': {
        setBand({ x: Math.min(a.start[0], p[0]), y: Math.min(a.start[1], p[1]), w: Math.abs(p[0] - a.start[0]), h: Math.abs(p[1] - a.start[1]) });
        break;
      }
      case 'move': {
        let dx = p[0] - a.start[0];
        let dy = p[1] - a.start[1];
        if (sn && a.box) {
          dx = snap(a.box.x + dx, true) - a.box.x;
          dy = snap(a.box.y + dy, true) - a.box.y;
        }
        const set = new Set(a.ids);
        const origById = elementMap(a.orig.els);
        const moved: Drawing = {
          ...a.orig,
          els: a.orig.els.map((el) => {
            if (!set.has(el.id)) return el;
            if (el.t === 'arrow') {
              // A line docked to a shape that stays behind stays too: it comes loose only by dragging its end
              if ((el.from && !set.has(el.from)) || (el.to && !set.has(el.to))) return el;
              const g = arrowGeometry(el, origById);
              return moveElement({ ...el, a: g.start, b: g.end }, dx, dy);
            }
            return moveElement(el, dx, dy);
          }),
        };
        moved.els = dropStaleVia(moved.els, set);
        setDoc(moved);
        break;
      }
      case 'resize': {
        const o = a.el;
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        const px = snap(p[0], sn);
        const py = snap(p[1], sn);
        if (a.handle.includes('w')) x0 = Math.min(px, x1 - 8);
        if (a.handle.includes('e')) x1 = Math.max(px, x0 + 8);
        if (a.handle.includes('n')) y0 = Math.min(py, y1 - 8);
        if (a.handle.includes('s')) y1 = Math.max(py, y0 + 8);
        if (e.shiftKey && a.handle.length === 2) {
          // Keep the proportions from the opposite corner
          const ratio = o.w / o.h;
          const w = x1 - x0;
          const h = y1 - y0;
          if (w / h > ratio) {
            const nw = h * ratio;
            if (a.handle.includes('w')) x0 = x1 - nw;
            else x1 = x0 + nw;
          } else {
            const nh = w / ratio;
            if (a.handle.includes('n')) y0 = y1 - nh;
            else y1 = y0 + nh;
          }
        }
        const resized = replaceEl(a.orig, o.id, (el) => ({ ...el, x: x0, y: y0, w: x1 - x0, h: y1 - y0, ver: el.ver + 1 }));
        setDoc({ ...resized, els: dropStaleVia(resized.els, new Set([o.id])) });
        break;
      }
      case 'create': {
        let x1 = snap(p[0], sn);
        let y1 = snap(p[1], sn);
        if (e.shiftKey) {
          const size = Math.max(Math.abs(x1 - a.start[0]), Math.abs(y1 - a.start[1]));
          x1 = a.start[0] + Math.sign(x1 - a.start[0] || 1) * size;
          y1 = a.start[1] + Math.sign(y1 - a.start[1] || 1) * size;
        }
        const x = Math.min(a.start[0], x1);
        const y = Math.min(a.start[1], y1);
        setDoc(replaceEl(docRef.current, a.id, (el) => ({ ...el, x, y, w: Math.max(1, Math.abs(x1 - a.start[0])), h: Math.max(1, Math.abs(y1 - a.start[1])) })));
        break;
      }
      case 'arrow':
      case 'arrowEnd': {
        // A click on an end with a twitch moves nothing: the end follows only after a few pixels
        if (a.k === 'arrowEnd' && !a.started) {
          if (Math.hypot(e.clientX - a.from[0], e.clientY - a.from[1]) < 5) break;
          a.started = true;
        }
        const end = a.k === 'arrow' ? 'b' : a.end;
        const cur = docRef.current.els.find((el) => el.id === a.id) as ArrowElement | undefined;
        if (!cur) break;
        const other = end === 'b' ? cur.from : cur.to;
        const target = shapeAt(docRef.current.els, p, 8 / viewRef.current.z, other);
        // Elbows dock to the side and spot the end is dragged to (snapping to the middle of the side);
        // near the shape's centre they take the side facing the other end
        const port = target && cur.route === 'elbow' ? portNear(target, p) : undefined;
        setDockTarget(target?.id || null);
        setDockPort(port && target ? { id: target.id, port } : null);
        const pt: Point = target ? p : [snap(p[0], sn), snap(p[1], sn)];
        setDoc(
          replaceEl(docRef.current, a.id, (el: ArrowElement) => {
            // Corners of its own stay: the new end reaches the first (or last) of them over a short stub
            const next: ArrowElement = { ...el, [end]: pt, ver: el.ver + 1 };
            const key = end === 'b' ? 'to' : 'from';
            const portKey = end === 'b' ? 'toPort' : 'fromPort';
            if (target) next[key] = target.id;
            else delete next[key];
            if (port) next[portKey] = port;
            else delete next[portKey];
            return next;
          })
        );
        break;
      }
      case 'segment': {
        // The stretch moves across and becomes fixed; at an end the line makes the corner it needs
        const q: Point = [snap(p[0], sn), snap(p[1], sn)];
        const via = dragSegment(a.poly, a.index, q);
        setDoc(
          replaceEl(docRef.current, a.id, (el: ArrowElement) => {
            const next: ArrowElement = { ...el, route: 'elbow', via, ver: el.ver + 1 };
            delete next.bend;
            delete next.axis;
            return next;
          })
        );
        break;
      }
      case 'bend': {
        const cur = docRef.current.els.find((el) => el.id === a.id) as ArrowElement | undefined;
        if (!cur) break;
        const g = arrowGeometry(cur, elementMap(docRef.current.els));
        const bend = Math.max(-2, Math.min(2, bendThrough(g.start, g.end, p)));
        setDoc(replaceEl(docRef.current, a.id, (el) => ({ ...el, bend: Math.abs(bend) < 0.02 ? 0 : bend })));
        break;
      }
      case 'draw': {
        const last = a.pts[a.pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1 / viewRef.current.z) break;
        a.pts.push(p);
        setDoc(replaceEl(docRef.current, a.id, (el) => ({ ...el, pts: a.pts.flat() })));
        break;
      }
      case 'erase': {
        const hit = hitTest(docRef.current.els, p, tol());
        if (hit && !a.ids.has(hit.id)) {
          a.ids.add(hit.id);
          setFaded(new Set(a.ids));
        }
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pinchRef.current) {
      if (pointers.current.size < 2) pinchRef.current = null;
      return;
    }
    const a = actionRef.current;
    actionRef.current = null;
    if (!a) return;
    const cur = docRef.current;
    switch (a.k) {
      case 'band': {
        setBand(null);
        const p = toWorld(e.clientX, e.clientY);
        const box: Box = { x: Math.min(a.start[0], p[0]), y: Math.min(a.start[1], p[1]), w: Math.abs(p[0] - a.start[0]), h: Math.abs(p[1] - a.start[1]) };
        if (box.w < 2 && box.h < 2) break;
        const inside = cur.els.filter((el) => boxContains(box, elementBox(el, byId))).map((el) => el.id);
        setSelected(e.shiftKey ? [...new Set([...selectedRef.current, ...inside])] : inside);
        break;
      }
      case 'create': {
        const el = cur.els.find((x) => x.id === a.id) as ShapeElement | undefined;
        if (el && el.w < 6 && el.h < 6) {
          // A click instead of a drag: a shape of the usual size around that point
          const [w, h] = SHAPE_SIZE[el.t];
          setDoc(replaceEl(cur, el.id, (x) => ({ ...x, x: a.start[0] - w / 2, y: a.start[1] - h / 2, w, h })));
        }
        remember(a.orig);
        setSelected([a.id]);
        setTool('select');
        break;
      }
      case 'arrow': {
        setDockTarget(null);
        setDockPort(null);
        const el = cur.els.find((x) => x.id === a.id) as ArrowElement | undefined;
        const g = el ? arrowGeometry(el, elementMap(cur.els)) : null;
        if (!el || !g || (!el.to && Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1]) < 8)) {
          setDoc(a.orig);
          break;
        }
        remember(a.orig);
        setSelected([a.id]);
        setTool('select');
        break;
      }
      case 'draw': {
        const pts = simplifyPoints(a.pts, Math.max(0.5, 1.2 / viewRef.current.z));
        setDoc(replaceEl(cur, a.id, (el) => ({ ...el, pts: pts.flat().map(Math.round) })));
        remember(a.orig);
        break;
      }
      case 'erase': {
        setFaded(new Set());
        if (a.ids.size) {
          remember(cur);
          setDoc({ ...cur, els: removeElements(cur.els, a.ids) });
          setSelected(selectedRef.current.filter((id) => !a.ids.has(id)));
        }
        break;
      }
      case 'arrowEnd': {
        setDockTarget(null);
        setDockPort(null);
        const el = cur.els.find((x) => x.id === a.id) as ArrowElement | undefined;
        const settled = el && settleCorners(el, elementMap(cur.els));
        if (settled) setDoc(replaceEl(cur, a.id, (x: ArrowElement) => withCorners(x, settled)));
        if (cur !== a.orig) remember(a.orig);
        break;
      }
      case 'segment': {
        // Corners whose stretch lost its length (or runs on with its neighbour) go now
        const el = cur.els.find((x) => x.id === a.id) as ArrowElement | undefined;
        const settled = el && settleCorners(el, elementMap(cur.els));
        if (settled) setDoc(replaceEl(cur, a.id, (x: ArrowElement) => withCorners(x, settled)));
        if (cur !== a.orig) remember(a.orig);
        break;
      }
      case 'move':
      case 'resize':
      case 'bend':
        if (cur !== a.orig) remember(a.orig);
        break;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnly || tool !== 'select') return;
    const p = toWorld(e.clientX, e.clientY);
    // Double click on a fixed stretch of an elbow: it goes, the corners around it are joined (elsewhere on
    // the line a double click edits its label as usual)
    const h = handleAt(p);
    const id = selectedRef.current[0];
    const sel = docRef.current.els.find((x) => x.id === id);
    if (h?.kind === 'segment' && h.fixed && sel?.t === 'arrow' && sel.via) {
      const via = releaseSegment(sel.via, h.poly[h.index], h.poly[h.index + 1]);
      const before = docRef.current;
      setDoc(replaceEl(before, id, (x: ArrowElement) => withCorners(x, { via })));
      remember(before);
      return;
    }
    const hit = hitTest(docRef.current.els, p, tol());
    if (hit && (isShape(hit) || hit.t === 'text' || hit.t === 'arrow')) startTextEdit(hit);
    else if (!hit) startTextEdit(null, [snap(p[0], !!docRef.current.grid), snap(p[1], !!docRef.current.grid)]);
  };

  // ------------------------------------------------------------------------------------------------------
  // Rendering

  const width = size.w || 1;
  const height = size.h || 1;
  const z = view.z;

  // While text is being edited, the drawing leaves it out so the text field takes its place
  // Labels that would cover each other move aside; worked out when a change is done (and on opening), not
  // while something is dragged
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const labelShifts = useMemo(() => spreadLabels(docRef.current.els), [historyTick]);

  const shownEls = useMemo(() => {
    if (!textEdit) return doc.els;
    return doc.els.map((el) => (el.id === textEdit.id && (isShape(el) || el.t === 'arrow') ? { ...el, txt: undefined } : el));
  }, [doc, textEdit]);
  // Free text is left out entirely; shapes and arrows stay, only without their words
  const hidden = useMemo(
    () => (textEdit && doc.els.find((el) => el.id === textEdit.id)?.t === 'text' ? new Set([textEdit.id]) : undefined),
    [doc, textEdit]
  );

  const selectedEls = selected.map((id) => byId.get(id)).filter(Boolean) as DrawElement[];
  const single = selectedEls.length === 1 ? selectedEls[0] : null;

  const selectionOverlay = (
    <g pointerEvents="none">
      {selectedEls.map((el) => {
        const b = elementBox(el, byId);
        const pad = 4 / z;
        return (
          <rect
            key={el.id}
            x={b.x - pad}
            y={b.y - pad}
            width={b.w + pad * 2}
            height={b.h + pad * 2}
            fill="none"
            stroke="var(--accent-primary)"
            strokeWidth={1 / z}
            strokeDasharray={`${4 / z} ${3 / z}`}
          />
        );
      })}
      {single && isShape(single) &&
        handlePoints(single).map(([h, q]) => (
          <rect key={h} x={q[0] - 4 / z} y={q[1] - 4 / z} width={8 / z} height={8 / z} fill="var(--bg-panel)" stroke="var(--accent-primary)" strokeWidth={1.5 / z} />
        ))}
      {single && single.t === 'arrow' &&
        (() => {
          const g = arrowGeometry(single, byId);
          const pts: Point[] = [g.start, g.end, ...(single.route === 'curve' ? [g.mid] : [])];
          const fixed = single.route === 'elbow' ? fixedStretches(g.poly, single.via) : [];
          return (
            <>
              {pts.map((q, i) => (
                <circle key={i} cx={q[0]} cy={q[1]} r={5 / z} fill={i === 2 ? 'var(--accent-primary)' : 'var(--bg-panel)'} stroke="var(--accent-primary)" strokeWidth={1.5 / z} />
              ))}
              {/* Elbows: full handles on fixed stretches, grey ones on the stretches the line makes up */}
              {fixed.map((own, i) => (
                <circle
                  key={`s${i}`}
                  cx={(g.poly[i][0] + g.poly[i + 1][0]) / 2}
                  cy={(g.poly[i][1] + g.poly[i + 1][1]) / 2}
                  r={4 / z}
                  fill={own ? 'var(--accent-primary)' : 'var(--bg-panel)'}
                  stroke={own ? 'var(--bg-panel)' : 'var(--text-faint)'}
                  strokeWidth={1.5 / z}
                  opacity={own ? 1 : 0.8}
                />
              ))}
            </>
          );
        })()}
      {dockPort &&
        (() => {
          const el = byId.get(dockPort.id);
          if (!isShape(el)) return null;
          const { at } = portPoint(el, dockPort.port, 0);
          return <circle cx={at[0]} cy={at[1]} r={6 / z} fill="var(--accent-primary)" stroke="var(--bg-panel)" strokeWidth={2 / z} />;
        })()}
      {dockTarget &&
        (() => {
          const el = byId.get(dockTarget);
          if (!isShape(el)) return null;
          const pad = 4 / z;
          return <rect x={el.x - pad} y={el.y - pad} width={el.w + pad * 2} height={el.h + pad * 2} rx={6 / z} fill="var(--accent-primary)" fillOpacity={0.08} stroke="var(--accent-primary)" strokeWidth={2 / z} />;
        })()}
      {band && <rect x={band.x} y={band.y} width={band.w} height={band.h} fill="var(--accent-primary)" fillOpacity={0.08} stroke="var(--accent-primary)" strokeWidth={1 / z} />}
    </g>
  );

  // Text field over the element being written in
  let textField: React.ReactNode = null;
  if (textEdit) {
    const el = byId.get(textEdit.id);
    const fs = (el && 'fs' in el && el.fs) || (el ? DEFAULT_FONT_SIZE : style.fs);
    const color = el && 'fs' in el ? strokeColor(el.s) : strokeColor(style.s);
    const lines = Math.max(1, textValue.split('\n').length);
    const common: React.CSSProperties = {
      position: 'absolute',
      fontSize: fs * z,
      lineHeight: 1.3,
      color,
      fontFamily: '"Inter Variable", Inter, system-ui, sans-serif',
      background: 'transparent',
      resize: 'none',
      outline: 'none',
      border: 'none',
      padding: 0,
      overflow: 'hidden',
      whiteSpace: 'pre',
    };
    if (el && el.t === 'arrow') {
      const at = arrowGeometry(el, byId).labelAt;
      const afs = el.fs || ARROW_FONT_SIZE;
      const longest = Math.max(...textValue.split('\n').map((l) => l.length), 6);
      const w = longest * afs * 0.62 + afs;
      textField = (
        <textarea
          ref={textRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={commitText}
          placeholder={t('drawing.textPlaceholder')}
          style={{
            ...common,
            fontSize: afs * z,
            textAlign: 'center',
            background: 'var(--bg-panel)',
            borderRadius: 4,
            width: w * z,
            height: lines * lineHeight(afs) * z + 4,
            left: (at[0] - view.x) * z - (w * z) / 2,
            top: (at[1] - view.y) * z - (lines * lineHeight(afs) * z + 4) / 2,
          }}
          aria-label={t('drawing.textField')}
        />
      );
    } else if (el && isShape(el)) {
      const inner = el.t === 'rect' ? 0.9 : el.t === 'ellipse' ? 0.7 : 0.55;
      const w = Math.max(fs, el.w * inner - 8);
      const wrapped = wrapText(textValue || ' ', fs, w).length;
      textField = (
        <textarea
          ref={textRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={commitText}
          style={{
            ...common,
            whiteSpace: 'pre-wrap',
            textAlign: 'center',
            width: w * z,
            height: wrapped * lineHeight(fs) * z + 2,
            left: (el.x + el.w / 2 - view.x) * z - (w * z) / 2,
            top: (el.y + el.h / 2 - view.y) * z - (wrapped * lineHeight(fs) * z) / 2,
          }}
          aria-label={t('drawing.textField')}
        />
      );
    } else {
      const longest = Math.max(...textValue.split('\n').map((l) => l.length), 4);
      const w = el && el.t === 'text' ? Math.max(textBox({ ...el, txt: textValue || ' ' }).w, fs * 3) : longest * fs * 0.62;
      textField = (
        <textarea
          ref={textRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={commitText}
          placeholder={t('drawing.textPlaceholder')}
          style={{
            ...common,
            width: (w + fs * 2) * z,
            height: lines * lineHeight(fs) * z + 2,
            left: (textEdit.x - view.x) * z,
            top: (textEdit.y - view.y) * z,
          }}
          aria-label={t('drawing.textField')}
        />
      );
    }
  }

  // What the style panel applies to: the selection, or the tool about to draw
  const kinds = new Set<string>(selectedEls.length ? selectedEls.map((el) => el.t) : tool === 'select' || tool === 'hand' || tool === 'eraser' ? [] : [tool]);
  const current = single ?? null;
  const panelStyle: Style = current
    ? {
        ...style,
        s: current.s,
        sw: current.sw,
        dash: !!current.dash,
        ...(isShape(current) ? { f: current.f, r: !!current.r, fs: current.fs || DEFAULT_FONT_SIZE } : {}),
        ...(current.t === 'text' ? { fs: current.fs || DEFAULT_FONT_SIZE } : {}),
        ...(current.t === 'arrow' ? { route: current.route, head: current.head } : {}),
      }
    : style;
  const hasShape = ['rect', 'ellipse', 'diamond'].some((k) => kinds.has(k));
  const hasText = hasShape || kinds.has('text');
  const hasLine = [...kinds].some((k) => k !== 'text');

  const toolButtons: { id: Tool; icon: React.ReactNode; label: string; key: string }[] = [
    { id: 'select', icon: <MousePointer2 className="w-4 h-4" />, label: t('drawing.tool.select'), key: 'V' },
    { id: 'hand', icon: <Hand className="w-4 h-4" />, label: t('drawing.tool.hand'), key: 'H' },
    { id: 'rect', icon: <Square className="w-4 h-4" />, label: t('drawing.tool.rect'), key: 'R' },
    { id: 'ellipse', icon: <Circle className="w-4 h-4" />, label: t('drawing.tool.ellipse'), key: 'O' },
    { id: 'diamond', icon: <Diamond className="w-4 h-4" />, label: t('drawing.tool.diamond'), key: 'D' },
    { id: 'arrow', icon: <MoveRight className="w-4 h-4" />, label: t('drawing.tool.arrow'), key: 'A' },
    { id: 'draw', icon: <Pencil className="w-4 h-4" />, label: t('drawing.tool.draw'), key: 'P' },
    { id: 'text', icon: <Type className="w-4 h-4" />, label: t('drawing.tool.text'), key: 'T' },
    { id: 'eraser', icon: <Eraser className="w-4 h-4" />, label: t('drawing.tool.eraser'), key: 'E' },
  ];

  const tools = (
    <div className="flex items-center gap-0.5">
      {toolButtons.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => chooseTool(b.id)}
          className={`h-11 w-11 sm:h-8 sm:w-8 shrink-0 inline-flex items-center justify-center rounded-btn transition-colors cursor-pointer ${
            tool === b.id ? 'bg-accent text-on-accent' : 'text-muted hover:text-main hover:bg-panel-hover'
          }`}
          title={`${b.label} (${b.key})`}
          aria-label={b.label}
          aria-pressed={tool === b.id}
        >
          {b.icon}
        </button>
      ))}
    </div>
  );

  const iconBtn = 'h-11 w-11 sm:h-8 sm:w-8 shrink-0 inline-flex items-center justify-center rounded-btn text-muted hover:text-main hover:bg-panel-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default';
  const chip = (on: boolean) =>
    `h-9 sm:h-7 px-2 inline-flex items-center justify-center gap-1 rounded-btn text-xs transition-colors cursor-pointer ${
      on ? 'bg-accent text-on-accent' : 'text-muted hover:text-main hover:bg-panel-hover'
    }`;

  const swatch = (c: DrawColor | 'none', on: boolean, onClick: () => void, asFill: boolean) => (
    <button
      key={c}
      type="button"
      onClick={onClick}
      className={`h-8 w-8 sm:h-6 sm:w-6 rounded-full border-2 shrink-0 cursor-pointer ${on ? 'border-accent' : 'border-transparent'}`}
      title={t(`drawing.color.${c}`)}
      aria-label={t(`drawing.color.${c}`)}
      aria-pressed={on}
    >
      <span
        className="block w-full h-full rounded-full border border-border"
        style={
          c === 'none'
            ? { background: 'linear-gradient(135deg, transparent 45%, var(--color-danger) 45%, var(--color-danger) 55%, transparent 55%)' }
            : { background: asFill ? fillColor(c) : strokeColor(c) }
        }
      />
    </button>
  );

  const panel =
    kinds.size > 0 && !textEdit ? (
      <div className={`${panelOpen ? '' : 'hidden'} sm:block absolute left-2 right-2 sm:right-auto bottom-2 sm:bottom-auto sm:top-2 z-10 sm:w-60 max-h-[45%] sm:max-h-[calc(100%-1rem)] overflow-y-auto p-2.5 bg-panel border border-border rounded-card shadow-panel space-y-2.5 text-xs text-main`}>
        <div>
          <div className="text-[11px] text-muted mb-1">{t('drawing.stroke')}</div>
          <div className="flex flex-wrap gap-1">{DRAW_COLORS.map((c) => swatch(c, panelStyle.s === c, () => applyStyle({ s: c }), false))}</div>
        </div>
        {hasShape && (
          <div>
            <div className="text-[11px] text-muted mb-1">{t('drawing.fill')}</div>
            <div className="flex flex-wrap gap-1">
              {(['none', ...DRAW_COLORS] as DrawFill[]).map((c) => swatch(c, panelStyle.f === c, () => applyStyle({ f: c }), true))}
            </div>
          </div>
        )}
        {hasLine && (
          <div className="flex flex-wrap items-center gap-1">
            {[1, 2, 4].map((w) => (
              <button key={w} type="button" onClick={() => applyStyle({ sw: w })} className={chip(panelStyle.sw === w)} title={t(`drawing.width.${w}`)} aria-label={t(`drawing.width.${w}`)}>
                <span className="block w-5 rounded-full bg-current" style={{ height: w + 0.5 }} />
              </button>
            ))}
            <button type="button" onClick={() => applyStyle({ dash: !panelStyle.dash })} className={chip(panelStyle.dash)} title={t('drawing.dashed')} aria-label={t('drawing.dashed')}>
              <span className="block w-5 border-t-2 border-dashed border-current" />
            </button>
            {(kinds.has('rect') || (current && current.t === 'rect')) && (
              <button type="button" onClick={() => applyStyle({ r: !panelStyle.r })} className={chip(panelStyle.r)} title={t('drawing.rounded')} aria-label={t('drawing.rounded')}>
                <span className="block w-4 h-3 border-2 border-current rounded-[4px]" />
              </button>
            )}
          </div>
        )}
        {hasText && (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted mr-1">{t('drawing.fontSize')}</span>
            {FONT_SIZES.map((fs, i) => (
              <button key={fs} type="button" onClick={() => applyStyle({ fs })} className={chip(panelStyle.fs === fs)}>
                {['S', 'M', 'L'][i]}
              </button>
            ))}
          </div>
        )}
        {kinds.has('arrow') && (
          <>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => applyStyle({ route: 'straight' })} className={chip(panelStyle.route === 'straight')} title={t('drawing.route.straight')} aria-label={t('drawing.route.straight')}>
                <Minus className="w-3.5 h-3.5 -rotate-45" />
              </button>
              <button type="button" onClick={() => applyStyle({ route: 'curve' })} className={chip(panelStyle.route === 'curve')} title={t('drawing.route.curve')} aria-label={t('drawing.route.curve')}>
                <Spline className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => applyStyle({ route: 'elbow' })} className={chip(panelStyle.route === 'elbow')} title={t('drawing.route.elbow')} aria-label={t('drawing.route.elbow')}>
                <CornerDownRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1">
              {[
                [2, 'end'],
                [3, 'both'],
                [0, 'none'],
              ].map(([h, label]) => (
                <button key={label} type="button" onClick={() => applyStyle({ head: h as number })} className={chip(panelStyle.head === h)}>
                  {t(`drawing.head.${label}`)}
                </button>
              ))}
            </div>
          </>
        )}
        {selectedEls.length > 0 && (
          <div className="flex items-center gap-0.5 pt-1 border-t border-border">
            <button type="button" onClick={() => reorder(true)} className={iconBtn} title={t('drawing.toFront')} aria-label={t('drawing.toFront')}>
              <ArrowUpToLine className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => reorder(false)} className={iconBtn} title={t('drawing.toBack')} aria-label={t('drawing.toBack')}>
              <ArrowDownToLine className="w-4 h-4" />
            </button>
            <button type="button" onClick={duplicateSelected} className={iconBtn} title={t('drawing.duplicate')} aria-label={t('drawing.duplicate')}>
              <Copy className="w-4 h-4" />
            </button>
            <button type="button" onClick={deleteSelected} className={`${iconBtn} hover:!text-status-err`} title={t('drawing.delete')} aria-label={t('drawing.delete')}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    ) : null;

  const cursor =
    spaceHeld || tool === 'hand'
      ? actionRef.current?.k === 'pan'
        ? 'grabbing'
        : 'grab'
      : tool === 'select'
      ? 'default'
      : tool === 'text'
      ? 'text'
      : 'crosshair';

  // Size for the "nearly full" notice: written out again only after a short pause, not on every move of a drag
  const [bytes, setBytes] = useState(() => contentBytes(serializeDrawing(doc)));
  useEffect(() => {
    const timer = window.setTimeout(() => setBytes(contentBytes(serializeDrawing(docRef.current))), 300);
    return () => window.clearTimeout(timer);
  }, [doc]);
  const nearlyFull = bytes > MAX_CONTENT_BYTES * 0.8;

  return createPortal(
    <div className="fixed inset-0 z-[66] flex flex-col bg-canvas text-main" role="dialog"
      aria-modal="true"
      aria-label={t('drawing.editorTitle')}
      // React passes events from a portal up to the bullet that renders it; they stop here
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onContextMenu={stop}
    >
      <div className="shrink-0 flex items-center gap-1 sm:gap-2 px-2 sm:px-4 pt-[calc(0.375rem+env(safe-area-inset-top))] pb-1.5 bg-panel/95 backdrop-blur-sm border-b border-border">
        {!readOnly && <div className="hidden sm:block">{tools}</div>}
        <div className="flex-1" />
        {!readOnly && (
          <>
        <button type="button" onClick={undo} disabled={past.current.length === 0} className={iconBtn} title={t('drawing.undo')} aria-label={t('drawing.undo')}>
          <Undo2 className="w-4 h-4" />
        </button>
        <button type="button" onClick={redo} disabled={future.current.length === 0} className={iconBtn} title={t('drawing.redo')} aria-label={t('drawing.redo')}>
          <Redo2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={toggleGrid}
          className={`${iconBtn} ${gridOn ? '!text-accent' : ''}`}
          title={`${t('drawing.grid')} (G)`}
          aria-label={t('drawing.grid')}
          aria-pressed={gridOn}
        >
          <Grid3x3 className="w-4 h-4" />
        </button>
          </>
        )}
        <button type="button" onClick={close} className="btn-action h-11 sm:h-8 px-3 text-xs inline-flex items-center gap-1.5 ml-1" title={t('drawing.doneEsc')}>
          <Check className="w-3.5 h-3.5" /> {readOnly ? t('drawing.close') : t('drawing.done')}
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={onDiscardClick}
            className="btn-action h-11 w-11 sm:h-8 sm:w-8 p-0 inline-flex items-center justify-center"
            title={t('drawing.discardTitle')}
            aria-label={t('drawing.discardTitle')}
          >
            {/* Same sign as leaving the full screen of a note */}
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        )}
        {confirmDiscard && (
          <ConfirmPopover
            x={confirmDiscard.x}
            y={confirmDiscard.y}
            message={t('drawing.discardAsk')}
            confirmLabel={t('drawing.discard')}
            danger
            onConfirm={() => {
              setConfirmDiscard(null);
              discard();
            }}
            onCancel={() => setConfirmDiscard(null)}
          />
        )}
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden select-none"
        style={{ touchAction: 'none', cursor }}
      >
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`${view.x} ${view.y} ${width / z} ${height / z}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          {gridOn && (
            <>
              <defs>
                <pattern id="drawing-grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                  <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="var(--border-color)" strokeWidth={1 / z} />
                </pattern>
              </defs>
              <rect x={view.x} y={view.y} width={width / z} height={height / z} fill="url(#drawing-grid)" />
            </>
          )}
          <DrawingElements els={shownEls} hidden={hidden} faded={faded} labelShifts={labelShifts} />
          {selectionOverlay}
        </svg>
        {textField}
        {panel}

        {draft && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-1rem)] flex flex-wrap items-center gap-2 px-3 py-2 bg-panel-elevated border border-status-warn/40 rounded-card shadow-panel text-xs">
            <span>{t('drawing.draftFound')}</span>
            <button
              type="button"
              className="btn-action h-8 px-2.5 text-xs"
              onClick={() => {
                const d = (draft && parseDrawing(draft.content)) || null;
                setDraft(null);
                if (d) {
                  remember(docRef.current);
                  setDoc(d);
                }
              }}
            >
              {t('drawing.draftRestore')}
            </button>
            <button
              type="button"
              className="btn-secondary h-8 px-2.5 text-xs"
              onClick={() => {
                setDraft(null);
                try {
                  localStorage.removeItem(DRAFT_PREFIX + draftKey);
                } catch {
                  /* ignore */
                }
              }}
            >
              {t('drawing.draftDiscard')}
            </button>
          </div>
        )}
        {(error || nearlyFull) && (
          <div className="absolute top-2 right-2 z-20 max-w-xs px-3 py-2 bg-panel-elevated border border-status-err/40 rounded-card shadow-panel text-xs text-main">
            {error || t('drawing.nearlyFull', { percent: Math.round((bytes / MAX_CONTENT_BYTES) * 100) })}
          </div>
        )}

        <div className="absolute right-2 bottom-2 z-10 hidden sm:flex items-center gap-0.5 p-0.5 bg-panel border border-border rounded-card shadow-panel">
          <button type="button" onClick={() => zoomCenter(0.8)} className={iconBtn} title={t('drawing.zoomOut')} aria-label={t('drawing.zoomOut')}>
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="w-11 text-center text-[11px] text-muted tabular-nums">{Math.round(z * 100)} %</span>
          <button type="button" onClick={() => zoomCenter(1.25)} className={iconBtn} title={t('drawing.zoomIn')} aria-label={t('drawing.zoomIn')}>
            <ZoomIn className="w-4 h-4" />
          </button>
          <button type="button" onClick={fitAll} className={iconBtn} title={t('drawing.fit')} aria-label={t('drawing.fit')}>
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Phones: the tools sit at the bottom, within thumb reach */}
      <div className={`${readOnly ? 'hidden' : 'sm:hidden'} shrink-0 overflow-x-auto px-1 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] bg-panel/95 border-t border-border`}>
        <div className="flex items-center gap-1 w-max">
          {kinds.size > 0 && !textEdit && (
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              className={`${iconBtn} ${panelOpen ? '!text-accent' : ''}`}
              title={t('drawing.style')}
              aria-label={t('drawing.style')}
              aria-pressed={panelOpen}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          )}
          {tools}
          <button type="button" onClick={fitAll} className={iconBtn} title={t('drawing.fit')} aria-label={t('drawing.fit')}>
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function handlePoints(el: ShapeElement): [Handle, Point][] {
  const { x, y, w, h } = el;
  return [
    ['nw', [x, y]],
    ['n', [x + w / 2, y]],
    ['ne', [x + w, y]],
    ['e', [x + w, y + h / 2]],
    ['se', [x + w, y + h]],
    ['s', [x + w / 2, y + h]],
    ['sw', [x, y + h]],
    ['w', [x, y + h / 2]],
  ];
}
