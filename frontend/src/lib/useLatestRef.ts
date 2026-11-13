import { useRef } from 'react';

// A ref that holds the value of the latest render, for listeners, timers and effects that live longer than
// one render and must not start over when the value changes. Read it in those, not during render.
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  // Written during render on purpose (react-hooks/refs): handlers that run before this render's effects,
  // e.g. a key press right after a change, already see the new value
  // eslint-disable-next-line react-hooks/refs
  ref.current = value;
  return ref;
}
