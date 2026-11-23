import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

// Every notice at the bottom of the screen (Toast, StatusToast, ErrorNotice, the offline notice) goes into
// one shared stack, so two at once (an "Undo" and an error) stand one above the other instead of on top of
// each other (Doku/ui-patterns.md). The element is made on first use and made again should something have
// removed it.
let stackEl: HTMLDivElement | null = null;
export function toastStack(): HTMLDivElement {
  if (!stackEl || !stackEl.isConnected) {
    stackEl = document.createElement('div');
    stackEl.dataset.toastStack = '';
    stackEl.className =
      'fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6 z-70 w-max max-w-[calc(100vw-1.5rem)] pointer-events-none flex flex-col items-center';
    document.body.appendChild(stackEl);
  }
  return stackEl;
}

export type ToastTone = 'neutral' | 'err' | 'warn';

// The surface of a notice in the stack: elevated panel, theme corners, a frame in the tone's colour
export function toastSurface(tone: ToastTone = 'neutral'): string {
  const frame =
    tone === 'err'
      ? 'text-status-err border-status-err/60'
      : tone === 'warn'
      ? 'text-main border-status-warn/40'
      : 'text-main border-border';
  return `pointer-events-auto max-w-full mt-2 rounded-card text-xs font-medium bg-panel-elevated border shadow-panel ${frame}`;
}

export type ToastAction = { label: string; run: () => void; title?: string };
export type ToastMessage = { text: string; actions: ToastAction[] };

// How long a notice stays: longer with an action such as "Undo", so there is time to press it
export const TOAST_MS = 4000;
export const TOAST_ACTION_MS = 8000;

// A short notice, optionally with actions such as "Undo". A new one replaces the old one (its "Undo" would
// otherwise point at the wrong step).
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<number | null>(null);
  const hideToast = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast(null);
  }, []);
  const showToast = useCallback((text: string, actions: ToastAction[] = []) => {
    setToast({ text, actions });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setToast(null), actions.length ? TOAST_ACTION_MS : TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );
  return { toast, showToast, hideToast };
}

interface ToastProps {
  text: React.ReactNode;
  actions?: ToastAction[];
  // Called before an action runs and by the ×; without it there is no ×
  onClose?: () => void;
  // Show a × to close it (needs onClose)
  closable?: boolean;
  icon?: React.ReactNode;
  tone?: ToastTone;
  role?: 'status' | 'alert';
}

// A notice in the shared stack at the bottom, above the bottom navigation on phones. Text on the left (two
// lines at most on phones), actions in the accent colour on the right, 44 px high on phones.
export function Toast({ text, actions = [], onClose, closable = false, icon, tone = 'neutral', role = 'status' }: ToastProps) {
  const { t } = useTranslation();
  return createPortal(
    <div role={role} data-toast={tone} className={`${toastSurface(tone)} pl-3 ${closable ? 'pr-1' : 'pr-3'} flex items-center gap-3`}>
      {icon}
      <span className="py-2 min-w-0 max-sm:line-clamp-2">{text}</span>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          title={a.title}
          onClick={() => {
            onClose?.();
            a.run();
          }}
          className="font-semibold text-accent hover:underline min-h-[44px] sm:min-h-0 sm:py-2 shrink-0"
        >
          {a.label}
        </button>
      ))}
      {closable && onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          title={t('close')}
          className="shrink-0 -ml-2 w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-btn text-muted hover:text-main"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>,
    toastStack()
  );
}

// The notice of useToast, nothing while there is none
export function ToastHost({ toast, onClose }: { toast: ToastMessage | null; onClose: () => void }) {
  if (!toast) return null;
  return <Toast text={toast.text} actions={toast.actions} onClose={onClose} />;
}
