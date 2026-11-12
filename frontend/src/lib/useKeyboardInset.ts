import type React from 'react';
import { useEffect, useState } from 'react';

// Tallest visible height seen at the current width, i.e. the height without keyboard. Tracked from app
// start, so it is known before the first field is focused; a new width (rotation) starts over.
let fullHeight = 0;
let fullWidth = 0;
function noteFullHeight() {
  const vv = window.visualViewport;
  if (!vv) return;
  if (window.innerWidth !== fullWidth) {
    fullWidth = window.innerWidth;
    fullHeight = 0;
  }
  fullHeight = Math.max(fullHeight, Math.round(vv.height));
}
if (typeof window !== 'undefined' && window.visualViewport) {
  noteFullHeight();
  window.visualViewport.addEventListener('resize', noteFullHeight);
}

// More than browser bars appearing or disappearing (about 60 px)
const KEYBOARD_MIN_PX = 150;

// Space the on-screen keyboard takes at the bottom (0 without keyboard), the height that stays visible
// and whether a keyboard is open. Fixed bottom sheets use the inset to sit right above the keyboard
// instead of behind it (iOS keeps fixed elements on the layout viewport; on Android the inset is usually
// 0 because the page shrinks). keyboardOpen compares with the height without keyboard, so it works in
// both cases; without visualViewport it is unknown and reported as open.
export function useKeyboardInset(): { inset: number; visibleHeight: number; keyboardOpen: boolean } {
  const read = () => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return { inset: 0, visibleHeight: typeof window !== 'undefined' ? window.innerHeight : 0, keyboardOpen: true };
    noteFullHeight();
    const visibleHeight = Math.round(vv.height);
    return {
      inset: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
      visibleHeight,
      keyboardOpen: visibleHeight < fullHeight - KEYBOARD_MIN_PX,
    };
  };
  const [state, setState] = useState(read);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setState(read());
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return state;
}

const isField = (el: Element | null): el is HTMLElement =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

/**
 * Room for the on-screen keyboard on full-height pages that center a form (sign-in, setup): Android only
 * shrinks the visible part, so the form stayed where it was and the keyboard covered the lower fields.
 * While the keyboard is open the page gets its height as padding at the bottom, and the focused field is
 * scrolled into the visible part (again when the focus moves on). Returns the style for the page.
 */
export function useKeyboardRoom(): React.CSSProperties | undefined {
  const { inset, keyboardOpen } = useKeyboardInset();
  const open = keyboardOpen && inset > 0;
  useEffect(() => {
    if (!open) return;
    const reveal = () => {
      const el = document.activeElement;
      if (isField(el)) requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }));
    };
    reveal();
    document.addEventListener('focusin', reveal);
    return () => document.removeEventListener('focusin', reveal);
  }, [open, inset]);
  return open ? { paddingBottom: inset + 16 } : undefined;
}
