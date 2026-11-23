// REST calls: Themes, API keys, OAuth consent, search, import/export and backups
import {
  APIKey,
  OAuthAuthorizeInfo,
  BackupFile,
  BackupLocation,
  DataSection,
  ApiKeyScope,
  PriorityLevel,
  UserTheme,
  ImportSummary,
  SearchResults,
  SearchFilter, DeletedAccountBackups, SecondFactorProof, CalendarFeedState, SnapshotStaged, SnapshotTakeOver } from '../types';
import { ensureArray, fetchHealth, request, requestRaw, downloadBlob } from './client';
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

  // proof: the second factor, when the account has one (askSecondFactor.withSecondFactor)
  async createAPIKey(name: string, scopes: ApiKeyScope[], proof?: SecondFactorProof): Promise<APIKey> {
    return request<APIKey>('/api/v1/keys', {
      method: 'POST',
      body: JSON.stringify({ name, scopes, ...proof }),
    });
  },

  async updateAPIKey(id: string, patch: { name?: string; scopes?: ApiKeyScope[] }): Promise<APIKey> {
    return request<APIKey>(`/api/v1/keys/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  async deleteAPIKey(id: string): Promise<void> {
    await request(`/api/v1/keys/${id}`, { method: 'DELETE' });
  },

  // --- CALENDAR SUBSCRIPTION (read-only iCalendar feed of the own tasks) ---
  async getCalendarFeed(): Promise<CalendarFeedState> {
    return request<CalendarFeedState>('/api/v1/calendar-feed');
  },

  // Switches the feed on with a new address; an earlier address stops working
  async renewCalendarFeed(): Promise<CalendarFeedState> {
    return request<CalendarFeedState>('/api/v1/calendar-feed', { method: 'PUT' });
  },

  async disableCalendarFeed(): Promise<CalendarFeedState> {
    return request<CalendarFeedState>('/api/v1/calendar-feed', { method: 'DELETE' });
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
    const res = await requestRaw(`/api/v1/import/${source}${params.toString() ? `?${params}` : ''}`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || i18n.t('common:errors.importFailed', { status: res.status }));
    return data as ImportSummary;
  },

  // --- Automatic server backups ---
  async adminListBackups(): Promise<BackupFile[]> {
    return ensureArray(await request<BackupFile[]>('/api/v1/admin/backups'));
  },

  // Desktop app only: where the backups go (the default is backups/ in the instance's folder)
  async adminGetBackupLocation(): Promise<BackupLocation> {
    return request<BackupLocation>('/api/v1/admin/backups/location');
  },

  // Desktop app only: '' goes back to the default folder; the server checks the folder and creates it
  async adminSetBackupLocation(dir: string): Promise<BackupLocation> {
    return request<BackupLocation>('/api/v1/admin/backups/location', { method: 'PUT', body: JSON.stringify({ dir }) });
  },

  // Desktop app only: a server's database snapshot (.db.gz) is staged; the answer lists its accounts
  async adminStageServerSnapshot(file: File): Promise<SnapshotStaged> {
    const form = new FormData();
    form.append('file', file);
    const res = await requestRaw('/api/v1/admin/backups/server-snapshot', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || i18n.t('common:errors.importFailed', { status: res.status }));
    return { token: data.token, accounts: ensureArray(data.accounts) };
  },

  // Desktop app only: the chosen account of the staged snapshot into the local account (preview: only the summary)
  async adminTakeOverSnapshotAccount(
    token: string,
    account: string,
    opts: { preview: boolean; mode: 'merge' | 'restore'; sections: DataSection[]; settings: boolean }
  ): Promise<SnapshotTakeOver> {
    const params = new URLSearchParams({ account, mode: opts.mode, sections: opts.sections.join(',') });
    if (opts.preview) params.set('preview', '1');
    if (!opts.settings) params.set('settings', '0');
    return request<SnapshotTakeOver>(`/api/v1/admin/backups/server-snapshot/${encodeURIComponent(token)}?${params}`, {
      method: 'POST',
      timeout: 'slow',
    });
  },

  async adminDiscardServerSnapshot(token: string): Promise<void> {
    await request(`/api/v1/admin/backups/server-snapshot/${encodeURIComponent(token)}`, { method: 'DELETE' });
  },

  async adminRunBackup(): Promise<BackupFile[]> {
    return ensureArray(await request<BackupFile[]>('/api/v1/admin/backups', { method: 'POST', timeout: 'slow' }));
  },

  async adminDeleteBackup(name: string): Promise<BackupFile[]> {
    return ensureArray(await request<BackupFile[]>(`/api/v1/admin/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }));
  },

  async adminDownloadBackup(name: string): Promise<Blob> {
    return downloadBlob(`/api/v1/admin/backups/${encodeURIComponent(name)}`);
  },

  // The browser's own download of a backup (a link: several GB go to disk, not into the page's memory),
  // authorized by a one-time stream ticket
  async adminBackupDownloadUrl(name: string): Promise<string> {
    const res = await request<{ ticket?: string }>('/api/v1/auth/stream-ticket', { method: 'POST' });
    return `/api/v1/admin/backup-download/${encodeURIComponent(name)}?ticket=${encodeURIComponent(res.ticket ?? '')}`;
  },

  // Restores the whole instance from a backup of the list; the server reopens afterwards (202).
  // acceptKeyMismatch: after 409 secrets_key_mismatch, restore anyway (features/settings/restoreKeyCheck.ts)
  async adminRestoreBackup(name: string, acceptKeyMismatch = false): Promise<{ restarting: boolean; preRestoreBackup: string }> {
    return request(`/api/v1/admin/backups/${encodeURIComponent(name)}/restore`, {
      method: 'POST',
      body: JSON.stringify({ confirm: name, acceptKeyMismatch }),
      timeout: 'slow',
    });
  },

  // The same from an uploaded backup (lib/backupUpload.ts)
  async adminRestoreUpload(
    id: string,
    name: string,
    sha256: string,
    acceptKeyMismatch = false,
  ): Promise<{ restarting: boolean; preRestoreBackup: string }> {
    return request(`/api/v1/admin/backups/uploads/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      body: JSON.stringify({ confirm: name, sha256, acceptKeyMismatch }),
      timeout: 'slow',
    });
  },

  async adminDiscardUpload(id: string): Promise<void> {
    await request(`/api/v1/admin/backups/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // The id of the server's current start (/health): it changes once a restore has reopened the data
  async serverBoot(): Promise<string | null> {
    return (await fetchHealth())?.boot ?? null;
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
    return request<ImportSummary>(`/api/v1/backups/${encodeURIComponent(name)}/restore?${params}`, { method: 'POST', timeout: 'slow' });
  },

  // Danger zone: both need the current password
  async purgeOwnData(password: string, proof?: SecondFactorProof): Promise<void> {
    await request('/api/v1/user/data', { method: 'DELETE', body: JSON.stringify({ password, ...proof }), timeout: 'slow' });
  },

  // New login or alarm address (storage/email_change.go): the link from the mail, keep the old one, new link
  async confirmEmailChange(token: string): Promise<{ confirmed: boolean; kind: 'account'; message: string }> {
    return request('/api/v1/auth/confirm-email', { method: 'POST', body: JSON.stringify({ token }) });
  },

  async cancelEmailChange(kind: 'account'): Promise<void> {
    await request(`/api/v1/user/email-change/${kind}`, { method: 'DELETE' });
  },

  async resendEmailChange(kind: 'account'): Promise<void> {
    await request(`/api/v1/user/email-change/${kind}/resend`, { method: 'POST' });
  },

  async deleteOwnAccount(password: string, proof?: SecondFactorProof): Promise<void> {
    await request('/api/v1/user/account', { method: 'DELETE', body: JSON.stringify({ password, ...proof }), timeout: 'slow' });
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
