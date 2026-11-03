// DocSyncEngine keeps one note in sync with the server: confirmed state from the server log, plus the
// user's own unconfirmed operations on top. Every change is stored in IndexedDB before it is sent, sent
// with a unique op ID (safe to resend), and the server decides about conflicts. See
// Doku/plans/kollaboration-notizen.md.
import type { DocumentBlock } from '../types';
import { diffFlat, toDocumentBlocks } from './diff';
import { applyEffect, applyOp, cloneDoc, Doc, docFromSnapshot, emptyDoc, Op, Result } from './model';
import { defaultStorage, SyncStorage } from './persist';
import { httpTransport, LeaseInfo, Presence, Transport, TransportError } from './transport';
import { buildStep, failedChecks, touchedBlocks, UndoStep } from './undo';
import { PushChannel, PushKind, realtimePush } from './push';
import i18n from '../../i18n';

export type EngineStatus = 'loading' | 'saved' | 'saving' | 'offline' | 'error';

/** How changes of others reach this client: push (WebSocket/SSE), long polling or plain polling. */
export type SyncChannel = 'ws' | 'sse' | 'longpoll' | 'interval';

export interface EngineState {
  ready: boolean;
  status: EngineStatus;
  errorMessage?: string;
  role: string; // owner | editor | viewer | '' (unknown yet)
  title: string;
  blocks: DocumentBlock[];
  pendingCount: number;
  shared: boolean;
  sessions: number;
  presence: Presence[];
  lockedByOthers: LeaseInfo[];
  conflicts: Result[]; // conflicts of own operations since start
  canUndo: boolean;
  canRedo: boolean;
  channel: SyncChannel;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface EngineOptions {
  transport?: Transport;
  storage?: SyncStorage;
  now?: () => number;
  /** Disables timers, window listeners, push and long polling (tests drive the engine with syncNow()). */
  manual?: boolean;
  /** Push notifications; defaults to the app's realtime connection (not used in manual mode). */
  push?: PushChannel;
}

const LEASE_GRACE_MS = 20_000; // keep a left block for this long
const IDLE_RELEASE_MS = 60_000; // release even the focused block after this long without input
const SYNC_DEBOUNCE_MS = 300;
const POLL_COLLAB_MS = 3_000; // shared note without push or long polling
const POLL_SOLO_MS = 30_000; // private note, opened once
const HEARTBEAT_MS = 7_000; // renews block leases while changes arrive by push/long polling
const SAFETY_POLL_MS = 30_000; // in case a push notification got lost
const LONG_POLL_WAIT_S = 25; // below typical proxy timeouts (nginx 60 s, Cloudflare 100 s)
const LONG_POLL_MAX_FAILURES = 3;
const BACKOFF_MAX_MS = 30_000;
const UNDO_LIMIT = 200;
const UNDO_GROUP_MS = 1_000; // keystrokes in the same block are one undo step until a pause this long

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Random block ID for new blocks (unique across clients). */
export function newBlockId(): string {
  return `blk_${randomHex(10)}`;
}

/**
 * Keeps only the last text change per block (and the last title change). The base version is the one of
 * the first change: all later keystrokes build on what the user saw when starting to type, so a change
 * from someone else in between is detected as a conflict instead of being overwritten.
 */
export function formBatch(pending: Op[]): Op[] {
  const lastText = new Map<string, number>();
  const firstTextBase = new Map<string, number | undefined>();
  let lastTitle = -1;
  let firstTitleBase: number | undefined;
  pending.forEach((op, i) => {
    if (op.kind === 'set_content') {
      lastText.set(op.blockId!, i);
      if (!firstTextBase.has(op.blockId!)) firstTextBase.set(op.blockId!, op.baseVersion);
    }
    if (op.kind === 'set_title') {
      if (lastTitle < 0) firstTitleBase = op.baseVersion;
      lastTitle = i;
    }
  });
  const batch: Op[] = [];
  pending.forEach((op, i) => {
    if (op.kind === 'set_content') {
      if (lastText.get(op.blockId!) !== i) return;
      batch.push({ ...op, baseVersion: firstTextBase.get(op.blockId!) ?? 0 });
      return;
    }
    if (op.kind === 'set_title') {
      if (i !== lastTitle) return;
      batch.push({ ...op, baseVersion: firstTitleBase ?? 0 });
      return;
    }
    batch.push(op);
  });
  return batch;
}

export class DocSyncEngine {
  readonly clientId = `c_${randomHex(8)}`;
  private transport: Transport;
  private storage: SyncStorage;
  private now: () => number;
  private manual: boolean;

