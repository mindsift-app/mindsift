import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import type { UpdateState } from '../lib/useUpdateCheck';

// The server got a new MindSift (lib/useUpdateCheck): the app reloads by itself. No "later": the notice
// only says when, and the button does it at once. At the top, clear of the offline banner and error notices.
export const UpdateReloadNotice: React.FC<{ update: UpdateState; onReloadNow: () => void }> = ({ update, onReloadNow }) => {
  const { t } = useTranslation();
  const stuck = update.phase === 'stuck';
  const text =
    update.phase === 'countdown'
      ? t('update.countdown', { seconds: update.secondsLeft })
      : update.phase === 'waiting'
      ? t('update.waitTyping')
      : update.phase === 'held'
      ? t('update.held')
      : update.phase === 'saving'
      ? t('update.saving')
      : update.phase === 'offline'
      ? t('update.offline')
      : t('update.stuck');
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 top-[calc(0.75rem+env(safe-area-inset-top))] z-80 w-max max-w-[calc(100vw-1.5rem)]"
    >
      <div className="panel-elevated shadow-panel px-3 py-2 flex items-center gap-3 text-xs">
        {stuck ? (
          <TriangleAlert className="w-4 h-4 text-status-warn shrink-0" />
        ) : (
          <RefreshCw className={`w-4 h-4 text-accent shrink-0 ${update.phase === 'saving' ? 'animate-spin' : ''}`} />
        )}
        <div className="min-w-0">
          <p className="font-semibold text-main">{stuck ? t('update.stuckTitle') : t('update.title')}</p>
          <p className="text-muted">{text}</p>
        </div>
        <button
          type="button"
          onClick={onReloadNow}
          disabled={update.phase === 'saving'}
          className="btn-primary shrink-0 h-11 sm:h-8 px-3 text-xs font-semibold disabled:opacity-60"
        >
          {t('update.now')}
        </button>
      </div>
    </div>
  );
};
