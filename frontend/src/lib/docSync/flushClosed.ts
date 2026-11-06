// Sends changes that are still waiting in notes no longer open in an editor (typed offline, then the note
// was left). Without this they would only go out the next time the note is opened. Runs at app start and
// when the connection is back; each note goes through a short-lived engine, so the same op IDs, conflict
// rules and storage apply as in the editor.
import { getCurrentUserId } from '../api/client';
import { DocSyncEngine, isNoteOpen } from './engine';
import { defaultStorage, SyncStorage } from './persist';
import type { Transport } from './transport';

let running = false;

/** Returns how many notes had all their waiting changes sent. */
export async function flushClosedNotes(
  opts: { storage?: SyncStorage; transport?: Transport; userId?: string } = {}
): Promise<number> {
  const userId = opts.userId ?? getCurrentUserId();
  if (running || !userId) return 0;
  running = true;
  const storage = opts.storage || defaultStorage();
  let sent = 0;
  try {
    const states = await storage.list();
    for (const s of states) {
      // Only the signed-in person's own changes; notes in an editor send theirs themselves
      if (s.userId !== userId || isNoteOpen(s.docId)) continue;
      if (s.pending.length === 0 && !s.inflight?.length) continue;
      const engine = new DocSyncEngine(s.docId, { storage, transport: opts.transport, userId, manual: true });
      await engine.start();
      const done = engine.getState().pendingCount === 0;
      engine.stop();
      if (done) sent++;
      else if (engine.getState().status === 'offline') break; // still no connection: try again later
    }
  } catch {
    // Storage unavailable: nothing stored to send
  } finally {
    running = false;
  }
  return sent;
}
