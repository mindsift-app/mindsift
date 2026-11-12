import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Expand, Maximize2, Pencil, RotateCcw, Save, Shrink } from 'lucide-react';
import { Drawing, contentBox, drawingTexts, parseDrawing, serializeDrawing, wheelZoom } from '../../../lib/drawing/model';
import { DrawingElements } from './DrawingElements';
import { DrawingEditor } from './DrawingEditor';
import { ConfirmPopover } from '../../../components/ConfirmPopover';
import { AvatarStack } from '../../../components/AvatarStack';
import { isWebSocketConnected } from '../../../lib/api';

interface View {
  x: number;
  y: number;
  z: number;
}

/** Automatic height stops here; taller drawings are zoomed out instead */
const AUTO_MAX_HEIGHT = 420;
const MIN_HEIGHT = 80;
const EMPTY_HEIGHT = 140;
const MAX_HEIGHT = 4000;
const PAD = 24;

/**
 * Section and height of the preview at a width (everything follows the width, so a wider window gives a
 * taller preview): the saved frame; or the chosen size ('all': the whole drawing as large as the width
 * allows; 'readable': the recommended height at a readable size, a wide drawing starting at its left and
 * moved sideways); or automatic: everything at most 1:1 and the recommended height.
 */
export function previewLayout(d: Drawing, width: number): View & { h: number } {
  if (d.frame) {
    const z = width / d.frame.w;
    return { x: d.frame.x, y: d.frame.y, z, h: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, d.frame.h * z)) };
  }
  const box = contentBox(d);
  if (!box || width <= 0) return { x: 0, y: 0, z: 1, h: EMPTY_HEIGHT };
  const bw = box.w + PAD * 2;
  const bh = box.h + PAD * 2;
  if (d.fit === 'readable') {
    const z = Math.min(1, AUTO_MAX_HEIGHT / bh);
    const h = Math.max(MIN_HEIGHT, bh * z);
    const x = bw * z > width ? box.x - PAD : box.x + box.w / 2 - width / (2 * z);
    return { x, y: box.y + box.h / 2 - h / (2 * z), z, h };
  }
  const z = d.fit === 'all' ? Math.min(3, width / bw, MAX_HEIGHT / bh) : Math.min(1, width / bw, AUTO_MAX_HEIGHT / bh);
  const h = Math.max(MIN_HEIGHT, bh * z);
  return { x: box.x + box.w / 2 - width / (2 * z), y: box.y + box.h / 2 - h / (2 * z), z, h };
}

/**
 * What the size toggle does: from a saved view or a chosen size back to the automatic one; from the automatic
 * size to the other one (a drawing held back by the width gets the readable height, one held back by the
 * height is shown all large).
 */
export function nextSize(d: Drawing, width: number): Drawing['fit'] | 'auto' {
  if (d.frame || d.fit) return 'auto';
  const box = contentBox(d);
  if (!box || width <= 0) return 'all';
  const byWidth = width / (box.w + PAD * 2) < Math.min(1, AUTO_MAX_HEIGHT / (box.h + PAD * 2));
  return byWidth ? 'readable' : 'all';
}

interface DrawingBlockProps {
  docId?: string;
  blockId: string;
  content: string;
  canEdit: boolean;
  /** Freshly created via /canvas: open the editor right away */
  autoOpen?: boolean;
  onChange: (content: string) => void;
  /** The editor of a fresh drawing was closed without drawing anything */
  onDiscardNew?: () => void;
  /** Element the buttons go into (the bullet's action bubble); without one they sit on the drawing */
  actionsTarget?: HTMLElement | null;
  /** Clicked into or open in the editor, and back */
  onFocusChange?: (focused: boolean) => void;
  /** Drawing in the editor (keeps the bullet held for this person) */
  onActivity?: () => void;
  /** People drawing in it live right now (host first) */
  live?: { userId: string; name: string; avatarUrl?: string }[];
}

/** How the editor is open: alone as before ('solo'), looking only ('view'), or in a live session */
type EditMode = 'solo' | 'view' | 'draw' | 'watch';

