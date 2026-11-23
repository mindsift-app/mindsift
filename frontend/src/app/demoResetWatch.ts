import type { AuthStatus } from '../lib/types';

// Waits between attempts to learn the next demo reset: the first one shortly after the countdown ran out
// (the reset itself takes a moment), then backing off up to a minute while the server still answers
// with the deadline just passed or cannot be reached.
const DEMO_STATUS_RETRY_MS = [5000, 10000, 20000, 40000, 60000];

// The answer still names the deadline that has just passed: the reset is running or about to
const stale = (st: AuthStatus) => Boolean(st.demoMode) && typeof st.demoResetInSeconds === 'number' && st.demoResetInSeconds <= 0;

// Asks the server for the next demo reset until it names one ahead, so the countdown never stays at
// "resetting": after the countdown ran out (elapsed, first attempt after a short wait) and after a gap in
// which an event may have been missed (refresh: reconnect, tab visible again, DEMO_RESET; at once).
// Only one round runs at a time; a refresh replaces a waiting round.
export function createDemoResetWatch(fetchStatus: () => Promise<AuthStatus>, onStatus: (st: AuthStatus) => void) {
  let timer: number | undefined;
  let round = 0; // answers of a replaced or cancelled round are dropped
  let running = false;

  const attempt = async (r: number, tries: number) => {
    let st: AuthStatus | null = null;
    try {
      st = await fetchStatus();
    } catch {
      // Server unreachable for the moment (restarting, offline): try again
    }
    if (r !== round) return;
    if (st && !stale(st)) {
      running = false;
      onStatus(st);
      return;
    }
    schedule(r, tries);
  };
  const schedule = (r: number, tries: number) => {
    const delay = DEMO_STATUS_RETRY_MS[Math.min(tries, DEMO_STATUS_RETRY_MS.length - 1)];
    timer = window.setTimeout(() => void attempt(r, tries + 1), delay);
  };

  return {
    elapsed() {
      if (running) return;
      running = true;
      schedule(++round, 0);
    },
    refresh() {
      window.clearTimeout(timer);
      running = true;
      void attempt(++round, 0);
    },
    cancel() {
      window.clearTimeout(timer);
      round++;
      running = false;
    },
  };
}
