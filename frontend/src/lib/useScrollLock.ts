import { useEffect } from 'react';

// While a dialog is open the page behind it does not scroll: neither the app's scroll area nor the
// document. The scrollbar that disappears is made up for with padding, so nothing shifts sideways.
// Nested dialogs count; the last one to close unlocks.
let locks = 0;
let restore: (() => void) | null = null;

function lock() {
  locks++;
  if (locks > 1) return;
  const targets = [document.querySelector<HTMLElement>('[data-app-scroll]'), document.documentElement].filter(
    (el): el is HTMLElement => !!el
  );
  const saved = targets.map((el) => ({ el, overflow: el.style.overflow, paddingRight: el.style.paddingRight }));
  for (const el of targets) {
    const bar = el === document.documentElement ? window.innerWidth - el.clientWidth : el.offsetWidth - el.clientWidth;
    if (bar > 0) el.style.paddingRight = `${parseFloat(getComputedStyle(el).paddingRight) + bar}px`;
    el.style.overflow = 'hidden';
  }
  restore = () => {
    for (const s of saved) {
      s.el.style.overflow = s.overflow;
      s.el.style.paddingRight = s.paddingRight;
    }
  };
}

function unlock() {
  locks = Math.max(0, locks - 1);
  if (locks === 0 && restore) {
    restore();
    restore = null;
  }
}

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}
