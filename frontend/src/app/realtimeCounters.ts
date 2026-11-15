// How the counters in the navigation (GET /stats) and the triage deck follow realtime events. In a shared
// task list or shopping list every change reaches every member; reloading both on each event made the
// requests grow with the square of the members. So: the deck only reloads for events that can touch the
// inbox, and the counters follow other people's changes in a slower shared rhythm (one request for a
// whole burst), while this tab's own changes still show at once.
import { WSMessage } from '../lib/types';

// Own change (a view asks for it, or the echo of a change this tab just sent): short debounce
export const STATS_SOON_MS = 300;
// Someone else's change: wait a moment so a burst of events makes one request...
export const STATS_SHARED_DELAY_MS = 1500;
// ...and reload at most once in this interval while events keep coming
export const STATS_SHARED_INTERVAL_MS = 5000;
// An event this soon after this tab sent a change counts as the echo of it
export const OWN_ECHO_WINDOW_MS = 3000;

// Events that can change a counter. DOC_SEQ only announces new edits inside a note (DOC_COUNTS and
// DOC_UPDATED follow when the to-dos change), ITEM_REORDERED only moves entries of a list.
export function eventChangesStats(event: unknown): boolean {
  if (typeof event !== 'string' || event === 'DOC_SEQ' || event === 'ITEM_REORDERED') return false;
  return ['TASK_', 'DOC_', 'SPACE_', 'ITEM_', 'LIST_'].some((prefix) => event.startsWith(prefix));
}

// Events that can change the triage deck: a thought that is (or was) in the inbox was created, sorted,
// sent back or deleted. Task changes in a task list (status kept, not in the deck) leave it alone.
export function eventChangesDeck(msg: WSMessage, deckIds: ReadonlySet<string>): boolean {
  const { event } = msg;
  if (event !== 'TASK_CREATED' && event !== 'TASK_UPDATED' && event !== 'TASK_DELETED') return false;
  const p = msg.payload as { id?: unknown; status?: unknown } | null | undefined;
  // Unknown shape: rather reload once too often than keep a sorted thought in the deck
  if (!p || typeof p.id !== 'string') return true;
  if (deckIds.has(p.id)) return true;
  return event !== 'TASK_DELETED' && p.status === 'inbox';
}

export interface StatsScheduler {
  /** Reload shortly (own change). */
  soon(): void;
  /** Reload in the shared rhythm (someone else's change). */
  shared(): void;
  cancel(): void;
}

// One pending reload at a time: a request asked for earlier than the pending one moves it forward, a
// later one is covered by it. load runs when the timer fires, so a change that arrives while a request is
// on its way schedules the next one.
export function createStatsScheduler(load: () => void, now: () => number = Date.now): StatsScheduler {
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
    soon: () => at(now() + STATS_SOON_MS),
    shared: () => at(Math.max(now() + STATS_SHARED_DELAY_MS, lastLoad + STATS_SHARED_INTERVAL_MS)),
    cancel: () => {
      window.clearTimeout(timer);
      timer = undefined;
    },
  };
}
