import { useEffect, useRef, useState } from 'react';
import { isPhoneWidth } from '../../lib/breakpoints';

// Desktop: a wheel step down over the background (the tab row, the margins beside and below the workspace)
// pushes the tab row (notes, to-dos, hashtags) out at the top and snaps, so the note fills the whole area,
// like the bar above the Kanban board; a step up brings it back. Over the note and the folder sidebar the
// wheel only scrolls them. The workspace is higher than the app's scroll area by the row (wsBar); that
// area stays overflow-hidden and is only scrolled from here.
export function useTabRowSnap(focusMode: boolean) {
  const workspaceRootRef = useRef<HTMLDivElement>(null);
  const tabRowRef = useRef<HTMLDivElement>(null);
  const [wsBar, setWsBar] = useState(0);
  useEffect(() => {
    const row = tabRowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    // offsetHeight is 0 on phones (the row is hidden there); 12 px is the gap below it
    const measure = () => setWsBar(row.offsetHeight ? row.offsetHeight + 12 : 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const root = workspaceRootRef.current;
    const area = root?.closest<HTMLElement>('[data-app-scroll]');
    if (!root || !area || !wsBar || focusMode) return;
    let pending = 0; // trackpads send many small steps: move only once they add up
    let lockedUntil = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || isPhoneWidth()) return;
      if ((e.target as HTMLElement).closest?.('[data-ws-pane]')) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (dy === 0) return;
      const max = area.scrollHeight - area.clientHeight;
      if (dy > 0 ? area.scrollTop >= max - 1 : area.scrollTop <= 0) return;
      e.preventDefault();
      if (Date.now() < lockedUntil) return;
      pending += dy;
      if (Math.abs(pending) < 40) return;
      pending = 0;
      lockedUntil = Date.now() + 450;
      area.scrollTo({ top: dy > 0 ? max : 0, behavior: 'smooth' });
    };
    // While the row slides out, the split pane grows into the freed room (the spacer below it shrinks), so the
    // pane always ends at the bottom of the window: its last bits (like the trash) stay visible from the start
    const onScroll = () => root.style.setProperty('--ws-scroll', `${area.scrollTop}px`);
    onScroll();
    area.addEventListener('wheel', onWheel, { passive: false });
    area.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      area.removeEventListener('wheel', onWheel);
      area.removeEventListener('scroll', onScroll);
    };
  }, [wsBar, focusMode]);

  return { workspaceRootRef, tabRowRef, wsBar };
}
