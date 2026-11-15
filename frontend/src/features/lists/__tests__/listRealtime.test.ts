import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ListItem, SharedList, WSMessage } from '../../../lib/types';
import { createRealtimeConnection } from '../../../lib/api';
import { LIST_RELOAD_EVENTS, listsAfterEvent, listsAfterMessage, useListRealtime } from '../useListRealtime';
import { RELOAD_SHARED_DELAY_MS, RELOAD_SOON_MS } from '../../../lib/realtimeReload';

vi.mock('../../../lib/api', async (original) => ({
  ...(await original<typeof import('../../../lib/api')>()),
  createRealtimeConnection: vi.fn(() => ({ close: vi.fn() })),
}));

const item = (id: string, i: Partial<ListItem> = {}) =>
  ({ id, listId: 'l1', content: id, isCompleted: false, sortOrder: 0, createdAt: '', ...i }) as ListItem;
const lists = () =>
  [
    { id: 'l1', title: 'A', items: [item('a'), item('b', { isCompleted: true })] },
    { id: 'l2', title: 'B', items: [item('c', { listId: 'l2' })] },
  ] as SharedList[];
const msg = (event: string, payload: unknown, listId = 'l1') => ({ event, listId, payload }) as WSMessage;
const ids = (l: SharedList[], i = 0) => l[i].items.map((x) => x.id);

describe('shopping list realtime updates', () => {
  it('adds a created entry once, on top of its own list', () => {
    const prev = lists();
    const next = listsAfterMessage(prev, msg('ITEM_CREATED', item('n')));
    expect(ids(next)).toEqual(['n', 'a', 'b']);
    expect(next[1]).toBe(prev[1]);
    expect(ids(listsAfterMessage(next, msg('ITEM_CREATED', item('n'))))).toEqual(['n', 'a', 'b']);
    expect(listsAfterMessage(prev, msg('ITEM_CREATED', null))).toBe(prev);
  });

  it('replaces toggled or updated entries, removes deleted ones and clears done ones', () => {
    const prev = lists();
    expect(listsAfterMessage(prev, msg('ITEM_TOGGLED', item('a', { isCompleted: true })))[0].items[0].isCompleted).toBe(true);
    expect(listsAfterMessage(prev, msg('ITEM_UPDATED', item('a', { quantity: '2x' })))[0].items[0].quantity).toBe('2x');
    expect(ids(listsAfterMessage(prev, msg('ITEM_DELETED', { itemId: 'a' })))).toEqual(['b']);
    expect(ids(listsAfterMessage(prev, msg('LIST_CLEARED', {})))).toEqual(['a']);
  });

  it('reads the list from list_id too and ignores events without a list', () => {
    const prev = lists();
    const next = listsAfterMessage(prev, { event: 'ITEM_DELETED', list_id: 'l2', payload: { itemId: 'c' } } as unknown as WSMessage);
    expect(ids(next, 1)).toEqual([]);
    expect(listsAfterMessage(prev, { event: 'ITEM_DELETED', payload: { itemId: 'a' } } as WSMessage)).toBe(prev);
  });

  it('reloads only for list events it cannot apply', () => {
    expect(LIST_RELOAD_EVENTS).toEqual(['LIST_SHARED', 'LIST_UNSHARED']);
    const prev = lists();
    for (const e of LIST_RELOAD_EVENTS) expect(listsAfterEvent(prev, msg(e, {}))).toEqual({ lists: prev, reload: true });
    // A new list: the creating tab shows it already, another device of the creator loads
    expect(listsAfterEvent(prev, msg('LIST_CREATED', { id: 'l1' }))).toEqual({ lists: prev, reload: false });
    expect(listsAfterEvent(prev, msg('LIST_CREATED', { id: 'l9' })).reload).toBe(true);
    expect(listsAfterEvent(prev, msg('LIST_CREATED', null)).reload).toBe(true);
    expect(listsAfterEvent(prev, msg('ITEM_CREATED', item('n'))).reload).toBe(false);
  });
});

