// Persists the sync state of each note in IndexedDB so that typed text survives reloads, crashes and
// offline phases. Falls back to memory when IndexedDB is unavailable (private mode, old browsers).
import type { Block, Op } from './model';

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
}

export interface SyncStorage {
  load(docId: string): Promise<StoredDocState | null>;
  save(state: StoredDocState): Promise<void>;
  /** All stored notes (to send changes of notes that are no longer open). */
  list(): Promise<StoredDocState[]>;
}

const DB_NAME = 'mindsift-sync';
const STORE = 'docs';

export class MemoryStorage implements SyncStorage {
  private data = new Map<string, StoredDocState>();
  async load(docId: string) {
    const s = this.data.get(docId);
    return s ? JSON.parse(JSON.stringify(s)) : null;
  }
  async save(state: StoredDocState) {
    this.data.set(state.docId, JSON.parse(JSON.stringify(state)));
  }
  async list() {
    return Array.from(this.data.values(), (s) => JSON.parse(JSON.stringify(s)) as StoredDocState);
  }
}

export class IndexedDBStorage implements SyncStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
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
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(docId);
      req.onsuccess = () => resolve((req.result as StoredDocState) || null);
      req.onerror = () => reject(req.error);
    });
  }

  async list(): Promise<StoredDocState[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredDocState[]) || []);
      req.onerror = () => reject(req.error);
    });
  }

  async save(state: StoredDocState): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
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
