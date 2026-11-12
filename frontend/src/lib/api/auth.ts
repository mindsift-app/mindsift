// REST calls: Login, first-boot setup, sessions and account settings
import {
  AuthStatus,
  DashboardStats,
  LoginResult,
  MfaLoginResult,
  MfaStatus,
  Retention,
  SharingMode,
  Session,
  SmtpForm,
  User,
  NotificationSettings,
} from '../types';
import { setToken, clearToken, ensureArray, request, setCurrentSharingMode, setCurrentPeopleSearch } from './client';
import { forgetTrust, rememberTrust, trustedDeviceId, trustTokens } from '../trustedDevice';
import { clearStoredNotes } from '../docSync/persist';
import { clearUndoHistories } from '../docSync/undoHistory';

export const authApi = {
  // --- AUTH, FIRST-BOOT SETUP & SETTINGS ---
  async getAuthStatus(): Promise<AuthStatus> {
    const st = await request<AuthStatus>('/api/v1/auth/status');
    if (st.sharingMode) setCurrentSharingMode(st.sharingMode);
    setCurrentPeopleSearch(st.peopleSearch !== false);
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
      clearUndoHistories();
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
    backupEnabled?: boolean;
    backupTime?: string;
    backupRetentionDays?: number;
    smtp?: SmtpForm;
  }): Promise<{ token: string; user: User }> {
    const res = await request<{ token: string; user: User }>('/api/v1/auth/setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setToken(res.token);
    return res;
  },

  // The wizard's instance settings after an admin from ADMIN_USER (only while getMe says setupPending);
  // email: the admin's address when ADMIN_EMAIL was missing, taken once the mailed link is clicked
  async finishSetup(payload: {
    instanceName?: string;
    sharingMode?: SharingMode;
    allowRegistration?: boolean;
    createSampleData?: boolean;
    defaultLanguage?: string;
    backupEnabled?: boolean;
    backupTime?: string;
    backupRetentionDays?: number;
    smtp?: SmtpForm;
    email?: string;
  }): Promise<void> {
    await request<{ done: boolean }>('/api/v1/admin/setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Public: always the same answer, whether the address exists or not
  async requestPasswordReset(email: string): Promise<void> {
    await request('/api/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await request('/api/v1/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
  },

  // A session, or the second step when the account has an authenticator app and this device is not
  // trusted (lib/trustedDevice.ts)
  async login(loginOrEmail: string, password: string): Promise<LoginResult> {
    const res = await request<LoginResult>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: loginOrEmail, username: loginOrEmail, login: loginOrEmail, password, trustTokens: trustTokens() }),
    });
    if (!('mfaToken' in res)) setToken(res.token);
    return res;
  },

  // Second step: a code of the app or a recovery code; trustDevice spares the code here for 30 days
  async loginMfa(mfaToken: string, code: string, trustDevice: boolean): Promise<MfaLoginResult> {
    const res = await request<MfaLoginResult>('/api/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code, trustDevice }),
    });
    setToken(res.token);
    if (res.trustToken && res.trustedDeviceId) rememberTrust(res.user.id, res.trustedDeviceId, res.trustToken);
    return res;
  },

  async getMfaStatus(): Promise<MfaStatus> {
    return request<MfaStatus>('/api/v1/auth/mfa');
  },

  // A new secret for the authenticator app; on only after confirmTotp
  async setupTotp(password: string): Promise<{ secret: string; uri: string }> {
    return request('/api/v1/auth/mfa/totp/setup', { method: 'POST', body: JSON.stringify({ password }) });
  },

  async confirmTotp(code: string): Promise<{ recoveryCodes: string[]; enabledAt: string }> {
    return request('/api/v1/auth/mfa/totp/confirm', { method: 'POST', body: JSON.stringify({ code }) });
  },

  async disableTotp(userId: string, password: string, code: string): Promise<void> {
    await request('/api/v1/auth/mfa/totp/disable', { method: 'POST', body: JSON.stringify({ password, code }) });
    forgetTrust(userId);
  },

  async newRecoveryCodes(password: string, code: string): Promise<{ recoveryCodes: string[] }> {
    return request('/api/v1/auth/mfa/recovery-codes', { method: 'POST', body: JSON.stringify({ password, code }) });
  },

  // id omitted: every trusted device of the account
  async removeTrustedDevice(userId: string, id?: string): Promise<void> {
    await request(id ? `/api/v1/auth/mfa/trusted-devices/${encodeURIComponent(id)}` : '/api/v1/auth/mfa/trusted-devices', {
      method: 'DELETE',
    });
    if (!id || id === trustedDeviceId(userId)) forgetTrust(userId);
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

  // setupPending: an admin from ADMIN_USER still has the wizard's instance settings to choose
  async getMe(): Promise<{ user: User; stats: DashboardStats; isLastAdmin?: boolean; setupPending?: boolean }> {
    return request<{ user: User; stats: DashboardStats; isLastAdmin?: boolean; setupPending?: boolean }>('/api/v1/auth/me');
  },

  async updateSettings(patch: {
    displayName?: string;
    email?: string;
    password?: string;
    currentPassword?: string;
    avatarUrl?: string;
    alarmChannels?: string[];
    discordWebhookUrl?: string;
    customWebhookUrl?: string;
    notifyBeforeMinutes?: number;
    notificationSettings?: NotificationSettings;
    doneRetentionDays?: number;
    voiceInput?: '' | 'browser';
    voiceLanguage?: string;
    language?: string;
    retention?: Retention;
    tourOffered?: boolean;
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
      timeout: 'slow',
    });
  },

  async getStats(): Promise<DashboardStats> {
    return request<DashboardStats>('/api/v1/stats');
  },

  async getUsersDirectory(): Promise<User[]> {
    const res = await request<User[]>('/api/v1/users/directory');
    return ensureArray(res);
  },

  // One person by exact e-mail address or username (sharing without people search); 404 = not found
  async lookupUser(login: string): Promise<User> {
    return request<User>('/api/v1/users/lookup', { method: 'POST', body: JSON.stringify({ login }) });
  },
};
