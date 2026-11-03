import { useEffect, useRef } from 'react';
import { ActiveTab } from './appTabs';

// Each page keeps its scroll position when switching pages. The new page is often still loading and
// shorter than before: the position comes back as soon as the content is high enough (or the user
// scrolls first, or after 3 s). Scroll events meanwhile do not count as the page's position.
// Returns the ref of the scroll area under the header (desktop; phones keep the window scroll).
export function useScrollPositions(activeTab: ActiveTab, userId: string | undefined) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Partial<Record<ActiveTab, number>>>({});
  useEffect(() => {
    const area = scrollAreaRef.current;
    if (!area) return;
    const target = scrollPositionsRef.current[activeTab] ?? 0;
    let restoring = true;
    let observer: ResizeObserver | null = null;
    const finish = () => {
      if (!restoring) return;
      restoring = false;
      observer?.disconnect();
      window.clearTimeout(timeout);
      area.removeEventListener('wheel', finish);
      area.removeEventListener('pointerdown', finish);
      area.removeEventListener('keydown', finish);
    };
    const tryRestore = () => {
      area.scrollTop = target;
      if (Math.abs(area.scrollTop - target) < 2) finish();
    };
    const timeout = window.setTimeout(finish, 3000);
    area.addEventListener('wheel', finish, { passive: true });
    area.addEventListener('pointerdown', finish);
    area.addEventListener('keydown', finish);
    tryRestore();
    if (restoring && typeof ResizeObserver !== 'undefined' && area.firstElementChild) {
      observer = new ResizeObserver(tryRestore);
      observer.observe(area.firstElementChild);
    }
    const onScroll = () => {
      if (!restoring) scrollPositionsRef.current[activeTab] = area.scrollTop;
    };
    area.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      finish();
      area.removeEventListener('scroll', onScroll);
    };
  }, [activeTab, userId]);
  return scrollAreaRef;
}
