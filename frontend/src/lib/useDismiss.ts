import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useLatestRef } from './useLatestRef';

type Inside = RefObject<Element | null> | Element | null | undefined;

export interface DismissOptions {
  /** Listens only while true (an open menu) */
  active?: boolean;
  /** Escape closes too: true always, 'unhandled' only when nothing inside took it (default prevented), false never */
  escape?: boolean | 'unhandled';
  /** The press that counts as outside: pointerdown (default) or mousedown (fires after a tap, not at its start) */
  event?: 'pointerdown' | 'mousedown';
}

/**
 * Closes a popover or menu on a press outside of `inside` (its box, and e.g. the button it opens from) and on
 * Escape (Doku/ui-patterns.md). `onClose` may change from render to render.
 */
export function useDismiss(inside: Inside | Inside[], onClose: () => void, { active = true, escape = true, event = 'pointerdown' }: DismissOptions = {}) {
  const insideRef = useLatestRef(inside);
  const closeRef = useLatestRef(onClose);
  useEffect(() => {
    if (!active) return;
    const contains = (target: Node) =>
      ([] as Inside[]).concat(insideRef.current).some((i) => {
        const el = i && 'current' in i ? i.current : i;
        return !!el && el.contains(target);
      });
    const onDown = (e: Event) => {
      if (!contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !escape || (escape === 'unhandled' && e.defaultPrevented)) return;
      closeRef.current();
    };
    document.addEventListener(event, onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener(event, onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [active, escape, event, insideRef, closeRef]);
}
