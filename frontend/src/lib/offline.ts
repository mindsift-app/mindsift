import i18n from '../i18n';
// Offline support for the REST layer (lib/api/client.ts):
// - Read cache: successful GET responses are kept in IndexedDB per user. Without network the last
//   known answer is returned, so thoughts, tasks and lists stay visible offline.
// - Outbox: a few mutations (capturing a thought, checking off a task, adding, ticking, editing or deleting
//   a list item) are queued in localStorage while offline and sent in order once the connection is back.
// Notes have their own offline store in lib/docSync.

/** Thrown by request() when the server could not be reached at all (no HTTP answer). */
export class OfflineError extends Error {
  constructor() {
    super(i18n.t('common:offline.noConnection'));
    this.name = 'OfflineError';
  }
}

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// --- Read cache (IndexedDB) ---

const DB_NAME = 'mindsift-offline';
const STORE = 'responses';

// Endpoints whose answers are worth keeping; streams, long polls, note sync, downloads, the OAuth
// consent and revealed hidden values (they must never land on the device) are not
const NOT_CACHED = [/^\/api\/v1\/(events|ws)/, /\/changes/, /\/sync/, /^\/api\/v1\/export/, /^\/api\/v1\/search/, /^\/api\/v1\/oauth/, /\/secrets(\/|$)/];

export const isCacheablePath = (path: string) => path.startsWith('/api/v1/') && !NOT_CACHED.some((re) => re.test(path));

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDB();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

// Cached answers belong to one account: the key starts with the user ID from the token
function cacheKey(userKey: string, path: string) {
  return `${userKey}|${path}`;
}

export async function readCached<T>(userKey: string, path: string): Promise<T | undefined> {
  return withStore<T>('readonly', (s) => s.get(cacheKey(userKey, path)));
}

export function writeCached(userKey: string, path: string, value: unknown): void {
  void withStore('readwrite', (s) => {
    s.put(value, cacheKey(userKey, path));
  });
}

export async function clearOfflineData(): Promise<void> {
  try {
    localStorage.removeItem(OUTBOX_KEY);
    localStorage.removeItem(LEGACY_QUEUE_KEY);
  } catch {}
  notifyOutbox();
  await withStore('readwrite', (s) => {
    s.clear();
  });
}

// --- Outbox (localStorage) ---

export interface OutboxEntry {
  id: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  // The state the first queued change of this path started from (not sent): a later change back to it
  // leaves nothing to send
  base?: Record<string, unknown>;
}

const OUTBOX_KEY = 'mindsift_outbox';
const LEGACY_QUEUE_KEY = 'mindsift_offline_capture_queue'; // thoughts captured offline before the outbox existed

function notifyOutbox() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mindsift:outbox-changed'));
}

export function getOutbox(): OutboxEntry[] {
  try {
    const entries: OutboxEntry[] = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    const legacy = JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY) || '[]');
    if (Array.isArray(legacy) && legacy.length > 0) {
      for (const t of legacy) {
        entries.push({
          id: t.id,
          method: 'POST',
          path: '/api/v1/inbox',
          body: { content: t.content, priority: t.priority, source: t.source, dueDate: t.dueDate || '', taskListId: t.taskListId || '' },
          createdAt: t.createdAt,
        });
      }
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
      localStorage.removeItem(LEGACY_QUEUE_KEY);
    }
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function saveOutbox(entries: OutboxEntry[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  } catch {}
  notifyOutbox();
}

/**
 * Queues a request. Every change states the wanted values, never "the opposite of what I saw", so it
 * can be sent late and meet other people's changes (the server keeps what is already so).
 * - A PATCH or PUT to the same path is merged into the earlier one (checking a task off and on again
 *   while offline sends only the final state). base is the state the change starts from: when the merged
 *   change ends where the first one started (ticked and un-ticked again), nothing is left to send, so it
 *   cannot undo what somebody else did meanwhile.
 * - A DELETE drops the queued changes of the same path.
 */