  private confirmed: Doc = emptyDoc();
  private lastSeq = 0;
  private pending: Op[] = [];
  private inflight: Op[] | null = null;
  private local: Doc = emptyDoc();
  private opCounter = 0;

  private ready = false;
  private status: EngineStatus = 'loading';
  private errorMessage?: string;
  private role = '';
  private shared = false;
  private sessions = 0;
  private presence: Presence[] = [];
  private lockedByOthers: LeaseInfo[] = [];
  private conflicts: Result[] = [];
  private taskLinks = new Map<string, string>();
  private subtaskLinks = new Map<string, string>();

  private focused: string | null = null;
  private activity = new Map<string, number>(); // blockId -> last edit/focus time
  // Version of each block the editor last showed in agreement with the engine. The focused text field does
  // not take over remote changes while typing, so its edits are based on this version, not the newest one.
  private uiSeen = new Map<string, number>();
  // Focused block -> its conflict copy: the field still shows the user's losing text, so typing on there
  // goes into that copy instead of making a new copy per keystroke batch. Ends when the field shows the
  // engine's text again or the cursor leaves the block.
  private conflictRedirects = new Map<string, string>();
  private undoStack: UndoStep[] = [];
  private redoStack: UndoStep[] = [];

  private push: PushChannel | null;
  private pushKind: PushKind = 'none';
  private unsubscribePush: (() => void) | null = null;
  private pokeTimer: ReturnType<typeof setTimeout> | null = null;
  private longPollRunning = false;
  private longPollBroken = false;
  private longPollAbort: AbortController | null = null;

  private syncing = false;
  private syncAgain = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 0;
  private listeners = new Set<(s: EngineState) => void>();
  private cleanup: Array<() => void> = [];

  constructor(readonly docId: string, opts: EngineOptions = {}) {
    this.transport = opts.transport || httpTransport;
    this.storage = opts.storage || defaultStorage();
    this.now = opts.now || (() => Date.now());
    this.manual = !!opts.manual;
    this.push = opts.push || (this.manual ? null : realtimePush);
  }

  // --- Public API ---

  /** Loads the stored state (instant, works offline), then syncs with the server. */
  async start(): Promise<void> {
    try {
      const stored = await this.storage.load(this.docId);
      if (stored) {
        this.confirmed = docFromSnapshot(stored.title, stored.titleVersion, stored.blocks);
        this.lastSeq = stored.lastSeq;
        this.role = stored.role || '';
        this.pending = stored.pending || [];
        this.inflight = stored.inflight || null;
        this.ready = true;
        this.recompute();
      }
    } catch {
      // Storage unavailable: continue with the server state only
    }
    if (!this.manual) this.attachWindowListeners();
    if (this.push) {
      this.unsubscribePush = this.push.subscribe(
        this.docId,
        () => this.onPoke(),
        (kind) => this.onPushStatus(kind)
      );
    }
    if (!this.ready) {
      try {
        await this.loadSnapshot();
      } catch (err) {
        this.handleError(err);
        this.emit();
        this.schedule(this.nextBackoff());
        return;
      }
    }
    this.emit();
    await this.syncNow();
  }

  /** Flushes pending changes (keepalive) and leaves the note. */
  stop(): void {
    if (this.stopped) return;
    this.flushOnExit();
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pokeTimer) clearTimeout(this.pokeTimer);
    this.longPollAbort?.abort();
    this.unsubscribePush?.();
    this.unsubscribePush = null;
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.listeners.clear();
  }

