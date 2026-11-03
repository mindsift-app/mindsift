import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudOff, RefreshCw } from 'lucide-react';
import { outboxCount } from '../lib/offline';

// Small notice above the bottom navigation: offline (with the number of changes waiting), or
// "synchronisiere" while queued changes are being sent after the connection came back.
export const OfflineBanner: React.FC = () => {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [pending, setPending] = useState(() => outboxCount());

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      setPending(outboxCount());
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
  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-4 z-[60] max-w-[calc(100vw-1.5rem)] px-3 py-1.5 rounded-full border text-[11px] font-medium shadow-panel flex items-center gap-1.5 bg-panel-elevated border-status-warn/40 text-main"
    >
      {online ? (
        <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
      ) : (
        <CloudOff className="w-3.5 h-3.5 text-status-warn shrink-0" />
      )}
      <span className="truncate">
        {online
          ? t('offline.syncing', { waiting })
          : pending > 0
          ? t('offline.pending', { waiting })
          : t('offline.idle')}
      </span>
    </div>
  );
};
