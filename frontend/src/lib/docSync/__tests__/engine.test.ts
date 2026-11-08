import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import type { DocumentBlock } from '../../types';
import { DocSyncEngine, formBatch } from '../engine';
import { flushClosedNotes } from '../flushClosed';
import { applyEffect, applyOp, cloneDoc, Doc, Effect, emptyDoc, Op, Result } from '../model';
import { clearStoredNotes, IndexedDBStorage, MemoryStorage, unsentNoteCount } from '../persist';
import { PushChannel, PushKind } from '../push';
import { LogEntry, SnapshotResponse, SyncRequest, SyncResponse, Transport, TransportError } from '../transport';

/** In-memory stand-in for the Go server: same operation rules, log and idempotency. */
class FakeServer {
  doc: Doc = emptyDoc();
  log: LogEntry[] = [];
  results = new Map<string, Result>();
  roles = new Map<string, string>(); // clientId -> role
  applyCount = new Map<string, number>();
  floor = 0; // log entries up to here were compacted away
  private waiters: (() => void)[] = [];

  /** Resolves on the next change (used by the long-poll stand-in). */
  nextChange(): Promise<void> {
    return new Promise((r) => this.waiters.push(r));
  }

  constructor(initial: { id: string; content: string }[] = [{ id: 'b1', content: 'Start' }]) {
    let key = 'a0';
    for (const b of initial) {
      this.apply({ opId: `seed-${b.id}`, kind: 'insert', blockId: b.id, parentId: '', orderKey: key, content: b.content }, 'seed');
      key = String.fromCharCode(key.charCodeAt(0)) + String.fromCharCode(key.charCodeAt(1) + 1);
    }
  }

  apply(op: Op, clientId: string): Result {
    const known = this.results.get(op.opId);
    if (known) return known;
    this.applyCount.set(op.opId, (this.applyCount.get(op.opId) || 0) + 1);
    const { effects, result } = applyOp(this.doc, op, clientId);
    for (const e of effects) this.log.push({ seq: this.log.length + 1, userId: clientId, clientId, opId: op.opId, effect: e });
    if (effects.length > 0) result.seq = this.log.length;
    this.results.set(op.opId, result);
    if (effects.length > 0) {
      const w = this.waiters;
      this.waiters = [];
      w.forEach((fn) => fn());
    }
    return result;
  }

  /** Log compaction: purges the given tombstones (as a log entry) and drops all older log entries. */
  compact(purge: string[]) {
    this.floor = this.log.length;
    const effect: Effect = { kind: 'purge', ids: purge };
    applyEffect(this.doc, effect);
    this.log.push({ seq: this.log.length + 1, userId: '', clientId: '', opId: '', effect });
  }

  snapshot(): SnapshotResponse {
    return {
      docId: 'doc',
      title: this.doc.title,
      titleVersion: this.doc.titleVersion,
      headSeq: this.log.length,
      blocks: Array.from(cloneDoc(this.doc).blocks.values()),
      role: 'owner',
      shared: true,
    };
  }

  sync(body: SyncRequest): SyncResponse {
    const role = this.roles.get(body.clientId) || 'owner';
    if (body.ops.length > 0 && role === 'viewer') throw new TransportError('nur Lesen', 403);
    const results = body.ops.map((op) => this.apply(op, body.clientId));
    const compacted = body.lastSeq < this.floor;
    return {
      results,
      resync: compacted || undefined,
      ops: compacted ? [] : this.log.filter((e) => e.seq > body.lastSeq),
      headSeq: this.log.length,
      hasMore: false,
      role,
      shared: true,
      sessions: 2,
      presence: [],
      leases: { granted: [], denied: [], others: this.others },
    };
  }
  others: { blockId: string; userId: string; name: string }[] = [];
}

