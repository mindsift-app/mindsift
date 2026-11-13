import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLatestRef } from '../../lib/useLatestRef';

// Reordering a short vertical list by a drag handle, with mouse, pen and finger alike (pointer events; HTML5
// drag & drop does not exist on touch devices) and with the arrow keys on the handle. Items carry
// data-sort-id="<id>" inside containerRef. While dragging, `order` already shows the new place.
// Move and release are followed on the window: moving the item in the DOM ends a pointer capture, so the
// handle alone would lose the rest of the gesture.
export function usePointerSort(ids: string[], onReorder: (ids: string[]) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; index: number } | null>(null);
  const dragRef = useLatestRef(drag);
  const idsRef = useLatestRef(ids);
  const onReorderRef = useLatestRef(onReorder);

  const order = useMemo(() => {
    if (!drag) return ids;
    const rest = ids.filter((x) => x !== drag.id);
    rest.splice(drag.index, 0, drag.id);
    return rest;
  }, [ids, drag]);

  const finish = (next: string[]) => {
    setDrag(null);
    if (next.join('\n') !== idsRef.current.join('\n')) onReorderRef.current(next);
  };
  const finishRef = useLatestRef(finish);

  const dragId = drag?.id ?? null;
  useEffect(() => {
    if (!dragId) return;
    // Target place: how many of the other items have their middle above the pointer
    const indexAt = (clientY: number) => {
      const items = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[data-sort-id]') ?? []).filter(
        (el) => el.dataset.sortId !== dragId
      );
      let index = 0;
      for (const el of items) {
        const r = el.getBoundingClientRect();
        if (clientY > r.top + r.height / 2) index++;
      }
      return index;
    };
    const move = (e: PointerEvent) => {
      const index = indexAt(e.clientY);
      if (dragRef.current && index !== dragRef.current.index) setDrag({ id: dragId, index });
    };
    const up = () => {
      const d = dragRef.current;
      if (!d) return;
      const next = idsRef.current.filter((x) => x !== d.id);
      next.splice(d.index, 0, d.id);
      finishRef.current(next);
    };
    const cancel = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [dragId, dragRef, finishRef, idsRef]);

  const handleProps = (id: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setDrag({ id, index: ids.indexOf(id) });
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      const from = ids.indexOf(id);
      const to = e.key === 'ArrowUp' ? from - 1 : e.key === 'ArrowDown' ? from + 1 : -1;
      if (to < 0 || to >= ids.length) return;
      e.preventDefault();
      const next = ids.filter((x) => x !== id);
      next.splice(to, 0, id);
      finish(next);
    },
  });

  return { containerRef, order, draggingId: dragId, handleProps };
}
