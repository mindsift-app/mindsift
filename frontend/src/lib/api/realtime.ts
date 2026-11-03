// Realtime transport: WebSocket, with SSE and long polling as fallbacks behind proxies
import { WSMessage } from '../types';
import { authHeaders, getToken, request } from './client';
import { api } from './rest';

// poll: long polling, when a proxy lets neither WebSocket nor event streams through
export type RealtimeTransport = 'ws' | 'sse' | 'poll' | 'none';

let activeTransport: RealtimeTransport = 'none';
let activeGlobalWS: WebSocket | null = null;
let activeGlobalSSE: EventSource | null = null;
let activeSSEId: string | null = null;
let wsReconnectTimer: any = null;
let wsConnectionWatchdog: any = null;
let wsListeners: ((msg: WSMessage) => void)[] = [];
let realtimeStatusListeners: ((connected: boolean, transport: RealtimeTransport) => void)[] = [];
let isRealtimeConnectedState = false;
let manualDisconnect = false;
let wsReconnectDelay = 2000;

// WebSocket and EventSource cannot send headers, so instead of the session token (which would land in
// proxy logs) every connection gets a one-time ticket, valid for a minute (POST /auth/stream-ticket).
async function fetchStreamTicket(): Promise<string | null> {
  try {
    const res = await request<{ ticket?: string }>('/api/v1/auth/stream-ticket', { method: 'POST' });
    return res?.ticket || null;
  } catch {
    return null;
  }
}

export function buildWebSocketURL(ticket: string, listId?: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (listId) {
    return `${protocol}//${window.location.host}/api/v1/ws/lists/${encodeURIComponent(listId)}?ticket=${encodeURIComponent(ticket)}`;
  }
  return `${protocol}//${window.location.host}/api/v1/ws?ticket=${encodeURIComponent(ticket)}`;
}

export function buildSSEURL(ticket: string, listId?: string, docId?: string, rooms?: string[]): string {
  const params = new URLSearchParams();
  params.set('ticket', ticket);
  if (listId) params.set('listId', listId);
  if (docId) params.set('docId', docId);
  if (rooms && rooms.length > 0) params.set('rooms', rooms.join(','));
  return `/api/v1/events?${params.toString()}`;
}

export function isWebSocketConnected(): boolean {
  return activeTransport === 'ws' && activeGlobalWS !== null && activeGlobalWS.readyState === WebSocket.OPEN;
}

export function isRealtimeConnected(): boolean {
  return isRealtimeConnectedState;
}

export function getRealtimeTransport(): RealtimeTransport {
  return activeTransport;
}

export function getSSEId(): string | null {
  return activeSSEId;
}

export function onWebSocketStatus(callback: (connected: boolean) => void): () => void {
  const wrapper = (connected: boolean) => callback(connected);
  realtimeStatusListeners.push(wrapper);
  callback(isRealtimeConnected());
  return () => {
    realtimeStatusListeners = realtimeStatusListeners.filter((fn) => fn !== wrapper);
  };
}

export function onRealtimeStatus(callback: (connected: boolean, transport: RealtimeTransport) => void): () => void {
  realtimeStatusListeners.push(callback);
  callback(isRealtimeConnected(), activeTransport);
  return () => {
    realtimeStatusListeners = realtimeStatusListeners.filter((fn) => fn !== callback);
  };
}

let isWsBlockedByProxy = typeof window !== 'undefined' && sessionStorage.getItem('mindsift_ws_blocked') === 'true';
// Some proxies buffer event streams: the connection opens, but events only arrive much later (or never).
// Then SSE is useless and the note sync engines fall back to long polling.
let isSseBufferedByProxy = typeof window !== 'undefined' && sessionStorage.getItem('mindsift_sse_buffered') === 'true';
let sseFirstEventWatchdog: any = null;
const SSE_FIRST_EVENT_TIMEOUT_MS = 5000;
// Some proxies accept the WebSocket upgrade but then forward nothing. An app-level ping detects that.
let wsHeartbeatTimer: any = null;
let wsLastMessageAt = 0;
const WS_PING_INTERVAL_MS = 15000;
const WS_DEAD_AFTER_MS = 35000;
let sseReconnectTimer: any = null;
let sseReconnectDelay = 2000;
const globalSubscribedRooms = new Set<string>();