/** Network between one client and the fake server, with switchable failures. */
class FakeNet implements Transport {
  mode: 'ok' | 'down' | 'lose-response' = 'ok';
  longPollDown = false;
  changesCalls = 0;
  duringRequest: (() => void) | null = null; // runs while the request is "on the wire"

  constructor(private server: FakeServer, private role = 'owner') {}
  async snapshot() {
    if (this.mode === 'down') throw new TransportError('offline', 0);
    return { ...this.server.snapshot(), role: this.role };
  }
  async sync(_docId: string, body: SyncRequest) {
    if (this.mode === 'down') throw new TransportError('offline', 0);
    this.server.roles.set(body.clientId, this.role);
    const hook = this.duringRequest;
    this.duringRequest = null;
    hook?.();
    const res = this.server.sync(body);
    if (this.mode === 'lose-response') throw new TransportError('timeout', 0);
    return res;
  }
  async leave() {}
  async changes(_docId: string, since: number, waitSec: number, signal?: AbortSignal) {
    this.changesCalls++;
    if (this.mode === 'down' || this.longPollDown) throw new TransportError('blocked', 0);
    if (this.server.log.length === since) {
      await Promise.race([
        this.server.nextChange(),
        new Promise((r) => setTimeout(r, waitSec * 1000)),
        new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))),
      ]);
    }
    return { headSeq: this.server.log.length, changed: this.server.log.length !== since };
  }
}

/** Push channel controlled by the test. */
class FakePush implements PushChannel {
  kind: PushKind = 'none';
  private poke: (() => void) | null = null;
  private status: ((k: PushKind) => void) | null = null;
  subscribe(_docId: string, onPoke: () => void, onStatus: (k: PushKind) => void) {
    this.poke = onPoke;
    this.status = onStatus;
    onStatus(this.kind);
    return () => {
      this.poke = null;
    };
  }
  setKind(k: PushKind) {
    this.kind = k;
    this.status?.(k);
  }
  notify() {
    this.poke?.();
  }
}

function flatOf(engine: DocSyncEngine): DocumentBlock[] {
  return engine.getState().blocks;
}

function edit(engine: DocSyncEngine, fn: (blocks: DocumentBlock[]) => DocumentBlock[]) {
  engine.applyFlat(fn(flatOf(engine).map((b) => ({ ...b }))));
}

const contents = (engine: DocSyncEngine) => flatOf(engine).map((b) => b.content);
const serverContents = (server: FakeServer) => docContents(server.doc);
function docContents(d: Doc): string[] {
  return Array.from(d.blocks.values())
    .filter((b) => !b.deleted)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : a.id < b.id ? -1 : 1))
    .map((b) => b.content);
}

async function startEngine(net: Transport, storage = new MemoryStorage()) {
  const engine = new DocSyncEngine('doc', { transport: net, storage, manual: true });
  await engine.start();
  return engine;
}

