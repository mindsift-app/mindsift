// Token, request() with offline cache and session renewal, and small helpers shared by the REST modules
import { SharingMode } from '../types';
import { OfflineError, isOffline, isCacheablePath, readCached, writeCached, clearOfflineData } from '../offline';
import i18n from '../../i18n';

const TOKEN_STORAGE_KEY = 'mindsift_jwt_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function getCurrentUserId(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(atob(parts[1]));
      return payload.userId || payload.sub || payload.id || null;
    }
  } catch {}
  return null;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  // Cached answers and unsent changes belong to the account that just left
  void clearOfflineData();
}

// Authorization and the app's language: the server answers errors in it
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return { 'Accept-Language': i18n.language || 'de', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// An error answer of the server; code is a stable name for errors the app reacts to (e.g. email_unverified)
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function triggerHaptic(pattern: number | number[] = 15): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore on desktop browsers
  }
}

export function ensureArray<T>(val: T[] | null | undefined): T[] {
  return Array.isArray(val) ? val : [];
}

// How long request() waits for the answer; after that the server counts as unreachable.
// - normal: ordinary calls, answered within a second
// - slow: the server itself is busy for a while (restoring or writing backups, deleting an account with
//   all it holds) or waits for somebody else (a test mail through a mail server that does not answer).
//   The server keeps the connection open as long (allowLongWork in internal/api/bodylimit.go).
// Uploads and downloads of whole files do not go through request() and have no timeout.
export const REQUEST_TIMEOUT = { normal: 12_000, slow: 5 * 60_000 } as const;

type RequestOptions = RequestInit & { timeout?: keyof typeof REQUEST_TIMEOUT };

export async function request<T>(path: string, { timeout = 'normal', ...options }: RequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const cacheable = method === 'GET' && isCacheablePath(path);
  const userKey = getCurrentUserId() || 'anon';

  // Known to be offline: answer from the cache right away instead of waiting for the timeout
  if (cacheable && isOffline()) {
    const cached = await readCached<T>(userKey, path);
    if (cached !== undefined) return cached;
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    ...(options.headers as Record<string, string>),
    ...authHeaders(),
  };

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT[timeout]);
  // The caller can abort too (e.g. a newer search makes this one pointless)
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    // No HTTP answer at all (offline, server down, timeout): fall back to the last known answer
    if (cacheable) {
      const cached = await readCached<T>(userKey, path);
      if (cached !== undefined) return cached;
    }
    throw new OfflineError();
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (
    res.status === 401 &&
    !path.includes('/auth/login') &&
    !path.includes('/auth/register') &&
    !path.includes('/auth/setup') &&
    !path.includes('/auth/status')
  ) {
    clearToken();
    window.dispatchEvent(new CustomEvent('mindsift:unauthorized'));
  }

  // Sliding session: the server hands out a fresh token once a day (or after a password change)
  const renewed = res.headers.get('X-Session-Token');
  if (renewed && res.ok) setToken(renewed);

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const errData = await res.json();
      if (errData.error) errMsg = errData.error;
      if (typeof errData.code === 'string') code = errData.code;
    } catch {
      // ignore
    }
    // The administration requires a second factor this account has not set up (yet): the app shows the setup
    if (code === 'mfa_setup_required') window.dispatchEvent(new CustomEvent('mindsift:mfa-setup-required'));
    throw new ApiError(errMsg, res.status, code);
  }

  const data = await res.json();
  if (cacheable) writeCached(userKey, path, data);
  return data;
}

// Sends a queued outbox entry with the current token (no timeout, no cache)
export function sendOutboxEntry(entry: { method: string; path: string; body: Record<string, unknown> }): Promise<Response> {
  return fetch(entry.path, {
    method: entry.method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(entry.body),
    cache: 'no-store',
  });
}

// Server-wide sharing mode from /auth/status; in private mode the UI hides sharing and groups
let currentSharingMode: SharingMode = 'organizations';
export const setCurrentSharingMode = (mode: SharingMode) => {
  currentSharingMode = mode;
};
export const isSharingDisabled = () => currentSharingMode === 'private';

// People search (auth status): off, people are added by exact e-mail address or username only
let currentPeopleSearch = true;
export const setCurrentPeopleSearch = (on: boolean) => {
  currentPeopleSearch = on;
};
export const isPeopleSearchOn = () => currentPeopleSearch;

// Authenticated binary download (archives); no JSON parsing and no request timeout
export async function downloadBlob(path: string): Promise<Blob> {
  const res = await fetch(path, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new ApiError(i18n.t('common:errors.downloadFailed', { status: res.status }), res.status);
  return res.blob();
}
