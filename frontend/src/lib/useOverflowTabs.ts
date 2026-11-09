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

  // After every render (titles, counters and members change the widths); only a real change re-renders
  useLayoutEffect(() => {
    measure();
  });
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(row);
    return () => ro.disconnect();
  }, [measure]);

  const tabRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) tabs.current.set(id, el);
      else tabs.current.delete(id);
    },
    []
  );
  const hiddenSet = new Set(hidden);
  return { rowRef, moreRef, tabRef, hidden, isHidden: (id: string) => hiddenSet.has(id) };
}
