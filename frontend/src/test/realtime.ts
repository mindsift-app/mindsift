import { act } from '@testing-library/react';
import { RealtimeTransport, emitRealtimeMessage, emitRealtimeStatus } from '../lib/realtimeBus';

// Realtime events and the connection's status in tests, as lib/api/realtime.ts reports them (lib/realtimeBus.ts),
// inside act() so React state set by the listeners is applied

/** A realtime event, as if it came over the connection. */
export const emitRealtime = (event: string, payload: unknown = {}, extra: Record<string, unknown> = {}) =>
  act(() => emitRealtimeMessage({ event, payload, timestamp: '', ...extra }));

/** The connection went down or came back. */
export const emitStatus = (connected: boolean, transport: RealtimeTransport = connected ? 'ws' : 'none') =>
  act(() => emitRealtimeStatus(connected, transport));

/** The connection dropped and came back (the events in between are lost). */
export const reconnect = () => {
  emitStatus(false);
  emitStatus(true);
};
