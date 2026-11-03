// Block tree, operations and effects of collaborative note editing. Port of internal/collab (doc.go, ops.go).
// applyEffect must behave exactly like the server's Doc.ApplyEffect, because clients replay the server log.
import { keyBetween, validOrderKey } from './orderKey';

export interface Props {
  checked?: boolean;
  collapsed?: boolean;
  lang?: string;
  conflictOf?: string;
  conflictAuthor?: string;
}

export interface Block {
  id: string;
  parentId: string; // '' = top level
  orderKey: string;
  type: string;
  content: string;
  props: Props;
  version: number;
  deleted?: boolean;
  updatedBy?: string;
}

export interface Doc {
  title: string;
  titleVersion: number;
  blocks: Map<string, Block>;
}

export interface PropsPatch {
  type?: string;
  checked?: boolean;
  collapsed?: boolean;
  lang?: string;
  clearConflict?: boolean;
}

// 'purge' only appears as a log effect: log compaction removed old tombstones for good
export type OpKind = 'insert' | 'set_content' | 'set_props' | 'move' | 'delete' | 'restore' | 'set_title' | 'purge';

export interface Op {
  opId: string;
  kind: OpKind;
  blockId?: string;
  baseVersion?: number;
  parentId?: string;
  orderKey?: string;
  type?: string;
  content?: string;
  props?: Props;
  patch?: PropsPatch;
  ids?: string[];
  title?: string;
}

export interface Effect {
  kind: OpKind;
  blockId?: string;
  parentId?: string;
  orderKey?: string;
  type?: string;
  content?: string;
  props?: Props;
  version?: number;
  ids?: string[];
  title?: string;
  titleVersion?: number;
  by?: string;
}

export interface Result {
  opId: string;
  status: 'applied' | 'conflict' | 'rejected';
  reason?: string;
  version?: number;
  conflictBlockId?: string;
  seq?: number;
}

export interface FlatBlock extends Block {
  level: number;
}

export function emptyDoc(): Doc {
  return { title: '', titleVersion: 0, blocks: new Map() };
}

export function cloneDoc(d: Doc): Doc {
  const blocks = new Map<string, Block>();
  d.blocks.forEach((b, id) => blocks.set(id, { ...b, props: { ...b.props } }));
  return { title: d.title, titleVersion: d.titleVersion, blocks };
}

/** Normalizes props so that missing and false/empty values compare equal (the server omits them in JSON). */
export function normProps(p?: Props): Props {
  const out: Props = {};
  if (p?.checked) out.checked = true;
  if (p?.collapsed) out.collapsed = true;
  if (p?.lang) out.lang = p.lang;
  if (p?.conflictOf) out.conflictOf = p.conflictOf;
  if (p?.conflictAuthor) out.conflictAuthor = p.conflictAuthor;
  return out;
}

export function propsEqual(a?: Props, b?: Props): boolean {
  const x = normProps(a);
  const y = normProps(b);
  return (
    x.checked === y.checked &&
    x.collapsed === y.collapsed &&
    x.lang === y.lang &&
    x.conflictOf === y.conflictOf &&
    x.conflictAuthor === y.conflictAuthor
  );
}

function siblingLess(a: Block, b: Block): number {
  if (a.orderKey !== b.orderKey) return a.orderKey < b.orderKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Live children of parentId in display order. */
export function children(d: Doc, parentId: string): Block[] {
  const out: Block[] = [];
  d.blocks.forEach((b) => {
    if (!b.deleted && b.parentId === parentId) out.push(b);
  });
  return out.sort(siblingLess);
}

/** All live blocks in display order with their nesting level. */
export function flatten(d: Doc): FlatBlock[] {
  const byParent = new Map<string, Block[]>();
  d.blocks.forEach((b) => {
    if (b.deleted) return;
    const list = byParent.get(b.parentId);
    if (list) list.push(b);
    else byParent.set(b.parentId, [b]);
  });
  byParent.forEach((list) => list.sort(siblingLess));
  const out: FlatBlock[] = [];
  const walk = (parent: string, level: number) => {
    for (const b of byParent.get(parent) || []) {
      out.push({ ...b, level });
      walk(b.id, level + 1);
    }
  };
  walk('', 0);
  return out;
}

function subtree(d: Doc, id: string): string[] {
  const kids = new Map<string, string[]>();
  d.blocks.forEach((b) => {
    if (b.deleted) return;
    const list = kids.get(b.parentId);
    if (list) list.push(b.id);
    else kids.set(b.parentId, [b.id]);
  });
  const out = [id];
  for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) || []));
  return [out[0], ...out.slice(1).sort()];
}

function liveAncestor(d: Doc, id: string): string {
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const b = d.blocks.get(id);
    if (!b) return '';
    if (!b.deleted) return id;
    id = b.parentId;
  }
  return '';
}

