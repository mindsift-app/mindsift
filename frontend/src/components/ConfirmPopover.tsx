import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { placeInViewport } from '../lib/placeInViewport';
import { useDismiss } from '../lib/useDismiss';

interface ConfirmPopoverProps {
  // Where the click was (clientX/clientY); the popover opens right there, kept inside the window
  x: number;
  y: number;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // A second way out next to the main one (e.g. "Link entfernen" next to "Anlegen"); replaces "Abbrechen"
  altLabel?: string;
  onAlt?: () => void;
}

// Small confirmation right at the mouse (Doku/ui-patterns.md): Enter or the button confirms, Escape, a
// click outside or "Abbrechen" closes it.
export const ConfirmPopover: React.FC<ConfirmPopoverProps> = ({ x, y, message, confirmLabel, danger, onConfirm, onCancel, altLabel, onAlt }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });

  // Below and right of the pointer; flipped above or to the left when it would leave the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { left, top } = placeInViewport({ left: x, top: y }, el.getBoundingClientRect(), { shift: -12 });
    setPos({ left, top, ready: true });
    confirmRef.current?.focus();
  }, [x, y]);

  useDismiss(ref, onCancel);

  return createPortal(
    <div
      ref={ref}
      role="alertdialog"
      aria-modal="false"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      className="fixed z-70 w-72 max-w-[calc(100vw-1rem)] p-3 bg-panel border border-border rounded-card shadow-panel text-xs text-main space-y-3"
    >
      <div className="leading-snug">{message}</div>
      <div className="flex flex-wrap justify-end gap-2">
        {/* With a second way out, two buttons are enough: Escape or a click outside cancels */}
        {altLabel && onAlt ? null : (
          <button type="button" onClick={onCancel} className="btn-action h-11 sm:h-8 px-3 text-xs">
            {t('common:cancel')}
          </button>
        )}
        {altLabel && onAlt && (
          <button type="button" onClick={onAlt} className="btn-action h-11 sm:h-8 px-3 text-xs">
            {altLabel}
          </button>
        )}
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className={`h-11 sm:h-8 px-3 text-xs font-semibold rounded-btn border transition-colors ${
            danger
              ? 'bg-status-err/15 text-status-err border-status-err/50 hover:bg-status-err/25'
              : 'btn-primary'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body
  );
};
