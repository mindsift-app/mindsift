import { describe, it, expect } from 'vitest';
import { ListItem, SharedList, WSMessage } from '../../../lib/types';
import { LIST_RELOAD_EVENTS, listsAfterMessage } from '../useListRealtime';

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
