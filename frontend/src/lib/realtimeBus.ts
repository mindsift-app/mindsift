// The one way realtime events and the connection's status reach the app. lib/api/realtime.ts (WebSocket, SSE
// or long polling) emits here; everything else subscribes here: React code with the hooks of
// useRealtimeEvents.ts, other modules with onRealtimeMessage/onRealtimeStatus. The event names are the ones in
// realtimeEvents.json (a test checks every name the app uses). No imports of lib/api, so a test that mocks
// lib/api still gets real events.
import type { WSMessage } from './types';

// poll: long polling, when a proxy lets neither WebSocket nor event streams through
export type RealtimeTransport = 'ws' | 'sse' | 'poll' | 'none';

type MessageListener = (msg: WSMessage) => void;
type StatusListener = (connected: boolean, transport: RealtimeTransport) => void;

const messageListeners = new Set<MessageListener>();
const statusListeners = new Set<StatusListener>();
let status: { connected: boolean; transport: RealtimeTransport } = { connected: false, transport: 'none' };

// A listener that throws does not keep the others from the event
function each<T extends unknown[]>(listeners: Set<(...args: T) => void>, args: T, what: string) {
  [...listeners].forEach((fn) => {
    try {
      fn(...args);
    } catch (e) {
      console.error(`Realtime ${what} listener error`, e);
    }
  });
}

/** A message of the realtime connection, to every listener (lib/api/realtime.ts; tests). */
export function emitRealtimeMessage(msg: WSMessage): void {
  each(messageListeners, [msg], 'message');
}

/** The connection came up or went down (lib/api/realtime.ts; tests). */
export function emitRealtimeStatus(connected: boolean, transport: RealtimeTransport): void {
  status = { connected, transport };
  each(statusListeners, [connected, transport], 'status');
}

export function onRealtimeMessage(listener: MessageListener): () => void {
  messageListeners.add(listener);
  return () => void messageListeners.delete(listener);
}

/** Every change of the connection's status; with `current`, also the status right now (synchronously). */
export function onRealtimeStatus(listener: StatusListener, { current = false }: { current?: boolean } = {}): () => void {
  statusListeners.add(listener);
  if (current) listener(status.connected, status.transport);
  return () => void statusListeners.delete(listener);
}

/** The connection is back after it dropped: the events of the gap are lost, so whoever listens loads anew. */
export function onRealtimeReconnect(listener: () => void): () => void {
  let lost = false;
  return onRealtimeStatus((connected) => {
    if (!connected) {
      lost = true;
    } else if (lost) {
      lost = false;
      listener();
    }
  });
}

export const realtimeStatus = () => status;
