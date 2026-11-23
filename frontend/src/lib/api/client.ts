// Token, request() with offline cache and session renewal, and small helpers shared by the REST modules
import { DesktopInfo } from '../types';
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

// An error answer of the server; code is a stable name for errors the app reacts to (e.g. email_unverified),
// data the whole answer for errors that carry more (e.g. count with foreign_links)
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly data?: Record<string, unknown>,
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

// When this tab last sent a change (any method but GET): a realtime event shortly after is most likely the
// echo of it, and the counters in the navigation follow at once instead of in the slower shared rhythm
let lastWriteAt = 0;
export function lastLocalWriteAt(): number {
  return lastWriteAt;
}

export async function request<T>(path: string, { timeout = 'normal', ...options }: RequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const cacheable = method === 'GET' && isCacheablePath(path);
  if (method !== 'GET') lastWriteAt = Date.now();
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

  noteSession(path, res);

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    let code: string | undefined;
    let data: Record<string, unknown> | undefined;
    try {
      const errData = await res.json();
      if (errData && typeof errData === 'object') data = errData;
      if (errData.error) errMsg = errData.error;
      if (typeof errData.code === 'string') code = errData.code;
    } catch {
      // ignore
    }
    // The administration requires a second factor this account has not set up (yet): the app shows the setup
    if (code === 'mfa_setup_required') window.dispatchEvent(new CustomEvent('mindsift:mfa-setup-required'));
    // A reset by the administration asked for a new own password first: the app asks for it
    if (code === 'password_change_required') window.dispatchEvent(new CustomEvent('mindsift:password-change-required'));
    throw new ApiError(errMsg, res.status, code, data);
  }

  const data = await res.json();
  if (cacheable) writeCached(userKey, path, data);
  return data;
}

// What every answer to a signed-in request says about the session: 401 ends it (the app shows the sign-in),
// and once a day (or after a password change) the server hands out a fresh token (sliding session)
function noteSession(path: string, res: Response): void {
  if (
    res.status === 401 &&
    !path.includes('/auth/login') &&
    !path.includes('/auth/register') &&
    !path.includes('/auth/setup') &&
    !path.includes('/auth/status') &&
    // A ticket that ran out is no sign-out of the session that sent it
    !path.includes('/auth/oidc/') &&
    // The stream reconnects when the server ends it after a new password, possibly before the answer with the
    // fresh token is read: the next try uses that one (a session that really ended fails everywhere else)
    !path.includes('/auth/stream-ticket')
  ) {
    clearToken();
    window.dispatchEvent(new CustomEvent('mindsift:unauthorized'));
  }
  const renewed = res.headers.get('X-Session-Token');
  if (renewed && res.ok) setToken(renewed);
}

/**
 * A signed-in request whose body or answer is no JSON for request(): FormData uploads, files, blobs, text.
 * Sends the login and language like request() and handles the session the same way (401, fresh token), but
 * has no timeout and no offline cache, and hands back the Response as it is: the caller reads it and decides
 * what an error status means. Headers of `init` go first, the login last.
 */
export async function requestRaw(path: string, init: RequestInit = {}): Promise<Response> {
  if ((init.method || 'GET').toUpperCase() !== 'GET') lastWriteAt = Date.now();
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...authHeaders() },
  });
  noteSession(path, res);
  return res;
}

/** The server's /health (no login): its answer, or null when it cannot be reached or is not healthy. */
export async function fetchHealth(): Promise<{ boot?: string } | null> {
  try {
    const res = await fetch('/api/v1/health', { cache: 'no-store' });
    if (!res.ok) return null;
    return ((await res.json().catch(() => ({}))) as { boot?: string }) ?? {};
  } catch {
    return null;
  }
}

// Sends a queued outbox entry with the current token (no timeout, no cache). A change that carries when it
// was made (changedAt) also gets when it is sent, both on this device's clock: the server works out how
// long ago it was made, whatever this clock says (changeTime in internal/api/handlers_lists.go).
export function sendOutboxEntry(entry: { method: string; path: string; body: Record<string, unknown> }): Promise<Response> {
  const body = typeof entry.body.changedAt === 'number' ? { ...entry.body, sentAt: Date.now() } : entry.body;
  return fetch(entry.path, {
    method: entry.method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: entry.method === 'DELETE' ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
}

// Sign-in through the OIDC provider as /auth/status said (lib/oidc.ts)
let currentOidc = { enabled: false, name: '', passwordLogin: true };
export const setCurrentOidc = (oidc: { enabled: boolean; name: string } | undefined, passwordLogin: boolean | undefined) => {
  currentOidc = { enabled: Boolean(oidc?.enabled), name: oidc?.name || '', passwordLogin: passwordLogin !== false };
};
export const getCurrentOidc = () => currentOidc;

// People search (auth status): off, people are added by exact e-mail address or username only
let currentPeopleSearch = true;
export const setCurrentPeopleSearch = (on: boolean) => {
  currentPeopleSearch = on;
};
export const isPeopleSearchOn = () => currentPeopleSearch;

// Desktop app (AuthStatus.desktop, set with every status). Only for the app's own shell (start view,
// switching instances, local API, its setup wizard, backup folder) and the realtime transport: what the
// instance offers is a capability (lib/capabilities.ts)
let currentDesktop: DesktopInfo | null = null;
export const setCurrentDesktop = (d: DesktopInfo | null | undefined) => {
  currentDesktop = d ?? null;
};
export const getDesktop = () => currentDesktop;
export const isDesktopApp = () => currentDesktop !== null;

// Authenticated binary download (archives); no JSON parsing and no request timeout
export async function downloadBlob(path: string): Promise<Blob> {
  const res = await requestRaw(path);
  if (!res.ok) throw new ApiError(i18n.t('common:errors.downloadFailed', { status: res.status }), res.status);
  return res.blob();
}
