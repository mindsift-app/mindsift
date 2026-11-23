// REST calls: Administration: users, invites, server settings, voice, organizations
import { AuditPage, Organization, SetupInfo, SmtpForm, SpeechModelsInfo, SystemSettings, SharingMode, TranscriptionJob, UpdateStatus, User, UserInvite, VoiceAdminStatus } from '../types';
import { ensureArray, request, requestRaw } from './client';
import i18n from '../../i18n';

// File name of a recording for the Whisper server, after its format
function recordingName(audio: Blob): string {
  const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
  return `aufnahme.${ext}`;
}

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
    organizationIds?: string[];
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
      username?: string;
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

  // mustChange: a new own password at the next sign-in; revokeKeys: the account's API keys, AI connections
  // (MCP) and calendar subscription go as well. The answer counts what was revoked.
  async adminResetPassword(
    id: string,
    password: string,
    options: { mustChange?: boolean; revokeKeys?: boolean } = {}
  ): Promise<{ keysRevoked?: number; connectionsRevoked?: number; calendarFeedRevoked?: boolean }> {
    return request<{ keysRevoked?: number; connectionsRevoked?: number; calendarFeedRevoked?: boolean }>(`/api/v1/admin/users/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password, mustChange: Boolean(options.mustChange), revokeKeys: Boolean(options.revokeKeys) }),
    });
  },

  // Removes every second factor of the account (app, passkeys, recovery codes, trusted devices)
  async adminResetMfa(id: string): Promise<void> {
    await request(`/api/v1/admin/users/${id}/mfa/reset`, { method: 'POST' });
  },

  async adminDeleteUser(id: string): Promise<void> {
    await request(`/api/v1/admin/users/${id}`, { method: 'DELETE', timeout: 'slow' });
  },

  async adminGetInvites(): Promise<UserInvite[]> {
    const res = await request<UserInvite[]>('/api/v1/admin/invites');
    return ensureArray(res);
  },

  // Invites always create members
  async adminCreateInvite(payload: {
    email?: string;
    organizationIds?: string[];
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
    return request<UserInvite>(`/api/v1/admin/invites/${id}/send`, { method: 'POST', body: JSON.stringify({ email }), timeout: 'slow' });
  },

  async adminApproveUser(id: string): Promise<User> {
    return request<User>(`/api/v1/admin/users/${id}/approve`, { method: 'POST' });
  },

  async adminDeleteInvite(id: string): Promise<void> {
    await request(`/api/v1/admin/invites/${id}`, { method: 'DELETE' });
  },

  async adminUpdateStatus(): Promise<UpdateStatus> {
    return request<UpdateStatus>('/api/v1/admin/update');
  },

  // Puts the hint for this release aside for the signed-in admin; a newer release shows it again
  async adminDismissUpdate(version: string): Promise<UpdateStatus> {
    return request<UpdateStatus>('/api/v1/admin/update/dismiss', { method: 'POST', body: JSON.stringify({ version }) });
  },

  async adminVoiceStatus(): Promise<VoiceAdminStatus> {
    return request<VoiceAdminStatus>('/api/v1/admin/voice');
  },

  // The models of the Whisper server: which are downloaded, the one in use, downloads under way
  async adminSpeechModels(): Promise<SpeechModelsInfo> {
    return request<SpeechModelsInfo>('/api/v1/admin/voice/models');
  },

  // Deletes a downloaded model on the Whisper server (not the one in use)
  async adminDeleteSpeechModel(model: string): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/v1/admin/voice/models/${model.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });
  },

  // Lets the Whisper server download a model; select makes it the one in use once it is there

  async adminDownloadSpeechModel(model: string, select: boolean): Promise<{ downloaded: boolean }> {
    return request<{ downloaded: boolean }>(`/api/v1/admin/voice/models/${model.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      body: JSON.stringify({ select }),
    });
  },

  // Sends a recording to the own Whisper server (voice mode "server") and returns the text
  async transcribe(audio: Blob, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append('file', audio, recordingName(audio));
    const res = await requestRaw('/api/v1/voice/transcribe', { method: 'POST', body: form, signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || i18n.t('common:errors.transcribeFailed', { status: res.status }));
    return data.text || '';
  },

  // Background transcriptions (lib/transcriptionJobs.ts). A recording in a note: its text becomes the caption
  async transcribeBlock(docId: string, blockId: string): Promise<TranscriptionJob> {
    return request<TranscriptionJob>(`/api/v1/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(blockId)}/transcribe`, { method: 'POST' });
  },

  async docTranscriptions(docId: string): Promise<TranscriptionJob[]> {
    return ensureArray(await request<TranscriptionJob[]>(`/api/v1/documents/${encodeURIComponent(docId)}/transcriptions`));
  },

  // A recording dictated into the inbox, stored on the server with the text of the parts known already;
  // the server makes the entry once the rest is transcribed
  async captureVoice(parts: { blob: Blob; text: string | null }[]): Promise<TranscriptionJob> {
    const form = new FormData();
    for (const p of parts) form.append('file', p.blob, recordingName(p.blob));
    form.append('texts', JSON.stringify(parts.map((p) => p.text)));
    const res = await requestRaw('/api/v1/voice/captures', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || i18n.t('common:errors.transcribeFailed', { status: res.status }));
    return data as TranscriptionJob;
  },

  async voiceJobs(): Promise<TranscriptionJob[]> {
    return ensureArray(await request<TranscriptionJob[]>('/api/v1/voice/jobs'));
  },

  async retryVoiceJob(id: string): Promise<TranscriptionJob> {
    return request<TranscriptionJob>(`/api/v1/voice/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' });
  },

  async deleteVoiceJob(id: string): Promise<void> {
    await request<{ deleted: boolean }>(`/api/v1/voice/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  // --- ORGANIZATIONS (server admins and user managers) ---
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

  async adminAddOrganizationMember(orgId: string, userId: string): Promise<void> {
    await request(`/api/v1/admin/organizations/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  },

  // dryRun: only count the shares and group memberships that would go
  async adminRemoveOrganizationMember(orgId: string, userId: string, dryRun = false): Promise<number> {
    const res = await request<{ affected?: number }>(
      `/api/v1/admin/organizations/${orgId}/members/${userId}${dryRun ? '?dryRun=true' : ''}`,
      { method: 'DELETE' }
    );
    return res?.affected || 0;
  },

  // Mail server, BASE_URL and backup folder for the summary of the setup wizard
  async getSetupStatus(): Promise<SetupInfo> {
    return request<SetupInfo>('/api/v1/admin/setup/status');
  },

  // smtp: a mail server to try before it is stored (setup wizard); left out, the configured one
  async adminTestSMTP(toEmail: string, smtp?: SmtpForm): Promise<{ status: string }> {
    return request<{ status: string }>('/api/v1/admin/smtp/test', {
      method: 'POST',
      body: JSON.stringify(smtp ? { toEmail, smtp } : { toEmail }),
      timeout: 'slow',
    });
  },

  // Audit log, newest first: action is a key or a category ending in a dot, user an account id, before
  // the nextBefore of the previous page
  async adminGetAudit(params: { action?: string; user?: string; before?: number; limit?: number } = {}): Promise<AuditPage> {
    const q = new URLSearchParams();
    if (params.action) q.set('action', params.action);
    if (params.user) q.set('user', params.user);
    if (params.before) q.set('before', String(params.before));
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    const res = await request<AuditPage>(`/api/v1/admin/audit${qs ? `?${qs}` : ''}`);
    return { entries: ensureArray(res?.entries), nextBefore: res?.nextBefore || 0 };
  },
};
