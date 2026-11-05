import type React from 'react';
import { DocumentBlock } from '../../lib/types';

const MAX_ROWS = 8;
const STRIPE_H = 9;
const STRIPE_GAP = 5;
const INDENT = 14;
// Ghost sits right of and slightly above the pointer, so the drop line under the pointer stays visible
const OFFSET_X = 16;
const OFFSET_Y = -6;

// Fully transparent image: the browser's own drag image is replaced by the ghost below
const EMPTY = typeof Image !== 'undefined' ? new Image() : null;
if (EMPTY) EMPTY.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function stripeWidth(block: DocumentBlock): number {
  const len = (block.content || '').split('\n')[0].trim().length;
  return Math.max(28, Math.min(220, len * 5.5));
}

// The browser's drag image is a static snapshot of the small bullet, easy to miss. Instead the dragged
// branch follows the pointer as a stack of rounded stripes, one per row and indented like in the note.
// They take the text colour at low opacity (light on dark themes, dark on light ones), build up one after
// another, trail the pointer a little and fade out when the drag ends.
export function startBranchDragGhost(e: React.DragEvent, branch: DocumentBlock[]) {
  if (!branch.length || typeof e.dataTransfer.setDragImage !== 'function') return;
  if (EMPTY) e.dataTransfer.setDragImage(EMPTY, 0, 0);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const base = Math.max(0, branch[0].level || 0);

  const ghost = document.createElement('div');
  ghost.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:9999;will-change:transform;color:var(--text-main)';
  document.body.appendChild(ghost);
  // Dark text (light themes) weighs more than light text at the same opacity, so it gets less of it
  const [r, g, b] = (getComputedStyle(ghost).color.match(/[\d.]+/g) || ['255', '255', '255']).map(Number);
  const darkText = 0.299 * r + 0.587 * g + 0.114 * b < 128;
  branch.slice(0, MAX_ROWS).forEach((block, i) => {
    const stripe = document.createElement('div');
    const strength = darkText ? (i === 0 ? 14 : 8) : i === 0 ? 22 : 13;
    stripe.style.cssText =
      `height:${STRIPE_H}px;margin-top:${i ? STRIPE_GAP : 0}px;border-radius:${STRIPE_H}px;transform-origin:left center;` +
      `margin-left:${Math.max(0, (block.level || 0) - base) * INDENT}px;width:${stripeWidth(block)}px;` +
      `background:color-mix(in srgb, var(--text-main) ${strength}%, transparent)`;
    // Rows past the limit fade out instead of being cut off hard
    if (branch.length > MAX_ROWS && i >= MAX_ROWS - 2) stripe.style.opacity = i === MAX_ROWS - 1 ? '0.35' : '0.7';
    ghost.appendChild(stripe);
    if (!reduce) {
      stripe.animate(
        [
          { opacity: 0, transform: 'translateY(-4px) scaleX(0.4)' },
          { opacity: stripe.style.opacity || 1, transform: 'none' },
        ],
        { duration: 220, delay: i * 28, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' }
      );
    }
  });

  let target = { x: e.clientX + OFFSET_X, y: e.clientY + OFFSET_Y };
  const pos = { ...target };
  let frame = 0;
  const place = () => {
    ghost.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
  };
  const step = () => {
    pos.x += (target.x - pos.x) * 0.35;
    pos.y += (target.y - pos.y) * 0.35;
    place();
    frame = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y) > 0.3 ? requestAnimationFrame(step) : 0;
  };
  place();

  // dragover carries the pointer position in every engine (the drag event itself reports 0/0 in Firefox)
  const onOver = (ev: DragEvent) => {
    target = { x: ev.clientX + OFFSET_X, y: ev.clientY + OFFSET_Y };
    if (reduce) {
      Object.assign(pos, target);
      place();
    } else if (!frame) {
      frame = requestAnimationFrame(step);
    }
  };
  const onEnd = () => {
    document.removeEventListener('dragover', onOver, true);
    document.removeEventListener('dragend', onEnd, true);
    document.removeEventListener('drop', onEnd, true);
    cancelAnimationFrame(frame);
    if (reduce) {
      ghost.remove();
      return;
    }
    ghost
      .animate([{ opacity: 1 }, { opacity: 0, transform: `${ghost.style.transform} scale(0.96)` }], {
        duration: 160,
        easing: 'ease-out',
        fill: 'forwards',
      })
      .finished.finally(() => ghost.remove());
  };
  document.addEventListener('dragover', onOver, true);
  document.addEventListener('dragend', onEnd, true);
  document.addEventListener('drop', onEnd, true);
}
