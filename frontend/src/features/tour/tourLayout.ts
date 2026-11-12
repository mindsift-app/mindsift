// Where the tour's card goes, as plain geometry (GuidedTour.tsx measures, this decides)

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CardSide = 'below' | 'above' | 'right' | 'left' | 'inside' | 'center' | 'dock-top' | 'dock-bottom';

export interface CardPlacement {
  left: number;
  top: number;
  side: CardSide;
  // Arrow from the card towards the target: offset along the card's edge facing it (adjacent sides only)
  arrow: number | null;
}

const GAP = 14; // between target and card
const MARGIN = 12; // to the window's edge

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// Desktop: next to the target (below, above, right or left, whichever fits first; tall targets try the sides
// first); a target too big for any of them gets the card inside its lower right corner. Without a target:
// in the middle.
export function placeCard(target: Box | null, card: { width: number; height: number }, vw: number, vh: number): CardPlacement {
  const { width: w, height: h } = card;
  if (!target) return { left: (vw - w) / 2, top: Math.max(MARGIN, (vh - h) / 2), side: 'center', arrow: null };
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const hLeft = clamp(cx - w / 2, MARGIN, vw - w - MARGIN);
  const vTop = clamp(cy - h / 2, MARGIN, vh - h - MARGIN);
  const arrowX = clamp(cx - hLeft, 18, w - 18);
  const arrowY = clamp(cy - vTop, 18, h - 18);
  const options: Record<'below' | 'above' | 'right' | 'left', CardPlacement & { fits: boolean }> = {
    below: { left: hLeft, top: bottom + GAP, side: 'below', arrow: arrowX, fits: bottom + GAP + h <= vh - MARGIN },
    above: { left: hLeft, top: target.top - GAP - h, side: 'above', arrow: arrowX, fits: target.top - GAP - h >= MARGIN },
    right: { left: right + GAP, top: vTop, side: 'right', arrow: arrowY, fits: right + GAP + w <= vw - MARGIN },
    left: { left: target.left - GAP - w, top: vTop, side: 'left', arrow: arrowY, fits: target.left - GAP - w >= MARGIN },
  };
  const order: (keyof typeof options)[] =
    target.height > vh * 0.45 ? ['right', 'left', 'below', 'above'] : ['below', 'above', 'right', 'left'];
  for (const side of order) {
    const { fits, ...placement } = options[side];
    if (fits) return placement;
  }
  // No side has room for the whole card: at the window's edge beside the target, over as little of it as
  // possible, its bottom at the target's bottom (the top of a big area usually matters most)
  const roomRight = vw - right - MARGIN;
  const roomLeft = target.left - MARGIN;
  if (Math.max(roomRight, roomLeft) >= w / 2) {
    return {
      left: roomRight >= roomLeft ? vw - w - MARGIN : MARGIN,
      top: clamp(bottom - h, MARGIN, vh - h - MARGIN),
      side: roomRight >= roomLeft ? 'right' : 'left',
      arrow: null,
    };
  }
  return {
    left: clamp(right - w - 16, MARGIN, vw - w - MARGIN),
    top: clamp(bottom - h - 16, MARGIN, vh - h - MARGIN),
    side: 'inside',
    arrow: null,
  };
}

// Phones: the card spans the width and docks at the bottom (above controls lit at the bottom edge, such as
// the + of the navigation) or at the top (below controls lit at the top), whichever covers less of the target
export function dockCard(target: Box | null, lit: Box[], cardHeight: number, vh: number): CardPlacement {
  const left = MARGIN;
  const atBottom = lit.filter((b) => b.top > vh * 0.75);
  const atTop = lit.filter((b) => b.top + b.height < vh * 0.2);
  const bottomEdge = atBottom.length ? Math.min(...atBottom.map((b) => b.top)) - GAP : vh - MARGIN;
  const topEdge = atTop.length ? Math.max(...atTop.map((b) => b.top + b.height)) + GAP : MARGIN;
  const bottomTop = Math.max(MARGIN, bottomEdge - cardHeight);
  const topTop = Math.min(topEdge, Math.max(MARGIN, vh - MARGIN - cardHeight));
  if (!target) return { left, top: bottomTop, side: 'dock-bottom', arrow: null };
  const t0 = target.top;
  const t1 = target.top + target.height;
  const coverBottom = overlap(bottomTop, bottomTop + cardHeight, t0, t1);
  const coverTop = overlap(topTop, topTop + cardHeight, t0, t1);
  return coverTop < coverBottom
    ? { left, top: topTop, side: 'dock-top', arrow: null }
    : { left, top: bottomTop, side: 'dock-bottom', arrow: null };
}

export const TOUR_MARGIN = MARGIN;
