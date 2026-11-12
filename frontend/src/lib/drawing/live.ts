// Live drawing sessions: several people draw in one drawing at once (server: internal/drawlive). As in
// Excalidraw, every element carries a version (ver) and, in a session, a random nonce; a change raises the
// version, and when changes meet, the higher version wins, a tie goes to the lower nonce. Deleted elements
// travel as tombstones ({id, ver, nonce, deleted: true}). Nonces and tombstones only live in the session:
// the block keeps the elements with their versions, as before.
import { Drawing, DrawElement, parseElement } from './model';

/** An element as it travels in a session */
export interface WireElement {
  id: string;
  ver: number;
  nonce?: number;
  deleted?: boolean;
  [field: string]: unknown;
}

export interface Meta {
  ver: number;
  nonce: number;
  deleted: boolean;
}

/** One change from someone else: the element now, or null when it was deleted */
export interface Applied {
  id: string;
  el: DrawElement | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const metaOf = (w: WireElement): Meta => ({ ver: num(w.ver), nonce: num(w.nonce), deleted: !!w.deleted });

/** Whether a replaces b: the higher version, on a tie the lower nonce (the server's rule too) */
export function wins(a: Meta, b: Meta): boolean {
  return a.ver > b.ver || (a.ver === b.ver && a.nonce < b.nonce);
}

export function newNonce(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** Puts changes of others into a drawing (also the editor's undo steps): replaced in place, new ones on
 *  top, deleted ones out */
export function patchDrawing(d: Drawing, applied: Applied[]): Drawing {
  if (applied.length === 0) return d;
  const next = new Map(applied.map((a) => [a.id, a.el]));
  const els: DrawElement[] = [];
  for (const el of d.els) {
    if (!next.has(el.id)) {
      els.push(el);
      continue;
    }
    const now = next.get(el.id);
    if (now) els.push(now);
    next.delete(el.id);
  }
  next.forEach((el) => el && els.push(el));
  return { ...d, els };
}

/** Ids named in order first, in that order (unknown ones skipped); the rest follow as they were */
export function orderIds(ids: string[], order: string[]): string[] {
  const have = new Set(ids);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of order) {
    if (have.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of ids) if (!seen.has(id)) out.push(id);
  return out;
}

export function applyOrder(d: Drawing, order: string[]): Drawing {
  const byId = new Map(d.els.map((el) => [el.id, el]));
  const ids = orderIds(
    d.els.map((el) => el.id),
    order
  );
  if (ids.every((id, i) => id === d.els[i].id)) return d;
  return { ...d, els: ids.map((id) => byId.get(id)!) };
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export interface Outgoing {
  els: WireElement[];
  order?: string[];
  grid?: boolean;
}

export interface Incoming {
  doc: Drawing;
  applied: Applied[];
}

/**
 * What one browser knows of a session: for each element the version the session has (as far as it knows)
 * and the element object that version belongs to. A different object in the drawing is a change of this
 * browser (drawn, edited, undone); collect() gives it a new version and sends it. Elements in a gesture
 * (being dragged or written in) keep their local state: changes of others to them wait until it ends.
 */
export class LiveMerge {
  private known = new Map<string, Meta>();
  private synced = new Map<string, DrawElement>();
  private pending = new Map<string, WireElement>();
  private resendTombs = new Set<string>();
  private lastOrder: string[];
  private lastGrid: boolean;

  /** start: the drawing as the block holds it (its versions count as known, nonce 0) */
  constructor(start: Drawing) {
    for (const el of start.els) {
      this.known.set(el.id, { ver: el.ver, nonce: 0, deleted: false });
      this.synced.set(el.id, el);
    }
    this.lastOrder = start.els.map((el) => el.id);
    this.lastGrid = !!start.grid;
  }

  /** Changes of this browser since the last call, with new versions */
  collect(doc: Drawing): Outgoing {
    const els: WireElement[] = [];
    const present = new Set<string>();
    for (const el of doc.els) {
      present.add(el.id);
      if (this.synced.get(el.id) === el) continue;
      const ver = Math.max(el.ver, this.baseVer(el.id) + 1);
      const m: Meta = { ver, nonce: newNonce(), deleted: false };
      this.known.set(el.id, m);
      this.synced.set(el.id, el);
      this.resendTombs.delete(el.id);
      els.push({ ...el, ver, nonce: m.nonce });
    }
    this.known.forEach((k, id) => {
      if (k.deleted) {
        if (this.resendTombs.delete(id)) els.push({ id, ver: k.ver, nonce: k.nonce, deleted: true });
        return;
      }
      if (present.has(id)) return;
      // Gone from the drawing here: deleted (or undone)
      const m: Meta = { ver: this.baseVer(id) + 1, nonce: newNonce(), deleted: true };
      this.known.set(id, m);
      this.synced.delete(id);
      els.push({ id, ver: m.ver, nonce: m.nonce, deleted: true });
    });
    const out: Outgoing = { els };
    const cur = doc.els.map((el) => el.id);
    const before = new Set(this.lastOrder);
    const expected = [...this.lastOrder.filter((id) => present.has(id)), ...cur.filter((id) => !before.has(id))];
    if (!sameIds(cur, expected)) out.order = cur;
    this.lastOrder = cur;
    if (!!doc.grid !== this.lastGrid) {
      this.lastGrid = !!doc.grid;
      out.grid = this.lastGrid;
    }
    return out;
  }

  private baseVer(id: string): number {
    const p = this.pending.get(id);
    return Math.max(this.known.get(id)?.ver ?? 0, p ? num(p.ver) : 0);
  }

  /** The whole state of this browser (joining, also again after a lost connection or a server restart) */
  all(doc: Drawing): WireElement[] {
    this.collect(doc);
    const out: WireElement[] = [];
    for (const el of doc.els) {
      const k = this.known.get(el.id)!;
      out.push({ ...el, ver: k.ver, nonce: k.nonce });
    }
    this.known.forEach((k, id) => {
      if (k.deleted) out.push({ id, ver: k.ver, nonce: k.nonce, deleted: true });
    });
    return out;
  }

  /** Changes of others; those to elements in held (a gesture of this browser) wait for release() */
  receive(doc: Drawing, wires: WireElement[], held: Set<string> = new Set()): Incoming {
    const applied: Applied[] = [];
    for (const w of wires) {
      if (!w || typeof w.id !== 'string') continue;
      const m = metaOf(w);
      if (held.has(w.id)) {
        const p = this.pending.get(w.id);
        if (!p || wins(m, metaOf(p))) this.pending.set(w.id, w);
        continue;
      }
      const k = this.known.get(w.id);
      if (k && !wins(m, k)) continue;
      if (m.deleted) {
        this.known.set(w.id, m);
        this.synced.delete(w.id);
        applied.push({ id: w.id, el: null });
        continue;
      }
      const el = parseElement(w);
      if (!el) continue;
      el.ver = m.ver;
      this.known.set(w.id, m);
      this.synced.set(w.id, el);
      applied.push({ id: w.id, el });
    }
    // The order the session knows: deleted ones out, new ones on top (as the server does)
    const gone = new Set(applied.filter((a) => !a.el).map((a) => a.id));
    const had = new Set(this.lastOrder);
    this.lastOrder = [...this.lastOrder.filter((id) => !gone.has(id)), ...applied.filter((a) => a.el && !had.has(a.id)).map((a) => a.id)];
    return { doc: patchDrawing(doc, applied), applied };
  }

  /** A new order of the elements from someone else */
  receiveOrder(doc: Drawing, order: string[]): Drawing {
    this.lastOrder = orderIds(this.lastOrder, order);
    return applyOrder(doc, order);
  }

  receiveGrid(doc: Drawing, grid: boolean): Drawing {
    this.lastGrid = grid;
    if (!!doc.grid === grid) return doc;
    const next: Drawing = { ...doc };
    if (grid) next.grid = true;
    else delete next.grid;
    return next;
  }

  /** A gesture ended: its own result goes out first (so it wins), then what others sent meanwhile */
  release(doc: Drawing): { out: Outgoing; incoming: Incoming } {
    const out = this.collect(doc);
    const waiting = [...this.pending.values()];
    this.pending.clear();
    return { out, incoming: this.receive(doc, waiting) };
  }

  /**
   * The full state of the session (joining, or again after a gap): taken in like changes of others; what
   * this browser has newer than the session (changed while the connection was gone) goes out again.
   */
  reconcile(doc: Drawing, state: { els: WireElement[]; order?: string[]; grid?: boolean }, held: Set<string> = new Set()): Incoming {
    const incoming = this.receive(doc, state.els, held);
    let next = incoming.doc;
    if (state.order) next = this.receiveOrder(next, state.order);
    if (typeof state.grid === 'boolean') next = this.receiveGrid(next, state.grid);
    const there = new Map(state.els.filter((w) => w && typeof w.id === 'string').map((w) => [w.id, metaOf(w)]));
    this.known.forEach((k, id) => {
      const s = there.get(id);
      if (s && !wins(k, s)) return;
      if (k.deleted) {
        this.resendTombs.add(id);
      } else {
        this.synced.delete(id);
      }
    });
    return { doc: next, applied: incoming.applied };
  }

  /** Waiting changes of others to an element (tests) */
  waiting(id: string): WireElement | undefined {
    return this.pending.get(id);
  }
}

/** The saved form of a session's final state: elements in their order, without nonces and tombstones */
export function finalDrawing(base: Drawing, els: WireElement[], order?: string[]): Drawing {
  const live = els.filter((w) => w && !w.deleted).map((w) => parseElement(w)).filter(Boolean) as DrawElement[];
  const d: Drawing = { ...base, els: live };
  return order ? applyOrder(d, order) : d;
}
