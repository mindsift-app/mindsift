import { useEffect, useRef, useState } from 'react';
import { APP_BUILD } from '../version';

const CHECK_EVERY_MS = 15 * 60 * 1000;

export interface AvailableUpdate {
  version: string;
  build: string;
}

// Notices when the server runs a newer build than this page (version.json, written at build time and
// never cached): when the tab or the installed app comes back to the foreground, every 15 minutes and
// when the realtime connection is back after a server restart. "Later" hides it until the next build.
export function useUpdateCheck() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const dismissedRef = useRef('');

  useEffect(() => {
    if (!APP_BUILD) return; // dev server: no version.json
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        const live = (await res.json()) as Partial<AvailableUpdate>;
        if (live.build && live.build !== APP_BUILD && live.build !== dismissedRef.current) {
          setUpdate({ version: live.version || '', build: live.build });
        }
      } catch {
        // offline, or an older server without version.json (answers with the page): try again later
      } finally {
        busy = false;
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void check();
    const onWsStatus = (e: Event) => (e as CustomEvent<{ connected?: boolean }>).detail?.connected && void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('mindsift:ws:status', onWsStatus);
    void check();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('mindsift:ws:status', onWsStatus);
    };
  }, []);

  const dismiss = () => {
    if (update) dismissedRef.current = update.build;
    setUpdate(null);
  };
  return { update, dismiss };
}
