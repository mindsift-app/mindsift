import { useEffect } from 'react';
import { isPhoneWidth } from '../lib/breakpoints';

// Desktop: a bare "c" opens the Quick Dump (not while typing, not Ctrl/Cmd+C, which copies). Phones have the
// + of the bottom bar instead.
export function useQuickDumpShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'c' && e.key !== 'C') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (isPhoneWidth()) return;
      // Another window on top (drawing editor, dialogs): the key belongs to it
      if (document.querySelector('[aria-modal="true"]:not([data-quick-dump])')) return;
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}
