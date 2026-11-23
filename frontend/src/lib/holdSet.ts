import { useEffect, useRef } from 'react';

export interface HoldSet {
  /** Marks (or clears) a piece of work; `holder` is any object standing for it. */
  hold(holder: object, active: boolean): void;
  /** Whether anything holds right now. */
  held(): boolean;
  /** Holds while `active` (and the component is mounted). */
  useHold(active: boolean): void;
}

/**
 * A set of holders that keep something back while any of them is active (leaving the view, unloading the
 * page, the automatic reload for a new version). `onChange` runs after every hold or release.
 */
export function createHoldSet(onChange?: (held: boolean) => void): HoldSet {
  const holders = new Set<object>();
  const hold = (holder: object, active: boolean) => {
    if (active) holders.add(holder);
    else holders.delete(holder);
    onChange?.(holders.size > 0);
  };
  return {
    hold,
    held: () => holders.size > 0,
    useHold(active: boolean) {
      const holder = useRef({});
      useEffect(() => {
        if (!active) return;
        const h = holder.current;
        hold(h, true);
        return () => hold(h, false);
      }, [active]);
    },
  };
}