export function enqueue(
  method: OutboxEntry['method'],
  path: string,
  body: Record<string, unknown>,
  base?: Record<string, unknown>
): OutboxEntry {
  let entries = getOutbox();
  const entry: OutboxEntry = {
    id: `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    method,
    path,
    body,
    createdAt: new Date().toISOString(),
    ...(base ? { base } : {}),
  };
  if (method === 'DELETE') entries = entries.filter((e) => !(e.path === path && (e.method === 'PATCH' || e.method === 'PUT')));
  const same = method === 'PATCH' || method === 'PUT' ? entries.findIndex((e) => e.method === method && e.path === path) : -1;
  if (same >= 0) {
    const earlier = entries[same];
    const merged: OutboxEntry = { ...entry, body: { ...earlier.body, ...body } };
    const from = earlier.base ?? base;
    if (from) merged.base = from;
    const backToStart = !!from && Object.keys(from).every((k) => merged.body[k] === from[k]);
    if (backToStart) entries.splice(same, 1);
    else entries[same] = merged;
  } else {
    entries.push(entry);
  }
  saveOutbox(entries);
  return entry;
}

export const outboxCount = () => getOutbox().length;

/** Changes the body of a queued entry (e.g. the quantity of a list item added offline). */
export function updateQueued(entryId: string, body: Record<string, unknown>): boolean {
  const entries = getOutbox();
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return false;
  entry.body = { ...entry.body, ...body };
  saveOutbox(entries);
  return true;
}

/** Removes a queued entry that is no longer wanted (e.g. a list item added and deleted while offline). */
export function dropQueued(entryId: string): boolean {
  const entries = getOutbox();
  const rest = entries.filter((e) => e.id !== entryId);
  if (rest.length === entries.length) return false;
  saveOutbox(rest);
  return true;
}

/** The status a task had before its change still waiting in the outbox (base of the queued PATCH: ticked
 *  offline and not sent yet), or undefined. Un-ticking it again goes back to that column, so nothing is
 *  left to send. */
export function queuedTaskStart(taskId: string): { isCompleted?: boolean; kanbanStatus?: string } | undefined {
  const entry = getOutbox().find((e) => e.method === 'PATCH' && e.path === `/api/v1/thoughts/${taskId}`);
  return entry?.base as { isCompleted?: boolean; kanbanStatus?: string } | undefined;
}

// List items added offline: a stand-in id until the server knows them, derived from the outbox entry
export const OFFLINE_ITEM_PREFIX = 'itm_offline_';
const LIST_ITEMS_PATH = /^\/api\/v1\/lists\/([^/]+)\/items$/;

/** List items still waiting in the outbox, as stand-ins for the list view (also after a reload). */
export function pendingListItems(): { listId: string; id: string; content: string; category: string; quantity: string; createdAt: string }[] {
  return getOutbox()
    .filter((e) => e.method === 'POST' && LIST_ITEMS_PATH.test(e.path))
    .map((e) => ({
      listId: (e.path.match(LIST_ITEMS_PATH) as RegExpMatchArray)[1],
      id: OFFLINE_ITEM_PREFIX + e.id,
      content: String(e.body.content || ''),
      category: String(e.body.category || ''),
      quantity: String(e.body.quantity || ''),
      createdAt: e.createdAt,
    }));
}

const LIST_ITEM_PATH = /^\/api\/v1\/lists\/([^/]+)\/items\/([^/]+)$/;

export interface PendingListChange {
  isCompleted?: boolean;
  content?: string;
  category?: string;
  quantity?: string;
  deleted?: boolean;
}

/** Changes of list items still waiting in the outbox, by item id: the list view shows them on top of what
 *  it loaded (the cached answer offline, or the server's before they are sent). */
export function pendingListChanges(): Map<string, PendingListChange> {
  const out = new Map<string, PendingListChange>();
  for (const e of getOutbox()) {
    const m = e.path.match(LIST_ITEM_PATH);
    if (!m) continue;
    const change = out.get(m[2]) || {};
    if (e.method === 'DELETE') change.deleted = true;
    else if (e.method === 'PATCH' && typeof e.body.isCompleted === 'boolean') change.isCompleted = e.body.isCompleted;
    else if (e.method === 'PUT') {
      for (const k of ['content', 'category', 'quantity'] as const) if (typeof e.body[k] === 'string') change[k] = e.body[k] as string;
    }
    out.set(m[2], change);
  }
  return out;
}

/** Whether an outbox entry belongs to a shopping list (an item added, changed or deleted offline). */
export const isListEntry = (e: OutboxEntry) => e.path.startsWith('/api/v1/lists/');

let flushing: Promise<number> | null = null;

/**
 * Sends the queued requests in order. Stops at the first network failure and keeps the rest; entries
 * the server rejects (4xx, e.g. the task was deleted meanwhile) are dropped. Returns how many went through.
 */
export function flushOutbox(send: (e: OutboxEntry) => Promise<Response>): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let synced = 0;
    for (const entry of getOutbox()) {
      let res: Response;
      try {
        res = await send(entry);
      } catch {
        break; // still offline
      }
      if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) break;
      saveOutbox(getOutbox().filter((e) => e.id !== entry.id));
      if (res.ok) synced++;
    }
    return synced;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
