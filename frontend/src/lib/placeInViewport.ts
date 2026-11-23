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
  /**
   * The popover may be shorter than `size.height` (a list that scrolls): it stays below unless there is less
   * room there than it wants and more above, and `maxHeight` is the room on the chosen side
   */
  shrink?: boolean;
}

export interface Placement {
  left: number;
  top: number;
  /** Flipped above the anchor (for a menu that grows upwards) */
  above: boolean;
  /** How tall it may be: the room on the chosen side with `shrink`, else the given height */
  maxHeight: number;
}

/**
 * Place for a fixed popover of `size` at `anchor` (Doku/ui-patterns.md): below it, flipped above when it
 * would leave the window at the bottom, pushed left when it would leave it on the right, never closer than
 * 8 px to the top or left edge.
 */
export function placeInViewport(
  anchor: PopoverAnchor,
  size: { width: number; height: number },
  { gap = VIEWPORT_MARGIN, align = 'start', shift = 0, shrink = false }: PlaceOptions = {}
): Placement {
  const right = anchor.right ?? anchor.left;
  const bottom = anchor.bottom ?? anchor.top;
  let left = align === 'start' ? anchor.left + shift : right - size.width - shift;
  if (left + size.width > window.innerWidth - VIEWPORT_MARGIN) left = window.innerWidth - size.width - VIEWPORT_MARGIN;
  left = Math.max(VIEWPORT_MARGIN, left);
  if (shrink) {
    const roomBelow = window.innerHeight - VIEWPORT_MARGIN - (bottom + gap);
    const roomAbove = anchor.top - gap - VIEWPORT_MARGIN;
    const above = roomBelow < size.height && roomAbove > roomBelow;
    const maxHeight = Math.max(0, Math.min(size.height, above ? roomAbove : roomBelow));
    return { left, top: above ? anchor.top - gap - maxHeight : bottom + gap, above, maxHeight };
  }
  let top = bottom + gap;
  let above = false;
  if (top + size.height > window.innerHeight - VIEWPORT_MARGIN) {
    top = anchor.top - size.height - gap;
    above = true;
  }
  return { left, top: Math.max(VIEWPORT_MARGIN, top), above, maxHeight: size.height };
}
