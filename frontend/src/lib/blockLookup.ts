import { api, ApiError, getCurrentUserId } from './api';
import type { BlockInfo } from './types';

// Single bullets looked up by id (GET /blocks/{id}) for links to one bullet ([[Titel#^blk_id]]) whose note is
// not loaded here: the note list brings no bullets. Asked for when a link is shown, kept for the session (per
// person), at most MAX entries; refresh() has them fetched again the next time they are shown.

const MAX = 500;
// After a failed lookup (no connection) a bullet is not asked for again before this has passed
const RETRY_MS = 30_000;

// Per person: id → the bullet, or null when it does not exist or may not be read (404)
const cache = new Map<string, BlockInfo | null>();
const stale = new Set<string>();
const pending = new Map<string, Promise<BlockInfo | null>>();
const failedAt = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

const key = (id: string) => `${getCurrentUserId() || ''}:${id}`;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

function remember(k: string, info: BlockInfo | null) {
  cache.delete(k);
  cache.set(k, info);
  stale.delete(k);
  // The oldest entries go first (a Map keeps the order of insertion)
  while (cache.size > MAX) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
    stale.delete(oldest);
  }
}

/** The bullet as far as known here: undefined = not looked up yet, null = does not exist or no access. */
export function cachedBlock(id: string): BlockInfo | null | undefined {
  return cache.get(key(id));
}

/** Looks the bullet up (once at a time; from the cache unless it is missing or stale). */
export function lookupBlock(id: string): Promise<BlockInfo | null> {
  const k = key(id);
  if (cache.has(k) && !stale.has(k)) return Promise.resolve(cache.get(k) ?? null);
  const running = pending.get(k);
  if (running) return running;
  const p = api
    .getBlock(id)
    .then((info) => {
      remember(k, info);
      return info;
    })
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) {
        remember(k, null);
        return null;
      }
      // No connection or a server error: what is known stays, asked again later
      failedAt.set(k, Date.now());
      stale.delete(k);
      return cache.get(k) ?? null;
    })
    .finally(() => {
      pending.delete(k);
      changed();
    });
  pending.set(k, p);
  return p;
}

/** Has the bullet looked up in the background unless it is known (and fresh), asked for or failed just now. */
export function requestBlock(id: string): void {
  const k = key(id);
  if ((cache.has(k) && !stale.has(k)) || pending.has(k)) return;
  const failed = failedAt.get(k);
  if (failed !== undefined && Date.now() - failed < RETRY_MS) return;
  // Asked for while rendering: the request starts afterwards
  queueMicrotask(() => void lookupBlock(id));
}

/** Every known bullet is fetched again the next time it is shown (the old text shows until then). */
export function refreshBlocks(): void {
  for (const k of cache.keys()) stale.add(k);
  failedAt.clear();
  if (cache.size > 0) changed();
}

export function subscribeBlocks(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Changes whenever a lookup finished (for useSyncExternalStore). */
export function blocksVersion(): number {
  return version;
}

/** Forgets everything (tests). */
export function clearBlockLookup(): void {
  cache.clear();
  stale.clear();
  pending.clear();
  failedAt.clear();
  version = 0;
}