function notifyRealtimeStatusChange(connected: boolean, transport: RealtimeTransport) {
  isRealtimeConnectedState = connected;
  activeTransport = transport;
  realtimeStatusListeners.forEach((fn) => {
    try {
      fn(connected, transport);
    } catch (e) {
      console.error('Realtime status listener error', e);
    }
  });
  window.dispatchEvent(new CustomEvent('mindsift:ws:status', { detail: { connected, transport } }));
}

function switchToSSE(reason: string) {
  console.warn(`[MindSift Realtime] ${reason} -> switching to Server-Sent Events (SSE) for good.`);
  clearInterval(wsHeartbeatTimer);
  isWsBlockedByProxy = true;
  try {
    sessionStorage.setItem('mindsift_ws_blocked', 'true');
  } catch {}
  clearTimeout(wsConnectionWatchdog);
  clearTimeout(wsReconnectTimer);
  if (activeGlobalWS) {
    try {
      activeGlobalWS.onclose = null;
      activeGlobalWS.onerror = null;
      activeGlobalWS.close();
    } catch {}
    activeGlobalWS = null;
  }
  connectSSE();
}

let sseTicketPending = false;

export async function connectSSE(rooms?: string[]): Promise<void> {
  if (rooms) {
    rooms.forEach((r) => globalSubscribedRooms.add(r));
  }
  clearTimeout(sseReconnectTimer);
  clearTimeout(wsReconnectTimer);
  clearTimeout(wsConnectionWatchdog);
  clearTimeout(sseFirstEventWatchdog);

  if (isSseBufferedByProxy) {
    void connectPoll();
    return;
  }

  if (activeGlobalSSE) {
    try { activeGlobalSSE.close(); } catch {}
    activeGlobalSSE = null;
  }

  if (sseTicketPending) return;
  sseTicketPending = true;
  const ticket = await fetchStreamTicket();
  sseTicketPending = false;
  if (manualDisconnect || !getToken()) return;
  if (!ticket) {
    // Server unreachable or session gone: try again later like after a dropped stream
    notifyRealtimeStatusChange(false, 'none');
    sseReconnectTimer = setTimeout(() => connectSSE(), sseReconnectDelay);
    return;
  }

  try {
    const url = buildSSEURL(ticket, undefined, undefined, Array.from(globalSubscribedRooms));
    const es = new EventSource(url);
    activeGlobalSSE = es;

    es.onopen = () => {
      sseReconnectDelay = 2000;
      // Connected only counts once the first event really arrives (see SSE_CONNECTED below)
      clearTimeout(sseFirstEventWatchdog);
      sseFirstEventWatchdog = setTimeout(() => {
        console.warn('[MindSift Realtime] SSE liefert keine Ereignisse (Proxy puffert) -> Long-Polling');
        isSseBufferedByProxy = true;
        try {
          sessionStorage.setItem('mindsift_sse_buffered', 'true');
        } catch {}
        try {
          es.close();
        } catch {}
        if (activeGlobalSSE === es) activeGlobalSSE = null;
        notifyRealtimeStatusChange(false, 'none');
        void connectPoll();
      }, SSE_FIRST_EVENT_TIMEOUT_MS);
    };

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        if (msg.event === 'SSE_CONNECTED') {
          clearTimeout(sseFirstEventWatchdog);
          notifyRealtimeStatusChange(true, 'sse');
          activeSSEId = msg.payload?.sseId || null;
          if (activeSSEId && globalSubscribedRooms.size > 0) {
            globalSubscribedRooms.forEach((room) => {
              api.joinSSERoom(activeSSEId!, room, 'join').catch(() => {});
            });
          }
        }
        wsListeners.forEach((fn) => {
          try {
            fn(msg);
          } catch (e) {
            console.error('SSE listener error', e);
          }
        });
        window.dispatchEvent(new CustomEvent('mindsift:ws', { detail: msg }));
      } catch (err) {
        console.error('Failed to parse SSE message', err);
      }
    };

    es.onerror = (e) => {
      clearTimeout(sseFirstEventWatchdog);
      console.warn('[MindSift Realtime] SSE Verbindungsfehler:', e);
      if (activeTransport === 'sse') {
        notifyRealtimeStatusChange(false, 'none');
      }
      try { es.close(); } catch {}
      activeGlobalSSE = null;
      if (!manualDisconnect && getToken()) {
        clearTimeout(sseReconnectTimer);
        const delay = sseReconnectDelay;
        sseReconnectDelay = Math.min(30000, Math.round(sseReconnectDelay * 1.5));
        sseReconnectTimer = setTimeout(() => {
          if (!manualDisconnect && getToken()) {
            connectSSE();
          }
        }, delay);
      }
    };
  } catch (err) {
    console.error('Failed to initialize EventSource SSE', err);
    notifyRealtimeStatusChange(false, 'none');
  }
}

