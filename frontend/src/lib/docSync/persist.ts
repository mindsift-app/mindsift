// Persists the sync state of each note in IndexedDB so that typed text survives reloads, crashes and
// offline phases. Falls back to memory when IndexedDB is unavailable (private mode, old browsers).
import type { Block, Effect, Op } from './model';

/** A server log entry the client applied to its confirmed note (see StoredQueue.tail). */
export interface AppliedEntry {
  seq: number;
  effect: Effect;
}

export interface StoredDocState {
  docId: string;
  title: string;
  titleVersion: number;
  lastSeq: number;
  role: string;
  userId?: string; // whose changes these are (missing in states stored before v0.83.6)
  blocks: Block[];
  pending: Op[];
  inflight: Op[] | null;
  savedAt: number;
  tail?: AppliedEntry[]; // confirmed after the blocks were stored, see StoredQueue
}

/** The changes of a note not confirmed by the server yet, stored on their own (see saveQueue). */
export interface StoredQueue {
  pending: Op[];
  inflight: Op[] | null;
  savedAt: number;
  userId?: string;
  /**
   * What the server confirmed since the note was last stored in full (its log entries after the stored lastSeq):
   * changes leave the queue when confirmed, and the note is stored in full only now and then, so they wait here
   * until it is. Applied on top of the stored blocks when loading.
   */
  tail?: AppliedEntry[];
}

export interface SyncStorage {
  /** The note with its newest queue. */
  load(docId: string): Promise<StoredDocState | null>;
  /** The whole note and its queue, together. */
  save(state: StoredDocState): Promise<void>;
  /**
   * Only the queue (with what the server confirmed since the last full save): every edit changes it, while the
   * note itself changes only with what the server confirms. Writing all blocks on every typing pause took
   * several MB per pause in large notes.
   */
  saveQueue(docId: string, queue: StoredQueue): Promise<void>;
  /** All stored notes (to send changes of notes that are no longer open). */
  list(): Promise<StoredDocState[]>;
}

const DB_NAME = 'mindsift-sync';
const STORE = 'docs';

// The queue lies in the same store as the note, under its own key: a new store would need a database
// upgrade, which waits for every tab still open with an older app version. Its top-level pending/inflight
// stay empty, so older app versions take the record for a note without changes and pass it by.
const QUEUE_SUFFIX = '#queue';

interface QueueRecord {
  docId: string; // note ID + QUEUE_SUFFIX
  pending: [];
  inflight: null;
  queue: StoredQueue;
}

const queueRecord = (docId: string, queue: StoredQueue): QueueRecord => ({ docId: docId + QUEUE_SUFFIX, pending: [], inflight: null, queue });
const queueOf = (s: StoredDocState): StoredQueue => ({ pending: s.pending, inflight: s.inflight, savedAt: s.savedAt, userId: s.userId, tail: s.tail });

/**
 * The note with the newer of its two queues (an older app version stores the queue in the note only, and
 * ignores the tail: it then shows the note as last stored in full and catches up from the server).
 */
function withQueue(state: StoredDocState, queue: StoredQueue | undefined): StoredDocState {
  if (!queue || queue.savedAt < state.savedAt || (queue.userId || '') !== (state.userId || '')) return state;
  return { ...state, pending: queue.pending || [], inflight: queue.inflight || null, tail: queue.tail };
}

/** Notes and queues of a store's records joined. */
function joinRecords(records: Array<StoredDocState | QueueRecord>): StoredDocState[] {
  const queues = new Map<string, StoredQueue>();
  for (const r of records) if (r.docId.endsWith(QUEUE_SUFFIX)) queues.set(r.docId.slice(0, -QUEUE_SUFFIX.length), (r as QueueRecord).queue);
  return records
    .filter((r): r is StoredDocState => !r.docId.endsWith(QUEUE_SUFFIX))
    .map((s) => withQueue(s, queues.get(s.docId)));
}

export class MemoryStorage implements SyncStorage {
  private data = new Map<string, StoredDocState>();
  private queues = new Map<string, StoredQueue>();
  async load(docId: string): Promise<StoredDocState | null> {
    const s = this.data.get(docId);
    return s ? JSON.parse(JSON.stringify(withQueue(s, this.queues.get(docId)))) : null;
  }
  async save(state: StoredDocState) {
    this.data.set(state.docId, JSON.parse(JSON.stringify(state)));
    this.queues.set(state.docId, JSON.parse(JSON.stringify(queueOf(state))));
  }
  async saveQueue(docId: string, queue: StoredQueue) {
    this.queues.set(docId, JSON.parse(JSON.stringify(queue)));
  }
  async list() {
    return Array.from(this.data.values(), (s) => JSON.parse(JSON.stringify(withQueue(s, this.queues.get(s.docId)))) as StoredDocState);
  }
}

export class IndexedDBStorage implements SyncStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private factory: IDBFactory = indexedDB) {}

  open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = this.factory.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'docId' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  async load(docId: string): Promise<StoredDocState | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      const note = store.get(docId);
      const queue = store.get(docId + QUEUE_SUFFIX);
      queue.onsuccess = () => {
        const state = note.result as StoredDocState | undefined;
        resolve(state ? withQueue(state, (queue.result as QueueRecord | undefined)?.queue) : null);
      };
      note.onerror = () => reject(note.error);
      queue.onerror = () => reject(queue.error);
    });
  }

  async list(): Promise<StoredDocState[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(joinRecords(req.result || []));
      req.onerror = () => reject(req.error);
    });
  }

  async save(state: StoredDocState): Promise<void> {
    return this.write((store) => {
      store.put(state);
      store.put(queueRecord(state.docId, queueOf(state)));
    });
  }

  async saveQueue(docId: string, queue: StoredQueue): Promise<void> {
    return this.write((store) => store.put(queueRecord(docId, queue)));
  }

  private async write(fn: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

/** Deletes every stored note (signing out: the next person on this device must not find them). */
export async function clearStoredNotes(): Promise<void> {
  unsent.clear();
  notifyUnsent();
  try {
    if (typeof indexedDB === 'undefined') return;
    const db = await new IndexedDBStorage(indexedDB).open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Storage unavailable: nothing stored
  }
}

// Notes with changes the server has not confirmed yet, for the offline notice and the question at sign-out
const unsent = new Set<string>();

function notifyUnsent() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('mindsift:outbox-changed'));
}

export function markUnsent(docId: string, has: boolean): void {
  if (unsent.has(docId) === has) return;
  if (has) unsent.add(docId);
  else unsent.delete(docId);
  notifyUnsent();
}

export const unsentNoteCount = () => unsent.size;

// Unsent changes live only in this browser. Asks once per page load that the browser does not clear them
// when disk space runs low (granted silently in Chrome for installed apps, Firefox may ask).
let persistenceRequested = false;
export function requestPersistentStorage(): void {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    // not supported
  }
}

/** IndexedDB when available, otherwise memory (state is then lost on reload). */
export function defaultStorage(): SyncStorage {
  try {
    if (typeof indexedDB !== 'undefined') return new IndexedDBStorage(indexedDB);
  } catch {
    // ignore
  }
  return new MemoryStorage();
}
