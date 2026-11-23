// Reloading data because of realtime events, without an avalanche: in a shared task list or shopping list
// every change reaches every member, so a reload per event made the requests grow with the square of the
// members. A view applies what an event carries where it can; where it cannot, it asks this scheduler,
// which makes one request for a whole burst. This tab's own changes show at once, other people's follow in
// a slower shared rhythm, a hidden tab waits until it is visible again, and a reconnect (events of the gap
// are lost) reloads once.
import { useEffect, useState } from 'react';
import { lastLocalWriteAt } from './api';
import { useLatestRef } from './useLatestRef';
import { onRealtimeStatus } from './realtimeBus';

// Own change (a view asks for it, or the echo of a change this tab just sent): short debounce
export const RELOAD_SOON_MS = 300;
// Someone else's change: wait a moment so a burst of events makes one request...
export const RELOAD_SHARED_DELAY_MS = 1500;
// ...and reload at most once in this interval while events keep coming
export const RELOAD_SHARED_INTERVAL_MS = 5000;
// An event this soon after this tab sent a change counts as the echo of it
export const OWN_ECHO_WINDOW_MS = 3000;

export interface ReloadScheduler {
  /** Reload shortly (own change). */
  soon(): void;
  /** Reload in the shared rhythm (someone else's change). */
  shared(): void;
  cancel(): void;
}

// One pending reload at a time: a request asked for earlier than the pending one moves it forward, a
// later one is covered by it. load runs when the timer fires, so a change that arrives while a request is
// on its way schedules the next one.
export function createReloadScheduler(load: () => void, now: () => number = Date.now): ReloadScheduler {
  let timer: number | undefined;
  let fireAt = 0;
  let lastLoad = -Infinity;
  const run = () => {
    timer = undefined;
    lastLoad = now();
    load();
  };
  const at = (t: number) => {
    if (timer !== undefined) {
      if (fireAt <= t) return;
      window.clearTimeout(timer);
    }
    fireAt = t;
    timer = window.setTimeout(run, Math.max(0, t - now()));
  };
  return {
    soon: () => at(now() + RELOAD_SOON_MS),
    shared: () => at(Math.max(now() + RELOAD_SHARED_DELAY_MS, lastLoad + RELOAD_SHARED_INTERVAL_MS)),
    cancel: () => {
      window.clearTimeout(timer);
      timer = undefined;
    },
  };
}

export interface RealtimeReloader {
  /** An event needs a reload: own echo shortly, someone else's in the shared rhythm, a hidden tab later. */
  request(own?: boolean): void;
  /** The tab became visible: a reload put off while it was hidden runs now. */
  visible(): void;
  /** The realtime connection went down or came back: back after a loss reloads once. */
  status(connected: boolean): void;
  cancel(): void;
}

const tabHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export interface ReloaderOptions {
  now?: () => number;
  ownWriteAt?: () => number;
  // Reload once when the connection is back (default); off where another reload covers the gap
  reconnect?: boolean;
}

export function createRealtimeReloader(
  load: () => void,
  { now = Date.now, ownWriteAt = lastLocalWriteAt, reconnect = true }: ReloaderOptions = {}
): RealtimeReloader {
  const scheduler = createReloadScheduler(load, now);
  let pending = false;
  let lost = false;
  return {
    request(own) {
      if (tabHidden()) {
        pending = true;
        return;
      }
      if (own ?? now() - ownWriteAt() < OWN_ECHO_WINDOW_MS) scheduler.soon();
      else scheduler.shared();
    },
    visible() {
      if (!pending || tabHidden()) return;
      pending = false;
      scheduler.soon();
    },
    status(connected) {
      if (!reconnect) return;
      if (!connected) {
        lost = true;
        return;
      }
      if (!lost) return;
      lost = false;
      if (tabHidden()) pending = true;
      else scheduler.soon();
    },
    cancel() {
      pending = false;
      scheduler.cancel();
    },
  };
}

// The reloader of a view: load is the latest one passed (it may read the view's current state), the tab's
// visibility and the realtime connection's status are followed while the view is mounted.
export function useRealtimeReload(load: () => void, options: { reconnect?: boolean } = {}): RealtimeReloader {
  const loadRef = useLatestRef(load);
  // The reloader calls load from its timers only, never during render
  // eslint-disable-next-line react-hooks/refs
  const [reloader] = useState(() => createRealtimeReloader(() => loadRef.current(), options));
  useEffect(() => {
    const onVisible = () => reloader.visible();
    document.addEventListener('visibilitychange', onVisible);
    const offStatus = onRealtimeStatus((connected) => reloader.status(connected));
    return () => {
      reloader.cancel();
      document.removeEventListener('visibilitychange', onVisible);
      offStatus();
    };
  }, [reloader]);
  return reloader;
}
