import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_BUILD } from '../version';
import { flushBeforeReload, noteReloadAttempt, reloadAttempts, reloadPage, settleReload } from './appReload';

// Short enough for a tab that stays in front behind a proxy, where a server restart can go unnoticed by
// the realtime connection for a long time; version.json is a few bytes
const CHECK_EVERY_MS = 5 * 60 * 1000;
/** The notice stands this long before the page reloads */
export const UPDATE_NOTICE_MS = 5_000;
/** Typing goes on: the reload waits for a pause this long... */
export const UPDATE_IDLE_MS = 2_000;
/** ...but not longer than this after the notice came up */
export const UPDATE_MAX_WAIT_MS = 30_000;
const TICK_MS = 250;
// After a reload and one more past caches the page still has the old build: no more automatic reloads
const MAX_RELOADS = 2;

export interface AvailableUpdate {
  version: string;
  build: string;
}

/**
 * countdown: the notice is up, the page reloads in `secondsLeft`; waiting: the user is typing, the reload
 * waits for a pause; saving: waiting changes are sent, then the page reloads; offline: reloads once the
 * server answers again; stuck: reloading did not bring the new build, only the button is left.
 */
export type UpdatePhase = 'countdown' | 'waiting' | 'saving' | 'offline' | 'stuck';

export interface UpdateState extends AvailableUpdate {
  phase: UpdatePhase;
  secondsLeft: number;
}

export interface UpdateCheckOptions {
  /** Sends or stores what is waiting (lib/appReload.ts) */
  flush?: () => Promise<void>;
  /** Loads the page again, the second time past every cache */
  reload?: (bypassCache: boolean) => void;
}

// Fields whose text is lost on a reload: anything typed outside a note (notes keep theirs in IndexedDB)
function editingUnsavedField(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el.closest('[data-outline-block]')) return false;
  if (el instanceof HTMLTextAreaElement) return el.value !== '';
  if (el instanceof HTMLInputElement) return !/^(checkbox|radio|button|submit|reset|range|color|file|hidden|image)$/.test(el.type) && el.value !== '';
  return el.isContentEditable && (el.textContent || '') !== '';
}

/**
 * The server runs another build than this page (version.json, written at build time and never cached):
 * the app reloads itself, so nobody keeps working with an old app after a server update. Checked when the
 * tab or the installed app comes back to the foreground, every 5 minutes, when the browser is online again
 * and when the realtime connection is back after a server restart. A notice counts down UPDATE_NOTICE_MS,
 * typing delays the reload until a pause (UPDATE_IDLE_MS, at most UPDATE_MAX_WAIT_MS); before the reload
 * everything waiting is sent or stored. Never while offline; no loops (MAX_RELOADS per build and tab).
 */
export function useUpdateCheck(options: UpdateCheckOptions = {}) {
  const [state, setState] = useState<UpdateState | null>(null);
  const flushRef = useRef(options.flush || flushBeforeReload);
  const reloadRef = useRef(options.reload || reloadPage);
  const reloadNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!APP_BUILD) return; // dev server: no version.json
    settleReload();
    let target: AvailableUpdate | null = null;
    let phase: UpdatePhase | null = null;
    let shownAt = 0;
    let lastInput = 0;
    let checking = false;
    let tick: number | undefined;
    let stopped = false;

    const show = (secondsLeft = 0) => setState(target && phase ? { ...target, phase, secondsLeft } : null);
    const stopTick = () => {
      window.clearInterval(tick);
      tick = undefined;
    };
    const startCountdown = () => {
      phase = 'countdown';
      shownAt = Date.now();
      stopTick();
      tick = window.setInterval(step, TICK_MS);
      step();
    };
    const waitForServer = () => {
      phase = 'offline';
      stopTick();
      show();
    };

    // version.json of the running server; null when there is none (an older server answers with the page)
    const fetchLive = async (): Promise<AvailableUpdate | null> => {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      const live = (await res.json()) as Partial<AvailableUpdate>;
      return live.build ? { version: live.version || '', build: live.build } : null;
    };

    const reloadNow = async () => {
      if (!target || phase === 'saving' || stopped) return;
      const stuck = phase === 'stuck';
      phase = 'saving';
      stopTick();
      show();
      // Right before: online, and the server still has the new build (not restarted back to this one)
      let live: AvailableUpdate | null = null;
      try {
        live = navigator.onLine ? await fetchLive() : null;
      } catch {
        live = null;
      }
      if (stopped) return;
      if (!live) {
        waitForServer();
        return;
      }
      if (live.build === APP_BUILD) {
        target = null;
        phase = null;
        show();
        return;
      }
      target = live;
      try {
        await flushRef.current();
      } catch {
        // What could not be sent stays stored (IndexedDB, localStorage) and goes out after the reload
      }
      if (stopped) return;
      const before = noteReloadAttempt(live.build);
      reloadRef.current(stuck || before >= 1);
    };
    reloadNowRef.current = () => void reloadNow();

    function step() {
      if (!target || phase === 'saving' || phase === 'stuck') return;
      if (!navigator.onLine) {
        waitForServer();
        return;
      }
      const now = Date.now();
      const left = UPDATE_NOTICE_MS - (now - shownAt);
      if (left > 0) {
        phase = 'countdown';
        show(Math.ceil(left / 1000));
        return;
      }
      const busy = now - lastInput < UPDATE_IDLE_MS || editingUnsavedField();
      if (busy && now - shownAt < UPDATE_MAX_WAIT_MS) {
        if (phase !== 'waiting') {
          phase = 'waiting';
          show();
        }
        return;
      }
      void reloadNow();
    }

    const check = async () => {
      if (checking || phase === 'saving' || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const live = navigator.onLine ? await fetchLive() : null;
        if (stopped || !live) return;
        if (live.build === APP_BUILD) {
          // The server went back to this build before the reload: nothing to do any more
          if (target && phase !== 'stuck') {
            target = null;
            phase = null;
            stopTick();
            show();
          }
          return;
        }
        if (target?.build === live.build && phase !== 'offline') return; // already on its way
        target = live;
        if (reloadAttempts(live.build) >= MAX_RELOADS) {
          phase = 'stuck';
          stopTick();
          show();
          return;
        }
        startCountdown();
      } catch {
        // offline, or an older server without version.json (answers with the page): try again later
      } finally {
        checking = false;
      }
    };

    const onInput = () => {
      lastInput = Date.now();
    };
    const onVisible = () => document.visibilityState === 'visible' && void check();
    const onWsStatus = (e: WindowEventMap['mindsift:ws:status']) => e.detail?.connected && void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const inputEvents = ['keydown', 'input', 'compositionupdate'] as const;
    inputEvents.forEach((name) => window.addEventListener(name, onInput, true));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('offline', step);
    window.addEventListener('mindsift:ws:status', onWsStatus);
    void check();
    return () => {
      stopped = true;
      stopTick();
      window.clearInterval(timer);
      inputEvents.forEach((name) => window.removeEventListener(name, onInput, true));
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('offline', step);
      window.removeEventListener('mindsift:ws:status', onWsStatus);
    };
  }, []);

  const reloadNow = useCallback(() => reloadNowRef.current(), []);
  return { update: state, reloadNow };
}
