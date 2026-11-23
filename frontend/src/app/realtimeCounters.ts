// How the counters in the navigation (GET /stats) and the triage deck follow realtime events. In a shared
// task list or shopping list every change reaches every member; reloading both on each event made the
// requests grow with the square of the members. So: the deck only reloads for events that can touch the
// inbox, and the counters follow other people's changes in a slower shared rhythm (one request for a
// whole burst), while this tab's own changes still show at once.
import { WSMessage } from '../lib/types';
import {
  OWN_ECHO_WINDOW_MS,
  RELOAD_SHARED_DELAY_MS,
  RELOAD_SHARED_INTERVAL_MS,
  RELOAD_SOON_MS,
  createReloadScheduler,
} from '../lib/realtimeReload';

// The rhythm is the one of every realtime reload (lib/realtimeReload.ts)
export { OWN_ECHO_WINDOW_MS };
export const STATS_SOON_MS = RELOAD_SOON_MS;
export const STATS_SHARED_DELAY_MS = RELOAD_SHARED_DELAY_MS;
export const STATS_SHARED_INTERVAL_MS = RELOAD_SHARED_INTERVAL_MS;

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

export const createStatsScheduler = createReloadScheduler;
