import { useLayoutEffect, useRef, useState } from 'react';
import { useLatestRef } from './useLatestRef';
import { useDismiss } from './useDismiss';
import { placeInViewport } from './placeInViewport';

// Space between the field and its popover
const POPOVER_GAP = 4;

export interface PopoverPosition {
  left: number;
  // Width of the field it hangs at
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

// A popover hanging at a field (dropdown list, calendar, list of times; Doku/ui-patterns.md), placed with
// placeInViewport (shrink: it gets shorter rather than leave the window): fixed position
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
    const p = placeInViewport(r, { width: Math.max(r.width, popWidth), height: wanted }, { gap: POPOVER_GAP, shrink: true });
    const next: PopoverPosition = {
      left: p.left,
      width: r.width,
      // Above the field it hangs at its bottom edge, so a list shorter than wanted still touches the field
      ...(p.above ? { bottom: window.innerHeight - r.top + POPOVER_GAP } : { top: p.top }),
      maxHeight: p.maxHeight,
    };
    // Scrolling the list inside the popover (or anything else that leaves the field in place) renders nothing
    setPos((prev) => (prev && samePosition(prev, next) ? prev : next));
  };
  const placeRef = useLatestRef(place);

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
  }, [open, placeRef]);

  // The field's own keys close the list or calendar first (the dialog around it stays); a press beside it only
  // closes it (lib/useDismiss.ts)
  useDismiss([anchorRef, popRef], () => setOpen(false), { active: open });

  return { open, setOpen, show, pos, anchorRef, popRef };
}

const samePosition = (a: PopoverPosition, b: PopoverPosition): boolean =>
  a.left === b.left && a.width === b.width && a.top === b.top && a.bottom === b.bottom && a.maxHeight === b.maxHeight;

// Touch as the main pointer (phones, tablets): date and time use the system's own picker there
export const isTouchPointer = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
