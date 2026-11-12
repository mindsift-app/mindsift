import React, { useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { SharedList, Thought } from '../lib/types';
import { isPhoneWidth } from '../lib/breakpoints';
import { CaptureTarget, InstantCaptureBar } from '../features/capture/InstantCaptureBar';

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

interface QuickDumpWindowProps {
  open: boolean;
  onClose: () => void;
  onCaptured: (thought: Thought, target?: CaptureTarget) => void;
  lists: SharedList[];
  // Counts up on every opening: the field takes the focus
  focusTrigger: number;
}

// Desktop: the Quick Dump as a window at the top centre over everything, the page dimmed behind it (like a
// spotlight search). It stays mounted while closed, so the chosen target and an unfinished text are still
// there next time. After sending it stays open for the next thought (the bar confirms each one); Escape or a
// click beside it closes it.
export function QuickDumpWindow({ open, onClose, onCaptured, lists, focusTrigger }: QuickDumpWindowProps) {
  const { t } = useTranslation('app');

  useEffect(() => {
    if (!open) return;
    // A calendar or menu inside the bar closes first (they prevent the default of their Escape)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={`${open ? 'hidden sm:flex' : 'hidden'} fixed inset-0 z-[60] items-start justify-center px-4 pt-[14vh] bg-black/45 backdrop-blur-[2px] animate-in fade-in duration-150`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('quickDump.title')}
        data-quick-dump
        className="w-full max-w-xl p-3 rounded-card bg-panel border border-border shadow-panel animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-150"
      >
        <InstantCaptureBar onCaptured={onCaptured} lists={lists} autoFocusTrigger={focusTrigger} />
        <p className="mt-2 px-1 text-[11px] text-faint">
          <Trans
            t={t}
            i18nKey="quickDump.hint"
            components={{ kbd: <kbd className="px-1 py-px rounded-btn bg-panel-elevated border border-border font-mono text-[10px] text-muted" /> }}
          />
        </p>
      </div>
    </div>
  );
}
