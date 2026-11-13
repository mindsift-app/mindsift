import { useEffect, useState } from 'react';

export type MainViews = typeof import('./mainViews');

let loaded: MainViews | null = null;
let pending: Promise<MainViews> | null = null;

// The one place that loads the app's chunk (app/mainViews.ts). A failed attempt is forgotten, so the next
// one asks again.
export function loadMainViews(): Promise<MainViews> {
  pending ??= import('./mainViews').then(
    (m) => (loaded = m),
    (err) => {
      pending = null;
      throw err;
    }
  );
  return pending;
}


const RELOAD_KEY = 'mindsift:chunk-reload';

// Online but the chunk is missing: a new version replaced it on the server while this page was open (or
// came from the cache). Loading the page again picks up the new one; at most once a minute, so a server
// that really lacks the file does not cause a reload loop.
export function reloadForNewVersion(reload = () => window.location.reload()): boolean {
  if (!navigator.onLine) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  reload();
  return true;
}

// The app's views once `active` (signed in); `failed` when the chunk could not be loaded, `retry` tries again
export function useMainViews(active: boolean) {
  const [views, setViews] = useState<MainViews | null>(loaded);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || views) return;
    let live = true;
    loadMainViews().then(
      (m) => live && setViews(m),
      () => {
        if (live && !reloadForNewVersion()) setFailed(true);
      }
    );
    return () => {
      live = false;
    };
  }, [active, views, attempt]);

  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };
  return { views, failed, retry };
}
