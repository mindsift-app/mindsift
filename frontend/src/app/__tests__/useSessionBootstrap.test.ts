import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  token: '' as string,
  outbox: 0,
  getAuthStatus: vi.fn(),
  getMe: vi.fn(),
  getTriageDeck: vi.fn(),
  getAllLists: vi.fn(),
  flushOfflineQueue: vi.fn(),
  oidcExchange: vi.fn(),
  getStats: vi.fn(),
  desktopSignIn: vi.fn(),
  desktop: false,
  lastWrite: 0,
}));

vi.mock('../../lib/api', () => ({
  api: {
    getAuthStatus: mocks.getAuthStatus,
    getMe: mocks.getMe,
    getTriageDeck: mocks.getTriageDeck,
    getAllLists: mocks.getAllLists,
    flushOfflineQueue: mocks.flushOfflineQueue,
    oidcExchange: mocks.oidcExchange,
    getStats: mocks.getStats,
    desktopSignIn: mocks.desktopSignIn,
  },
  isDesktopApp: () => mocks.desktop,
  lastLocalWriteAt: () => mocks.lastWrite,
  getToken: () => mocks.token || null,
  clearToken: () => {
    mocks.token = '';
  },
  connectWebSocket: vi.fn(),
  disconnectWebSocket: vi.fn(),
  getCurrentOidc: () => ({}),
}));
vi.mock('../../lib/offline', () => ({ outboxCount: () => mocks.outbox, clearOfflineData: vi.fn() }));
vi.mock('../../lib/docSync/flushClosed', () => ({ flushClosedNotes: vi.fn() }));

import { prefetchAuthStatus, useSessionBootstrap } from '../useSessionBootstrap';
import { loadVoiceConfig, resetVoiceConfig } from '../../lib/voice';

const me = { user: { id: 'usr_1', displayName: 'Anna' }, stats: { inboxCount: 3 } };

beforeEach(() => {
  mocks.token = 'tok';
  mocks.outbox = 0;
  mocks.getAuthStatus.mockResolvedValue({ needsSetup: false, allowRegistration: false, instanceName: 'MindSift', voice: { mode: 'off' } });
  mocks.getMe.mockResolvedValue(me);
  mocks.getTriageDeck.mockResolvedValue([{ id: 'th_1' }]);
  mocks.getAllLists.mockResolvedValue([]);
  mocks.flushOfflineQueue.mockResolvedValue(0);
  mocks.oidcExchange.mockResolvedValue({ token: 'neu' });
  mocks.getStats.mockResolvedValue({ inboxCount: 1 });
  mocks.lastWrite = 0;
  mocks.desktop = false;
  mocks.desktopSignIn.mockImplementation(async () => {
    mocks.token = 'desktop-tok';
    return me.user;
  });
});

afterEach(() => {
  vi.clearAllMocks();
  resetVoiceConfig();
  window.history.replaceState(null, '', '/');
});

async function boot() {
  const hook = renderHook(() => useSessionBootstrap(() => {}));
  await waitFor(() => expect(hook.result.current.bootLoading).toBe(false));
  return hook;
}

