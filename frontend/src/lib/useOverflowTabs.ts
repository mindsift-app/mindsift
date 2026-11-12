import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Classes of a tab that does not fit: out of the row's flow and invisible (not focusable either), but still
// laid out, so its width can be measured. The tab must not carry "relative" then (it would win over absolute).
export const OVERFLOW_HIDDEN_TAB = 'absolute invisible pointer-events-none';

// A row of tabs that never wraps: the tabs that fit stay in order, the rest goes behind a "more" button.
// The open tab always keeps its place. Fixed parts of the row ("Alle Aufgaben", "Neue Liste") carry
// data-tab-fixed; the more button is always rendered (hidden while nothing overflows) so it can be measured.
export function useOverflowTabs(ids: string[], activeId: string | null) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const tabs = useRef(new Map<string, HTMLElement>());
  const [hidden, setHidden] = useState<string[]>([]);
  const idsKey = ids.join('|');

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    let available = row.clientWidth;
    row.querySelectorAll<HTMLElement>(':scope > [data-tab-fixed]').forEach((el) => {
      available -= el.offsetWidth + gap;
    });
    const list = idsKey ? idsKey.split('|') : [];
    const widths = list.map((id) => (tabs.current.get(id)?.offsetWidth ?? 0) + gap);
    let next: string[] = [];
    if (widths.reduce((a, w) => a + w, 0) > available + 0.5) {
      let budget = available - ((moreRef.current?.offsetWidth ?? 0) + gap);
      const activeIdx = activeId ? list.indexOf(activeId) : -1;
      if (activeIdx >= 0) budget -= widths[activeIdx];
      const shown = new Set(activeIdx >= 0 ? [list[activeIdx]] : []);
      for (let i = 0; i < list.length; i++) {
        if (i === activeIdx) continue;
        if (widths[i] > budget) break; // keep the order: no smaller tab jumps in after a gap
        budget -= widths[i];
        shown.add(list[i]);
      }
      next = list.filter((id) => !shown.has(id));
    }
    setHidden((prev) => (prev.join('|') === next.join('|') ? prev : next));
  }, [idsKey, activeId]);

  // Measured when the tabs change and whenever the row, a tab, a fixed part or the more button changes its
  // size (titles, counters, members). Not after every render: reading the widths right after a render
  // makes the browser lay out the whole page at once, which with a long task list below cost more than
  // the render itself (e.g. opening a task's dialog).
  const observer = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(row);
    row.querySelectorAll<HTMLElement>(':scope > [data-tab-fixed]').forEach((el) => ro.observe(el));
    if (moreRef.current) ro.observe(moreRef.current);
    tabs.current.forEach((el) => ro.observe(el));
    observer.current = ro;
    return () => {
      ro.disconnect();
      observer.current = null;
    };
  }, [measure]);

  const tabRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      const before = tabs.current.get(id);
      if (before && before !== el) observer.current?.unobserve(before);
      if (el) {
        tabs.current.set(id, el);
        observer.current?.observe(el);
      } else tabs.current.delete(id);
    },
    []
  );
  const hiddenSet = new Set(hidden);
  return { rowRef, moreRef, tabRef, hidden, isHidden: (id: string) => hiddenSet.has(id) };
}
