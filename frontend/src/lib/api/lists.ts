// REST calls: Spaces, shared lists and their items
import { ListItem, ListShare, SharedList, Space, SpaceShare } from '../types';
import { OfflineError, enqueue, dropQueued, updateQueued, OFFLINE_ITEM_PREFIX } from '../offline';
import { ensureArray, request } from './client';

export const listsApi = {
  // --- SPACES & REALTIME LISTS ---
  async getSpaces(): Promise<Space[]> {
    const res = await request<Space[]>('/api/v1/spaces');
    return ensureArray(res).map((s) => ({
      ...s,
      members: ensureArray(s.members),
      shares: ensureArray(s.shares),
    }));
  },

  async getSpaceShares(spaceId: string): Promise<SpaceShare[]> {
    const res = await request<SpaceShare[]>(`/api/v1/spaces/${spaceId}/shares`);
    return ensureArray(res);
  },

  async createSpace(name: string, icon: string, description: string): Promise<Space> {
    return request<Space>('/api/v1/spaces', {
      method: 'POST',
      body: JSON.stringify({ name, icon, description }),
    });
  },

  async joinSpace(inviteCode: string): Promise<Space> {
    return request<Space>('/api/v1/spaces/join', {
      method: 'POST',
      body: JSON.stringify({ inviteCode }),
    });
  },

  async addSpaceMember(spaceId: string, target: { userId?: string; email?: string; teamId?: string; role?: string }): Promise<any> {
    return request<any>(`/api/v1/spaces/${spaceId}/members`, {
      method: 'POST',
      body: JSON.stringify(target),
    });
  },

  async removeSpaceMember(spaceId: string, userId: string): Promise<void> {
    await request(`/api/v1/spaces/${spaceId}/members/${userId}`, {
      method: 'DELETE',
    });
  },

  async getSpaceLists(spaceId: string): Promise<SharedList[]> {
    const res = await request<SharedList[]>(`/api/v1/spaces/${spaceId}/lists`);
    return ensureArray(res).map((l) => ({
      ...l,
      items: ensureArray(l.items),
    }));
  },

  async getAllLists(): Promise<SharedList[]> {
    const res = await request<SharedList[]>('/api/v1/lists');
    return ensureArray(res).map((l) => ({
      ...l,
      items: ensureArray(l.items),
      shares: ensureArray(l.shares),
    }));
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
    let type = (iconOrType as any) || 'shopping';
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

  async toggleListItem(listId: string, itemId: string, isCompleted?: boolean): Promise<ListItem> {
    // Added offline and checked off before it was sent: nothing left to send
    if (itemId.startsWith(OFFLINE_ITEM_PREFIX) && isCompleted) {
      dropQueued(itemId.slice(OFFLINE_ITEM_PREFIX.length));
      return { id: itemId, listId, isCompleted: true } as ListItem;
    }
    try {
      return await request<ListItem>(`/api/v1/lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isCompleted }),
      });
    } catch (err) {
      if (!(err instanceof OfflineError) || isCompleted === undefined) throw err;
      enqueue('PATCH', `/api/v1/lists/${listId}/items/${itemId}`, { isCompleted });
      return { id: itemId, listId, isCompleted } as ListItem;
    }
  },

  async updateListItem(
    listId: string,
    itemId: string,
    payload: { content?: string; category?: string; quantity?: string }
  ): Promise<ListItem> {
    if (itemId.startsWith(OFFLINE_ITEM_PREFIX)) {
      updateQueued(itemId.slice(OFFLINE_ITEM_PREFIX.length), payload);
      return { id: itemId, listId, ...payload } as ListItem;
    }
    return request<ListItem>(`/api/v1/lists/${listId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteListItem(listId: string, itemId: string): Promise<void> {
    if (itemId.startsWith(OFFLINE_ITEM_PREFIX)) {
      dropQueued(itemId.slice(OFFLINE_ITEM_PREFIX.length));
      return;
    }
    await request(`/api/v1/lists/${listId}/items/${itemId}`, { method: 'DELETE' });
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
