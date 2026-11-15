import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Sparkles, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { UpdateStatus, User } from '../../lib/types';
import { tourOfferPending } from '../tour/tourOffer';

// Admins only: a new MindSift release is out (the server looks once a day, api/update.go). The same small
// card at the edge as the tour offer, never at the same time: while the tour is still to be offered, this
// waits. "Später" and × put it aside for this release on every device of the admin (stored on the server);
// a newer release shows it again.
export function UpdateNoticeCard({
  user,
  demoMode,
  suppressed = false,
}: {
  user: User;
  demoMode: boolean;
  // Something else holds the screen (the install offer on phones): wait until it is gone
  suppressed?: boolean;
}) {
  const { t } = useTranslation('settings');
  const isAdmin = user.role === 'admin';
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isAdmin || demoMode) return;
    let cancelled = false;
    api
      .adminUpdateStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAdmin, demoMode]);

  const latest = status?.latest;
  if (!isAdmin || demoMode || suppressed || dismissed || !status?.available || status.dismissed || !latest) return null;
  // The tour offer goes first
  if (tourOfferPending(user, demoMode)) return null;

  const dismiss = () => {
    setDismissed(true);
    api.adminDismissUpdate(latest).catch(() => {});
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="update-notice-title"
      data-update-notice
      className="fixed z-40 left-3 right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:left-auto sm:right-4 sm:bottom-4 sm:w-80 panel-elevated shadow-panel p-4 text-main animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <button
        type="button"
        onClick={dismiss}
        title={t('update.card.close')}
        aria-label={t('update.card.close')}
        className="absolute top-1 right-1 h-11 w-11 sm:h-8 sm:w-8 flex items-center justify-center rounded-btn text-muted hover:text-main hover:bg-canvas"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <Sparkles className="w-5 h-5 text-accent shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p id="update-notice-title" className="text-sm font-semibold">
            {t('update.card.title', { version: latest.replace(/^v/, '') })}
          </p>
          <p className="mt-1 text-xs text-muted leading-relaxed">
            {t('update.card.text', { current: status.current })}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={dismiss} className="btn-action h-11 sm:h-8 px-3 text-xs">
          {t('update.card.later')}
        </button>
        {status.url && (
          <a
            href={status.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <span>{t('update.card.whatsNew')}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
