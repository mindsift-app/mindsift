// REST calls: Login, first-boot setup, sessions and account settings
import { AuthStatus, DashboardStats, Retention, SharingMode, Session, User, NotificationSettings } from '../types';
import { setToken, clearToken, ensureArray, request, setCurrentSharingMode } from './client';
import { clearStoredNotes } from '../docSync/persist';

export const authApi = {
  // --- AUTH, FIRST-BOOT SETUP & SETTINGS ---
  async getAuthStatus(): Promise<AuthStatus> {
    const st = await request<AuthStatus>('/api/v1/auth/status');
    if (st.sharingMode) setCurrentSharingMode(st.sharingMode);
    return st;
  },

  // Public, works before login
  async getLegalText(type: 'imprint' | 'privacy'): Promise<string> {
    const res = await request<{ content: string }>(`/api/v1/legal/${type}`);
    return res.content || '';
  },

  async logout(): Promise<void> {
    try {
      await request<{ success: boolean }>('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      clearToken();
      await clearStoredNotes();
    }
  },

  async listSessions(): Promise<Session[]> {
    return ensureArray(await request<Session[]>('/api/v1/auth/sessions'));
  },

  async endSession(id: string): Promise<void> {
    await request(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async revokeAllSessions(): Promise<void> {
    await request<{ success: boolean }>('/api/v1/auth/revoke-all', { method: 'POST' });
  },

  async completeSetup(payload: {
    email: string;
    password: string;
    displayName: string;
    instanceName?: string;
    sharingMode?: SharingMode;
    allowRegistration?: boolean;
    createSampleData?: boolean;
    defaultLanguage?: string;
  }): Promise<{ token: string; user: User }> {
    const res = await request<{ token: string; user: User }>('/api/v1/auth/setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setToken(res.token);
    return res;
  },

  // Public: always the same answer, whether the address exists or not
  async requestPasswordReset(email: string): Promise<void> {
    await request('/api/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await request('/api/v1/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
  },

  async login(loginOrEmail: string, password: string): Promise<{ token: string; user: User }> {
    const res = await request<{ token: string; user: User }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: loginOrEmail, username: loginOrEmail, login: loginOrEmail, password }),
    });
    setToken(res.token);
    return res;
  },

  async register(
    email: string,
    password: string,
    displayName: string,
    inviteCode?: string
  ): Promise<{ token?: string; user?: User; pending?: boolean; message?: string }> {
    const res = await request<{ token?: string; user?: User; pending?: boolean; message?: string }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, inviteCode: inviteCode || '' }),
    });
    // Waiting for approval: no session yet
    if (res.token) setToken(res.token);
    return res;
  },

  async getMe(): Promise<{ user: User; stats: DashboardStats; isLastAdmin?: boolean }> {
    return request<{ user: User; stats: DashboardStats; isLastAdmin?: boolean }>('/api/v1/auth/me');
  },

  async updateSettings(patch: {
    displayName?: string;
    email?: string;
    password?: string;
    currentPassword?: string;
    avatarUrl?: string;
    alarmChannels?: string[];
    alarmEmail?: string;
    discordWebhookUrl?: string;
    customWebhookUrl?: string;
    notifyBeforeMinutes?: number;
    notificationSettings?: NotificationSettings;
    doneRetentionDays?: number;
    voiceInput?: '' | 'browser';
    language?: string;
    retention?: Retention;
  }): Promise<User> {
    return request<User>('/api/v1/auth/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async testAlarmChannel(
    channel: 'email' | 'discord' | 'webhook',
    target?: string
  ): Promise<{ status: string }> {
    return request<{ status: string }>('/api/v1/auth/alarms/test', {
      method: 'POST',
      body: JSON.stringify({ channel, target: target || '' }),
    });
  },

  async getStats(): Promise<DashboardStats> {
    return request<DashboardStats>('/api/v1/stats');
  },

  async getUsersDirectory(): Promise<User[]> {
    const res = await request<User[]>('/api/v1/users/directory');
    return ensureArray(res);
  },
};
