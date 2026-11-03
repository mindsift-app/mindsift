import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { APP_VERSION } from '../version';
import type { AvailableUpdate } from '../lib/useUpdateCheck';

// Shown when the server got a new MindSift (lib/useUpdateCheck): reloading fetches the new app (the
// service worker loads pages from the network first).
export const UpdateAvailableModal: React.FC<{ update: AvailableUpdate; onLater: () => void }> = ({ update, onLater }) => {
  const { t } = useTranslation();
  return (
  <div className="fixed inset-0 !m-0 z-[70] modal-overlay flex items-center justify-center p-4" onClick={onLater}>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-title"
      onClick={(e) => e.stopPropagation()}
      className="w-full max-w-sm panel-surface shadow-panel p-5 space-y-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 bg-accent text-on-accent rounded-btn flex items-center justify-center shrink-0">
          <RefreshCw className="w-4 h-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <h3 id="update-title" className="text-sm font-semibold text-main">
            {t('update.title')}
          </h3>
          <p className="text-xs text-muted leading-relaxed">
            {update.version && update.version !== APP_VERSION ? (
              <Trans
                t={t}
                i18nKey="update.bodyVersion"
                values={{ version: update.version }}
                components={{ v: <span className="font-mono text-main" /> }}
              />
            ) : (
              t('update.body')
            )}
          </p>
        </div>
      </div>
      <div className="flex gap-2 sm:justify-end">
        <button type="button" onClick={onLater} className="btn-action flex-1 sm:flex-none h-11 sm:h-8 px-3 text-sm sm:text-xs">
          {t('update.later')}
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => window.location.reload()}
          className="btn-primary flex-1 sm:flex-none h-11 sm:h-8 px-4 text-sm sm:text-xs font-semibold"
        >
          {t('update.now')}
        </button>
      </div>
    </div>
  </div>
);
};
