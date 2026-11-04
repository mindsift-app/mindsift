import { describe, it, expect } from 'vitest';
import type { DocumentBlock } from '../../types';
import { DocSyncEngine } from '../engine';
import { applyOp, Doc, emptyDoc, Op, Result } from '../model';
import { MemoryStorage } from '../persist';
import { LogEntry, SyncRequest, Transport, TransportError } from '../transport';

/** Minimal stand-in server (same rules as the Go server, plus configurable leases of others). */
class Server {
  doc: Doc = emptyDoc();
  log: LogEntry[] = [];
  results = new Map<string, Result>();
  othersLeases: { blockId: string; userId: string; name: string }[] = [];

  constructor(blocks: [string, string][]) {
    blocks.forEach(([id, content], i) => this.apply({ opId: `seed${i}`, kind: 'insert', blockId: id, parentId: '', orderKey: `a${i}`, content }, 'seed'));
  }
  apply(op: Op, by: string): Result {
    const known = this.results.get(op.opId);
    if (known) return known;
    const { effects, result } = applyOp(this.doc, op, by);
    for (const e of effects) this.log.push({ seq: this.log.length + 1, userId: by, clientId: by, opId: op.opId, effect: e });
    if (effects.length) result.seq = this.log.length;
    this.results.set(op.opId, result);
    return result;
  }
  transport(): Transport {
    return {
      snapshot: async () => ({
        docId: 'd',
        title: this.doc.title,
        titleVersion: this.doc.titleVersion,
        headSeq: this.log.length,
        blocks: Array.from(this.doc.blocks.values()).map((b) => ({ ...b, props: { ...b.props } })),
        role: 'owner',
        shared: true,
      }),
      sync: async (_id: string, body: SyncRequest) => {
        if (!body) throw new TransportError('x', 0);
        const results = body.ops.map((op) => this.apply(op, body.clientId));
        return {
          results,
          ops: this.log.filter((e) => e.seq > body.lastSeq),
          headSeq: this.log.length,
          hasMore: false,
          role: 'owner',
          shared: true,
          sessions: 2,
          presence: [],
          leases: { granted: [], denied: [], others: this.othersLeases },
        };
      },
      leave: async () => {},
      changes: async () => ({ headSeq: this.log.length, changed: false }),
    };
  }
}

let clock = 1_000_000;
async function engineFor(server: Server) {
  const e = new DocSyncEngine('d', { transport: server.transport(), storage: new MemoryStorage(), manual: true, now: () => clock });
  await e.start();
  return e;
}
const flat = (e: DocSyncEngine) => e.getState().blocks;
const texts = (e: DocSyncEngine) => flat(e).map((b) => b.content);
function edit(e: DocSyncEngine, fn: (b: DocumentBlock[]) => DocumentBlock[]) {
  e.applyFlat(fn(flat(e).map((b) => ({ ...b }))));
}

