// Room kept between a popover and the window's edges
export const VIEWPORT_MARGIN = 8;

/** Where a popover hangs: a point (a click) or an element's rectangle. */
export interface PopoverAnchor {
  left: number;
  top: number;
  right?: number;
  bottom?: number;
}

export interface PlaceOptions {
  /** Space between anchor and popover (default 8) */
  gap?: number;
  /** 'start': the popover's left edge at the anchor's left; 'end': its right edge at the anchor's right */
  align?: 'start' | 'end';
  /** Moves the popover that many pixels away from the aligned edge, towards its inside (negative: outwards) */
  shift?: number;
}

/**
 * Place for a fixed popover of `size` at `anchor` (Doku/ui-patterns.md): below it, flipped above when it
 * would leave the window at the bottom, pushed left when it would leave it on the right, never closer than
 * 8 px to the top or left edge. `above` tells whether it was flipped (for a menu that grows upwards).
 */
export function placeInViewport(
  anchor: PopoverAnchor,
  size: { width: number; height: number },
  { gap = VIEWPORT_MARGIN, align = 'start', shift = 0 }: PlaceOptions = {}
): { left: number; top: number; above: boolean } {
  const right = anchor.right ?? anchor.left;
  const bottom = anchor.bottom ?? anchor.top;
  let left = align === 'start' ? anchor.left + shift : right - size.width - shift;
  let top = bottom + gap;
  let above = false;
  if (left + size.width > window.innerWidth - VIEWPORT_MARGIN) left = window.innerWidth - size.width - VIEWPORT_MARGIN;
  if (top + size.height > window.innerHeight - VIEWPORT_MARGIN) {
    top = anchor.top - size.height - gap;
    above = true;
  }
  return { left: Math.max(VIEWPORT_MARGIN, left), top: Math.max(VIEWPORT_MARGIN, top), above };
}
