import { useCallback, useRef } from 'react';

// A function that keeps its identity and always runs the fn of the latest render. For handlers handed to
// many memoized children (the bullets of a note): they need not render again because a handler was
// recreated. Only for event handlers, not for calls during render.
export function useLatestCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