describe('list events applied from what they carry', () => {
  it('takes title, icon, entries and members of a changed list, but keeps this person\'s role', () => {
    const prev = [{ ...lists()[0], isOwner: false, role: 'viewer', items: [item('itm_offline_1'), item('a')] }, lists()[1]] as SharedList[];
    const payload = {
      id: 'l1',
      title: 'Wocheneinkauf',
      icon: '🥕',
      isOwner: true,
      role: 'owner',
      items: [item('x'), item('a', { quantity: '3' })],
      members: [{ userId: 'u1', displayName: 'Anna', role: 'owner' }],
    };
    const { lists: next, reload } = listsAfterEvent(prev, msg('LIST_UPDATED', payload));
    expect(reload).toBe(false);
    expect(next[0]).toMatchObject({ title: 'Wocheneinkauf', icon: '🥕', isOwner: false, role: 'viewer' });
    expect(ids(next)).toEqual(['itm_offline_1', 'x', 'a']); // not sent yet: stays
    expect(next[0].members).toHaveLength(1);
    expect(next[1]).toBe(prev[1]);
    // A list not shown here (shared just now): load
    expect(listsAfterEvent(prev, msg('LIST_UPDATED', { id: 'l9', title: 'Neu' }, 'l9')).reload).toBe(true);
  });

  it('removes a deleted list and loads only when none is left', () => {
    const prev = lists();
    expect(listsAfterEvent(prev, msg('LIST_DELETED', { listId: 'l2' }, 'l2'))).toEqual({ lists: [prev[0]], reload: false });
    expect(listsAfterEvent([prev[0]], msg('LIST_DELETED', { listId: 'l1' }))).toEqual({ lists: [], reload: true });
    expect(listsAfterEvent(prev, msg('LIST_DELETED', { listId: 'l7' }, 'l7')).lists).toBe(prev);
  });

  it('applies reordered entries, also moved into another category', () => {
    const prev = [{ id: 'l1', title: 'A', items: [item('a', { sortOrder: 0 }), item('b', { sortOrder: 1 }), item('c', { sortOrder: 2 })] }] as SharedList[];
    const moved = [
      { id: 'c', sortOrder: 0, category: 'Obst', content: 'Äpfel #Obst' },
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ];
    const { lists: next, reload } = listsAfterEvent(prev, msg('ITEM_REORDERED', { listId: 'l1', items: moved }));
    expect(reload).toBe(false);
    expect(ids(next)).toEqual(['c', 'a', 'b']);
    expect(next[0].items[0]).toMatchObject({ category: 'Obst', content: 'Äpfel #Obst' });
    // The echo of one's own move changes nothing
    expect(listsAfterEvent(next, msg('ITEM_REORDERED', { listId: 'l1', items: moved })).lists).toBe(next);
    // Another list's move is not this view's business
    expect(listsAfterEvent(prev, msg('ITEM_REORDERED', { items: moved }, 'l9')).lists).toBe(prev);
  });
});

// loadLists decides which list stays open from what the view shows now: one kept from an earlier render
// would switch back to the list that was open then
describe('reloading the lists on a list event', () => {
  const shown = lists();
  const setLists = vi.fn();
  const hook = (first: () => Promise<void>) =>
    renderHook(({ load }) => useListRealtime('l1', shown, setLists, load), { initialProps: { load: first } });
  const ws = (detail: unknown) => window.dispatchEvent(new CustomEvent('mindsift:ws', { detail }));
  let hidden = false;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (hidden ? 'hidden' : 'visible'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setLists.mockClear();
  });

  it('uses the loadLists of the latest render, once for a burst of events', () => {
    const first = vi.fn(async () => {});
    const latest = vi.fn(async () => {});
    const { rerender, unmount } = hook(first);
    rerender({ load: latest });
    for (let i = 0; i < 20; i++) ws({ event: 'LIST_SHARED', payload: {} });
    vi.advanceTimersByTime(RELOAD_SHARED_DELAY_MS);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    unmount();
  });

  it('applies entry and list events without loading', () => {
    const load = vi.fn(async () => {});
    const { unmount } = hook(load);
    ws({ event: 'ITEM_CREATED', listId: 'l1', payload: item('n') });
    ws({ event: 'ITEM_REORDERED', listId: 'l1', payload: { listId: 'l1', items: [{ id: 'b', sortOrder: 0 }] } });
    ws({ event: 'LIST_UPDATED', listId: 'l1', payload: { id: 'l1', title: 'Neu' } });
    vi.advanceTimersByTime(60_000);
    expect(load).not.toHaveBeenCalled();
    expect(setLists).toHaveBeenCalledTimes(3);
    const update = setLists.mock.calls[2][0] as (prev: SharedList[]) => SharedList[];
    expect(update(shown)[0].title).toBe('Neu');
    unmount();
  });

  it('a hidden tab loads when it is visible again, a reconnect loads once', () => {
    const load = vi.fn(async () => {});
    const { unmount } = hook(load);
    hidden = true;
    ws({ event: 'LIST_UNSHARED', listId: 'l1', payload: {} });
    vi.advanceTimersByTime(60_000);
    expect(load).not.toHaveBeenCalled();
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    vi.advanceTimersByTime(RELOAD_SOON_MS);
    expect(load).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new CustomEvent('mindsift:ws:status', { detail: { connected: false, transport: 'websocket' } }));
      window.dispatchEvent(new CustomEvent('mindsift:ws:status', { detail: { connected: true, transport: 'websocket' } }));
    });
    vi.advanceTimersByTime(RELOAD_SOON_MS);
    expect(load).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('the open list\'s connection only joins its room (its messages arrive as mindsift:ws too)', () => {
    const { unmount } = hook(vi.fn(async () => {}));
    expect(vi.mocked(createRealtimeConnection).mock.lastCall![0]).toEqual({ listId: 'l1' });
    unmount();
  });
});
