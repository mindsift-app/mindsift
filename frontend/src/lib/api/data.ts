// REST calls: Themes, API keys, OAuth consent, search, import/export and backups
import {
  APIKey,
  OAuthAuthorizeInfo,
  BackupFile,
  DataSection,
  ApiKeyScope,
  PriorityLevel,
  UserTheme,
  ImportSummary,
  SearchResults,
  SearchFilter, DeletedAccountBackups } from '../types';
import { authHeaders, ensureArray, request, downloadBlob } from './client';
import i18n from '../../i18n';

export const dataApi = {
  // --- CUSTOM THEMES ---
  async getThemes(): Promise<UserTheme[]> {
    return ensureArray(await request<UserTheme[]>('/api/v1/themes'));
  },

  // Creates a theme, or updates it when `id` is given
  async saveTheme(theme: { id?: string; name: string; css: string }): Promise<UserTheme> {
    return request<UserTheme>('/api/v1/themes', {
      method: 'POST',
      body: JSON.stringify(theme),
    });
  },

  async deleteTheme(id: string): Promise<void> {
    await request(`/api/v1/themes/${id}`, { method: 'DELETE' });
  },

  // --- API KEYS, WEBHOOKS & EXPORT ---
  async getAPIKeys(): Promise<APIKey[]> {
    const res = await request<APIKey[]>('/api/v1/keys');
    return ensureArray(res);
  },

  async createAPIKey(name: string, scopes: ApiKeyScope[]): Promise<APIKey> {
    return request<APIKey>('/api/v1/keys', {
      method: 'POST',
      body: JSON.stringify({ name, scopes }),
    });
  },

  async updateAPIKey(id: string, patch: { name?: string; scopes?: ApiKeyScope[] }): Promise<APIKey> {
    return request<APIKey>(`/api/v1/keys/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  async deleteAPIKey(id: string): Promise<void> {
    await request(`/api/v1/keys/${id}`, { method: 'DELETE' });
  },

  // --- OAUTH CONSENT (claude.ai, ChatGPT connect to MCP) ---
  /** query: the search string of /oauth/authorize as the client sent it */
  async getOAuthAuthorizeInfo(query: string): Promise<OAuthAuthorizeInfo> {
    return request<OAuthAuthorizeInfo>(`/api/v1/oauth/authorize${query}`);
  },

  /** Allow (with the chosen rights) or refuse; returns where to send the browser */
  async answerOAuthAuthorize(query: string, approve: boolean, scopes: ApiKeyScope[]): Promise<{ redirect: string }> {
    const q = new URLSearchParams(query);
    return request<{ redirect: string }>('/api/v1/oauth/authorize', {
      method: 'POST',
      body: JSON.stringify({
        responseType: q.get('response_type') || '',
        clientId: q.get('client_id') || '',
        redirectUri: q.get('redirect_uri') || '',
        codeChallenge: q.get('code_challenge') || '',
        codeChallengeMethod: q.get('code_challenge_method') || '',
        state: q.get('state') || '',
        scope: q.get('scope') || '',
        resource: q.get('resource') || '',
        approve,
        scopes,
      }),
    });
  },

  /** Simulator: sends like an external system would, with the given key or else the own session. */
  async testWebhookIngest(
    apiKey: string | null,
    payload: {
      title: string;
      priority?: PriorityLevel;
      tags?: string[];
      target?: 'triage' | 'task' | 'list_item';
      taskListId?: string;
      listId?: string;
    }
  ): Promise<{ status: string }> {
    return request<{ status: string }>('/api/v1/webhooks/ingest', {
      method: 'POST',
      headers: apiKey ? { 'X-API-Key': apiKey } : {},
      body: JSON.stringify(payload),
    });
  },

  // signal: a newer search aborts this one, so the server stops working on it
  async searchAll(q: string, filter: SearchFilter = {}, signal?: AbortSignal): Promise<SearchResults> {
    const params = new URLSearchParams({ q });
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== '') params.set(k, String(v));
    }
    return request<SearchResults>(`/api/v1/search?${params.toString()}`, { signal });
  },

  async exportAll(): Promise<any> {
    return request<any>('/api/v1/export');
  },

  // Import of MindSift data (JSON backup or Markdown archive) or an Obsidian vault (ZIP).
  // preview = true only reports what would be created.
  // mode 'restore' (MindSift data only) deletes the user's notes, tasks and lists before importing
  async importData(
    source: 'mindsift' | 'obsidian',
    file: File,
    preview: boolean,
    mode: 'merge' | 'restore' = 'merge',
    sections?: DataSection[]
  ): Promise<ImportSummary> {
    const form = new FormData();
    form.append('file', file);
    const params = new URLSearchParams();
    if (preview) params.set('preview', '1');
    if (mode === 'restore') params.set('mode', 'restore');
    if (sections && sections.length > 0) params.set('sections', sections.join(','));
    const res = await fetch(`/api/v1/import/${source}${params.toString() ? `?${params}` : ''}`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || i18n.t('common:errors.importFailed', { status: res.status }));
    return data as ImportSummary;
  },

  // --- Automatic server backups ---
  async adminListBackups(): Promise<BackupFile[]> {
    return ensureArray(await request<BackupFile[]>('/api/v1/admin/backups'));
  },

  async adminRunBackup(): Promise<BackupFile[]> {
    return ensureArray(await request<BackupFile[]>('/api/v1/admin/backups', { method: 'POST' }));
  },

  async adminDeleteBackup(name: string): Promise<BackupFile[]> {
    return ensureArray(await request<BackupFile[]>(`/api/v1/admin/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }));
  },

  async adminDownloadBackup(name: string): Promise<Blob> {
    return downloadBlob(`/api/v1/admin/backups/${encodeURIComponent(name)}`);
  },

  // Backups of accounts an admin deleted, kept for the backup retention period
  async adminDeletedBackups(): Promise<DeletedAccountBackups[]> {
    return ensureArray(await request<DeletedAccountBackups[]>('/api/v1/admin/backups/deleted'));
  },

  async adminDownloadDeletedBackup(userId: string, name: string): Promise<Blob> {
    return downloadBlob(`/api/v1/admin/backups/deleted/${encodeURIComponent(userId)}/${encodeURIComponent(name)}`);
  },

  async listMyBackups(): Promise<BackupFile[]> {
    return ensureArray(await request<BackupFile[]>('/api/v1/backups'));
  },

  async downloadMyBackup(name: string): Promise<Blob> {
    return downloadBlob(`/api/v1/backups/${encodeURIComponent(name)}`);
  },

  async restoreMyBackup(name: string, mode: 'merge' | 'restore', sections: DataSection[], preview = false): Promise<ImportSummary> {
    const params = new URLSearchParams({ mode, sections: sections.join(',') });
    if (preview) params.set('preview', '1');
    return request<ImportSummary>(`/api/v1/backups/${encodeURIComponent(name)}/restore?${params}`, { method: 'POST' });
  },

  // Danger zone: both need the current password
  async purgeOwnData(password: string): Promise<void> {
    await request('/api/v1/user/data', { method: 'DELETE', body: JSON.stringify({ password }) });
  },

  // New login or alarm address (storage/email_change.go): the link from the mail, keep the old one, new link
  async confirmEmailChange(token: string): Promise<{ confirmed: boolean; kind: 'account' | 'alarm'; message: string }> {
    return request('/api/v1/auth/confirm-email', { method: 'POST', body: JSON.stringify({ token }) });
  },

  async cancelEmailChange(kind: 'account' | 'alarm'): Promise<void> {
    await request(`/api/v1/user/email-change/${kind}`, { method: 'DELETE' });
  },

  async resendEmailChange(kind: 'account' | 'alarm'): Promise<void> {
    await request(`/api/v1/user/email-change/${kind}/resend`, { method: 'POST' });
  },

  async deleteOwnAccount(password: string): Promise<void> {
    await request('/api/v1/user/account', { method: 'DELETE', body: JSON.stringify({ password }) });
  },

  // Full backup (all data as JSON) packed into a ZIP; restorable via importData('mindsift', …)
  async exportBackupZip(): Promise<Blob> {
    return downloadBlob('/api/v1/export?format=zip');
  },

  // Obsidian-compatible ZIP of the workspace; binary and possibly large, so no JSON helper and no timeout
  async exportMarkdownVault(): Promise<Blob> {
    return downloadBlob('/api/v1/export/markdown');
  },
};
