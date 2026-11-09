// REST calls: the notification center (bell)
import { CenterEntry } from '../types';
import { ensureArray, request } from './client';

export const centerApi = {
  async getNotifications(limit = 50): Promise<{ items: CenterEntry[]; unread: number }> {
    const res = await request<{ items: CenterEntry[]; unread: number }>(`/api/v1/notifications?limit=${limit}`);
    return { items: ensureArray(res?.items), unread: res?.unread || 0 };
  },

  // Without ids: all entries
  async markNotificationsRead(ids?: number[]): Promise<void> {
    await request('/api/v1/notifications/read', { method: 'POST', body: JSON.stringify({ ids: ids || [] }) });
  },

  async clearNotifications(): Promise<void> {
    await request('/api/v1/notifications', { method: 'DELETE' });
  },
};