// Drawing in a note: a preview that fills the note's width. Hovering leaves the page scrolling as usual; after
// a click the drawing takes dragging, the wheel and pinching to move and zoom. Editing happens full screen.
export const DrawingBlock: React.FC<DrawingBlockProps> = ({
  docId,
  blockId,
  content,
  canEdit,
  autoOpen,
  onChange,
  onDiscardNew,
  actionsTarget,
  onFocusChange,
  onActivity,
  live,
}) => {
  const { t } = useTranslation('workspace');
  const drawing = useMemo(() => parseDrawing(content), [content]);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  // Moved or zoomed by hand since the last save (only local until "Save view")
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  // With a WebSocket, editing is a live session others can join; without, alone as before
  const editMode = (): EditMode => (canEdit ? (docId && isWebSocketConnected() ? 'draw' : 'solo') : 'view');
  const [editing, setEditing] = useState<EditMode | null>(() => (autoOpen && canEdit ? editMode() : null));
  // Someone draws live: join or watch (asked where the click was)
  const [ask, setAsk] = useState<{ x: number; y: number } | null>(null);
  const liveNames = live?.length ? [...new Set(live.map((p) => p.name))] : [];
  const openEditor = (e?: { clientX: number; clientY: number }) => {
    if (liveNames.length && docId) {
      setAsk({ x: e?.clientX ?? window.innerWidth / 2, y: e?.clientY ?? window.innerHeight / 3 });
      return;
    }
    setEditing(editMode());
  };
  // Only the first editor of a fresh drawing may turn it back into a bullet when nothing was drawn
  const freshRef = useRef(!!autoOpen);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ sx: number; sy: number; view: View; dist?: number; cx?: number; cy?: number } | null>(null);
  // Where a press on the focused drawing began (a click without moving leaves it)
  const clickStart = useRef<{ x: number; y: number } | null>(null);

  const valid = drawing !== null;
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // Inside the border, as the observer reports it, so its first report does not render the drawing again
    setWidth(el.getBoundingClientRect().width - (el.offsetWidth - el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [valid]);

  // A new version from the editor or from someone else replaces a section moved by hand
  useEffect(() => {
    setView(null);
    viewRef.current = null;
  }, [content]);

  // A section moved by hand keeps showing the same part when the note gets wider or narrower
  const lastWidth = useRef(0);
  useEffect(() => {
    const before = lastWidth.current;
    lastWidth.current = width;
    const v = viewRef.current;
    if (!v || before <= 0 || width <= 0 || before === width) return;
    const next = { ...v, z: (v.z * width) / before };
    viewRef.current = next;
    setView(next);
  }, [width]);

  const layout = drawing ? previewLayout(drawing, width) : null;
  const shown: View | null = view || layout;
  const height = dragHeight ?? layout?.h ?? EMPTY_HEIGHT;

  const updateView = (v: View | null) => {
    cancelAnimationFrame(glide.current);
    viewRef.current = v;
    setView(v);
  };

  // Leaving the section without saving: it glides back to where it was
  const glide = useRef(0);
  const glideBack = () => {
    const from = viewRef.current;
    const to = layout;
    if (!from || !to) return updateView(null);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 250);
      const e = 1 - (1 - t) ** 3;
      if (t >= 1) {
        viewRef.current = null;
        setView(null);
        return;
      }
      const v = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e };
      viewRef.current = v;
      setView(v);
      glide.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(glide.current);
    glide.current = requestAnimationFrame(step);
  };
  const glideBackRef = useRef(glideBack);
  glideBackRef.current = glideBack;
  const leave = () => {
    setFocused(false);
    glideBackRef.current();
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  // The bullet counts as focused while the drawing takes gestures or its editor is open
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const active = focused || !!editing;
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current && !active) {
      firstRun.current = false;
      return;
    }
    firstRun.current = false;
    onFocusChangeRef.current?.(active);
  }, [active]);

  // Clicking elsewhere hands scrolling back to the page (its buttons in the bubble count as the drawing)
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const inside = boxRef.current?.contains(target) || actionsTarget?.parentElement?.contains(target);
      if (!inside) leaveRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        leaveRef.current();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [focused, actionsTarget]);

  const zoomAt = (clientX: number, clientY: number, factor: number, base: View) => {
    const rect = boxRef.current!.getBoundingClientRect();
    const z = Math.min(8, Math.max(0.05, base.z * factor));
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wx = base.x + sx / base.z;
    const wy = base.y + sy / base.z;
    return { x: wx - sx / z, y: wy - sy / z, z };
  };

  // The wheel keeps scrolling the page; only with Ctrl/Cmd (and trackpad pinching) it zooms the focused drawing.
  // It needs a non-passive listener to keep the page from zooming then.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !focused) return;
    const onWheel = (e: WheelEvent) => {
      const base = viewRef.current || (layout as View);
      if (!base || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      updateView(zoomAt(e.clientX, e.clientY, wheelZoom(e.deltaY), base));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  if (!drawing) {
    return <div className="text-xs text-status-err py-1">{t('drawing.broken')}</div>;
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!focused) {
      setFocused(true);
      return;
    }
    clickStart.current = pointers.current.size === 0 ? { x: e.clientX, y: e.clientY } : null;
    if (!shown) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = { sx: 0, sy: 0, view: viewRef.current || shown, dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    } else if (pts.length === 1) {
      gesture.current = { sx: e.clientX, sy: e.clientY, view: viewRef.current || shown };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = boxRef.current!.getBoundingClientRect();
      const z = Math.min(8, Math.max(0.05, g.view.z * (dist / g.dist)));
      const wx = g.view.x + (g.cx! - rect.left) / g.view.z;
      const wy = g.view.y + (g.cy! - rect.top) / g.view.z;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      updateView({ x: wx - (cx - rect.left) / z, y: wy - (cy - rect.top) / z, z });
    } else if (pts.length === 1 && !g.dist) {
      updateView({ ...g.view, x: g.view.x - (e.clientX - g.sx) / g.view.z, y: g.view.y - (e.clientY - g.sy) / g.view.z });
    }
  };

  // A second click without dragging ends moving the section (and an unsaved one glides back)
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    const c = clickStart.current;
    clickStart.current = null;
    if (c && pointers.current.size === 0 && Math.hypot(e.clientX - c.x, e.clientY - c.y) < 4) leave();
  };

  const saveFrame = (v: View, h: number) => {
    if (!drawing || width <= 0) return;
    onChange(serializeDrawing({ ...drawing, frame: { x: v.x, y: v.y, w: width / v.z, h: h / v.z } }));
  };

  // Dragging the bottom edge sets the height; zoom and section stay, and from then on are saved
  const onResizeDown = (e: React.PointerEvent) => {
    if (!shown) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = height;
    const v = viewRef.current || shown;
    const target = e.currentTarget as Element;
    target.setPointerCapture?.(e.pointerId);
    let h = startH;
    const move = (ev: PointerEvent) => {
      h = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH + ev.clientY - startY));
      setDragHeight(h);
    };
    const up = () => {
      target.removeEventListener('pointermove', move as EventListener);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDragHeight(null);
      if (Math.abs(h - startH) > 1) saveFrame(v, h);
    };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const empty = drawing.els.length === 0;
  const texts = drawingTexts(drawing);
  // Same look as the other buttons of the bullet's action bubble
  const btn =
    'p-1 sm:p-0.5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-faint hover:text-accent rounded-btn transition-colors cursor-pointer';
  // Toggle between the recommended size and the other one (stays available, saved for everyone)
  const next = nextSize(drawing, width);
  const sizeButton = (
    <button
      type="button"
      className={btn}
      onClick={() => onChange(serializeDrawing({ ...drawing, frame: undefined, fit: next === 'auto' ? undefined : next }))}
      title={t(next === 'auto' ? 'drawing.sizeAutoTitle' : next === 'all' ? 'drawing.sizeAllTitle' : 'drawing.sizeReadableTitle')}
      aria-label={t(next === 'auto' ? 'drawing.sizeAuto' : next === 'all' ? 'drawing.sizeAll' : 'drawing.sizeReadable')}
    >
      {next === 'auto' ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
    </button>
  );
  const actions = (
    <>
      {view && canEdit && (
        <button type="button" className={btn} onClick={() => saveFrame(view, height)} title={t('drawing.saveViewTitle')} aria-label={t('drawing.saveView')}>
          <Save className="w-3.5 h-3.5" />
        </button>
      )}
      {view && (
        <button type="button" className={btn} onClick={() => glideBack()} title={t('drawing.resetView')} aria-label={t('drawing.resetView')}>
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
      {!view && canEdit && !empty && sizeButton}
      {canEdit ? (
        <button type="button" className={btn} onClick={openEditor} title={t('drawing.editTitle')} aria-label={t('drawing.edit')}>
          <Pencil className="w-3.5 h-3.5" />
        </button>
      ) : (
        <button type="button" className={btn} onClick={openEditor} title={t('drawing.fullscreen')} aria-label={t('drawing.fullscreen')}>
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      )}
    </>
  );

  return (
    <div className="my-1 group/drawing">
      <div
        ref={boxRef}
        className={`relative w-full rounded-card border bg-panel overflow-hidden transition-colors ${
          focused ? 'border-accent ring-1 ring-accent/30' : 'border-border'
        }`}
        style={{ height, touchAction: focused ? 'none' : 'auto', cursor: focused ? (gesture.current ? 'grabbing' : 'grab') : 'pointer' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => (canEdit || liveNames.length > 0) && openEditor(e)}
        role="img"
        aria-label={texts.length ? t('drawing.ariaWithText', { text: texts.join(', ') }) : t('drawing.aria')}
      >
        {shown && width > 0 && (
          <svg className="absolute inset-0 w-full h-full" viewBox={`${shown.x} ${shown.y} ${width / shown.z} ${height / shown.z}`}>
            <DrawingElements els={drawing.els} />
          </svg>
        )}
        {liveNames.length > 0 && (
          <div
            data-live-badge
            className="absolute top-1.5 left-1.5 max-w-[calc(100%-5rem)] inline-flex items-center gap-1.5 h-6 pl-1.5 pr-2 rounded-pill bg-panel/90 border border-border text-[11px] font-semibold text-main shadow-xs pointer-events-none"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-status-err animate-pulse shrink-0" />
            <AvatarStack people={live!.map((p) => ({ id: p.userId, name: p.name, avatarUrl: p.avatarUrl }))} size="xxs" ringClass="ring-[var(--bg-panel)]" />
            <span className="truncate">{t('drawing.live.badge', { names: liveNames.join(', ') })}</span>
          </div>
        )}
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted pointer-events-none">
            {canEdit ? t('drawing.emptyEdit') : t('drawing.empty')}
          </div>
        )}

        {!actionsTarget && <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 p-0.5 bg-panel/90 backdrop-blur-sm border border-border rounded-btn shadow-xs" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>{actions}</div>}

        {canEdit && (
          <div
            className="absolute left-0 right-0 bottom-0 h-3 sm:h-2 cursor-ns-resize flex items-end justify-center opacity-100 sm:opacity-0 sm:group-hover/drawing:opacity-100 transition-opacity"
            style={{ touchAction: 'none' }}
            onPointerDown={onResizeDown}
            onDoubleClick={(e) => e.stopPropagation()}
            title={t('drawing.resize')}
          >
            <span className="mb-0.5 block w-10 h-1 rounded-full bg-border" />
          </div>
        )}
      </div>

      {/* Outside the drawing's box, so clicks on them do not reach its gesture handlers */}
      {actionsTarget && createPortal(actions, actionsTarget)}

      {ask && (
        <ConfirmPopover
          x={ask.x}
          y={ask.y}
          message={
            <>
              <p>{t('drawing.live.ask', { names: liveNames.join(', '), count: liveNames.length })}</p>
              {canEdit && !isWebSocketConnected() && <p className="mt-1 text-muted">{t('drawing.live.needsWebSocket')}</p>}
            </>
          }
          confirmLabel={canEdit && isWebSocketConnected() ? t('drawing.live.drawAlong') : t('drawing.live.watch')}
          onConfirm={() => {
            setAsk(null);
            setEditing(canEdit && isWebSocketConnected() ? 'draw' : 'watch');
          }}
          altLabel={canEdit && isWebSocketConnected() ? t('drawing.live.watch') : undefined}
          onAlt={
            canEdit && isWebSocketConnected()
              ? () => {
                  setAsk(null);
                  setEditing('watch');
                }
              : undefined
          }
          onCancel={() => setAsk(null)}
        />
      )}

      {editing && (
        <DrawingEditor
          // The live session holds the bullet itself
          onActivity={editing === 'solo' ? onActivity : undefined}
          initial={drawing}
          baseContent={content}
          draftKey={blockId}
          readOnly={editing === 'view'}
          live={
            docId && (editing === 'draw' || editing === 'watch')
              ? { docId, blockId, mode: editing, canDraw: canEdit && isWebSocketConnected() }
              : undefined
          }
          onClose={(next) => {
            setEditing(null);
            const fresh = freshRef.current;
            freshRef.current = false;
            if (next !== null) onChange(next);
            else if (fresh && empty) onDiscardNew?.();
          }}
        />
      )}
    </div>
  );
};
