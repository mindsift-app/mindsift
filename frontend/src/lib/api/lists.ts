// REST calls: shared lists and their items
import { ListItem, ListShare, SharedList } from '../types';
import { OfflineError, enqueue, dropQueued, updateQueued, OFFLINE_ITEM_PREFIX } from '../offline';
import { ensureArray, request } from './client';

export const listsApi = {
  // --- LISTS ---
  async getAllLists(): Promise<SharedList[]> {
    const res = await request<SharedList[]>('/api/v1/lists');
    return ensureArray(res).map((l) => ({
      ...l,
      items: ensureArray(l.items),
      shares: ensureArray(l.shares),
    }));
  },

  // The person's own order of the list tabs
  async setListOrder(ids: string[]): Promise<void> {
    await request('/api/v1/lists/order', { method: 'PUT', body: JSON.stringify({ ids }) });
  },

  async getListById(listId: string): Promise<SharedList> {
    const l = await request<SharedList>(`/api/v1/lists/${listId}`);
    return {
      ...l,
      items: ensureArray(l.items),
      shares: ensureArray(l.shares),
    };
  },

  async createList(titleOrSpaceId: string, titleOrIcon?: string, iconOrType?: string, listType?: 'shopping' | 'checklist' | 'vacation'): Promise<SharedList> {
    let title = titleOrSpaceId;
    // An empty icon means "no icon"; only a missing one gets the default
    let icon = titleOrIcon ?? '🛒';
    let type: string = iconOrType || 'shopping';
    if (listType !== undefined) {
      title = titleOrIcon || '';
      icon = iconOrType ?? '🛒';
      type = listType;
    }
    const l = await request<SharedList>('/api/v1/lists', {
      method: 'POST',
      body: JSON.stringify({ title, icon, listType: type }),
    });
    return {
      ...l,
      items: ensureArray(l.items),
      shares: ensureArray(l.shares),
    };
  },

  async updateList(listId: string, patch: { title?: string; icon?: string }): Promise<SharedList> {
    return request<SharedList>(`/api/v1/lists/${listId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async deleteList(listId: string): Promise<void> {
    await request(`/api/v1/lists/${listId}`, { method: 'DELETE' });
  },

  async getListShares(listId: string): Promise<ListShare[]> {
    const res = await request<ListShare[]>(`/api/v1/lists/${listId}/shares`);
    return ensureArray(res);
  },

  async addListShare(listId: string, target: { targetType: 'team' | 'user'; targetId: string; role?: string }): Promise<ListShare> {
    return request<ListShare>(`/api/v1/lists/${listId}/shares`, {
      method: 'POST',
      body: JSON.stringify(target),
    });
  },

  async removeListShare(listId: string, shareId: string): Promise<void> {
    await request(`/api/v1/lists/${listId}/shares/${shareId}`, { method: 'DELETE' });
  },

  async createListItem(listId: string, content: string, category = '', quantity = ''): Promise<ListItem> {
    const path = `/api/v1/lists/${listId}/items`;
    try {
      return await request<ListItem>(path, { method: 'POST', body: JSON.stringify({ content, category, quantity }) });
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      // Kept in the outbox and sent when the connection is back; until then a stand-in in the list
      const entry = enqueue('POST', path, { content, category, quantity });
      return {
        id: OFFLINE_ITEM_PREFIX + entry.id,
        listId,
        content,
        category,
        quantity,
        isCompleted: false,
        sortOrder: 0,
        createdAt: entry.createdAt,
      } as ListItem;
    }
  },

  // isCompleted is the wanted state ("ticked"), never a toggle: sent late from the outbox it cannot undo
  // somebody who ticked the same item meanwhile (the server keeps what is already so)
  async toggleListItem(listId: string, itemId: string, isCompleted?: boolean): Promise<ListItem> {
    // Added offline and checked off before it was sent: nothing left to send
    if (itemId.startsWith(OFFLINE_ITEM_PREFIX) && isCompleted) {
      dropQueued(itemId.slice(OFFLINE_ITEM_PREFIX.length));
      return { id: itemId, listId, isCompleted: true } as ListItem;
    }
    const changedAt = Date.now(); // the tap, not when a slow connection gave up
    const path = `/api/v1/lists/${listId}/items/${itemId}`;
    try {
      return await request<ListItem>(path, {
        method: 'PATCH',
        body: JSON.stringify({ isCompleted }),
      });
    } catch (err) {
      if (!(err instanceof OfflineError) || isCompleted === undefined) throw err;
      // When it was ticked goes along: an older tick does not undo a newer change made meanwhile.
      // Ticked and un-ticked again offline leaves nothing to send.
      enqueue('PATCH', path, { isCompleted, changedAt }, { isCompleted: !isCompleted });
      return { id: itemId, listId, isCompleted } as ListItem;
    }
  },

  // Only the given fields are sent and written; offline the change waits in the outbox
  async updateListItem(
    listId: string,
    itemId: string,
    payload: { content?: string; category?: string; quantity?: string }
  ): Promise<ListItem> {
    if (itemId.startsWith(OFFLINE_ITEM_PREFIX)) {
      updateQueued(itemId.slice(OFFLINE_ITEM_PREFIX.length), payload);
      return { id: itemId, listId, ...payload } as ListItem;
    }
    const path = `/api/v1/lists/${listId}/items/${itemId}`;
    try {
      return await request<ListItem>(path, { method: 'PUT', body: JSON.stringify(payload) });
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      enqueue('PUT', path, payload);
      return { id: itemId, listId, ...payload } as ListItem;
    }
  },

  async deleteListItem(listId: string, itemId: string): Promise<void> {
    if (itemId.startsWith(OFFLINE_ITEM_PREFIX)) {
      dropQueued(itemId.slice(OFFLINE_ITEM_PREFIX.length));
      return;
    }
    const path = `/api/v1/lists/${listId}/items/${itemId}`;
    try {
      await request(path, { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      // Sent later; its queued ticks and edits are dropped
      enqueue('DELETE', path, {});
    }
  },

  async moveListItem(listId: string, itemId: string, targetListId: string): Promise<ListItem> {
    return request<ListItem>(`/api/v1/lists/${listId}/items/${itemId}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetListId }),
    });
  },

  async clearCompletedItems(listId: string): Promise<{ removed: number }> {
    return request<{ removed: number }>(`/api/v1/lists/${listId}/clear-completed`, {
      method: 'POST',
    });
  },

  async reorderListItems(
    listId: string,
    items: { id: string; sortOrder: number; category?: string; content?: string }[]
  ): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/v1/lists/${listId}/items/reorder`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  },
};