// Long polling: the server buffers the events of a poll connection; each request waits until there are
// some (at most POLL_WAIT_S). Room joins use the poll id like an SSE id (activeSSEId).
const POLL_WAIT_S = 25; // below typical proxy timeouts, like the note sync's long polling
let pollRunning = false;
let pollAbort: AbortController | null = null;

function dispatchRealtimeMessage(msg: WSMessage) {
  wsListeners.forEach((fn) => {
    try {
      fn(msg);
    } catch (e) {
      console.error('Realtime listener error', e);
    }
  });
  window.dispatchEvent(new CustomEvent('mindsift:ws', { detail: msg }));
}

async function connectPoll(): Promise<void> {
  if (pollRunning || manualDisconnect || !getToken()) return;
  pollRunning = true;
  let pollId: string | null = null;
  let failures = 0;
  try {
    while (!manualDisconnect && getToken()) {
      const ctrl = new AbortController();
      pollAbort = ctrl;
      try {
        const fresh = !pollId;
        if (!pollId) {
          const opened = await request<{ pollId?: string }>('/api/v1/events/poll', {
            method: 'POST',
            body: JSON.stringify({ rooms: Array.from(globalSubscribedRooms) }),
          });
          if (!opened?.pollId) throw new Error('no poll id');
          pollId = opened.pollId;
          activeSSEId = pollId;
          notifyRealtimeStatusChange(true, 'poll');
        }
        const started = Date.now();
        const res = await fetch(`/api/v1/events/poll/${encodeURIComponent(pollId)}?wait=${POLL_WAIT_S}`, {
          headers: authHeaders(),
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (res.status === 404 && !fresh) {
          // Expired (e.g. device asleep, server restart): open a new one, rooms go along
          pollId = null;
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = ((await res.json()) as { events?: WSMessage[] }).events || [];
        failures = 0;
        events.forEach(dispatchRealtimeMessage);
        // An empty answer long before the wait ran out (proxy answering on its own): no tight loop
        if (events.length === 0 && Date.now() - started < 1000) await new Promise((r) => setTimeout(r, 1000));
      } catch {
        if (ctrl.signal.aborted || manualDisconnect) break;
        pollId = null;
        if (activeTransport === 'poll') {
          activeSSEId = null;
          notifyRealtimeStatusChange(false, 'none');
        }
        failures++;
        await new Promise((r) => setTimeout(r, Math.min(30000, 2000 * failures)));
      }
    }
  } finally {
    pollRunning = false;
    pollAbort = null;
  }
}

let wsTicketPending = false;

export async function connectWebSocket(): Promise<void> {
  const token = getToken();
  if (!token) return;
  manualDisconnect = false;

  // If proxy blocked WebSocket previously, do not attempt failing WebSocket; stay on SSE
  if (isWsBlockedByProxy) {
    return connectSSE();
  }

  if (activeGlobalWS && (activeGlobalWS.readyState === WebSocket.OPEN || activeGlobalWS.readyState === WebSocket.CONNECTING)) {
    return;
  }

  clearTimeout(wsConnectionWatchdog);
  clearTimeout(wsReconnectTimer);
  clearTimeout(sseReconnectTimer);

  if (wsTicketPending) return;
  wsTicketPending = true;
  const ticket = await fetchStreamTicket();
  wsTicketPending = false;
  if (manualDisconnect || !getToken()) return;
  if (activeGlobalWS && (activeGlobalWS.readyState === WebSocket.OPEN || activeGlobalWS.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (!ticket) {
    notifyRealtimeStatusChange(false, 'none');
    wsReconnectTimer = setTimeout(() => connectWebSocket(), wsReconnectDelay);
    return;
  }

  try {
    const url = buildWebSocketURL(ticket);
    const ws = new WebSocket(url);
    activeGlobalWS = ws;

    // 2.5s watchdog for corporate proxies silently stripping Upgrade header or hanging
    wsConnectionWatchdog = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        switchToSSE('WebSocket timeout after 2.5 s (proxy blocks the upgrade header)');
      }
    }, 2500);

    ws.onopen = () => {
      clearTimeout(wsConnectionWatchdog);
      wsLastMessageAt = Date.now();
      clearInterval(wsHeartbeatTimer);
      wsHeartbeatTimer = setInterval(() => {
        if (Date.now() - wsLastMessageAt > WS_DEAD_AFTER_MS) {
          switchToSSE('WebSocket stopped answering (proxy passes nothing on)');
          return;
        }
        try {
          ws.send(JSON.stringify({ event: 'PING' }));
        } catch {}
      }, WS_PING_INTERVAL_MS);
      if (activeGlobalSSE) {
        try { activeGlobalSSE.close(); } catch {}
        activeGlobalSSE = null;
      }
      wsReconnectDelay = 2000;
      notifyRealtimeStatusChange(true, 'ws');
      if (globalSubscribedRooms.size > 0) {
        globalSubscribedRooms.forEach((room) => {
          try {
            ws.send(JSON.stringify({ event: 'JOIN_ROOM', room }));
          } catch {}
        });
      }
    };

    ws.onmessage = (event) => {
      wsLastMessageAt = Date.now();
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        if (msg.event === 'PONG') return;
        wsListeners.forEach((fn) => {
          try {
            fn(msg);
          } catch (e) {
            console.error('WS listener error', e);
          }
        });
        window.dispatchEvent(new CustomEvent('mindsift:ws', { detail: msg }));
      } catch (err) {
        console.error('Failed to parse WS message', err);
      }
    };

    ws.onclose = (evt: CloseEvent) => {
      clearTimeout(wsConnectionWatchdog);
      clearInterval(wsHeartbeatTimer);
      activeGlobalWS = null;

      // In corporate environments, blocked WebSockets close abruptly without clean handshake
      if (!evt.wasClean || evt.code === 1006 || evt.code === 1002 || evt.code === 1008 || evt.code === 1005) {
        switchToSSE(`WebSocket unsauber beendet (Code ${evt.code}, wasClean=${evt.wasClean})`);
        return;
      }

      if (activeTransport === 'ws') {
        notifyRealtimeStatusChange(false, 'none');
      }

      if (!manualDisconnect && getToken() && activeTransport !== 'sse') {
        clearTimeout(wsReconnectTimer);
        const delay = wsReconnectDelay;
        wsReconnectDelay = Math.min(30000, Math.round(wsReconnectDelay * 1.5));
        wsReconnectTimer = setTimeout(() => {
          if (!manualDisconnect && getToken()) {
            connectWebSocket();
          }
        }, delay);
      }
    };

    ws.onerror = () => {
      clearTimeout(wsConnectionWatchdog);
      switchToSSE('WebSocket error (handshake/connection refused)');
    };
  } catch (e) {
    switchToSSE('WebSocket Exception beim Initialisieren');
  }
}

// Ensure reconnect when browser recovers from sleep or tab visibility
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (getToken() && !isRealtimeConnected()) {
      if (isWsBlockedByProxy) {
        connectSSE();
      } else {
        connectWebSocket();
      }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getToken() && !isRealtimeConnected()) {
      if (isWsBlockedByProxy) {
        connectSSE();
      } else {
        connectWebSocket();
      }
    }
  });
}

