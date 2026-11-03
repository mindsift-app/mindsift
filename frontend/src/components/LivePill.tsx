import React, { useEffect, useState } from 'react';
import { onRealtimeStatus, RealtimeTransport } from '../lib/api';

// Connection pill in the look of the notes' header (Doku/ui-patterns.md): whether changes of others
// arrive live, and how. Phones show the short label only.
export const LivePill: React.FC = () => {
  const [status, setStatus] = useState<{ connected: boolean; transport: RealtimeTransport }>({
    connected: false,
    transport: 'none',
  });
  useEffect(() => onRealtimeStatus((connected, transport) => setStatus({ connected, transport })), []);

  const { connected, transport } = status;
  return (
    <span
      className="inline-flex items-center gap-1 h-7 px-2 rounded-btn text-[11px] bg-panel text-muted flex-shrink-0"
      title={
        !connected
          ? 'Keine Live-Verbindung – Änderungen anderer erscheinen nach dem Neuladen'
          : transport === 'sse'
          ? 'Live-Verbindung über Server-Sent Events (WebSocket wird blockiert)'
          : transport === 'poll'
          ? 'Live über Long-Polling (WebSocket und SSE werden blockiert)'
          : 'Live-Verbindung über WebSocket'
      }
    >
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-status-ok' : 'bg-status-warn'}`} />
      {!connected ? (
        'Offline'
      ) : (
        <>
          Live
          {transport === 'poll' && <span className="hidden sm:inline">&nbsp;(Long-Polling)</span>}
        </>
      )}
    </span>
  );
};
