import i18n from '../i18n';
export interface SharedData {
  id?: number;
  title?: string;
  text?: string;
  url?: string;
  fileName?: string;
  hasMedia?: boolean;
  createdAt?: number;
}

const SHARE_DB_NAME = 'mindsift-share-target';
const SHARE_STORE_NAME = 'shared_items';

/**
 * Combines title, text, url and media note into a single thought string.
 * Ensures URLs are not duplicated if already present in the shared text or title.
 */
export function formatSharedThought(share: SharedData): string {
  const title = (share.title || '').trim();
  const text = (share.text || '').trim();
  const url = (share.url || '').trim();
  const mediaNote = i18n.t('common:shareTarget.mediaNote');

  let content = '';

  // Check if url is already contained in text or title
  const urlInText = url !== '' && text.includes(url);
  const urlInTitle = url !== '' && title.includes(url);

  // Combine title and text
  if (title && text) {
    if (text === title) {
      content = text;
    } else if (text.startsWith(title)) {
      content = text;
    } else {
      content = `${title}\n${text}`;
    }
  } else if (title) {
    content = title;
  } else if (text) {
    content = text;
  }

  // Append URL if not already included in text or title
  if (url && !urlInText && !urlInTitle) {
    if (content) {
      content = `${content}\n${url}`;
    } else {
      content = url;
    }
  }

  // Media note handling
  if (share.hasMedia || share.fileName) {
    if (content) {
      content = `${content}\n${mediaNote}`;
    } else if (share.fileName) {
      content = `[${share.fileName}] ${mediaNote}`;
    } else {
      content = mediaNote;
    }
  }

  return content.trim();
}

/**
 * Retrieves and removes all pending shared items stored in IndexedDB by the Service Worker.
 */
export async function consumePendingShares(): Promise<SharedData[]> {
  if (typeof indexedDB === 'undefined') return [];

  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(SHARE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
          db.createObjectStore(SHARE_STORE_NAME, { autoIncrement: true, keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
          db.close();
          return resolve([]);
        }

        const tx = db.transaction(SHARE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SHARE_STORE_NAME);
        const getAllReq = store.getAll();

        getAllReq.onsuccess = () => {
          const items: SharedData[] = getAllReq.result || [];
          store.clear();
          tx.oncomplete = () => {
            db.close();
            resolve(items);
          };
          tx.onerror = () => {
            db.close();
            resolve(items);
          };
        };

        getAllReq.onerror = () => {
          db.close();
          resolve([]);
        };
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}