export function disconnectWebSocket(): void {
  pollAbort?.abort();
  clearInterval(wsHeartbeatTimer);
  clearTimeout(sseFirstEventWatchdog);
  manualDisconnect = true;
  clearTimeout(wsReconnectTimer);
  clearTimeout(wsConnectionWatchdog);
  clearTimeout(sseReconnectTimer);
  if (activeGlobalWS) {
    try {
      activeGlobalWS.close();
    } catch {}
    activeGlobalWS = null;
  }
  if (activeGlobalSSE) {
    try {
      activeGlobalSSE.close();
    } catch {}
    activeGlobalSSE = null;
  }
  notifyRealtimeStatusChange(false, 'none');
}

export function sendWebSocketMessage(msg: any): void {
  if (activeGlobalWS && activeGlobalWS.readyState === WebSocket.OPEN) {
    activeGlobalWS.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    return;
  }

  // SSE Fallback: dispatch via REST endpoints
  try {
    const parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
    if (parsed.event === 'JOIN_ROOM' && parsed.room) {
      if (activeSSEId) api.joinSSERoom(activeSSEId, parsed.room, 'join').catch(() => {});
    } else if (parsed.event === 'LEAVE_ROOM' && parsed.room) {
      if (activeSSEId) api.joinSSERoom(activeSSEId, parsed.room, 'leave').catch(() => {});
    }
  } catch (err) {
    console.error('Error dispatching fallback REST message for SSE:', err);
  }
}

