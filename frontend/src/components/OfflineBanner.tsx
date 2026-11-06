import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudOff, RefreshCw } from 'lucide-react';
import { outboxCount } from '../lib/offline';
import { unsentNoteCount } from '../lib/docSync/persist';

// Small notice above the bottom navigation: offline (with the number of changes and notes waiting), or
// "synchronisiere" while queued changes are being sent after the connection came back. Notes count only
// offline: online they send their changes within a moment themselves.
export const OfflineBanner: React.FC = () => {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [pending, setPending] = useState(() => outboxCount());
  const [notes, setNotes] = useState(() => unsentNoteCount());
  // Tapped: explains where unsent changes are kept and when they would be lost
  const [explain, setExplain] = useState(false);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      setPending(outboxCount());
      setNotes(unsentNoteCount());
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('mindsift:outbox-changed', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('mindsift:outbox-changed', update);
      window.removeEventListener('storage', update);
    };
  }, []);

  if (online && pending === 0) return null;

  const waiting = t('offline.waiting', { count: pending });
  const offlineText =
    notes > 0 && pending > 0
      ? t('offline.bothPending', { waiting, count: notes })
      : notes > 0
      ? t('offline.notesPending', { count: notes })
      : pending > 0
      ? t('offline.pending', { waiting })
      : t('offline.idle');
  return (
    <div
      role="status"
      className={`fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-4 z-[60] max-w-[calc(100vw-1.5rem)] border text-[11px] font-medium shadow-panel bg-panel-elevated border-status-warn/40 text-main ${
        explain ? 'w-[26rem] rounded-card' : 'rounded-full'
      }`}
    >
      <button
        type="button"
        disabled={online}
        onClick={() => setExplain((v) => !v)}
        aria-expanded={online ? undefined : explain}
        title={online ? undefined : t('offline.localOnly')}
        className="relative w-full px-3 py-1.5 flex items-center gap-1.5 text-left disabled:cursor-default before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']"
      >
        {online ? (
          <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
        ) : (
          <CloudOff className="w-3.5 h-3.5 text-status-warn shrink-0" />
        )}
        <span className={explain ? '' : 'truncate'}>{online ? t('offline.syncing', { waiting }) : offlineText}</span>
      </button>
      {explain && !online && <p className="px-3 pb-2 -mt-0.5 font-normal text-muted leading-snug">{t('offline.localOnly')}</p>}
    </div>
  );
};
