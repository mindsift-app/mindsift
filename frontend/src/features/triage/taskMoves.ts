// Moves of tasks on one board (list or Kanban): what a move sends, and which answers and TASK_REORDERED
// events may still be applied. A move shows at once; its answer (and its realtime echo) can arrive after
// the next move was already made locally, and applying it then would put the cards back for a moment.
import { TaskOrder, TaskReorderResult, Thought } from '../../lib/types';

export type ReorderItem = { id: string; sortOrder: number; kanbanStatus?: string };

// Only the tasks whose place or column the move changes: the server leaves the rest as it is (it accepts
// any part of a list), so a move in a long list sends a few rows instead of all of them
export function changedOrder(before: readonly Pick<Thought, 'id' | 'sortOrder' | 'kanbanStatus'>[], after: readonly ReorderItem[]): ReorderItem[] {
  const old = new Map(before.map((t) => [t.id, t]));
  return after.filter((it) => {
    const t = old.get(it.id);
    if (!t) return true;
    return (t.sortOrder ?? 0) !== it.sortOrder || (it.kanbanStatus !== undefined && it.kanbanStatus !== t.kanbanStatus);
  });
}

// An echo of one's own move is recognised for this long (it arrives within moments of the move)
export const MOVE_ECHO_MS = 10000;

export interface MoveSettled {
  // No newer move was made since: the answer's places may be applied
  latest: boolean;
  // Load everything now: no move is on its way any more and one of them (or an event meanwhile) needs it
  reload: boolean;
}

export interface MoveTracker {
  /** A move is sent; returns its number. */
  begin(items: readonly ReorderItem[]): number;
  /** Its answer arrived (reload: the server asks for it, or the call failed). */
  settle(seq: number, reload: boolean): MoveSettled;
  /** What to do with a TASK_REORDERED event: drop the echo of an own move, apply, or wait for the moves
   * on their way (then load once they are done). */
  classify(payload: { userId?: string; items?: TaskOrder[] } | undefined, myUserId: string | null): 'echo' | 'apply' | 'defer';
}

export function createMoveTracker(now: () => number = Date.now): MoveTracker {
  let seq = 0;
  const inFlight = new Set<number>();
  let reloadWhenIdle = false;
  // Places sent by the last moves, to recognise their echoes
  let sent: { at: number; places: Map<string, number> }[] = [];
  return {
    begin(items) {
      seq++;
      inFlight.add(seq);
      sent = [...sent.filter((m) => now() - m.at < MOVE_ECHO_MS), { at: now(), places: new Map(items.map((it) => [it.id, it.sortOrder])) }].slice(-20);
      return seq;
    },
    settle(n, reload) {
      inFlight.delete(n);
      if (reload) reloadWhenIdle = true;
      const idle = inFlight.size === 0;
      const out = { latest: n === seq, reload: idle && reloadWhenIdle };
      if (out.reload) reloadWhenIdle = false;
      return out;
    },
    classify(payload, myUserId) {
      const items = payload?.items;
      if (myUserId && payload?.userId === myUserId && Array.isArray(items) && items.length > 0) {
        const recent = sent.filter((m) => now() - m.at < MOVE_ECHO_MS);
        // Every place of the event is one this tab sent (the answer brings the same)
        if (recent.some((m) => items.every((it) => m.places.get(it.id) === it.sortOrder))) return 'echo';
      }
      if (inFlight.size > 0) {
        // Someone else's move while own ones are on their way: which came first on the server is not known
        // here; load once they are answered
        reloadWhenIdle = true;
        return 'defer';
      }
      return 'apply';
    },
  };
}

// Applies the answer of a move: its places if it is still the latest move, else only the tasks the server
// skipped (deleted meanwhile); everything is loaded once no move is on its way and one asked for it.
export function applyMoveAnswer(
  tracker: MoveTracker,
  seq: number,
  res: TaskReorderResult | null,
  apply: (items: TaskOrder[], skipped: string[] | undefined) => void,
  reload: () => void
) {
  const settled = tracker.settle(seq, !res || !!res.reload || !Array.isArray(res.items));
  if (res && Array.isArray(res.items) && !res.reload) {
    if (settled.latest) apply(res.items, res.skipped);
    else if (res.skipped?.length) apply([], res.skipped);
  }
  if (settled.reload) reload();
}