export function onWebSocketMessage(callback: (msg: WSMessage) => void): () => void {
  wsListeners.push(callback);
  return () => {
    wsListeners = wsListeners.filter((fn) => fn !== callback);
  };
}

export function createRealtimeConnection(options: {
  listId?: string;
  docId?: string;
  rooms?: string[];
  onMessage?: (msg: WSMessage) => void;
  onStatusChange?: (status: { connected: boolean; transport: RealtimeTransport; reason?: string }) => void;
}) {
  let isClosed = false;

  const joinedRooms: string[] = [];
  if (options.docId) joinedRooms.push(`doc:${options.docId}`);
  if (options.listId) joinedRooms.push(options.listId);
  if (options.rooms) {
    options.rooms.forEach((r) => {
      if (!joinedRooms.includes(r)) joinedRooms.push(r);
    });
  }

  joinedRooms.forEach((r) => globalSubscribedRooms.add(r));

  // Subscribe to status changes
  const unsubStatus = onRealtimeStatus((connected, transport) => {
    if (isClosed) return;
    options.onStatusChange?.({
      connected,
      transport,
      reason: connected ? undefined : 'Verbindung getrennt',
    });
  });

  // Subscribe to messages
  let unsubMsg: (() => void) | null = null;
  if (options.onMessage) {
    unsubMsg = onWebSocketMessage((msg) => {
      if (isClosed) return;
      options.onMessage?.(msg);
    });
  }

  // Join rooms on the active connection
  const joinAll = () => {
    joinedRooms.forEach((r) => {
      sendWebSocketMessage({ event: 'JOIN_ROOM', room: r });
      if (activeSSEId) {
        api.joinSSERoom(activeSSEId, r, 'join').catch(() => {});
      }
    });
  };

  if (isRealtimeConnected()) {
    joinAll();
  }

  const unsubRejoin = onRealtimeStatus((connected) => {
    if (isClosed) return;
    if (connected) {
      joinAll();
    }
  });

  return {
    getTransport: () => activeTransport,
    isConnected: () => isRealtimeConnected(),
    send: (msg: any) => {
      if (isClosed) return;
      sendWebSocketMessage(msg);
    },
    close: () => {
      isClosed = true;
      unsubStatus();
      unsubRejoin();
      if (unsubMsg) unsubMsg();
      joinedRooms.forEach((r) => {
        globalSubscribedRooms.delete(r);
        sendWebSocketMessage({ event: 'LEAVE_ROOM', room: r });
        if (activeSSEId) {
          api.joinSSERoom(activeSSEId, r, 'leave').catch(() => {});
        }
      });
    },
  };
}