describe('undo/redo', () => {
  it('groups typing in one block and reverts it in one step', async () => {
    const server = new Server([['a', 'Hallo']]);
    const e = await engineFor(server);
    edit(e, (b) => [{ ...b[0], content: 'Hallo W' }]);
    clock += 300;
    edit(e, (b) => [{ ...b[0], content: 'Hallo Welt' }]);
    expect(e.undo().ok).toBe(true);
    expect(texts(e)).toEqual(['Hallo']);
    expect(e.getState().canUndo).toBe(false);
    expect(e.redo().ok).toBe(true);
    expect(texts(e)).toEqual(['Hallo Welt']);
    await e.syncNow();
    expect(server.doc.blocks.get('a')!.content).toBe('Hallo Welt');
  });

  it('separates typing steps after a pause', async () => {
    const server = new Server([['a', '']]);
    const e = await engineFor(server);
    edit(e, (b) => [{ ...b[0], content: 'Eins' }]);
    clock += 2000;
    edit(e, (b) => [{ ...b[0], content: 'Eins Zwei' }]);
    e.undo();
    expect(texts(e)).toEqual(['Eins']);
  });

  it('undoes inserting and deleting blocks', async () => {
    const server = new Server([['a', 'Erster']]);
    const e = await engineFor(server);
    edit(e, (b) => [...b, { id: 'n', type: 'bullet', content: 'Neu', level: 0 }]);
    clock += 2000;
    edit(e, (b) => b.filter((x) => x.id !== 'a'));
    expect(texts(e)).toEqual(['Neu']);
    e.undo();
    expect(texts(e)).toEqual(['Erster', 'Neu']);
    e.undo();
    expect(texts(e)).toEqual(['Erster']);
    await e.syncNow();
    expect(server.doc.blocks.get('a')!.deleted).toBe(false);
    expect(server.doc.blocks.get('n')!.deleted).toBe(true);
  });

  it('undoes deleting a selection whose last bullet had children (they moved up)', async () => {
    const server = new Server([['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma'], ['e', 'Ende']]);
    server.apply({ opId: 'kid', kind: 'insert', blockId: 'd', parentId: 'c', orderKey: 'a0', content: 'Kind' }, 'seed');
    const e = await engineFor(server);
    // As OutlinerTree does: the first bullet gets the merged text, the last goes, its child moves along
    edit(e, (b) => b.filter((x) => x.id !== 'c').map((x) => (x.id === 'b' ? { ...x, content: 'Betma' } : x)));
    expect(texts(e)).toEqual(['Alpha', 'Betma', 'Kind', 'Ende']);
    const res = e.undo();
    expect(res.message).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(texts(e)).toEqual(['Alpha', 'Beta', 'Gamma', 'Kind', 'Ende']);
  });

  it('skips undo when someone else changed the block in between', async () => {
    const server = new Server([['a', 'Start']]);
    const e = await engineFor(server);
    edit(e, (b) => [{ ...b[0], content: 'Meins' }]);
    await e.syncNow();
    server.apply({ opId: 'other', kind: 'set_content', blockId: 'a', baseVersion: 2, content: 'Fremd' }, 'other');
    await e.syncNow();
    const res = e.undo();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/jemand anderem/);
    expect(texts(e)).toEqual(['Fremd']);
  });

  it('skips undo on a block someone else is editing', async () => {
    const server = new Server([['a', 'Start']]);
    const e = await engineFor(server);
    edit(e, (b) => [{ ...b[0], content: 'Meins' }]);
    await e.syncNow();
    server.othersLeases = [{ blockId: 'a', userId: 'u2', name: 'Anna' }];
    await e.syncNow();
    const res = e.undo();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Anna/);
    expect(texts(e)).toEqual(['Meins']);
  });
});

describe('conflict copies', () => {
  async function withConflict() {
    const server = new Server([['a', 'Start']]);
    const e = await engineFor(server);
    server.apply({ opId: 'first', kind: 'set_content', blockId: 'a', baseVersion: 1, content: 'Gewinner' }, 'other');
    server.apply({ opId: 'second', kind: 'set_content', blockId: 'a', baseVersion: 1, content: 'Verlierer' }, 'mine');
    await e.syncNow();
    const copy = flat(e).find((b) => b.conflictOf === 'a')!;
    return { server, e, copy };
  }

  it('accepting replaces the original text and removes the copy', async () => {
    const { server, e, copy } = await withConflict();
    expect(e.resolveConflict(copy.id, true).ok).toBe(true);
    expect(texts(e)).toEqual(['Verlierer']);
    await e.syncNow();
    expect(server.doc.blocks.get('a')!.content).toBe('Verlierer');
    expect(server.doc.blocks.get(copy.id)!.deleted).toBe(true);
    e.undo();
    expect(texts(e)).toEqual(['Gewinner', 'Verlierer']);
  });

  it('is not started while someone else holds the copy', async () => {
    const { server, e, copy } = await withConflict();
    server.othersLeases = [{ blockId: copy.id, userId: 'u2', name: 'Ben' }];
    await e.syncNow();
    const res = e.resolveConflict(copy.id, true);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Ben/);
    expect(texts(e)).toEqual(['Gewinner', 'Verlierer']);
  });

  it('discarding removes only the copy', async () => {
    const { e, copy } = await withConflict();
    e.resolveConflict(copy.id, false);
    expect(texts(e)).toEqual(['Gewinner']);
  });

  it('a copy whose original is gone becomes a normal block', async () => {
    const { server, e, copy } = await withConflict();
    server.apply({ opId: 'del', kind: 'delete', blockId: 'a' }, 'other');
    await e.syncNow();
    e.resolveConflict(copy.id, true);
    expect(flat(e).find((b) => b.id === copy.id)?.conflictOf).toBeUndefined();
  });
});
