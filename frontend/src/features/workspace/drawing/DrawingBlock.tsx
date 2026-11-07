import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Pencil, RotateCcw, Save, Scan } from 'lucide-react';
import { Drawing, contentBox, drawingTexts, parseDrawing, serializeDrawing, wheelZoom } from '../../../lib/drawing/model';
import { DrawingElements } from './DrawingElements';
import { DrawingEditor } from './DrawingEditor';

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

/** Section and height of the preview at a width: the saved frame, or everything fitted */
export function previewLayout(d: Drawing, width: number): View & { h: number } {
  if (d.frame) {
    const z = width / d.frame.w;
    return { x: d.frame.x, y: d.frame.y, z, h: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, d.frame.h * z)) };
  }
  const box = contentBox(d);
  if (!box || width <= 0) return { x: 0, y: 0, z: 1, h: EMPTY_HEIGHT };
  const bw = box.w + PAD * 2;
  const bh = box.h + PAD * 2;
  let z = Math.min(1, width / bw);
  if (bh * z > AUTO_MAX_HEIGHT) z = AUTO_MAX_HEIGHT / bh;
  const h = Math.max(MIN_HEIGHT, bh * z);
  return { x: box.x + box.w / 2 - width / (2 * z), y: box.y + box.h / 2 - h / (2 * z), z, h };
}

interface DrawingBlockProps {
  blockId: string;
  content: string;
  canEdit: boolean;
  /** Freshly created via /canvas: open the editor right away */
  autoOpen?: boolean;
  onChange: (content: string) => void;
  /** The editor of a fresh drawing was closed without drawing anything */
  onDiscardNew?: () => void;
}

// Drawing in a note: a preview that fills the note's width. Hovering leaves the page scrolling as usual; after
// a click the drawing takes dragging, the wheel and pinching to move and zoom. Editing happens full screen.
export const DrawingBlock: React.FC<DrawingBlockProps> = ({ blockId, content, canEdit, autoOpen, onChange, onDiscardNew }) => {
  const { t } = useTranslation('workspace');
  const drawing = useMemo(() => parseDrawing(content), [content]);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  // Moved or zoomed by hand since the last save (only local until "Save view")
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [editing, setEditing] = useState(!!autoOpen && canEdit);
  // Only the first editor of a fresh drawing may turn it back into a bullet when nothing was drawn
  const freshRef = useRef(!!autoOpen);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ sx: number; sy: number; view: View; dist?: number; cx?: number; cy?: number } | null>(null);

  const valid = drawing !== null;
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
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

  const layout = drawing ? previewLayout(drawing, width) : null;
  const shown: View | null = view || layout;
  const height = dragHeight ?? layout?.h ?? EMPTY_HEIGHT;

  const updateView = (v: View | null) => {
    viewRef.current = v;
    setView(v);
  };

  // Clicking elsewhere hands scrolling back to the page
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setFocused(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [focused]);

  const zoomAt = (clientX: number, clientY: number, factor: number, base: View) => {
    const rect = boxRef.current!.getBoundingClientRect();
    const z = Math.min(8, Math.max(0.05, base.z * factor));
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wx = base.x + sx / base.z;
    const wy = base.y + sy / base.z;
    return { x: wx - sx / z, y: wy - sy / z, z };
  };

  // Wheel only while focused; it needs a non-passive listener to keep the page from scrolling
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !focused) return;
    const onWheel = (e: WheelEvent) => {
      const base = viewRef.current || (layout as View);
      if (!base) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) updateView(zoomAt(e.clientX, e.clientY, wheelZoom(e.deltaY), base));
      else updateView({ ...base, x: base.x + e.deltaX / base.z, y: base.y + e.deltaY / base.z });
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

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
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
  const btn =
    'h-9 sm:h-7 px-2 inline-flex items-center gap-1 rounded-btn text-xs text-muted hover:text-main hover:bg-panel-hover transition-colors cursor-pointer';

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
        onDoubleClick={() => canEdit && setEditing(true)}
        role="img"
        aria-label={texts.length ? t('drawing.ariaWithText', { text: texts.join(', ') }) : t('drawing.aria')}
      >
        {shown && width > 0 && (
          <svg className="absolute inset-0 w-full h-full" viewBox={`${shown.x} ${shown.y} ${width / shown.z} ${height / shown.z}`}>
            <DrawingElements els={drawing.els} />
          </svg>
        )}
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted pointer-events-none">
            {canEdit ? t('drawing.emptyEdit') : t('drawing.empty')}
          </div>
        )}

        <div
          className={`absolute top-1.5 right-1.5 flex items-center gap-0.5 p-0.5 bg-panel/90 backdrop-blur-sm border border-border rounded-btn shadow-xs transition-opacity ${
            focused || view ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover/drawing:opacity-100 focus-within:opacity-100'
          }`}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {view && (
            <>
              {canEdit && (
                <button type="button" className={btn} onClick={() => saveFrame(view, height)} title={t('drawing.saveViewTitle')}>
                  <Save className="w-3.5 h-3.5" /> {t('drawing.saveView')}
                </button>
              )}
              <button type="button" className={btn} onClick={() => updateView(null)} title={t('drawing.resetView')} aria-label={t('drawing.resetView')}>
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {!view && canEdit && drawing.frame && (
            <button
              type="button"
              className={btn}
              onClick={() => onChange(serializeDrawing({ ...drawing, frame: undefined }))}
              title={t('drawing.autoViewTitle')}
            >
              <Scan className="w-3.5 h-3.5" /> {t('drawing.autoView')}
            </button>
          )}
          {canEdit ? (
            <button type="button" className={btn} onClick={() => setEditing(true)} title={t('drawing.editTitle')}>
              <Pencil className="w-3.5 h-3.5" /> {t('drawing.edit')}
            </button>
          ) : (
            <button type="button" className={btn} onClick={() => setEditing(true)} title={t('drawing.fullscreen')} aria-label={t('drawing.fullscreen')}>
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

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

      {editing && (
        <DrawingEditor
          initial={drawing}
          baseContent={content}
          draftKey={blockId}
          readOnly={!canEdit}
          onClose={(next) => {
            setEditing(false);
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