function isAncestor(d: Doc, ancestorId: string, id: string): boolean {
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    if (id === ancestorId) return true;
    seen.add(id);
    const b = d.blocks.get(id);
    if (!b) return false;
    id = b.parentId;
  }
  return false;
}

/** Mutates the document with one effect, exactly like the server. */
export function applyEffect(d: Doc, e: Effect): void {
  switch (e.kind) {
    case 'insert':
      d.blocks.set(e.blockId!, {
        id: e.blockId!,
        parentId: e.parentId || '',
        orderKey: e.orderKey || '',
        type: e.type || '',
        content: e.content || '',
        props: normProps(e.props),
        version: e.version || 0,
        deleted: false,
        updatedBy: e.by || '',
      });
      break;
    case 'set_content': {
      const b = d.blocks.get(e.blockId!);
      if (b) {
        b.content = e.content || '';
        b.version = e.version || 0;
        b.updatedBy = e.by || '';
      }
      break;
    }
    case 'set_props': {
      const b = d.blocks.get(e.blockId!);
      if (b) {
        b.type = e.type || '';
        if (e.props) b.props = normProps(e.props);
      }
      break;
    }
    case 'move': {
      const b = d.blocks.get(e.blockId!);
      if (b) {
        b.parentId = e.parentId || '';
        b.orderKey = e.orderKey || '';
      }
      break;
    }
    case 'delete':
      for (const id of e.ids || []) {
        const b = d.blocks.get(id);
        if (b) b.deleted = true;
      }
      break;
    case 'restore':
      for (const id of e.ids || []) {
        const b = d.blocks.get(id);
        if (b) b.deleted = false;
      }
      break;
    case 'set_title':
      d.title = e.title || '';
      d.titleVersion = e.titleVersion || 0;
      break;
    case 'purge':
      for (const id of e.ids || []) d.blocks.delete(id);
      break;
  }
}

/**
 * Applies an operation the way the server does (without leases). The client uses it to show its own
 * unconfirmed operations on top of the confirmed state; tests use it as a stand-in server.
 * conflictId derives the ID of a conflict copy (the server uses a hash of the op ID).
 */
