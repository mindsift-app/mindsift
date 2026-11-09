import type React from 'react';

// Fully transparent image: replaces the browser's own drag image, which is a nearly opaque snapshot that
// hides what lies under the pointer
const EMPTY = typeof Image !== 'undefined' ? new Image() : null;
if (EMPTY) EMPTY.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Hides the browser's drag image; false where setDragImage is missing (then the browser's image stays)
export function hideBrowserDragImage(e: React.DragEvent): boolean {
  if (typeof e.dataTransfer.setDragImage !== 'function') return false;
  if (EMPTY) e.dataTransfer.setDragImage(EMPTY, 0, 0);
  return true;
}

// Lets a fixed element follow the pointer during an HTML5 drag (offset from the pointer), trailing a
// little, and fades it out when the drag ends. dragover carries the pointer position in every engine (the
// drag event itself reports 0/0 in Firefox).
export function followDragPointer(e: React.DragEvent, ghost: HTMLElement, offsetX: number, offsetY: number) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let target = { x: e.clientX + offsetX, y: e.clientY + offsetY };
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

  const onOver = (ev: DragEvent) => {
    target = { x: ev.clientX + offsetX, y: ev.clientY + offsetY };
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
    if (reduce || typeof ghost.animate !== 'function') {
      ghost.remove();
      return;
    }
    ghost
      .animate([{ opacity: ghost.style.opacity || 1 }, { opacity: 0, transform: `${ghost.style.transform} scale(0.96)` }], {
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

// The dragged element itself, half transparent, follows the pointer where it was grabbed: what lies under
// it (a list tab, a column) stays visible.
export function startElementDragGhost(e: React.DragEvent, el: HTMLElement, opacity = 0.55) {
  if (!hideBrowserDragImage(e)) return;
  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.style.cssText +=
    `;position:fixed;left:0;top:0;margin:0;width:${rect.width}px;height:${rect.height}px;opacity:${opacity};` +
    'pointer-events:none;z-index:9999;will-change:transform;box-shadow:var(--shadow-panel, 0 8px 24px rgba(0,0,0,.25))';
  document.body.appendChild(ghost);
  followDragPointer(e, ghost, rect.left - e.clientX, rect.top - e.clientY);
}
