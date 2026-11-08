// Undo/redo of a note outlives its editor while the app is open: switching to another note or view and
// back keeps it (a reload does not). In memory only, for the last few notes. The steps check the state
// they expect before they run (undo.ts), so changes made meanwhile are never overwritten.
import type { UndoStep } from './undo';

export interface UndoHistory {
  undo: UndoStep[];
  redo: UndoStep[];
  // Anything the editor needs for undoing its own server actions (extract, move, …)
  extra?: unknown;
}

export const UNDO_HISTORY_NOTES = 20;

// Insertion order = last used last, so the first entry is the one to drop
const histories = new Map<string, UndoHistory>();

const key = (userId: string, docId: string) => `${userId}\u0000${docId}`;

/** Takes the kept history of a note (it then belongs to the editor that opened the note). */
export function takeUndoHistory(userId: string, docId: string): UndoHistory | undefined {
  const k = key(userId, docId);
  const h = histories.get(k);
  histories.delete(k);
  return h;
}

/** Keeps the history of a note that is being closed. */
export function keepUndoHistory(userId: string, docId: string, history: UndoHistory): void {
  const k = key(userId, docId);
  histories.delete(k);
  if (history.undo.length === 0 && history.redo.length === 0 && history.extra === undefined) return;
  histories.set(k, history);
  while (histories.size > UNDO_HISTORY_NOTES) {
    const oldest = histories.keys().next().value as string;
    histories.delete(oldest);
  }
}

/** Logging out forgets everything. */
export function clearUndoHistories(): void {
  histories.clear();
}
