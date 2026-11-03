// MindSift service worker: keeps the app shell so the PWA also starts without network.
// - Page loads (navigation): network first, so a new release is picked up right away; offline the
//   last loaded index.html is used.
// - Built bundles (/assets/*, file names contain a content hash): from the cache, loaded once.
// - Icons: from the cache, refreshed in the background.
// - Manifest: network first (the browser checks it for changed app colours and name; a cached copy
//   would hand it the old values), the cache only offline.
// - API requests are never touched; offline data comes from the app's own cache (lib/offline.ts).
// Raise VERSION when this file changes in a way that needs fresh caches.
const VERSION = 'v7';
const SHELL_CACHE = `mindsift-shell-${VERSION}`;
const ASSET_CACHE = `mindsift-assets-${VERSION}`;
const MAX_ASSETS = 80;
const SHARE_DB_NAME = 'mindsift-share-target';
const SHARE_STORE_NAME = 'shared_items';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/icon.svg',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/apple-touch-icon.png',
  '/badge-96x96.png',
  '/boot-theme.js',
  '/pwa-install.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Old bundles pile up with every release; keep only the newest entries
async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)));
}

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok && response.type === 'basic') cache.put('/index.html', response.clone());
    return response;
  } catch {
    return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    trimAssets();
  }
  return response;
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit || Response.error());
  return hit || refresh;
}

function openShareDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
        db.createObjectStore(SHARE_STORE_NAME, { autoIncrement: true, keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePendingShare(item) {
  const db = await openShareDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE_NAME, 'readwrite');
    tx.objectStore(SHARE_STORE_NAME).add(item);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const title = formData.get('title');
    const text = formData.get('text');
    const url = formData.get('url');
    const media = formData.get('media');

    let fileName = '';
    let hasMedia = false;
    if (media && typeof media === 'object') {
      fileName = media.name || 'image';
      hasMedia = true;
    }

    await savePendingShare({
      title: typeof title === 'string' ? title.trim() : '',
      text: typeof text === 'string' ? text.trim() : '',
      url: typeof url === 'string' ? url.trim() : '',
      fileName,
      hasMedia,
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error('[SW] Share-Target Fehler:', err);
  }
  return Response.redirect('/?shared=pending', 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method === 'POST') {
    const url = new URL(request.url);
    if (url.origin === self.location.origin && url.pathname === '/share-target') {
      event.respondWith(handleShareTarget(event));
    }
    return;
  }
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAsset(request));
  } else if (url.pathname === '/manifest.json') {
    event.respondWith(networkFirstShell(request));
  } else if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// Web push: show the notification; a click focuses an open MindSift window or opens a new one
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || 'MindSift', {
      body: msg.body || '',
      icon: '/icon-192x192.png',
      // Status bar icon: Android only uses the alpha channel, the full app icon became a plain square
      badge: '/badge-96x96.png',
      tag: msg.tag || undefined,
      data: { url: msg.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === target.origin && 'focus' in w) return w.focus();
      }
      return self.clients.openWindow(target.href);
    })
  );
});
