// Reloading the page for a new MindSift version (lib/useUpdateCheck.ts): first everything not yet sent
// goes out or is safely stored in this browser, then the page loads again. A reload that still brings the
// old build (a cache between browser and server) is tried once more past caches, then the app stops trying.
import { APP_BUILD } from '../version';
import { api } from './api';
import { outboxCount } from './offline';
import { unsentNoteCount } from './docSync/persist';
import { notesStoring, syncOpenNotes } from './docSync/engine';
import { flushClosedNotes } from './docSync/flushClosed';

// How long to wait for the server to take the waiting changes; what is left is stored and sent after the reload
export const FLUSH_TIMEOUT_MS = 8_000;
// Writing to IndexedDB is quick; a write still running after this long is not waited for any more
const STORE_TIMEOUT_MS = 3_000;
const POLL_MS = 100;
const SW_UPDATE_TIMEOUT_MS = 3_000;

const ATTEMPTS_KEY = 'mindsift:update-reload';
// Added to the address for the second try, so no cache in between hands out the old page again
export const CACHE_BUST_PARAM = 'mindsift-reload';

/** Reloads the app has made for this build in this tab so far (sessionStorage survives a reload). */
export function reloadAttempts(build: string): number {
  try {
    const raw = sessionStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return 0;
    const stored = JSON.parse(raw) as { build?: string; attempts?: number };
    return stored.build === build ? Number(stored.attempts) || 0 : 0;
  } catch {
    // No sessionStorage: a reload loop could not be noticed, so no automatic reload at all
    return Number.POSITIVE_INFINITY;
  }
}

/** Counts a reload for this build; returns how many there were before. */
export function noteReloadAttempt(build: string): number {
  const before = reloadAttempts(build);
  try {
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify({ build, attempts: before + 1 }));
  } catch {
    // see reloadAttempts
  }
  return before;
}

/** At app start: the reload brought the new build, so the count starts over; the cache-busting part of the address goes. */
export function settleReload(): void {
  try {
    const raw = sessionStorage.getItem(ATTEMPTS_KEY);
    if (raw && (JSON.parse(raw) as { build?: string }).build === APP_BUILD) sessionStorage.removeItem(ATTEMPTS_KEY);
  } catch {
    // nothing stored
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has(CACHE_BUST_PARAM)) {
    url.searchParams.delete(CACHE_BUST_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Resolves when `p` settles or after `ms`, whichever comes first; never rejects. */
function within(p: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([p.then(() => undefined, () => undefined), sleep(ms)]);
}

const unsent = () => outboxCount() + unsentNoteCount();

/**
 * Sends what is waiting before the page reloads: text in a typing pause goes to its note, open notes sync
 * right away, the outbox (tasks, lists, thoughts) and notes closed with waiting changes are sent. Waits until
 * nothing is left or FLUSH_TIMEOUT_MS passed; either way every note is written to IndexedDB by then (the
 * outbox lives in localStorage, written at once), so what did not reach the server goes out after the reload.
 */
export async function flushBeforeReload(timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  window.dispatchEvent(new Event('mindsift:flush-edits'));
  // Fields that save when they lose focus (titles, list items) save now
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
  const deadline = Date.now() + timeoutMs;
  // A new service worker loads the new build's files for offline use; the page itself always comes from the network
  void within(updateServiceWorker(), SW_UPDATE_TIMEOUT_MS);
  await within(Promise.all([syncOpenNotes(), api.flushOfflineQueue(), flushClosedNotes()]), timeoutMs);
  // An open note sends again by itself as long as something is waiting (engine.syncNow)
  while (Date.now() < deadline && (unsent() > 0 || notesStoring())) await sleep(POLL_MS);
  const storeDeadline = Date.now() + STORE_TIMEOUT_MS;
  while (notesStoring() && Date.now() < storeDeadline) await sleep(POLL_MS);
}

async function updateServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  await reg?.update();
}

/** Loads the page again; `bypassCache` adds a changing parameter to the address so no cache can answer. */
export function reloadPage(bypassCache: boolean): void {
  if (!bypassCache) {
    window.location.reload();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set(CACHE_BUST_PARAM, String(Date.now()));
  window.location.replace(url.href);
}
