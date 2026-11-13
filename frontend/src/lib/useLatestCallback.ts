import { useCallback } from 'react';
import { useLatestRef } from './useLatestRef';

// A function that keeps its identity and always runs the fn of the latest render. For handlers handed to
// many memoized children (the bullets of a note): they need not render again because a handler was
// recreated. Only for event handlers, not for calls during render.
export function useLatestCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useLatestRef(fn);
  return useCallback((...args: A) => ref.current(...args), [ref]);
}
