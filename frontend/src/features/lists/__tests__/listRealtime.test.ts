import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ListItem, SharedList, WSMessage } from '../../../lib/types';
import { createRealtimeConnection } from '../../../lib/api';
import { LIST_RELOAD_EVENTS, listsAfterMessage, useListRealtime } from '../useListRealtime';

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

  it('reloads on list-level events', () => {
    expect(LIST_RELOAD_EVENTS).toContain('LIST_SHARED');
    expect(LIST_RELOAD_EVENTS).toContain('ITEM_REORDERED');
    expect(LIST_RELOAD_EVENTS).not.toContain('ITEM_CREATED');
  });
});

// loadLists decides which list stays open from what the view shows now: one kept from an earlier render
// would switch back to the list that was open then
describe('reloading the lists on a list event', () => {
  const shown = lists();
  const setLists = vi.fn();
  const hook = (first: () => Promise<void>) =>
    renderHook(({ load }) => useListRealtime('l1', shown, setLists, load), { initialProps: { load: first } });

  it('uses the loadLists of the latest render for events of the app connection', () => {
    const first = vi.fn(async () => {});
    const latest = vi.fn(async () => {});
    const { rerender } = hook(first);
    rerender({ load: latest });
    window.dispatchEvent(new CustomEvent('mindsift:ws', { detail: { event: 'LIST_UPDATED' } }));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    // Entry events are not a reason to reload
    window.dispatchEvent(new CustomEvent('mindsift:ws', { detail: { event: 'ITEM_CREATED' } }));
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('uses it for events of the open list\'s connection too', () => {
    const first = vi.fn(async () => {});
    const latest = vi.fn(async () => {});
    const { rerender } = hook(first);
    rerender({ load: latest });
    const { onMessage } = vi.mocked(createRealtimeConnection).mock.lastCall![0];
    onMessage?.({ event: 'ITEM_REORDERED', listId: 'l1' } as WSMessage);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
