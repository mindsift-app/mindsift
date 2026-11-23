import { describe, expect, it, vi } from 'vitest';
import { emitRealtimeMessage, emitRealtimeStatus, onRealtimeMessage, onRealtimeReconnect, onRealtimeStatus } from '../realtimeBus';

describe('realtimeBus', () => {
  it('hands every event to every listener, also when one of them throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    const offA = onRealtimeMessage(() => {
      throw new Error('kaputt');
    });
    const offB = onRealtimeMessage((m) => seen.push(m.event));
    emitRealtimeMessage({ event: 'DOC_CREATED', payload: {}, timestamp: '' });
    offA();
    offB();
    emitRealtimeMessage({ event: 'DOC_DELETED', payload: {}, timestamp: '' });
    expect(seen).toEqual(['DOC_CREATED']);
    error.mockRestore();
  });

  it('reports the status right now only when asked for', () => {
    emitRealtimeStatus(true, 'sse');
    const plain = vi.fn();
    const current = vi.fn();
    const offPlain = onRealtimeStatus(plain);
    const offCurrent = onRealtimeStatus(current, { current: true });
    expect(plain).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledWith(true, 'sse');
    offPlain();
    offCurrent();
  });

  it('calls a reconnect listener only when the connection is back after it dropped', () => {
    const back = vi.fn();
    const off = onRealtimeReconnect(back);
    emitRealtimeStatus(true, 'ws');
    expect(back).not.toHaveBeenCalled();
    emitRealtimeStatus(false, 'none');
    emitRealtimeStatus(true, 'ws');
    emitRealtimeStatus(true, 'ws');
    expect(back).toHaveBeenCalledTimes(1);
    off();
  });
});
