// Undo/redo of the user's own changes. For every action the engine records the inverse operations plus a
// check of the state the action left behind. Undo only runs if that state is still there, i.e. nobody
// else changed the affected blocks in between; otherwise the step is skipped instead of overwriting.
import { applyOp, cloneDoc, Doc, normProps, Op, propsEqual } from './model';

export type UndoCheck =
  | { kind: 'content'; blockId: string; content: string }
  | { kind: 'alive'; blockId: string; content: string }
  | { kind: 'deleted'; ids: string[] }
  | { kind: 'place'; blockId: string; parentId: string; orderKey: string; restoreParent: string }
  | { kind: 'props'; blockId: string; type: string; checked: boolean; collapsed: boolean; lang: string }
  | { kind: 'title'; title: string };

export interface UndoStep {
  inverse: Omit<Op, 'opId'>[]; // already in the order to apply
  checks: UndoCheck[];
  at: number;
  textKey?: string; // set for pure typing steps (block ID or '#title'), used to group keystrokes
}

/** Applies ops to a copy of `before` and records how to revert them. */
export function buildStep(before: Doc, ops: Op[], at: number): UndoStep | null {
  const v = cloneDoc(before);
  const inverse: Omit<Op, 'opId'>[] = [];
  const checks: UndoCheck[] = [];

  for (const raw of ops) {
    const op = { ...raw };
    const pre = op.blockId ? v.blocks.get(op.blockId) : undefined;
    const preCopy = pre ? { ...pre, props: { ...pre.props } } : undefined;
    const preTitle = v.title;
    if (op.kind === 'set_content') op.baseVersion = pre?.version ?? 0;
    if (op.kind === 'set_title') op.baseVersion = v.titleVersion;
    const { effects } = applyOp(v, op);
    if (effects.length === 0) continue;
    const post = op.blockId ? v.blocks.get(op.blockId) : undefined;

    switch (op.kind) {
      case 'insert':
        if (post && !post.deleted) {
          inverse.push({ kind: 'delete', blockId: post.id });
          checks.push({ kind: 'alive', blockId: post.id, content: post.content });
        }
        break;
      case 'set_content':
        if (preCopy && post) {
          inverse.push({ kind: 'set_content', blockId: post.id, content: preCopy.content });
          checks.push({ kind: 'content', blockId: post.id, content: post.content });
        }
        break;
      case 'set_props':
        if (preCopy && post) {
          const p = normProps(preCopy.props);
          inverse.push({
            kind: 'set_props',
            blockId: post.id,
            patch: { type: preCopy.type, checked: !!p.checked, collapsed: !!p.collapsed, lang: p.lang || '' },
          });
          const q = normProps(post.props);
          checks.push({ kind: 'props', blockId: post.id, type: post.type, checked: !!q.checked, collapsed: !!q.collapsed, lang: q.lang || '' });
        }
        break;
      case 'move':
        if (preCopy && post) {
          inverse.push({ kind: 'move', blockId: post.id, parentId: preCopy.parentId, orderKey: preCopy.orderKey });
          checks.push({ kind: 'place', blockId: post.id, parentId: post.parentId, orderKey: post.orderKey, restoreParent: preCopy.parentId });
        }
        break;
      case 'delete': {
        const ids = effects.flatMap((e) => (e.kind === 'delete' ? e.ids || [] : []));
        if (ids.length > 0) {
          inverse.push({ kind: 'restore', ids });
          checks.push({ kind: 'deleted', ids });
        }
        break;
      }
      case 'restore': {
        const ids = effects.flatMap((e) => (e.kind === 'restore' ? e.ids || [] : []));
        for (const id of ids) inverse.push({ kind: 'delete', blockId: id });
        for (const id of ids) checks.push({ kind: 'alive', blockId: id, content: v.blocks.get(id)?.content || '' });
        break;
      }
      case 'set_title':
        inverse.push({ kind: 'set_title', title: preTitle });
        checks.push({ kind: 'title', title: v.title });
        break;
    }
  }
  if (inverse.length === 0) return null;
  inverse.reverse();
  const onlyText = ops.every((o) => o.kind === 'set_content') && new Set(ops.map((o) => o.blockId)).size === 1;
  const onlyTitle = ops.every((o) => o.kind === 'set_title');
  return { inverse, checks, at, textKey: onlyText ? ops[0].blockId : onlyTitle ? '#title' : undefined };
}

/** Returns the IDs of blocks the step touches whose state no longer matches, or [] if undo is safe. */
export function failedChecks(d: Doc, step: UndoStep): string[] {
  const failed: string[] = [];
  for (const c of step.checks) {
    switch (c.kind) {
      case 'content': {
        const b = d.blocks.get(c.blockId);
        if (!b || b.deleted || b.content !== c.content) failed.push(c.blockId);
        break;
      }
      case 'alive': {
        const b = d.blocks.get(c.blockId);
        if (!b || b.deleted || b.content !== c.content) failed.push(c.blockId);
        break;
      }
      case 'deleted':
        for (const id of c.ids) if (!d.blocks.get(id)?.deleted) failed.push(id);
        break;
      case 'place': {
        const b = d.blocks.get(c.blockId);
        const parent = c.restoreParent ? d.blocks.get(c.restoreParent) : null;
        if (!b || b.deleted || b.parentId !== c.parentId || b.orderKey !== c.orderKey || (c.restoreParent && (!parent || parent.deleted))) {
          failed.push(c.blockId);
        }
        break;
      }
      case 'props': {
        const b = d.blocks.get(c.blockId);
        if (
          !b ||
          b.deleted ||
          b.type !== c.type ||
          !propsEqual(normProps({ checked: b.props.checked, collapsed: b.props.collapsed, lang: b.props.lang }), normProps({ checked: c.checked, collapsed: c.collapsed, lang: c.lang }))
        ) {
          failed.push(c.blockId);
        }
        break;
      }
      case 'title':
        if (d.title !== c.title) failed.push('#title');
        break;
    }
  }
  return failed;
}

/** Block IDs an inverse step would modify (for lease checks). */
export function touchedBlocks(step: UndoStep): string[] {
  const ids = new Set<string>();
  for (const op of step.inverse) {
    if (op.blockId) ids.add(op.blockId);
    for (const id of op.ids || []) ids.add(id);
  }
  return [...ids];
}
