import { describe, it, expect } from 'vitest';
import type { DocumentBlock } from '../../types';
import { diffFlat, toDocumentBlocks } from '../diff';
import { applyEffect, applyOp, cloneDoc, docsEqual, emptyDoc, Doc } from '../model';

let opSeq = 0;
const nextOp = () => `op${++opSeq}`;

function build(blocks: DocumentBlock[]): Doc {
  const d = emptyDoc();
  for (const op of diffFlat(d, blocks, nextOp)) applyOp(d, op);
  return d;
}

const B = (id: string, level: number, content = id, extra: Partial<DocumentBlock> = {}): DocumentBlock => ({
  id,
  level,
  content,
  type: 'bullet',
  ...extra,
});

const shape = (blocks: DocumentBlock[]) => blocks.map((b) => [b.id, b.level || 0, b.content, !!b.checked, b.type]);

describe('diffFlat', () => {
  it('builds the tree from levels and produces no ops for an unchanged list', () => {
    const list = [B('a', 0), B('b', 1), B('c', 2), B('d', 1), B('e', 0)];
    const d = build(list);
    expect(shape(toDocumentBlocks(d, 'doc'))).toEqual(shape(list));
    expect(diffFlat(d, toDocumentBlocks(d, 'doc'), nextOp)).toEqual([]);
  });

  it('turns typing into a single set_content without moves', () => {
    const d = build([B('a', 0), B('b', 0), B('c', 0)]);
    const ops = diffFlat(d, [B('a', 0), B('b', 0, 'b geändert'), B('c', 0)], nextOp);
    expect(ops.map((o) => o.kind)).toEqual(['set_content']);
  });

  it('sends the type before the text when a drawing turns into a bullet, and after it the other way round', () => {
    const d = build([B('a', 0, '')]);
    const toDrawing = diffFlat(d, [B('a', 0, '{"v":1,"els":[]}', { type: 'drawing' })], nextOp);
    expect(toDrawing.map((o) => o.kind)).toEqual(['set_content', 'set_props']);
    for (const op of toDrawing) applyOp(d, op);
    const toBullet = diffFlat(d, [B('a', 0, '[[Neue Notiz]]')], nextOp);
    expect(toBullet.map((o) => o.kind)).toEqual(['set_props', 'set_content']);
  });

  it('inserting in the middle does not move the neighbours', () => {
    const d = build([B('a', 0), B('c', 0)]);
    const ops = diffFlat(d, [B('a', 0), B('b', 0), B('c', 0)], nextOp);
    expect(ops.map((o) => o.kind)).toEqual(['insert']);
  });

  it('reaches any target list (random edits)', () => {
    let seed = 99;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    let current: DocumentBlock[] = [B('x0', 0)];
    const d = build(current);
    for (let step = 0; step < 300; step++) {
      const next = current.map((b) => ({ ...b }));
      const i = rnd(next.length);
      switch (rnd(6)) {
        case 0:
          next.splice(i + 1, 0, B(`x${step + 1}`, next[i] ? next[i].level || 0 : 0));
          break;
        case 1:
          if (next.length > 1) next.splice(i, 1);
          break;
        case 2:
          next[i].content += '!';
          break;
        case 3:
          next[i].level = (next[i].level || 0) + 1;
          break;
        case 4:
          next[i].level = Math.max(0, (next[i].level || 0) - 1);
          break;
        case 5: {
          const [moved] = next.splice(i, 1);
          next.splice(rnd(next.length + 1), 0, moved);
          break;
        }
      }
      // Normalise like the editor would (levels can only grow by one)
      let prev = -1;
      for (const b of next) {
        b.level = Math.min(b.level || 0, prev + 1);
        prev = b.level;
      }
      const before = cloneDoc(d);
      const replay = cloneDoc(d);
      for (const op of diffFlat(d, next, nextOp)) {
        const { effects } = applyOp(d, op);
        effects.forEach((e) => applyEffect(replay, e));
      }
      expect(shape(toDocumentBlocks(d, 'doc'))).toEqual(shape(next));
      expect(docsEqual(d, replay)).toBe(true);
      expect(before).not.toBe(d);
      current = next;
    }
  });
});
