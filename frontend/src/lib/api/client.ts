// Token, request() with offline cache and session renewal, and small helpers shared by the REST modules
import { SharingMode } from '../types';
import { OfflineError, isOffline, isCacheablePath, readCached, writeCached, clearOfflineData } from '../offline';

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

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
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
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);

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
    try {
      const errData = await res.json();
      if (errData.error) errMsg = errData.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const data = await res.json();
  if (cacheable) writeCached(userKey, path, data);
  return data;
}

// Sends a queued outbox entry with the current token (no timeout, no cache)
export function sendOutboxEntry(entry: { method: string; path: string; body: Record<string, unknown> }): Promise<Response> {
  const token = getToken();
  return fetch(entry.path, {
    method: entry.method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

// Authenticated binary download (archives); no JSON parsing and no request timeout
export async function downloadBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
  return res.blob();
}
