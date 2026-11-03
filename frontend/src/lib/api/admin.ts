// REST calls: Administration: users, invites, server settings, voice, organizations
import { Organization, SystemSettings, SharingMode, User, UserInvite, VoiceAdminStatus } from '../types';
import { authHeaders, ensureArray, request } from './client';
import i18n from '../../i18n';

export const adminApi = {
  // --- ADMIN & STAFF PANEL ---
  async adminGetUsers(): Promise<User[]> {
    const res = await request<User[]>('/api/v1/admin/users');
    return ensureArray(res);
  },

  async adminCreateUser(payload: {
    email: string;
    password: string;
    displayName: string;
    role: string;
    organizationId?: string;
  }): Promise<User> {
    return request<User>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminUpdateUser(
    id: string,
    patch: {
      displayName?: string;
      email?: string;
      role?: string;
      isActive?: boolean;
      discordWebhookUrl?: string;
    }
  ): Promise<User> {
    return request<User>(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async adminResetPassword(id: string, password: string): Promise<void> {
    await request(`/api/v1/admin/users/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
  },

  async adminDeleteUser(id: string): Promise<void> {
    await request(`/api/v1/admin/users/${id}`, { method: 'DELETE' });
  },

  async adminGetInvites(): Promise<UserInvite[]> {
    const res = await request<UserInvite[]>('/api/v1/admin/invites');
    return ensureArray(res);
  },

  async adminCreateInvite(payload: {
    email?: string;
    role: string;
    organizationId?: string;
    maxUses?: number;
  }): Promise<UserInvite> {
    return request<UserInvite>('/api/v1/admin/invites', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async verifyEmail(token: string): Promise<{ verified: boolean; pending: boolean; message: string }> {
    return request('/api/v1/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
  },

  async resendVerification(email: string): Promise<void> {
    await request('/api/v1/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async adminSendInvite(id: string, email: string): Promise<UserInvite> {
    return request<UserInvite>(`/api/v1/admin/invites/${id}/send`, { method: 'POST', body: JSON.stringify({ email }) });
  },

  async adminApproveUser(id: string): Promise<User> {
    return request<User>(`/api/v1/admin/users/${id}/approve`, { method: 'POST' });
  },

  async adminDeleteInvite(id: string): Promise<void> {
    await request(`/api/v1/admin/invites/${id}`, { method: 'DELETE' });
  },

  async adminVoiceStatus(): Promise<VoiceAdminStatus> {
    return request<VoiceAdminStatus>('/api/v1/admin/voice');
  },

  // Sends a recording to the own Whisper server (voice mode "server") and returns the text
  async transcribe(audio: Blob): Promise<string> {
    const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', audio, `aufnahme.${ext}`);
    const res = await fetch('/api/v1/voice/transcribe', {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || i18n.t('common:errors.transcribeFailed', { status: res.status }));
    return data.text || '';
  },

  async adminGetSettings(): Promise<SystemSettings> {
    return request<SystemSettings>('/api/v1/admin/settings');
  },

  async adminUpdateSettings(settings: SystemSettings): Promise<SystemSettings> {
    return request<SystemSettings>('/api/v1/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  // Counts shares and group memberships a switch to `mode` would remove
  async adminSharingImpact(mode: SharingMode): Promise<number> {
    const res = await request<{ affected: number }>(`/api/v1/admin/settings/sharing-impact?mode=${mode}`);
    return res.affected || 0;
  },

  // --- ORGANIZATIONS (server admin only) ---
  async adminGetOrganizations(): Promise<Organization[]> {
    return ensureArray(await request<Organization[]>('/api/v1/admin/organizations'));
  },

  async adminCreateOrganization(name: string): Promise<Organization> {
    return request<Organization>('/api/v1/admin/organizations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async adminRenameOrganization(id: string, name: string): Promise<void> {
    await request(`/api/v1/admin/organizations/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },

  async adminDeleteOrganization(id: string): Promise<void> {
    await request(`/api/v1/admin/organizations/${id}`, { method: 'DELETE' });
  },

  async adminSetUserOrganization(userId: string, organizationId: string): Promise<void> {
    await request(`/api/v1/admin/users/${userId}/organization`, {
      method: 'PUT',
      body: JSON.stringify({ organizationId }),
    });
  },

  async adminTestSMTP(toEmail: string): Promise<{ status: string }> {
    return request<{ status: string }>('/api/v1/admin/smtp/test', {
      method: 'POST',
      body: JSON.stringify({ toEmail }),
    });
  },
};
