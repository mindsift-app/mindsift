import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toastStack, toastSurface } from './Toast';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, X } from 'lucide-react';
import { useLatestRef } from '../lib/useLatestRef';

export type StatusMessage = { type: 'ok' | 'err'; text: string };

// How long a confirmation stays; an error stays until it is closed
const OK_MS = 4000;

// The state of a notice for StatusToast, kept where it outlives the notice (a hook of the view): a
// confirmation expires after its few seconds here, also while no notice shows it, so a save that ends
// after the section was left never greets the way back with an old "Gespeichert". An error stays until it
// is closed or replaced.
export function useStatusMessage<T extends { type: StatusMessage['type'] }>() {
  const [msg, setMsg] = useState<T | null>(null);
  useEffect(() => {
    if (msg?.type !== 'ok') return;
    // Only this confirmation: a newer message keeps its own time
    const timer = window.setTimeout(() => setMsg((cur) => (cur === msg ? null : cur)), OK_MS);
    return () => window.clearTimeout(timer);
  }, [msg]);
  return [msg, setMsg] as const;
}

// The answer to a save in the settings ("Gespeichert", or what went wrong) as a notice at the bottom of the
// screen, above the page instead of in it, so nothing below moves (Doku/ui-patterns.md). The live regions
// stay mounted, so screen readers announce every new message: confirmations politely, errors at once.
export function StatusToast({ msg, onClose }: { msg: StatusMessage | null; onClose: () => void }) {
  const { t } = useTranslation();
  const msgRef = useLatestRef(msg);
  const onCloseRef = useLatestRef(onClose);

  // Leaving the section ends a confirmation: its state often lives in the view, and it would otherwise
  // show again on the way back. An error stays until it is closed.
  useEffect(
    () => () => {
      if (msgRef.current?.type === 'ok') onCloseRef.current();
    },
    // the refs are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (msg?.type !== 'ok') return;
    const timer = window.setTimeout(onClose, OK_MS);
    return () => window.clearTimeout(timer);
    // A new message (a new object) starts the time again; onClose is often a new function each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg]);

  const notice = (type: StatusMessage['type']) =>
    msg?.type === type && (
      <div
        data-status-toast={type}
        className={`${toastSurface(type === 'ok' ? 'neutral' : 'err')} pl-3 pr-1 flex items-center gap-2`}
      >
        {type === 'ok' ? (
          <Check className="w-4 h-4 text-accent shrink-0" />
        ) : (
          <CircleAlert className="w-4 h-4 shrink-0" />
        )}
        <span className="py-2 min-w-0">{msg.text}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          title={t('close')}
          className="shrink-0 w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-btn text-muted hover:text-main"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );

  return createPortal(
    <>
      <div role="status" aria-live="polite" className="max-w-full">
        {notice('ok')}
      </div>
      <div role="alert" aria-live="assertive" className="max-w-full">
        {notice('err')}
      </div>
    </>,
    toastStack()
  );
}
