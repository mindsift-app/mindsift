import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

let statusListener: ((connected: boolean, transport?: string) => void) | null = null;
let currentConnected = false;
vi.mock('../api', () => ({
  onRealtimeStatus: (cb: (connected: boolean, transport?: string) => void) => {
    statusListener = cb;
    cb(currentConnected);
    return () => (statusListener = null);
  },
}));

import { useConnectionState, SERVER_OFFLINE_GRACE_MS, SERVER_PROBE_INTERVAL_MS } from '../useConnectionState';

function setDeviceOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

let serverAnswers = false;
const fetchMock = vi.fn(async () => {
  if (!serverAnswers) throw new TypeError('Failed to fetch');
  return { ok: true } as Response;
});

// Runs the timers and lets the health request settle
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useConnectionState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    currentConnected = false;
    serverAnswers = false;
    setDeviceOnline(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stays online during the grace period at app start', async () => {
    const { result } = renderHook(() => useConnectionState());
    expect(result.current).toBe('online');
    act(() => statusListener?.(true));
    await wait(SERVER_OFFLINE_GRACE_MS + 100);
    expect(result.current).toBe('online');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns offline once the server stays unreachable and back online on reconnect', async () => {
    currentConnected = true;
    const { result } = renderHook(() => useConnectionState());
    act(() => statusListener?.(false));
    expect(result.current).toBe('online');
    await wait(SERVER_OFFLINE_GRACE_MS + 100);
    expect(result.current).toBe('offline');
    act(() => statusListener?.(true));
    expect(result.current).toBe('online');
  });

  it('is limited when the server answers but no realtime connection gets through', async () => {
    serverAnswers = true;
    const { result } = renderHook(() => useConnectionState());
    await wait(SERVER_OFFLINE_GRACE_MS + 100);
    expect(result.current).toBe('limited');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', expect.anything());

    // Asked again while the connection is missing
    serverAnswers = false;
    await wait(SERVER_PROBE_INTERVAL_MS + 100);
    expect(result.current).toBe('offline');
    serverAnswers = true;
    await wait(SERVER_PROBE_INTERVAL_MS + 100);
    expect(result.current).toBe('limited');

    act(() => statusListener?.(true));
    expect(result.current).toBe('online');
    const calls = fetchMock.mock.calls.length;
    await wait(SERVER_PROBE_INTERVAL_MS * 2);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('is limited while changes only come by long polling', async () => {
    const { result } = renderHook(() => useConnectionState());
    act(() => statusListener?.(true, 'poll'));
    expect(result.current).toBe('limited');
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => statusListener?.(true, 'sse'));
    expect(result.current).toBe('online');
  });

  it('repeated failed reconnects do not postpone the check', async () => {
    currentConnected = true;
    const { result } = renderHook(() => useConnectionState());
    for (let i = 0; i < 4; i++) {
      act(() => statusListener?.(false));
      await wait(SERVER_OFFLINE_GRACE_MS / 2);
    }
    expect(result.current).toBe('offline');
  });

  it('is offline right away without device network', () => {
    currentConnected = true;
    const { result } = renderHook(() => useConnectionState());
    act(() => {
      setDeviceOnline(false);
      statusListener?.(false);
    });
    expect(result.current).toBe('offline');
  });
});
