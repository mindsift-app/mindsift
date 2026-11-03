import { useEffect, useState } from 'react';
import { onRealtimeStatus } from './api';

// Grace period before a missing realtime connection counts as offline (app start, short reconnects)
export const SERVER_OFFLINE_GRACE_MS = 4000;
// How often the server is asked while the realtime connection is missing
export const SERVER_PROBE_INTERVAL_MS = 15000;

// online: realtime connection (WebSocket/SSE) is up; limited: changes only come by long polling (a proxy
// that buffers event streams), or not live at all while the server still answers plain requests;
// offline: no server at all
export type ConnectionState = 'online' | 'limited' | 'offline';

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/health', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

// Whether the server is reachable, judged by the app-wide realtime connection. Unlike navigator.onLine it
// also notices a server that is down while the device still has network. Without device network it is
// offline right away; otherwise, once the connection stayed away for a moment, a request to the server
// decides between limited and offline (repeated while the connection is missing).
export function useConnectionState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>('online');

  useEffect(() => {
    let connected = false;
    let viaPoll = false;
    let disposed = false;
    let timer: number | undefined;
    const stopProbing = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const probe = async () => {
      const reachable = await serverReachable();
      if (disposed || connected) return;
      setState(reachable && navigator.onLine !== false ? 'limited' : 'offline');
      timer = window.setTimeout(probe, SERVER_PROBE_INTERVAL_MS);
    };
    // Reconnect attempts report "not connected" every few seconds; they must not restart the grace period
    const update = () => {
      if (connected) {
        stopProbing();
        setState(viaPoll ? 'limited' : 'online');
      } else if (navigator.onLine === false) {
        stopProbing();
        setState('offline');
      } else if (timer === undefined) {
        timer = window.setTimeout(probe, SERVER_OFFLINE_GRACE_MS);
      }
    };
    const unsubscribe = onRealtimeStatus((isConnected, transport) => {
      connected = isConnected;
      viaPoll = transport === 'poll';
      update();
    });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      disposed = true;
      unsubscribe();
      stopProbing();
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return state;
}