export function applyOp(d: Doc, op: Op, by = '', conflictId: (opId: string) => string = (id) => `blk_cf_${id}`): { effects: Effect[]; result: Result } {
  const effects: Effect[] = [];
  const emit = (e: Effect) => {
    e.by = by;
    applyEffect(d, e);
    effects.push(e);
  };
  const done = (r: Omit<Result, 'opId'>) => ({ effects, result: { opId: op.opId, ...r } as Result });
  const reject = (reason: string) => done({ status: 'rejected', reason });

  const restore = (ids: string[]) => {
    const set = new Set(ids);
    const sorted = [...ids].sort();
    emit({ kind: 'restore', ids: sorted });
    for (const id of sorted) {
      const b = d.blocks.get(id)!;
      if (b.parentId === '' || set.has(b.parentId)) continue;
      const p = d.blocks.get(b.parentId);
      if (p && !p.deleted) continue;
      emit({ kind: 'move', blockId: b.id, parentId: liveAncestor(d, b.parentId), orderKey: b.orderKey });
    }
  };
  const keyAfter = (b: Block): string => {
    const sibs = children(d, b.parentId);
    let next = '';
    for (const s of sibs) {
      if (s.orderKey > b.orderKey) {
        next = s.orderKey;
        break;
      }
    }
    try {
      return keyBetween(b.orderKey, next);
    } catch {
      return keyBetween(b.orderKey, '');
    }
  };

  switch (op.kind) {
    case 'insert': {
      if (!op.blockId || op.blockId.length > 64) return reject('invalid_id');
      if (d.blocks.has(op.blockId)) return reject('exists');
      let parent = op.parentId || '';
      if (parent) {
        // A purged parent (compaction) puts the block at the top level, like the server
        parent = d.blocks.has(parent) ? liveAncestor(d, parent) : '';
      }
      if (!op.orderKey || !validOrderKey(op.orderKey)) return reject('invalid_order_key');
      emit({
        kind: 'insert',
        blockId: op.blockId,
        parentId: parent,
        orderKey: op.orderKey,
        type: op.type || 'bullet',
        content: op.content || '',
        props: normProps(op.props),
        version: 1,
      });
      return done({ status: 'applied', version: 1 });
    }
    case 'set_content': {
      const b = d.blocks.get(op.blockId || '');
      if (op.content === undefined) return reject('no_content');
      if (!b) {
        // The block was purged (offline for weeks): like the server, the text becomes a new block at the end
        if (!op.content || !op.blockId || op.blockId.length > 64) return reject('missing');
        const roots = children(d, '');
        const key = keyBetween(roots.length ? roots[roots.length - 1].orderKey : '', '');
        emit({ kind: 'insert', blockId: op.blockId, parentId: '', orderKey: key, type: 'bullet', content: op.content, props: {}, version: 1 });
        return done({ status: 'applied', version: 1, reason: 'revived' });
      }
      if (b.deleted) restore([b.id]);
      if (op.content === b.content) return done({ status: 'applied', version: b.version });
      if ((op.baseVersion ?? 0) !== b.version) {
        const id = conflictId(op.opId);
        if (!d.blocks.has(id)) {
          emit({
            kind: 'insert',
            blockId: id,
            parentId: b.parentId,
            orderKey: keyAfter(b),
            type: b.type,
            content: op.content,
            props: { conflictOf: b.id },
            version: 1,
          });
        }
        return done({ status: 'conflict', version: b.version, conflictBlockId: id });
      }
      emit({ kind: 'set_content', blockId: b.id, content: op.content, version: b.version + 1 });
      return done({ status: 'applied', version: b.version });
    }
    case 'set_props': {
      const b = d.blocks.get(op.blockId || '');
      if (!b || b.deleted) return reject('missing');
      if (!op.patch) return reject('no_patch');
      const type = op.patch.type ? op.patch.type : b.type;
      const props = normProps({
        ...b.props,
        ...(op.patch.checked !== undefined ? { checked: op.patch.checked } : {}),
        ...(op.patch.collapsed !== undefined ? { collapsed: op.patch.collapsed } : {}),
        ...(op.patch.lang !== undefined ? { lang: op.patch.lang } : {}),
        ...(op.patch.clearConflict ? { conflictOf: undefined, conflictAuthor: undefined } : {}),
      });
      if (type !== b.type || !propsEqual(props, b.props)) emit({ kind: 'set_props', blockId: b.id, type, props });
      return done({ status: 'applied' });
    }
    case 'move': {
      const b = d.blocks.get(op.blockId || '');
      if (!b || b.deleted) return reject('missing');
      const parent = op.parentId || '';
      if (parent) {
        const p = d.blocks.get(parent);
        if (!p || p.deleted) return reject('parent_missing');
        if (isAncestor(d, b.id, parent)) return reject('cycle');
      }
      if (!op.orderKey || !validOrderKey(op.orderKey)) return reject('invalid_order_key');
      if (parent !== b.parentId || op.orderKey !== b.orderKey) emit({ kind: 'move', blockId: b.id, parentId: parent, orderKey: op.orderKey });
      return done({ status: 'applied' });
    }
    case 'delete': {
      const b = d.blocks.get(op.blockId || '');
      if (!b) return reject('missing');
      if (!b.deleted) emit({ kind: 'delete', ids: subtree(d, b.id) });
      return done({ status: 'applied' });
    }
    case 'restore': {
      const ids = (op.ids || []).filter((id) => d.blocks.get(id)?.deleted);
      if (ids.length > 0) restore(ids);
      return done({ status: 'applied' });
    }
    case 'set_title': {
      if (op.title === undefined) return reject('no_title');
      if (op.title === d.title) return done({ status: 'applied', version: d.titleVersion });
      if ((op.baseVersion ?? 0) !== d.titleVersion) return done({ status: 'conflict', version: d.titleVersion });
      emit({ kind: 'set_title', title: op.title, titleVersion: d.titleVersion + 1 });
      return done({ status: 'applied', version: d.titleVersion });
    }
  }
  return reject('unknown_kind');
}

/** Builds a Doc from snapshot blocks (as delivered by GET /docs/{id}/snapshot). */
export function docFromSnapshot(title: string, titleVersion: number, blocks: Block[]): Doc {
  const d: Doc = { title, titleVersion, blocks: new Map() };
  for (const b of blocks) {
    d.blocks.set(b.id, {
      id: b.id,
      parentId: b.parentId || '',
      orderKey: b.orderKey,
      type: b.type || '',
      content: b.content || '',
      props: normProps(b.props),
      version: b.version || 0,
      deleted: !!b.deleted,
      updatedBy: b.updatedBy || '',
    });
  }
  return d;
}

export function docsEqual(a: Doc, b: Doc): boolean {
  if (a.title !== b.title || a.titleVersion !== b.titleVersion || a.blocks.size !== b.blocks.size) return false;
  for (const [id, x] of a.blocks) {
    const y = b.blocks.get(id);
    if (
      !y ||
      x.parentId !== y.parentId ||
      x.orderKey !== y.orderKey ||
      x.type !== y.type ||
      x.content !== y.content ||
      x.version !== y.version ||
      !!x.deleted !== !!y.deleted ||
      !propsEqual(x.props, y.props)
    ) {
      return false;
    }
  }
  return true;
}