describe('app start', () => {
  it('loads the account next to the server status and asks for the status once', async () => {
    prefetchAuthStatus();
    // Both went out before the first render
    expect(mocks.getAuthStatus).toHaveBeenCalledTimes(1);
    expect(mocks.getMe).toHaveBeenCalledTimes(1);
    const { result } = await boot();
    expect(result.current.user?.id).toBe('usr_1');
    expect(result.current.deck).toHaveLength(1);
    expect(mocks.getMe).toHaveBeenCalledTimes(1);
    // The voice input takes its setting from the same answer
    expect((await loadVoiceConfig()).mode).toBe('off');
    expect(mocks.getAuthStatus).toHaveBeenCalledTimes(1);
  });

  it('sends changes made offline first, then loads deck and lists', async () => {
    mocks.outbox = 2;
    const order: string[] = [];
    mocks.flushOfflineQueue.mockImplementation(async () => {
      order.push('flush');
      return 2;
    });
    mocks.getTriageDeck.mockImplementation(async () => {
      order.push('deck');
      return [];
    });
    prefetchAuthStatus();
    expect(mocks.getMe).not.toHaveBeenCalled();
    const { result } = await boot();
    expect(result.current.user?.id).toBe('usr_1');
    expect(order).toEqual(['flush', 'deck']);
  });

  it('waits for the ticket on the return from the OIDC provider', async () => {
    window.history.replaceState(null, '', '/?oidc=ticket');
    const order: string[] = [];
    mocks.oidcExchange.mockImplementation(async () => {
      order.push('exchange');
      mocks.token = 'neu';
      return { token: 'neu' };
    });
    mocks.getMe.mockImplementation(async () => {
      order.push('me:' + mocks.token);
      return me;
    });
    prefetchAuthStatus();
    expect(mocks.getMe).not.toHaveBeenCalled();
    const { result } = await boot();
    expect(order).toEqual(['exchange', 'me:neu']);
    expect(result.current.user?.id).toBe('usr_1');
  });

  it('does not load an account without a stored session', async () => {
    mocks.token = '';
    prefetchAuthStatus();
    const { result } = await boot();
    expect(mocks.getMe).not.toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it('drops the account when the server needs its setup', async () => {
    mocks.getAuthStatus.mockResolvedValue({ needsSetup: true, allowRegistration: false, instanceName: 'MindSift' });
    prefetchAuthStatus();
    const { result } = await boot();
    await act(async () => {});
    expect(result.current.user).toBeNull();
    expect(mocks.token).toBe('');
  });
});

describe('realtime events', () => {
  const send = (event: string, payload: unknown = {}) =>
    act(() => {
      window.dispatchEvent(new CustomEvent('mindsift:ws', { detail: { event, payload, timestamp: '' } }));
    });
  const status = (connected: boolean) =>
    act(() => {
      window.dispatchEvent(new CustomEvent('mindsift:ws:status', { detail: { connected, transport: 'ws' } }));
    });

  async function bootWithFakeTimers() {
    const hook = await boot();
    mocks.getTriageDeck.mockClear();
    vi.useFakeTimers();
    return hook;
  }
  afterEach(() => vi.useRealTimers());

  it('a burst of task changes in a shared list makes one stats request and no deck request', async () => {
    await bootWithFakeTimers();
    for (let i = 0; i < 30; i++) send('TASK_UPDATED', { id: 'th_task' + i, status: 'kept' });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // Not at once: other people's changes follow in the shared rhythm
    expect(mocks.getStats).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(mocks.getStats).toHaveBeenCalledTimes(1);
    expect(mocks.getTriageDeck).not.toHaveBeenCalled();
  });

  it('a thought sorted elsewhere reloads the deck', async () => {
    await bootWithFakeTimers();
    send('TASK_UPDATED', { id: 'th_1', status: 'kept' });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mocks.getTriageDeck).toHaveBeenCalledTimes(1);
  });

  it('the echo of an own change updates the counters at once', async () => {
    await bootWithFakeTimers();
    mocks.lastWrite = Date.now();
    send('ITEM_TOGGLED', { id: 'it_1' });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mocks.getStats).toHaveBeenCalledTimes(1);
  });

  it('ignores reordered list entries and edits inside a note', async () => {
    await bootWithFakeTimers();
    send('ITEM_REORDERED', { listId: 'l_1' });
    send('DOC_SEQ', { docId: 'd_1' });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mocks.getStats).not.toHaveBeenCalled();
  });

  it('loads counters and deck after the connection came back', async () => {
    await bootWithFakeTimers();
    status(true);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mocks.getStats).not.toHaveBeenCalled();
    status(false);
    status(true);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mocks.getStats).toHaveBeenCalledTimes(1);
    expect(mocks.getTriageDeck).toHaveBeenCalledTimes(1);
  });
});

