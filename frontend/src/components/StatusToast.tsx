import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, X } from 'lucide-react';

export type StatusMessage = { type: 'ok' | 'err'; text: string };

// How long a confirmation stays; an error stays until it is closed
const OK_MS = 4000;

// The answer to a save in the settings ("Gespeichert", or what went wrong) as a notice at the bottom of the
// screen, above the page instead of in it, so nothing below moves (Doku/ui-patterns.md). The live regions
// stay mounted, so screen readers announce every new message: confirmations politely, errors at once.
export function StatusToast({ msg, onClose }: { msg: StatusMessage | null; onClose: () => void }) {
  const { t } = useTranslation();

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
        className={`pointer-events-auto max-w-full pl-3 pr-1 rounded-card text-xs font-medium bg-panel-elevated border shadow-panel flex items-center gap-2 ${
          type === 'ok' ? 'text-main border-border' : 'text-status-err border-status-err/60'
        }`}
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

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6 z-70 w-max max-w-[calc(100vw-1.5rem)] pointer-events-none">
      <div role="status" aria-live="polite">
        {notice('ok')}
      </div>
      <div role="alert" aria-live="assertive">
        {notice('err')}
      </div>
    </div>
  );
}
