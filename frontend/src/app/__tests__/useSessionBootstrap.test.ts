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
}));

vi.mock('../../lib/api', () => ({
  api: {
    getAuthStatus: mocks.getAuthStatus,
    getMe: mocks.getMe,
    getTriageDeck: mocks.getTriageDeck,
    getAllLists: mocks.getAllLists,
    flushOfflineQueue: mocks.flushOfflineQueue,
    oidcExchange: mocks.oidcExchange,
    getStats: vi.fn(),
  },
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