describe('DocSyncEngine', () => {
  it('sends edits and confirms them', async () => {
    const server = new FakeServer();
    const engine = await startEngine(new FakeNet(server));
    edit(engine, (b) => {
      b[0].content = 'Hallo';
      return [...b, { id: 'b2', type: 'bullet', content: 'Neu', level: 1 }];
    });
    expect(engine.getState().pendingCount).toBeGreaterThan(0);
    await engine.syncNow();
    expect(engine.getState().status).toBe('saved');
    expect(engine.getState().pendingCount).toBe(0);
    expect(serverContents(server)).toEqual(['Hallo', 'Neu']);
  });

  it('coalesces fast typing into one text operation', async () => {
    const server = new FakeServer();
    const engine = await startEngine(new FakeNet(server));
    for (const text of ['H', 'Ha', 'Hal', 'Hall', 'Hallo']) edit(engine, (b) => [{ ...b[0], content: text }]);
    await engine.syncNow();
    const textOps = server.log.filter((e) => e.effect.kind === 'set_content');
    expect(textOps).toHaveLength(1);
    expect(textOps[0].effect.content).toBe('Hallo');
  });

  it('keeps edits through an offline phase and a reload, and applies them exactly once', async () => {
    const server = new FakeServer();
    const storage = new MemoryStorage();
    const net = new FakeNet(server);
    const first = await startEngine(net, storage);

    net.mode = 'down';
    edit(first, (b) => [{ ...b[0], content: 'Offline getippt' }, { id: 'b9', type: 'bullet', content: 'Noch einer', level: 0 }]);
    await new Promise((r) => setTimeout(r, 0)); // let the queue reach storage
    await first.syncNow();
    expect(first.getState().status).toBe('offline');
    expect(contents(first)).toEqual(['Offline getippt', 'Noch einer']);

    // Tab is closed while offline; a new tab opens the note from storage, still offline
    const second = await startEngine(net, storage);
    expect(contents(second)).toEqual(['Offline getippt', 'Noch einer']);

    net.mode = 'ok';
    await second.syncNow();
    await second.syncNow();
    expect(serverContents(server)).toEqual(['Offline getippt', 'Noch einer']);
    for (const count of server.applyCount.values()) expect(count).toBe(1);
  });

  it('a client offline for weeks reloads after log compaction and keeps its unsent text', async () => {
    const server = new FakeServer([
      { id: 'b1', content: 'Start' },
      { id: 'b2', content: 'Wird gelöscht' },
    ]);
    const netA = new FakeNet(server);
    const netB = new FakeNet(server);
    const a = await startEngine(netA);
    const b = await startEngine(netB);

    netB.mode = 'down';
    edit(b, (blocks) => [{ ...blocks[0], content: 'Start (B)' }, { ...blocks[1], content: 'B tippt weiter' }]);
    await b.syncNow();

    // Meanwhile A deletes b2, and weeks later the tombstone is purged and the log compacted
    edit(a, (blocks) => [blocks[0]]);
    await a.syncNow();
    server.compact(['b2']);
    await a.syncNow();
    expect(contents(a)).toEqual(['Start']);

    netB.mode = 'ok';
    await b.syncNow();
    await b.syncNow();
    // Nothing typed offline is lost: the edit of the purged block comes back as a new block
    expect(serverContents(server)).toEqual(['Start (B)', 'B tippt weiter']);
    expect(contents(b)).toEqual(['Start (B)', 'B tippt weiter']);
    await a.syncNow();
    expect(contents(a)).toEqual(['Start (B)', 'B tippt weiter']);
  });

  it('retries after a lost response without applying twice', async () => {
    const server = new FakeServer();
    const net = new FakeNet(server);
    const engine = await startEngine(net);
    edit(engine, (b) => [...b, { id: 'b2', type: 'bullet', content: 'Einmal', level: 0 }]);
    net.mode = 'lose-response';
    await engine.syncNow();
    expect(engine.getState().status).toBe('offline');
    net.mode = 'ok';
    await engine.syncNow();
    expect(serverContents(server)).toEqual(['Start', 'Einmal']);
    expect(server.log.filter((e) => e.effect.kind === 'insert' && e.effect.blockId === 'b2')).toHaveLength(1);
  });

  it('two clients converge, and a conflict keeps both texts', async () => {
    const server = new FakeServer();
    const a = await startEngine(new FakeNet(server));
    const b = await startEngine(new FakeNet(server));

    edit(a, (blocks) => [{ ...blocks[0], content: 'Von A' }]);
    edit(b, (blocks) => [{ ...blocks[0], content: 'Von B' }]);
    await a.syncNow();
    await b.syncNow(); // B's base version is stale -> conflict copy
    await a.syncNow();

    expect(contents(a)).toEqual(contents(b));
    expect(contents(a)).toEqual(['Von A', 'Von B']);
    expect(flatOf(a)[1].conflictOf).toBe('b1');
    expect(b.getState().conflicts).toHaveLength(1);
  });

  it('keeps text when two clients create the same first block of an empty note', async () => {
    const server = new FakeServer([]);
    const a = await startEngine(new FakeNet(server));
    const b = await startEngine(new FakeNet(server));
    a.applyFlat([{ id: 'doc-b0', type: 'text', content: 'Text von A', level: 0 }]);
    b.applyFlat([{ id: 'doc-b0', type: 'text', content: 'Text von B', level: 0 }]);
    await a.syncNow();
    await b.syncNow(); // insert rejected: block exists
    await b.syncNow(); // text resent as set_content -> conflict copy
    await a.syncNow();
    expect(contents(a)).toEqual(contents(b));
    expect(contents(a)).toEqual(expect.arrayContaining(['Text von A', 'Text von B']));
  });

  it('does not overwrite a change that arrived while the user kept typing', async () => {
    const server = new FakeServer([
      { id: 'b1', content: 'Start' },
      { id: 'b2', content: 'Anderer Punkt' },
    ]);
    const netA = new FakeNet(server);
    const a = await startEngine(netA);
    const b = await startEngine(new FakeNet(server));

    edit(a, (blocks) => [blocks[0], { ...blocks[1], content: 'Anderer Punkt!' }]);
    netA.duringRequest = () => {
      // While A's request travels: B's change of b1 reaches the server first, and A starts typing into
      // b1 (still seeing 'Start')
      server.apply({ opId: 'b-op', kind: 'set_content', blockId: 'b1', baseVersion: 1, content: 'B war schneller' }, 'cB');
      edit(a, (blocks) => [{ ...blocks[0], content: 'Start + A' }, blocks[1]]);
    };
    await a.syncNow(); // response brings B's change; A's text for b1 is still pending
    await a.syncNow();
    await b.syncNow();

    expect(contents(a)).toEqual(contents(b));
    expect(contents(a)).toEqual(expect.arrayContaining(['B war schneller', 'Start + A', 'Anderer Punkt!']));
  });

  it('a stale focused text field cannot overwrite a newer remote version', async () => {
    const server = new FakeServer();
    const a = await startEngine(new FakeNet(server));
    const b = await startEngine(new FakeNet(server));

    a.focusBlock('b1'); // A's cursor stays in the block; its field keeps showing 'Start'
    edit(b, (blocks) => [{ ...blocks[0], content: 'B hat geändert' }]);
    await b.syncNow();
    await a.syncNow(); // A receives B's version, but the focused field still shows the old text

    a.applyFlat([{ id: 'b1', type: 'bullet', content: 'Start + A', level: 0 }]);
    await a.syncNow();
    await b.syncNow();

    expect(contents(a)).toEqual(contents(b));
    expect(contents(a)).toEqual(expect.arrayContaining(['B hat geändert', 'Start + A']));
  });

  it('leaving a block someone else typed in without typing there makes no conflict copy', async () => {
    const server = new FakeServer();
    const a = await startEngine(new FakeNet(server));
    const b = await startEngine(new FakeNet(server));

    a.focusBlock('b1'); // A clicks into the bullet B is editing; the field keeps showing 'Start'
    edit(b, (blocks) => [{ ...blocks[0], content: 'B tippt' }]);
    await b.syncNow();
    await a.syncNow();

    // A clicks out; the field hands back the text it showed
    a.focusBlock(null);
    a.applyFlat([{ id: 'b1', type: 'bullet', content: 'Start', level: 0 }]);
    await a.syncNow();
    await b.syncNow();

    expect(a.getState().conflicts).toEqual([]);
    expect(serverContents(server)).toEqual(['B tippt']);
    expect(contents(a)).toEqual(['B tippt']);
    expect(contents(b)).toEqual(['B tippt']);
  });

  it('own text handed back after someone else changed the bullet makes no conflict copy', async () => {
    const server = new FakeServer();
    const a = await startEngine(new FakeNet(server));
    const b = await startEngine(new FakeNet(server));

    a.focusBlock('b1');
    edit(a, (blocks) => [{ ...blocks[0], content: 'Von A' }]);
    await a.syncNow();
    await b.syncNow();
    // A's lease ran out while the cursor rested there; B changes the bullet
    edit(b, (blocks) => [{ ...blocks[0], content: 'Von A, B ergänzt' }]);
    await b.syncNow();
    await a.syncNow();

    a.focusBlock(null);
    a.applyFlat([{ id: 'b1', type: 'bullet', content: 'Von A', level: 0 }]);
    await a.syncNow();

    expect(a.getState().conflicts).toEqual([]);
    expect(serverContents(server)).toEqual(['Von A, B ergänzt']);
    expect(contents(a)).toEqual(['Von A, B ergänzt']);
  });

  it('typing in a rhythm (several edits per sync) causes no conflict with oneself', async () => {
    const server = new FakeServer();
    const net = new FakeNet(server);
    const engine = await startEngine(net);
    engine.focusBlock('b1');
    // Pauses longer than the field's debounce but shorter than the sync debounce: several edits per sync
    for (const text of ['S', 'Sc', 'Sch']) edit(engine, (b) => [{ ...b[0], content: text }]);
    await engine.syncNow();
    edit(engine, (b) => [{ ...b[0], content: 'Schr' }]);
    edit(engine, (b) => [{ ...b[0], content: 'Schre' }]);
    // More typing while the request is on the wire
    net.duringRequest = () => edit(engine, (b) => [{ ...b[0], content: 'Schrei' }]);
    await engine.syncNow();
    edit(engine, (b) => [{ ...b[0], content: 'Schreib' }]);
    await engine.syncNow();
    edit(engine, (b) => [{ ...b[0], content: 'Schreibe' }]);
    await engine.syncNow();

    expect(engine.getState().conflicts).toEqual([]);
    expect(serverContents(server)).toEqual(['Schreibe']);
    expect(contents(engine)).toEqual(['Schreibe']);
  });

  it('typing on after leaving the tab causes no conflict with oneself', async () => {
    const server = new FakeServer();
    const engine = await startEngine(new FakeNet(server));
    engine.focusBlock('b1');
    edit(engine, (b) => [{ ...b[0], content: 'Start und' }]);
    // Tab hidden (window switch, app switch on the phone): pending text goes out with keepalive
    (engine as any).flushOnExit();
    await new Promise((r) => setTimeout(r, 0));
    expect(serverContents(server)).toEqual(['Start und']);

    // Back in the tab, typing on in the same block
    edit(engine, (b) => [{ ...b[0], content: 'Start und weiter' }]);
    await engine.syncNow();
    edit(engine, (b) => [{ ...b[0], content: 'Start und weiter geht es' }]);
    await engine.syncNow();

    expect(engine.getState().conflicts).toEqual([]);
    expect(serverContents(server)).toEqual(['Start und weiter geht es']);
  });

  it('typing on in a block after a conflict updates the one conflict copy', async () => {
    const server = new FakeServer();
    const a = await startEngine(new FakeNet(server));
    const b = await startEngine(new FakeNet(server));

    a.focusBlock('b1');
    edit(b, (blocks) => [{ ...blocks[0], content: 'B hat geändert' }]);
    await b.syncNow();
    await a.syncNow(); // the focused field keeps showing A's own text

    a.applyFlat([{ id: 'b1', type: 'bullet', content: 'Start + A', level: 0 }]);
    await a.syncNow(); // conflict: A's text becomes a copy
    // A keeps typing in the same field, which still shows A's text
    a.applyFlat([{ ...flatOf(a)[0], content: 'Start + A tippt' }, flatOf(a)[1]]);
    await a.syncNow();
    a.applyFlat([{ ...flatOf(a)[0], content: 'Start + A tippt weiter' }, flatOf(a)[1]]);
    await a.syncNow();
    await b.syncNow();

    expect(a.getState().conflicts).toHaveLength(1);
    expect(serverContents(server)).toEqual(['B hat geändert', 'Start + A tippt weiter']);
    expect(contents(b)).toEqual(['B hat geändert', 'Start + A tippt weiter']);

    // Once the cursor left, the field shows B's version again: editing it changes the block itself
    a.focusBlock(null);
    a.focusBlock('b1');
    edit(a, (blocks) => [{ ...blocks[0], content: 'B hat geändert, A ergänzt' }, blocks[1]]);
    await a.syncNow();
    expect(a.getState().conflicts).toHaveLength(1);
    expect(serverContents(server)).toEqual(['B hat geändert, A ergänzt', 'Start + A tippt weiter']);
  });

  it('viewers cannot change anything', async () => {
    const server = new FakeServer();
    const viewer = await startEngine(new FakeNet(server, 'viewer'));
    edit(viewer, (b) => [{ ...b[0], content: 'Leser' }]);
    await viewer.syncNow();
    expect(viewer.getState().pendingCount).toBe(0);
    expect(serverContents(server)).toEqual(['Start']);
  });

  it('changes of others arrive within seconds right after reopening a shared note from local storage', async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      const net = new FakeNet(server);
      net.longPollDown = true; // worst case: only plain polling works
      // Opened before: the note is reopened from local storage (like after a reload)
      const storage = new MemoryStorage();
      const first = new DocSyncEngine('doc', { transport: net, storage, manual: true });
      await first.start();
      first.stop();
      const engine = new DocSyncEngine('doc', { transport: net, storage, push: new FakePush() });
      await engine.start();
      await vi.advanceTimersByTimeAsync(5_000); // long polling gives up after three attempts
      server.apply({ opId: 'remote', kind: 'set_content', blockId: 'b1', baseVersion: 1, content: 'Von anderen' }, 'other');
      await vi.advanceTimersByTimeAsync(3_500);
      expect(contents(engine)).toEqual(['Von anderen']); // not only after 30 s
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('formBatch keeps the last text per block with the base of the first', () => {
    const batch = formBatch([
      { opId: '1', kind: 'set_content', blockId: 'a', content: 'x', baseVersion: 5 },
      { opId: '2', kind: 'set_title', title: 'T1', baseVersion: 3 },
      { opId: '3', kind: 'set_content', blockId: 'a', content: 'xy', baseVersion: 6 },
      { opId: '4', kind: 'set_title', title: 'T2', baseVersion: 4 },
    ]);
    expect(batch).toEqual([
      { opId: '3', kind: 'set_content', blockId: 'a', content: 'xy', baseVersion: 5 },
      { opId: '4', kind: 'set_title', title: 'T2', baseVersion: 3 },
    ]);
  });

  it('sends changes of a note left while offline once the connection is back', async () => {
    const server = new FakeServer();
    const storage = new MemoryStorage();
    const net = new FakeNet(server);
    const engine = new DocSyncEngine('doc', { transport: net, storage, manual: true, userId: 'u1' });
    await engine.start();
    net.mode = 'down';
    edit(engine, (b) => [{ ...b[0], content: 'Offline getippt' }]);
    await engine.syncNow();
    engine.stop(); // the note is left, the change waits in storage
    expect(await flushClosedNotes({ storage, transport: net, userId: 'u1' })).toBe(0);
    net.mode = 'ok';
    // Changes stored for another account are not sent with this one's session
    expect(await flushClosedNotes({ storage, transport: net, userId: 'u2' })).toBe(0);
    expect(serverContents(server)).toEqual(['Start']);
    expect(await flushClosedNotes({ storage, transport: net, userId: 'u1' })).toBe(1);
    expect(serverContents(server)).toEqual(['Offline getippt']);
    expect((await storage.load('doc'))?.pending).toEqual([]);
    expect(await flushClosedNotes({ storage, transport: net, userId: 'u1' })).toBe(0);
  });

  it("never shows or sends a state stored for another account", async () => {
    const server = new FakeServer();
    const storage = new MemoryStorage();
    const net = new FakeNet(server);
    const mine = new DocSyncEngine('doc', { transport: net, storage, manual: true, userId: 'u1' });
    await mine.start();
    net.mode = 'down';
    edit(mine, (b) => [{ ...b[0], content: 'Privat von u1' }]);
    await mine.syncNow();
    mine.stop();
    net.mode = 'ok';
    const other = new DocSyncEngine('doc', { transport: net, storage, manual: true, userId: 'u2' });
    await other.start();
    expect(contents(other)).toEqual(['Start']);
    expect(other.getState().pendingCount).toBe(0);
    expect(serverContents(server)).toEqual(['Start']);
  });

  it('counts notes with unsent changes and forgets them when cleared', async () => {
    const server = new FakeServer();
    const net = new FakeNet(server);
    const engine = new DocSyncEngine('doc', { transport: net, storage: new MemoryStorage(), manual: true, userId: 'u1' });
    await engine.start();
    net.mode = 'down';
    edit(engine, (b) => [{ ...b[0], content: 'Wartet' }]);
    await engine.syncNow();
    expect(unsentNoteCount()).toBe(1);
    net.mode = 'ok';
    await engine.syncNow();
    expect(unsentNoteCount()).toBe(0);
    net.mode = 'down';
    edit(engine, (b) => [{ ...b[0], content: 'Wartet wieder' }]);
    await engine.syncNow();
    expect(unsentNoteCount()).toBe(1);
    engine.stop();
    await clearStoredNotes();
    expect(unsentNoteCount()).toBe(0);
  });

  it('stores state in IndexedDB', async () => {
    const storage = new IndexedDBStorage(indexedDB);
    await storage.save({ docId: 'd', title: 'T', titleVersion: 1, lastSeq: 7, role: 'owner', blocks: [], pending: [], inflight: null, savedAt: 1 });
    const loaded = await storage.load('d');
    expect(loaded?.lastSeq).toBe(7);
    expect(await storage.load('missing')).toBeNull();
    expect((await storage.list()).map((st) => st.docId)).toEqual(['d']);
    await clearStoredNotes(); // signing out
    expect(await storage.list()).toEqual([]);
  });
});


describe('how changes of others arrive', () => {
  async function live(push: FakePush, net: FakeNet) {
    const engine = new DocSyncEngine('doc', { transport: net, storage: new MemoryStorage(), push });
    await engine.start();
    await vi.advanceTimersByTimeAsync(100); // let the start-up round trips settle
    return engine;
  }
  const otherEdit = (server: FakeServer, text: string) =>
    server.apply({ opId: `other-${text}`, kind: 'set_content', blockId: 'b1', baseVersion: server.doc.blocks.get('b1')!.version, content: text }, 'other');

  it('push: syncs on a notification and otherwise only checks every 30 s', async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      const net = new FakeNet(server);
      const push = new FakePush();
      push.kind = 'ws';
      const engine = await live(push, net);
      expect(engine.getState().channel).toBe('ws');
      otherEdit(server, 'Von anderen');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(contents(engine)).toEqual(['Start']); // no notification, no poll yet
      push.notify();
      await vi.advanceTimersByTimeAsync(100);
      expect(contents(engine)).toEqual(['Von anderen']);
      expect(net.changesCalls).toBe(0);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('push: renews leases every 7 s while a block is held', async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      const net = new FakeNet(server);
      const push = new FakePush();
      push.kind = 'sse';
      const engine = await live(push, net);
      let syncs = 0;
      const orig = net.sync.bind(net);
      net.sync = async (...a: Parameters<typeof orig>) => {
        syncs++;
        return orig(...a);
      };
      engine.focusBlock('b1');
      await vi.advanceTimersByTimeAsync(15_000);
      expect(syncs).toBeGreaterThanOrEqual(2);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('push: looks every 3 s while someone else holds a bullet (their lock may run out unannounced)', async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      server.others = [{ blockId: 'b1', userId: 'u_anna', name: 'Anna' }];
      const net = new FakePush();
      net.kind = 'ws';
      const transport = new FakeNet(server);
      const engine = await live(net, transport);
      expect(engine.getState().lockedByOthers).toHaveLength(1);
      server.others = []; // Anna's browser closed, her lock ran out
      await vi.advanceTimersByTimeAsync(3_500);
      expect(engine.getState().lockedByOthers).toHaveLength(0);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('without push: long polling delivers changes right away', async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      const net = new FakeNet(server);
      const engine = await live(new FakePush(), net);
      await vi.advanceTimersByTimeAsync(10);
      expect(engine.getState().channel).toBe('longpoll');
      otherEdit(server, 'Per Long-Polling');
      await vi.advanceTimersByTimeAsync(200);
      expect(contents(engine)).toEqual(['Per Long-Polling']);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to polling every 3 s when long polling is blocked too', async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      const net = new FakeNet(server);
      net.longPollDown = true;
      const engine = await live(new FakePush(), net);
      await vi.advanceTimersByTimeAsync(5_000); // three failed attempts with back-off
      expect(engine.getState().channel).toBe('interval');
      otherEdit(server, 'Per Abfrage');
      await vi.advanceTimersByTimeAsync(3_500);
      expect(contents(engine)).toEqual(['Per Abfrage']);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('push: requests the lease right after focusing a block', async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      const net = new FakeNet(server);
      const push = new FakePush();
      push.kind = 'ws';
      const engine = await live(push, net);
      const holds: string[][] = [];
      const orig = net.sync.bind(net);
      net.sync = async (id: string, body: SyncRequest, o?: { keepalive?: boolean }) => {
        holds.push(body.leases?.hold || []);
        return orig(id, body, o);
      };
      engine.focusBlock('b1');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(holds.some((h) => h.includes('b1'))).toBe(true);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('push: gives a left bullet up right when its 7 s of grace are over, not only with the next renewal', async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      const net = new FakeNet(server);
      const push = new FakePush();
      push.kind = 'ws';
      const engine = await live(push, net);
      const holds: { at: number; hold: string[] }[] = [];
      const orig = net.sync.bind(net);
      net.sync = async (id: string, body: SyncRequest, o?: { keepalive?: boolean }) => {
        holds.push({ at: Date.now(), hold: body.leases?.hold || [] });
        return orig(id, body, o);
      };
      const start = Date.now();
      engine.focusBlock('b1');
      await vi.advanceTimersByTimeAsync(1_000);
      engine.focusBlock(null);
      await vi.advanceTimersByTimeAsync(7_500);
      const released = holds.find((h) => h.at - start > 1_000 && h.hold.length === 0);
      expect(released).toBeDefined();
      expect(released!.at - start).toBeGreaterThanOrEqual(8_000);
      expect(released!.at - start).toBeLessThan(8_500);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches between push and long polling when the connection changes', async () => {
    vi.useFakeTimers();
    try {
      const server = new FakeServer();
      const net = new FakeNet(server);
      const push = new FakePush();
      push.kind = 'ws';
      const engine = await live(push, net);
      push.setKind('none');
      await vi.advanceTimersByTimeAsync(10);
      expect(engine.getState().channel).toBe('longpoll');
      push.setKind('ws');
      await vi.advanceTimersByTimeAsync(10);
      expect(engine.getState().channel).toBe('ws');
      otherEdit(server, 'Wieder per Push');
      push.notify();
      await vi.advanceTimersByTimeAsync(100);
      expect(contents(engine)).toEqual(['Wieder per Push']);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