describe('demo reset countdown', () => {
  const demoStatus = (seconds: number) => ({
    needsSetup: false,
    allowRegistration: false,
    instanceName: 'MindSift',
    demoMode: true,
    demoResetInSeconds: seconds,
    demoResetMinutes: 20,
  });
  const secondsLeft = (deadline: number | null) => Math.round(((deadline ?? 0) - Date.now()) / 1000);

  async function bootDemo(seconds: number) {
    mocks.getAuthStatus.mockResolvedValue(demoStatus(seconds));
    const hook = await boot();
    vi.useFakeTimers();
    mocks.getAuthStatus.mockClear();
    mocks.getMe.mockClear();
    return hook;
  }
  afterEach(() => vi.useRealTimers());

  it('asks again after the countdown ran out until the server names the next reset', async () => {
    const { result } = await bootDemo(3);
    expect(secondsLeft(result.current.demoDeadline)).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    // The reset is still running: the server names the deadline just passed, then fails once
    mocks.getAuthStatus.mockResolvedValueOnce(demoStatus(0)).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(demoStatus(1200));
    act(() => result.current.handleDemoCountdownElapsed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.getAuthStatus).toHaveBeenCalledTimes(1);
    expect(secondsLeft(result.current.demoDeadline)).toBeLessThanOrEqual(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000 + 20000);
    });
    expect(mocks.getAuthStatus).toHaveBeenCalledTimes(3);
    // The countdown runs again, and the data of the reset demo are loaded although no DEMO_RESET came
    expect(secondsLeft(result.current.demoDeadline)).toBe(1200);
    expect(mocks.getMe).toHaveBeenCalledTimes(1);
    expect(result.current.demoNotice).toBe('Demo-Instanz wurde zurückgesetzt');
  });

  it('DEMO_RESET and the countdown reload the data once and the countdown starts over', async () => {
    const { result } = await bootDemo(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // The event comes before the server announces the next deadline: asked again 5 s later
    mocks.getAuthStatus.mockResolvedValueOnce(demoStatus(0)).mockResolvedValue(demoStatus(1199));
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mindsift:ws', { detail: { event: 'DEMO_RESET', payload: {}, timestamp: '' } }));
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.handleDemoCountdownElapsed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.getAuthStatus).toHaveBeenCalledTimes(2);
    expect(secondsLeft(result.current.demoDeadline)).toBe(1199);
    expect(mocks.getMe).toHaveBeenCalledTimes(1);
    // The next round works the same way
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1199 * 1000);
    });
    mocks.getAuthStatus.mockResolvedValue(demoStatus(1200));
    act(() => result.current.handleDemoCountdownElapsed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(secondsLeft(result.current.demoDeadline)).toBe(1200);
    expect(mocks.getMe).toHaveBeenCalledTimes(2);
  });

  it('asks for the next reset after the connection came back', async () => {
    const { result } = await bootDemo(600);
    mocks.getAuthStatus.mockResolvedValue(demoStatus(590));
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mindsift:ws:status', { detail: { connected: false, transport: 'ws' } }));
      window.dispatchEvent(new CustomEvent('mindsift:ws:status', { detail: { connected: true, transport: 'ws' } }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.getAuthStatus).toHaveBeenCalledTimes(1);
    expect(secondsLeft(result.current.demoDeadline)).toBe(590);
    // The deadline had not passed: no reset, nothing reloaded
    expect(mocks.getMe).not.toHaveBeenCalled();
  });
});

describe('desktop app', () => {
  const desktopStatus = { needsSetup: false, allowRegistration: false, instanceName: 'MindSift', desktop: { platform: 'linux', realtime: 'sse' } };

  it('signs in by itself on the first start, without a sign-in screen', async () => {
    mocks.token = '';
    mocks.desktop = true;
    mocks.getAuthStatus.mockResolvedValue(desktopStatus);
    const { result } = await boot();
    expect(mocks.desktopSignIn).toHaveBeenCalledTimes(1);
    expect(mocks.token).toBe('desktop-tok');
    expect(result.current.user?.id).toBe('usr_1');
  });

  it('keeps a stored session at a restart', async () => {
    mocks.desktop = true;
    mocks.getAuthStatus.mockResolvedValue(desktopStatus);
    const { result } = await boot();
    expect(mocks.desktopSignIn).not.toHaveBeenCalled();
    expect(result.current.user?.id).toBe('usr_1');
  });

  it('gets a new session when the old one ended, instead of showing the sign-in', async () => {
    mocks.desktop = true;
    mocks.getAuthStatus.mockResolvedValue(desktopStatus);
    const signedOut = vi.fn();
    const hook = renderHook(() => useSessionBootstrap(signedOut));
    await waitFor(() => expect(hook.result.current.bootLoading).toBe(false));
    mocks.token = '';
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mindsift:unauthorized'));
    });
    await waitFor(() => expect(mocks.desktopSignIn).toHaveBeenCalledTimes(1));
    expect(signedOut).not.toHaveBeenCalled();
    expect(hook.result.current.user?.id).toBe('usr_1');
  });

  it('a normal server never asks for a desktop session', async () => {
    mocks.token = '';
    await boot();
    expect(mocks.desktopSignIn).not.toHaveBeenCalled();
  });
});
