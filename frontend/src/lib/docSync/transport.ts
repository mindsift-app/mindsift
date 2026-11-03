// HTTP transport of the note sync protocol (see Doku/api/rest.md). Every data exchange is a plain request,
// so it works behind proxies that block WebSockets.
import { getToken } from '../api';
import type { Block, Effect, Op, Result } from './model';

export interface LeaseInfo {
  blockId: string;
  userId: string;
  name: string;
}

export interface Presence {
  userId: string;
  name: string;
}

export interface SnapshotResponse {
  docId: string;
  title: string;
  titleVersion: number;
  headSeq: number;
  blocks: Block[];
  role: string;
  shared: boolean;
}

export interface LogEntry {
  seq: number;
  opId?: string;
  userId: string;
  clientId: string;
  effect: Effect;
}

export interface SyncRequest {
  clientId: string;
  lastSeq: number;
  ops: Op[];
  leases?: { hold: string[]; release: string[] };
  skipLog?: boolean; // one-off changes do not need the log back
}

export interface SyncResponse {
  results: Result[];
  ops: LogEntry[];
  headSeq: number;
  hasMore: boolean;
  resync?: boolean;
  role: string;
  shared: boolean;
  sessions: number;
  presence: Presence[];
  leases: { granted: string[]; denied: string[]; others: LeaseInfo[] };
  // Checkboxes linked to a task / to a subtask (block → task), for the badges
  taskLinks?: Record<string, string>;
  subtaskLinks?: Record<string, string>;
}

/** status 0 = network error or timeout; otherwise the HTTP status. */
export class TransportError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface ChangesResponse {
  headSeq: number;
  changed: boolean;
}

export interface Transport {
  snapshot(docId: string): Promise<SnapshotResponse>;
  /** Long poll: resolves when the note changes, at the latest after waitSec seconds. */
  changes(docId: string, since: number, waitSec: number, signal?: AbortSignal): Promise<ChangesResponse>;
  sync(docId: string, body: SyncRequest, opts?: { keepalive?: boolean }): Promise<SyncResponse>;
  leave(docId: string, clientId: string): Promise<void>;
}

const TIMEOUT_MS = 15000;

async function call<T>(path: string, init: RequestInit & { keepalive?: boolean } = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal?.addEventListener('abort', () => controller.abort());
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, cache: 'no-store', signal: init.keepalive ? undefined : controller.signal });
  } catch (err: any) {
    throw new TransportError(err?.message || 'Netzwerkfehler', 0);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('mindsift:unauthorized'));
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new TransportError(msg, res.status);
  }
  return res.json();
}

export const httpTransport: Transport = {
  snapshot: (docId) => call(`/api/v1/docs/${encodeURIComponent(docId)}/snapshot`),
  changes: (docId, since, waitSec, signal) =>
    call(`/api/v1/docs/${encodeURIComponent(docId)}/changes?since=${since}&wait=${waitSec}`, { signal }, (waitSec + 10) * 1000),
  sync: (docId, body, opts) =>
    call(`/api/v1/docs/${encodeURIComponent(docId)}/sync`, { method: 'POST', body: JSON.stringify(body), keepalive: opts?.keepalive }),
  leave: async (docId, clientId) => {
    await call(`/api/v1/docs/${encodeURIComponent(docId)}/leave`, {
      method: 'POST',
      body: JSON.stringify({ clientId }),
      keepalive: true,
    });
  },
};
