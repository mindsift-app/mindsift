import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onRealtimeStatus, RealtimeTransport } from '../lib/realtimeBus';
import { useCapabilities } from '../lib/capabilities';

// Connection pill in the look of the notes' header (Doku/ui-patterns.md): whether changes of others
// arrive live, and how. Phones show the short label only. Hidden where nobody else reaches the instance
// (the desktop app's local instance): changes still arrive live, but there are no others to name.
export const LivePill: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{ connected: boolean; transport: RealtimeTransport }>({
    connected: false,
    transport: 'none',
  });
  useEffect(() => onRealtimeStatus((connected, transport) => setStatus({ connected, transport }), { current: true }), []);
  const { publicAddress } = useCapabilities();
  if (!publicAddress) return null;

  const { connected, transport } = status;
  return (
    <span
      className="inline-flex items-center gap-1 h-7 px-2 sm:px-1.5 rounded-btn text-[11px] bg-panel sm:bg-transparent text-muted shrink-0"
      title={
        !connected
          ? t('live.none')
          : transport === 'sse'
          ? t('live.sse')
          : transport === 'poll'
          ? t('live.poll')
          : t('live.ws')
      }
    >
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-status-ok' : 'bg-status-warn'}`} />
      {!connected ? (
        t('live.offline')
      ) : (
        <>
          Live
          {transport === 'poll' && <span className="hidden sm:inline">{t('live.longPolling')}</span>}
        </>
      )}
    </span>
  );
};
