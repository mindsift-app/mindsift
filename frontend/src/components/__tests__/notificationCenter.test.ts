import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { CenterEntry, WSMessage } from '../../lib/types';

const mocks = vi.hoisted(() => ({ getNotifications: vi.fn() }));
vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  api: { getNotifications: mocks.getNotifications },
}));

import { CENTER_LIMIT, CenterState, centerAfterEvent, useNotificationCenter } from '../notificationCenter';
import { RELOAD_SOON_MS } from '../../lib/realtimeReload';

const entry = (id: number, e: Partial<CenterEntry> = {}): CenterEntry => ({
  id,
  kind: 'taskDone',
  title: 'Einkaufen',
  text: 'Anna hat „Einkaufen“ erledigt',
  createdAt: '2026-11-15T10:00:00Z',
  read: false,
  ...e,
});
const msg = (event: string, payload: unknown): WSMessage => ({ event, payload, timestamp: '' });
const ids = (s: CenterState) => s.items.map((e) => e.id);

describe('how realtime events change the bell', () => {
  const start: CenterState = { items: [entry(2), entry(1, { read: true })], unread: 7 };

  it('puts a new entry on top and counts it, without loading', () => {
    const { state, reload } = centerAfterEvent(start, msg('NOTIFICATION', entry(3)));
    expect(ids(state)).toEqual([3, 2, 1]);
    expect(state.unread).toBe(8);
    expect(reload).toBe(false);
    // The same entry again changes nothing
    const again = centerAfterEvent(state, msg('NOTIFICATION', entry(3))).state;
    expect(ids(again)).toEqual([3, 2, 1]);
    expect(again.unread).toBe(8);
  });

  it('keeps at most the newest 50', () => {
    const full: CenterState = { items: Array.from({ length: CENTER_LIMIT }, (_, i) => entry(CENTER_LIMIT - i)), unread: 0 };
    const { state } = centerAfterEvent(full, msg('NOTIFICATION', entry(100)));
    expect(state.items).toHaveLength(CENTER_LIMIT);
    expect(state.items[0].id).toBe(100);
  });

  it('drops the entries the server says the new one replaced (a watched task keeps one entry)', () => {
    const prev: CenterState = {
      items: [
        entry(5, { kind: 'watched', targetType: 'task', targetId: 'th_a' }),
        entry(4, { kind: 'watched', targetType: 'task', targetId: 'th_b' }),
        entry(3, { kind: 'watched', targetType: 'task', targetId: 'th_a', read: true }),
      ],
      unread: 2,
    };
    const next = entry(6, { kind: 'watched', targetType: 'task', targetId: 'th_a', replaces: [3, 5] });
    const { state, reload } = centerAfterEvent(prev, msg('NOTIFICATION', next));
    expect(ids(state)).toEqual([6, 4]);
    expect(state.unread).toBe(2); // one unread replaced by another
    expect(reload).toBe(false);
    expect(state.items[0].replaces).toBeUndefined(); // not kept with the entry
    // The task was deleted: no target, the ids still say which entry goes
    const gone = centerAfterEvent(state, msg('NOTIFICATION', entry(7, { kind: 'watched', replaces: [6] })));
    expect(ids(gone.state)).toEqual([7, 4]);
    expect(gone.reload).toBe(false);
    // Without replaces nothing else goes, whatever the kind
    expect(ids(centerAfterEvent(gone.state, msg('NOTIFICATION', entry(8, { kind: 'watched', targetType: 'task', targetId: 'th_b' }))).state)).toEqual([8, 7, 4]);
  });

  it('loads when a replaced entry beyond the newest 50 may have been unread, or the payload is unknown', () => {
    const full: CenterState = { items: Array.from({ length: CENTER_LIMIT }, (_, i) => entry(CENTER_LIMIT - i)), unread: 3 };
    expect(centerAfterEvent(full, msg('NOTIFICATION', entry(100, { replaces: [2] }))).reload).toBe(false);
    expect(centerAfterEvent(full, msg('NOTIFICATION', entry(100, { replaces: [-5] }))).reload).toBe(true);
    expect(centerAfterEvent(start, msg('NOTIFICATION', entry(9, { replaces: [-5] }))).reload).toBe(false);
    expect(centerAfterEvent(start, msg('NOTIFICATION', null)).reload).toBe(true);
  });

  it('marks the entries read that the event names, all of them without ids', () => {
    const prev: CenterState = { items: [entry(3), entry(2), entry(1, { read: true })], unread: 5 };
    const some = centerAfterEvent(prev, msg('NOTIFICATIONS_READ', { ids: [3, 1, 99] })).state;
    expect(some.items.map((e) => e.read)).toEqual([true, false, true]);
    expect(some.unread).toBe(4);
    // Already read here (own click): nothing changes, nothing counted twice
    expect(centerAfterEvent(some, msg('NOTIFICATIONS_READ', { ids: [3] })).state).toBe(some);
    const all = centerAfterEvent(prev, msg('NOTIFICATIONS_READ', { ids: null })).state;
    expect(all.items.every((e) => e.read)).toBe(true);
    expect(all.unread).toBe(0);
  });

  it('empties the bell when cleared and ignores other events', () => {
    expect(centerAfterEvent(start, msg('NOTIFICATIONS_CLEARED', {})).state).toEqual({ items: [], unread: 0 });
    expect(centerAfterEvent(start, msg('TASK_UPDATED', {})).state).toBe(start);
  });
});

describe('the bells share one list', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getNotifications.mockResolvedValue({ items: [entry(1)], unread: 1 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const ws = (m: WSMessage) => window.dispatchEvent(new CustomEvent('mindsift:ws', { detail: m }));
  const status = (connected: boolean) =>
    window.dispatchEvent(new CustomEvent('mindsift:ws:status', { detail: { connected, transport: 'websocket' } }));

  it('loads once for both bells, applies events without a request and loads once after a reconnect', async () => {
    const phone = renderHook(() => useNotificationCenter());
    const desktop = renderHook(() => useNotificationCenter());
    await act(async () => {});
    expect(mocks.getNotifications).toHaveBeenCalledTimes(1);
    expect(desktop.result.current.unread).toBe(1);

    act(() => {
      for (let i = 2; i < 12; i++) ws(msg('NOTIFICATION', entry(i)));
      ws(msg('NOTIFICATIONS_READ', { ids: [2] }));
    });
    vi.advanceTimersByTime(10_000);
    expect(mocks.getNotifications).toHaveBeenCalledTimes(1);
    expect(phone.result.current.items[0].id).toBe(11);
    expect(phone.result.current.unread).toBe(10);

    act(() => {
      status(false);
      status(true);
    });
    vi.advanceTimersByTime(RELOAD_SOON_MS);
    await act(async () => {});
    expect(mocks.getNotifications).toHaveBeenCalledTimes(2);
    expect(phone.result.current.unread).toBe(1);

    phone.unmount();
    desktop.unmount();
  });
});
