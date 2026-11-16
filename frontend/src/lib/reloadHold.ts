import { useEffect, useRef } from 'react';

// Work a reload for a new version would lose and that does not save itself: a recording in progress,
// dictations still waiting for their text or save, typed text in a capture field or an open task draft.
// While any holds, the app does not reload by itself (lib/useUpdateCheck.ts); the user still can.
const holders = new Set<object>();

/** Marks (or clears) a piece of unsaved work; `holder` is any object standing for it. */
export function holdReload(holder: object, active: boolean): void {
  if (active) holders.add(holder);
  else holders.delete(holder);
}

/** Whether anything holds the automatic reload back right now. */
export const reloadHeld = () => holders.size > 0;

/** Holds the automatic reload back while `active` (and the component is mounted). */
export function useHoldReload(active: boolean): void {
  const holder = useRef({});
  useEffect(() => {
    if (!active) return;
    const h = holder.current;
    holdReload(h, true);
    return () => holdReload(h, false);
  }, [active]);
}
