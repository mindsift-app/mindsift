import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface PopoverPosition {
  left: number;
  // Width of the field it hangs at
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

// A popover hanging at a field (dropdown list, calendar, list of times; Doku/ui-patterns.md): fixed position
// below the field, above when there is no room, shifted left to stay on screen. Portalled to <body> by the
// caller, so a scrolling dialog does not cut it off. It follows the field while anything scrolls and closes
// on a pointer down outside field and popover.
//   wanted: the height it would like, popWidth: its width when wider than the field (stays on screen)
export function useAnchoredPopover<A extends HTMLElement>(wanted: number, popWidth = 0) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  const anchorRef = useRef<A | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const place = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < wanted && above > below;
    const width = Math.max(r.width, popWidth);
    const next: PopoverPosition = {
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width: r.width,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      maxHeight: Math.min(wanted, up ? above : below),
    };
    // Scrolling the list inside the popover (or anything else that leaves the field in place) renders nothing
    setPos((prev) => (prev && samePosition(prev, next) ? prev : next));
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  const show = () => {
    place();
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    // At most once per frame, however many scroll events come in
    let frame = 0;
    const follow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        placeRef.current();
      });
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      cancelAnimationFrame(frame);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!anchorRef.current?.contains(target) && !popRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return { open, setOpen, show, pos, anchorRef, popRef };
}

const samePosition = (a: PopoverPosition, b: PopoverPosition): boolean =>
  a.left === b.left && a.width === b.width && a.top === b.top && a.bottom === b.bottom && a.maxHeight === b.maxHeight;

// Touch as the main pointer (phones, tablets): date and time use the system's own picker there
export const isTouchPointer = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