  subscribe(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  getState(): EngineState {
    return {
      ready: this.ready,
      status: this.status,
      errorMessage: this.errorMessage,
      role: this.role,
      title: this.local.title,
      blocks: toDocumentBlocks(this.local, this.docId, this.taskLinks, this.subtaskLinks),
      pendingCount: this.pending.length + (this.inflight?.length || 0),
      shared: this.shared,
      sessions: this.sessions,
      presence: this.presence,
      lockedByOthers: this.lockedByOthers,
      conflicts: this.conflicts,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      channel: this.channel(),
    };
  }

  get canEdit(): boolean {
    return this.role === 'owner' || this.role === 'editor';
  }

  /** Task IDs of blocks linked to tasks (kept outside the synced tree). */
  setTaskLinks(links: Map<string, string>, subtaskLinks?: Map<string, string>): void {
    this.taskLinks = new Map(links);
    if (subtaskLinks) this.subtaskLinks = new Map(subtaskLinks);
    this.emit();
  }

  /** Records the editor's complete block list; differences become operations. */
  applyFlat(blocks: DocumentBlock[]): void {
    if (!this.ready || !this.canEdit) return;
    for (const b of blocks) {
      if (b.taskId) this.taskLinks.set(b.id, b.taskId);
    }
    for (const b of blocks) {
      const cur = this.local.blocks.get(b.id);
      if (cur && !cur.deleted && cur.content === (b.content || '')) {
        this.uiSeen.set(b.id, cur.version);
        this.conflictRedirects.delete(b.id);
      }
    }
    const ops = diffFlat(this.local, blocks, () => this.newOpId());
    if (ops.length === 0) return;
    const before = this.local;
    const t = this.now();
    for (const op of ops) {
      if (op.kind === 'set_content' && this.uiSeen.has(op.blockId!)) op.baseVersion = this.uiSeen.get(op.blockId!);
      if (op.kind === 'set_content') this.redirectToConflictCopy(op, this.local);
      if ((op.kind === 'insert' || op.kind === 'set_content') && op.blockId) this.activity.set(op.blockId, t);
    }
    this.enqueue(ops);
    this.record(before, ops);
    // The editor now shows exactly the local state for these blocks
    for (const op of ops) {
      if (op.kind === 'set_content' || op.kind === 'insert') {
        const cur = this.local.blocks.get(op.blockId!);
        if (cur) this.uiSeen.set(op.blockId!, cur.version);
      }
    }
  }

  setTitle(title: string): void {
    if (!this.ready || !this.canEdit || title === this.local.title) return;
    // The title field always shows the engine's title, so the current local version is what the user saw
    const before = this.local;
    const ops: Op[] = [{ opId: this.newOpId(), kind: 'set_title', title, baseVersion: this.local.titleVersion }];
    this.enqueue(ops);
    this.record(before, ops);
  }

  /** Name of the user holding the lease on a block, if it is someone else. */
  lockedBy(blockId: string): string | undefined {
    return this.lockedByOthers.find((l) => l.blockId === blockId)?.name;
  }

  /** Reverts the user's last own change (skipped if someone else changed the blocks since). */
  undo(): ActionResult {
    return this.replay(this.undoStack, this.redoStack, i18n.t('common:sync.undo'));
  }

  /** Re-applies the last undone change. */
  redo(): ActionResult {
    return this.replay(this.redoStack, this.undoStack, i18n.t('common:sync.redo'));
  }

  /** Accepts (replaces the original with the conflict copy) or discards a conflict copy. */
  resolveConflict(copyId: string, accept: boolean): ActionResult {
    if (!this.ready || !this.canEdit) return { ok: false };
    const copy = this.local.blocks.get(copyId);
    if (!copy || copy.deleted || !copy.props.conflictOf) return { ok: false };
    const target = copy.props.conflictOf;
    // The author of the conflicting text holds the copy for a moment; deleting it now would fail half-way
    const copyHolder = this.lockedBy(copyId);
    if (copyHolder) return { ok: false, message: `${copyHolder} bearbeitet diese Version gerade – bitte kurz warten` };
    const ops: Op[] = [];
    if (!accept) {
      ops.push({ opId: this.newOpId(), kind: 'delete', blockId: copyId });
    } else if (target === 'title') {
      ops.push({ opId: this.newOpId(), kind: 'set_title', title: copy.content, baseVersion: this.local.titleVersion });
      ops.push({ opId: this.newOpId(), kind: 'delete', blockId: copyId });
    } else {
      const original = this.local.blocks.get(target);
      if (original && !original.deleted) {
        const holder = this.lockedBy(target);
        if (holder) return { ok: false, message: i18n.t('common:sync.originalLocked', { name: holder }) };
        ops.push({ opId: this.newOpId(), kind: 'set_content', blockId: target, content: copy.content, baseVersion: original.version });
        ops.push({ opId: this.newOpId(), kind: 'delete', blockId: copyId });
      } else {
        // The original is gone: the copy simply becomes a normal block
        ops.push({ opId: this.newOpId(), kind: 'set_props', blockId: copyId, patch: { clearConflict: true } });
      }
    }
    const before = this.local;
    this.enqueue(ops);
    this.record(before, ops);
    return { ok: true };
  }

  /** Tells the engine which block the cursor is in (null = none); used for block leases. */
  focusBlock(blockId: string | null): void {
    const t = this.now();
    const changed = blockId !== this.focused;
    if (this.focused) this.activity.set(this.focused, t);
    if (changed && this.focused) this.conflictRedirects.delete(this.focused);
    this.focused = blockId;
    // Entering a block, its field shows the engine's text (unfocused fields take it over), so edits from
    // here on build on that version, not on one an earlier visit of the field saw
    const entered = changed && blockId ? this.local.blocks.get(blockId) : undefined;
    if (entered && !entered.deleted) this.uiSeen.set(entered.id, entered.version);
    if (blockId) this.activity.set(blockId, t);
    // Announce the lease right away: with push the next regular sync may be up to 30 s away
    if (changed && blockId && this.canEdit && this.collaborative()) {
      if (this.syncing) this.syncAgain = true;
      else this.schedule(SYNC_DEBOUNCE_MS);
    }
  }

  /** Runs one sync round trip now (or right after the running one). */
  async syncNow(): Promise<void> {
    if (this.stopped) return;
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.syncing = true;
    let failed = false;
    try {
      await this.roundTrip();
      this.backoff = 0;
    } catch (err) {
      this.handleError(err);
      failed = true;
    } finally {
      this.syncing = false;
      this.recompute();
      if (!failed) this.ensureLongPoll();
      // Decided only now: the response tells whether the note is shared and how changes arrive
      const delay = failed
        ? this.status === 'error'
          ? this.pollDelay()
          : this.nextBackoff()
        : this.syncAgain || this.pending.length > 0 || this.inflight
        ? 0
        : this.pollDelay();
      this.syncAgain = false;
      this.emit();
      this.schedule(delay);
    }
  }

  // --- Internals ---

  private newOpId(): string {
    this.opCounter++;
    return `${this.clientId}.${this.opCounter}`;
  }

  private enqueue(ops: Op[]): void {
    this.pending.push(...ops);
    this.recompute();
    if (this.status !== 'offline' && this.status !== 'error') this.status = 'saving';
    this.emit();
    // Store first, then send: typed text must survive a crash between the two
    void this.persist().finally(() => this.schedule(SYNC_DEBOUNCE_MS));
  }

  private record(before: Doc, ops: Op[]): void {
    const step = buildStep(before, ops, this.now());
    if (!step) return;
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    if (step.textKey && top && top.textKey === step.textKey && step.at - top.at < UNDO_GROUP_MS) {
      // Same block, still typing: keep the original text as undo target, update the expected result
      top.checks = step.checks;
      top.at = step.at;
    } else {
      this.undoStack.push(step);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.emit();
  }

  private replay(from: UndoStep[], to: UndoStep[], label: string): ActionResult {
    if (!this.ready || !this.canEdit) return { ok: false };
    const step = from.pop();
    if (!step) return { ok: false };
    if (failedChecks(this.local, step).length > 0) {
      this.emit();
      return { ok: false, message: i18n.t('common:sync.skippedChanged', { action: label }) };
    }
    const holder = touchedBlocks(step).map((id) => this.lockedBy(id)).find(Boolean);
    if (holder) {
      this.emit();
      return { ok: false, message: i18n.t('common:sync.skippedLocked', { action: label, name: holder }) };
    }
    const ops: Op[] = step.inverse.map((o) => {
      const op: Op = { ...o, opId: this.newOpId() } as Op;
      if (op.kind === 'set_content') op.baseVersion = this.local.blocks.get(op.blockId!)?.version ?? 0;
      if (op.kind === 'set_title') op.baseVersion = this.local.titleVersion;
      return op;
    });
    const before = this.local;
    this.enqueue(ops);
    const back = buildStep(before, ops, this.now());
    if (back) {
      back.textKey = undefined;
      to.push(back);
    }
    for (const op of ops) {
      const b = op.blockId ? this.local.blocks.get(op.blockId) : undefined;
      if (b) this.uiSeen.set(b.id, b.version);
    }
    this.emit();
    return { ok: true };
  }

  /** Sends a text change into the conflict copy of its block (see conflictRedirects). */
  private redirectToConflictCopy(op: Op, doc: Doc, copyId = this.conflictRedirects.get(op.blockId!)): void {
    if (!copyId) return;
    const copy = doc.blocks.get(copyId);
    if (!copy || copy.deleted || copy.props.conflictOf !== op.blockId) {
      // Resolved or discarded meanwhile: a new change is a new conflict
      this.conflictRedirects.delete(op.blockId!);
      return;
    }
    op.blockId = copyId;
    op.baseVersion = copy.version;
  }

  private recompute(): void {
    const v = cloneDoc(this.confirmed);
    // Pending ops count the way they will be sent: formBatch folds all text changes of a block into one,
    // so the server raises its version once. Applying every keystroke here would number local versions
    // ahead of the server, and the next edit of the focused block would conflict with the user's own text.
    for (const op of [...(this.inflight || []), ...formBatch(this.pending)]) {
      const local = { ...op };
      if (local.kind === 'set_content') local.baseVersion = v.blocks.get(local.blockId!)?.version ?? 0;
      if (local.kind === 'set_title') local.baseVersion = v.titleVersion;
      applyOp(v, local);
    }
    this.local = v;
  }

  private emit(): void {
    // Unfocused blocks take over whatever the engine shows; only the focused text field may lag behind
    this.local.blocks.forEach((b, id) => {
      if (id !== this.focused) this.uiSeen.set(id, b.version);
    });
    if (this.listeners.size === 0) return;
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }

  private async persist(): Promise<void> {
    try {
      await this.storage.save({
        docId: this.docId,
        title: this.confirmed.title,
        titleVersion: this.confirmed.titleVersion,
        lastSeq: this.lastSeq,
        role: this.role,
        blocks: Array.from(this.confirmed.blocks.values()),
        pending: this.pending,
        inflight: this.inflight,
        savedAt: this.now(),
      });
    } catch {
      // Storage full or unavailable: changes stay in memory and are still sent
    }
  }

  private async loadSnapshot(): Promise<void> {
    const snap = await this.transport.snapshot(this.docId);
    this.confirmed = docFromSnapshot(snap.title, snap.titleVersion, snap.blocks || []);
    this.lastSeq = snap.headSeq;
    this.role = snap.role;
    this.shared = snap.shared;
    this.ready = true;
    this.recompute();
    await this.persist();
  }

  private holds(): string[] {
    const t = this.now();
    const out: string[] = [];
    this.activity.forEach((at, id) => {
      const fresh = t - at < LEASE_GRACE_MS || (id === this.focused && t - at < IDLE_RELEASE_MS);
      if (fresh && this.local.blocks.has(id)) out.push(id);
      else if (!fresh) this.activity.delete(id);
    });
    return out.sort();
  }

  private collaborative(): boolean {
    return this.shared || this.sessions > 1;
  }

  private async roundTrip(): Promise<void> {
    if (!this.ready) await this.loadSnapshot();
    if (!this.inflight && this.pending.length > 0 && this.canEdit) {
      this.inflight = formBatch(this.pending);
      this.pending = [];
      await this.persist();
    }
    // flushOnExit may start a new batch while this request is on the wire; only this one is answered here
    let batch = this.canEdit ? this.inflight : null;
    if (batch && batch.length > 0) this.status = 'saving';

    for (;;) {
      const res = await this.transport.sync(this.docId, {
        clientId: this.clientId,
        lastSeq: this.lastSeq,
        ops: batch || [],
        leases: this.canEdit && this.collaborative() ? { hold: this.holds(), release: [] } : undefined,
      });
      const lostTo = new Map<string, string>(); // block -> conflict copy of its losing text
      if (batch) {
        const sent = new Map(batch.map((op) => [op.opId, op]));
        for (const r of res.results) {
          if (r.status === 'conflict') this.conflicts = [...this.conflicts, r];
          const conflicted = sent.get(r.opId);
          if (r.status === 'conflict' && r.conflictBlockId && conflicted?.kind === 'set_content') {
            lostTo.set(conflicted.blockId!, r.conflictBlockId);
            if (this.focused === conflicted.blockId) this.conflictRedirects.set(conflicted.blockId!, r.conflictBlockId);
          }
          // Someone else created a block with the same ID first (e.g. the first block of an empty note):
          // keep the typed text by sending it as a regular text change of that block
          const op = sent.get(r.opId);
          if (r.status === 'rejected' && r.reason === 'exists' && op?.kind === 'insert' && op.content) {
            // Base 0: the user never saw the other client's version of this block
            this.pending.unshift({ opId: this.newOpId(), kind: 'set_content', blockId: op.blockId, content: op.content, baseVersion: 0 });
          }
        }
        if (this.inflight === batch) this.inflight = null;
        batch = null;
      }
      this.role = res.role;
      this.shared = res.shared;
      this.sessions = res.sessions;
      // The server reports the links after every sync, so badges follow subtasks it adopted or added
      if (res.taskLinks) this.taskLinks = new Map(Object.entries(res.taskLinks));
      if (res.subtaskLinks) this.subtaskLinks = new Map(Object.entries(res.subtaskLinks));
      this.presence = res.presence || [];
      this.lockedByOthers = res.leases?.others || [];

      let gap = !!res.resync;
      for (const entry of res.ops) {
        if (entry.seq <= this.lastSeq) continue;
        if (entry.seq !== this.lastSeq + 1) {
          gap = true;
          break;
        }
        applyEffect(this.confirmed, entry.effect);
        this.lastSeq = entry.seq;
      }
      if (gap) await this.loadSnapshot();
      // Text typed into the same field while the losing batch was on the wire builds on the losing text
      // and belongs into the copy too
      for (const op of this.pending) {
        if (op.kind === 'set_content' && lostTo.has(op.blockId!)) this.redirectToConflictCopy(op, this.confirmed, lostTo.get(op.blockId!));
      }
      await this.persist();
      if (!res.hasMore || gap) break;
    }
    this.errorMessage = undefined;
    this.status = this.pending.length > 0 ? 'saving' : 'saved';
  }

  private handleError(err: unknown): void {
    if (err instanceof TransportError && (err.status === 403 || err.status === 404)) {
      // Access lost: keep the queue (nothing is thrown away), but stop sending
      this.status = 'error';
      this.errorMessage = err.message;
      if (err.status === 404) this.role = '';
      else if (this.role !== 'owner') this.role = 'viewer';
      return;
    }
    this.status = 'offline';
    this.errorMessage = err instanceof Error ? err.message : String(err);
  }

  private channel(): SyncChannel {
    // The app-wide long polling brings the notifications: same channel as the note's own long polling
    if (this.pushKind === 'poll') return 'longpoll';
    if (this.pushKind !== 'none') return this.pushKind;
    if (this.longPollRunning && !this.longPollBroken) return 'longpoll';
    return 'interval';
  }

  private pollDelay(): number {
    if (!this.collaborative()) return POLL_SOLO_MS;
    if (this.channel() === 'interval') return POLL_COLLAB_MS;
    return this.canEdit && this.holds().length > 0 ? HEARTBEAT_MS : SAFETY_POLL_MS;
  }

  private onPoke(): void {
    if (this.pokeTimer || this.stopped) return;
    // Several notifications in a row (e.g. typing of others) lead to one sync
    this.pokeTimer = setTimeout(() => {
      this.pokeTimer = null;
      void this.syncNow();
    }, 50);
  }

  private onPushStatus(kind: PushKind): void {
    const wasLive = this.pushKind !== 'none';
    this.pushKind = kind;
    if (kind !== 'none') {
      this.longPollAbort?.abort();
      if (!wasLive) void this.syncNow(); // catch up on what was missed while disconnected
    } else {
      this.ensureLongPoll();
      if (!this.syncing) this.schedule(this.pollDelay());
    }
    this.emit();
  }

  /** Starts long polling when there is no push channel (e.g. a proxy blocks WebSocket and SSE). */
  private ensureLongPoll(): void {
    if (this.manual || this.stopped || !this.ready || this.longPollRunning || this.longPollBroken) return;
    if (this.pushKind !== 'none' || !this.collaborative() || this.status === 'error') return;
    void this.longPollLoop();
  }

  private async longPollLoop(): Promise<void> {
    this.longPollRunning = true;
    this.emit();
    let failures = 0;
    try {
      while (!this.stopped && this.pushKind === 'none' && this.collaborative() && this.status !== 'error') {
        const ctrl = new AbortController();
        this.longPollAbort = ctrl;
        try {
          const res = await this.transport.changes(this.docId, this.lastSeq, LONG_POLL_WAIT_S, ctrl.signal);
          failures = 0;
          if (res.changed || res.headSeq !== this.lastSeq) await this.syncNow();
        } catch {
          if (ctrl.signal.aborted || this.stopped) break;
          failures++;
          if (failures >= LONG_POLL_MAX_FAILURES) {
            // Long polling does not get through either: plain polling every 3 s remains
            this.longPollBroken = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 1000 * failures));
        }
      }
    } finally {
      this.longPollRunning = false;
      this.longPollAbort = null;
      this.emit();
      if (!this.syncing && !this.stopped) this.schedule(this.pollDelay());
    }
  }

  private nextBackoff(): number {
    this.backoff = this.backoff ? Math.min(this.backoff * 2, BACKOFF_MAX_MS) : 1000;
    return this.backoff;
  }

  private schedule(delay: number): void {
    if (this.manual || this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  /** Sends what is pending with keepalive (survives page unload) and releases leases. */
  private flushOnExit(): void {
    if (this.canEdit && (this.inflight || this.pending.length > 0)) {
      // The batch becomes the one in flight: the next sync resends exactly these ops (same IDs, applied
      // once), and text typed afterwards starts a new batch on top instead of being folded into this one
      // with its older base version, which would conflict with the user's own text
      if (!this.inflight) {
        this.inflight = formBatch(this.pending);
        this.pending = [];
        this.recompute();
        void this.persist();
      }
      const ops = this.inflight;
      this.transport
        .sync(this.docId, { clientId: this.clientId, lastSeq: this.lastSeq, ops }, { keepalive: true })
        .catch(() => {
          // Not delivered: the queue is in IndexedDB and is resent on the next visit (same op IDs)
        });
    }
    this.transport.leave(this.docId, this.clientId).catch(() => {});
  }

  private attachWindowListeners(): void {
    const onOnline = () => {
      this.longPollBroken = false; // the network changed: long polling may work again
      void this.syncNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.flushOnExit();
      else void this.syncNow();
    };
    const onPageHide = () => this.flushOnExit();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    this.cleanup.push(
      () => window.removeEventListener('online', onOnline),
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('pagehide', onPageHide)
    );
  }
}
