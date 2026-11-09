import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Drag & drop on the Kanban board with a finger (browsers offer HTML5 drag & drop only for mouse and
// pen): hold a card for a moment, it lifts, drag it onto another card or column, let go. A short tap
// still opens the task and a swipe still scrolls, because the drag starts only after the hold.
// Cards carry data-kanban-task="<id>", columns data-kanban-col="<id>".

const HOLD_MS = 350;
const MOVE_TOLERANCE = 8; // px a finger may wander during the hold before it counts as scrolling
const EDGE = 90; // px near the top/bottom edge that scroll the page while dragging
const EDGE_DWELL_MS = 450; // with snap points: how long a card waits at the edge before the page moves on

export type KanbanDropTarget = { taskId: string; position: 'before' | 'after' } | null;

interface Options {
  enabled: boolean;
  onStart: (taskId: string) => void;
  onHover: (colId: string | null, target: KanbanDropTarget) => void;
  onDrop: (taskId: string, colId: string | null, target: KanbanDropTarget) => void;
  onCancel: () => void;
  // Page positions the board snaps to (one column per screen on phones). With them, holding a card at
  // the top/bottom edge moves the page to the previous/next one instead of scrolling slowly.
  snapPoints?: () => number[];
}

interface Drag {
  taskId: string;
  label: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
}

export function useKanbanTouchDrag({ enabled, onStart, onHover, onDrop, onCancel, snapPoints }: Options) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const holdRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const hoverRef = useRef<{ col: string | null; target: KanbanDropTarget }>({ col: null, target: null });
  const suppressClickRef = useRef(false);
  const callbacks = useRef({ onStart, onHover, onDrop, onCancel, snapPoints });
  callbacks.current = { onStart, onHover, onDrop, onCancel, snapPoints };

  const cancelHold = () => {
    if (holdRef.current) window.clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  };

  const hoverAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const card = el?.closest('[data-kanban-task]') as HTMLElement | null;
    const col = (el?.closest('[data-kanban-col]') as HTMLElement | null)?.dataset.kanbanCol ?? null;
    let target: KanbanDropTarget = null;
    const cardId = card?.dataset.kanbanTask;
    if (card && cardId && cardId !== dragRef.current?.taskId) {
      const r = card.getBoundingClientRect();
      target = { taskId: cardId, position: y - r.top < r.height / 2 ? 'before' : 'after' };
    }
    const prev = hoverRef.current;
    if (prev.col !== col || prev.target?.taskId !== target?.taskId || prev.target?.position !== target?.position) {
      hoverRef.current = { col, target };
      callbacks.current.onHover(col, target);
    }
  };

  // While dragging: the page must not scroll under the finger (non-passive listener), it scrolls
  // only near the edges
  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    let edgeSince = 0;
    let movingUntil = 0;
    const scroll = () => {
      const d = dragRef.current;
      if (d) {
        const up = d.y < EDGE;
        const down = d.y > window.innerHeight - EDGE;
        const points = callbacks.current.snapPoints?.();
        if (points && (up || down)) {
          // Snapping board: after a short wait at the edge, on to the previous/next column (again after
          // another wait while the card stays there)
          const now = Date.now();
          if (!edgeSince) edgeSince = now;
          if (now - edgeSince > EDGE_DWELL_MS && now > movingUntil) {
            const cur = window.scrollY;
            const next = down ? points.find((p) => p > cur + 2) : [...points].reverse().find((p) => p < cur - 2);
            if (next !== undefined) window.scrollTo({ top: next, behavior: 'smooth' });
            movingUntil = now + 1000;
            edgeSince = now;
          }
        } else if (points) {
          edgeSince = 0;
        } else if (up) window.scrollBy(0, -Math.ceil((EDGE - d.y) / 6));
        else if (down) window.scrollBy(0, Math.ceil((d.y - (window.innerHeight - EDGE)) / 6));
        hoverAt(d.x, d.y);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);

    const move = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (!t || !dragRef.current) return;
      dragRef.current = { ...dragRef.current, x: t.clientX, y: t.clientY };
      setDrag(dragRef.current);
    };
    const end = (e: TouchEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      suppressClickRef.current = true;
      window.setTimeout(() => (suppressClickRef.current = false), 400);
      if (!d) return;
      if (e.type === 'touchcancel') callbacks.current.onCancel();
      else callbacks.current.onDrop(d.taskId, hoverRef.current.col, hoverRef.current.target);
      hoverRef.current = { col: null, target: null };
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    };
    // Listeners live as long as one drag; positions are read from refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(drag)]);

  /** Props for a card; label is what the lifted card shows */
  const cardProps = useCallback(
    (taskId: string, label: string, draggable: boolean) => {
      if (!enabled || !draggable) return {};
      return {
        onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          const el = e.currentTarget;
          cancelHold();
          holdRef.current = {
            x: t.clientX,
            y: t.clientY,
            timer: window.setTimeout(() => {
              const hold = holdRef.current;
              holdRef.current = null;
              if (!hold) return;
              const r = el.getBoundingClientRect();
              navigator.vibrate?.(15);
              const d: Drag = { taskId, label, x: hold.x, y: hold.y, offsetX: hold.x - r.left, offsetY: hold.y - r.top, width: r.width };
              dragRef.current = d;
              hoverRef.current = { col: null, target: null };
              setDrag(d);
              callbacks.current.onStart(taskId);
            }, HOLD_MS),
          };
        },
        onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
          const h = holdRef.current;
          const t = e.touches[0];
          if (h && t && Math.hypot(t.clientX - h.x, t.clientY - h.y) > MOVE_TOLERANCE) cancelHold(); // scrolling
        },
        onTouchEnd: cancelHold,
        onTouchCancel: cancelHold,
        // The long press must not open the browser's context menu or select text
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        style: { WebkitTouchCallout: 'none' } as React.CSSProperties,
      };
    },
    [enabled]
  );

  /** A tap right after a drag must not open the task */
  const consumeClick = () => suppressClickRef.current;

  const ghost = drag
    ? createPortal(
        <div
          className="fixed z-[80] pointer-events-none panel-surface shadow-panel px-3 py-2.5 text-xs font-medium text-main rotate-1 opacity-60 border-accent"
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
        >
          {drag.label}
        </div>,
        document.body
      )
    : null;

  return { cardProps, ghost, consumeClick, dragging: Boolean(drag) };
}
