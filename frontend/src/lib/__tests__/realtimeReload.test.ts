import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  OWN_ECHO_WINDOW_MS,
  RELOAD_SHARED_DELAY_MS,
  RELOAD_SHARED_INTERVAL_MS,
  RELOAD_SOON_MS,
  createRealtimeReloader,
  useRealtimeReload,
} from '../realtimeReload';
import { emitRealtimeStatus } from '../realtimeBus';

let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  hidden = false;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (hidden ? 'hidden' : 'visible'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const status = (connected: boolean) =>
  emitRealtimeStatus(connected, 'ws');

describe('reloading because of realtime events', () => {
  it('loads shortly for the echo of an own change, once for a burst', () => {
    const load = vi.fn();
    const r = createRealtimeReloader(load, { ownWriteAt: () => Date.now() - 100 });
    r.request();
    r.request();
    vi.advanceTimersByTime(RELOAD_SOON_MS);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('follows other people’s changes in the shared rhythm: one request per burst', () => {
    const load = vi.fn();
    const r = createRealtimeReloader(load, { ownWriteAt: () => Date.now() - OWN_ECHO_WINDOW_MS - 1 });
    for (let i = 0; i < 40; i++) {
      r.request();
      vi.advanceTimersByTime(25);
    }
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RELOAD_SHARED_DELAY_MS);
    expect(load).toHaveBeenCalledTimes(1);
    // Events keep coming: at most once per interval
    r.request();
    vi.advanceTimersByTime(RELOAD_SHARED_DELAY_MS);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RELOAD_SHARED_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('puts the reload off while the tab is hidden and loads once when it is visible again', () => {
    const load = vi.fn();
    const r = createRealtimeReloader(load);
    hidden = true;
    r.request(false);
    r.request(true);
    vi.advanceTimersByTime(60_000);
    r.visible(); // still hidden
    vi.advanceTimersByTime(60_000);
    expect(load).not.toHaveBeenCalled();
    hidden = false;
    r.visible();
    vi.advanceTimersByTime(RELOAD_SOON_MS);
    expect(load).toHaveBeenCalledTimes(1);
    // Visible again without anything put off: nothing to load
    r.visible();
    vi.advanceTimersByTime(60_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads once after a reconnect, not on the first connect, and not when switched off', () => {
    const load = vi.fn();
    const r = createRealtimeReloader(load);
    r.status(true);
    vi.advanceTimersByTime(1000);
    expect(load).not.toHaveBeenCalled();
    r.status(false);
    r.status(false);
    r.status(true);
    r.status(true);
    vi.advanceTimersByTime(RELOAD_SOON_MS);
    expect(load).toHaveBeenCalledTimes(1);

    const quiet = vi.fn();
    const q = createRealtimeReloader(quiet, { reconnect: false });
    q.status(false);
    q.status(true);
    vi.advanceTimersByTime(1000);
    expect(quiet).not.toHaveBeenCalled();
  });

  it('a reconnect of a hidden tab loads when it is visible', () => {
    const load = vi.fn();
    const r = createRealtimeReloader(load);
    hidden = true;
    r.status(false);
    r.status(true);
    vi.advanceTimersByTime(1000);
    expect(load).not.toHaveBeenCalled();
    hidden = false;
    r.visible();
    vi.advanceTimersByTime(RELOAD_SOON_MS);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('the hook follows visibility and connection, calls the latest load and stops when unmounted', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { result, rerender, unmount } = renderHook(({ load }) => useRealtimeReload(load), { initialProps: { load: first } });
    rerender({ load: latest });
    act(() => {
      status(false);
      status(true);
    });
    vi.advanceTimersByTime(RELOAD_SOON_MS);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    hidden = true;
    result.current.request(true);
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    vi.advanceTimersByTime(RELOAD_SOON_MS);
    expect(latest).toHaveBeenCalledTimes(2);

    result.current.request(true);
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(latest).toHaveBeenCalledTimes(2);
  });
});
