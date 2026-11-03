// Sends a few operations for a note that is not open in an editor (e.g. ticking a to-do in the overview).
// Goes through the same sync endpoint and rules as the editor, so the change is logged and pushed to
// everyone who has the note open.
import type { Op, Result } from './model';
import { httpTransport } from './transport';

export async function sendDocOps(docId: string, ops: Omit<Op, 'opId'>[]): Promise<Result[]> {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const clientId = `once_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  const res = await httpTransport.sync(docId, {
    clientId,
    lastSeq: 0,
    ops: ops.map((op, i) => ({ ...op, opId: `${clientId}.${i}` }) as Op),
    skipLog: true,
  });
  return res.results;
}
