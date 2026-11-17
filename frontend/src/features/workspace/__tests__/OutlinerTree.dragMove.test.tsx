import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, createEvent, act } from '@testing-library/react';
import { OutlinerTree } from '../OutlinerTree';
import type { BlockLock } from '../OutlinerBlock';
import { DocumentBlock } from '../../../lib/types';
import type { BranchDrop } from '../../../lib/outlineList';

// Dragging a bullet by its handle (OutlinerTree): it lands on the level of the row it is dropped in front
// of, and with Shift held it goes without its children. The tree operation itself is tested in
// lib/__tests__/outlineList.test.ts.

const ghost = vi.hoisted(() => ({ single: [] as boolean[], started: [] as boolean[] }));
vi.mock('../branchDragImage', () => ({
  startBranchDragGhost: (_e: unknown, _branch: unknown, single: boolean) => {
    ghost.started.push(single);
    return { setSingle: (s: boolean) => ghost.single.push(s) };
  },
}));

const mk = (id: string, content: string, level = 0): DocumentBlock => ({ id, type: 'bullet', content, level, position: 1 });

// Arbeit
//   Bericht
//   Folien
// Einkaufen
//   Brot
// Urlaub
const blocks = [
  mk('a', 'Arbeit'), mk('b', 'Bericht', 1), mk('f', 'Folien', 1), mk('e', 'Einkaufen'), mk('br', 'Brot', 1), mk('u', 'Urlaub'),
];

let moves: Array<[string, BranchDrop, number, boolean | undefined]> = [];
let refused: string[] = [];
const renderTree = (locked?: Map<string, BlockLock>) =>
  render(
    <OutlinerTree
      docId="d1"
      blocks={blocks}
      canEdit
      onUpdateBlock={() => {}}
      onCreateBlock={() => {}}
      onDeleteBlock={() => {}}
      onMoveBlock={(id, drop, level, single) => moves.push([id, drop, level, single])}
      lockedBlocks={locked}
      onLockedAction={(holder) => refused.push(holder.name)}
    />
  );

const rowOf = (id: string) => document.querySelector(`[data-outline-block="${id}"]`) as HTMLElement;
const dropLine = () => document.querySelector('[data-drop-line]');

function transfer(): DataTransfer {
  const set: Record<string, string> = {};
  return {
    types: [],
    files: [],
    items: [],
    dropEffect: 'none',
    effectAllowed: 'all',
    setData: (type: string, v: string) => (set[type] = v),
    getData: (type: string) => set[type] || '',
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

type Mods = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; clientX?: number };
// A drag event with the modifier keys held (jsdom has no DragEvent, its plain Event carries no keys)
async function fire(type: 'dragStart' | 'dragOver' | 'drop', el: Element, data: DataTransfer, mods: Mods = {}) {
  const ev = createEvent[type](el, { dataTransfer: data });
  Object.defineProperty(ev, 'shiftKey', { value: !!mods.shiftKey });
  Object.defineProperty(ev, 'ctrlKey', { value: !!mods.ctrlKey });
  Object.defineProperty(ev, 'altKey', { value: !!mods.altKey });
  if (mods.clientX !== undefined) Object.defineProperty(ev, 'clientX', { value: mods.clientX });
  await act(async () => {
    fireEvent(el, ev);
  });
}
const start = (id: string, data: DataTransfer, mods: Mods = {}) =>
  fire('dragStart', rowOf(id).querySelector('button[draggable="true"]')!, data, mods);
const over = (id: string, data: DataTransfer, mods: Mods = {}) => fire('dragOver', rowOf(id), data, mods);
const drop = (id: string, data: DataTransfer) => fire('drop', rowOf(id), data);
const lastGhost = () => ghost.single[ghost.single.length - 1];

beforeEach(() => {
  moves = [];
  refused = [];
  ghost.single = [];
  ghost.started = [];
});

describe('dragging a bullet in the outliner', () => {
  it('lands on the level of the bullet it is dropped in front of and shows that level beforehand', async () => {
    renderTree();
    const data = transfer();
    await start('u', data);
    // Move only: Shift (unlike Ctrl or Alt) never turns a drag into a copy
    expect(data.effectAllowed).toBe('move');
    await over('br', data);
    expect(data.dropEffect).toBe('move');
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('1');
    expect(rowOf('br').contains(dropLine())).toBe(true);
    await drop('br', data);
    expect(moves).toEqual([['u', { beforeId: 'br' }, 1, false]]);
    expect(dropLine()).toBeNull();
  });

  it('takes a deeper bullet out to the level of the row below it', async () => {
    renderTree();
    const data = transfer();
    await start('br', data);
    await over('u', data);
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('0');
    await drop('u', data);
    expect(moves).toEqual([['br', { beforeId: 'u' }, 0, false]]);
  });

  it('does not offer its own children as a target', async () => {
    renderTree();
    const data = transfer();
    await start('a', data);
    await over('f', data);
    expect(dropLine()).toBeNull();
    await drop('f', data);
    expect(moves).toEqual([]);
  });

  it('moves the bullet alone with Shift held, switched on and off during the drag', async () => {
    renderTree();
    const data = transfer();
    await start('a', data);
    expect(ghost.started).toEqual([false]);
    // Pressed during the drag: its own child becomes a target, on the level it has after moving up
    await over('f', data, { shiftKey: true });
    expect(lastGhost()).toBe(true);
    expect(data.dropEffect).toBe('move');
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('0');
    // Released: the whole branch again
    await over('f', data);
    expect(lastGhost()).toBe(false);
    expect(data.dropEffect).toBe('move');
    expect(dropLine()).toBeNull();
    await over('u', data, { shiftKey: true });
    await drop('u', data);
    expect(moves).toEqual([['a', { beforeId: 'u' }, 0, true]]);
  });

  it('takes the key as seen during the drag when the drop event does not report it', async () => {
    renderTree();
    const data = transfer();
    await start('a', data);
    await over('u', data, { shiftKey: true });
    expect(data.dropEffect).toBe('move');
    // The drop event itself carries no Shift here: the state seen while dragging counts
    await drop('u', data);
    expect(moves).toEqual([['a', { beforeId: 'u' }, 0, true]]);
  });

  it('starts alone when Shift is held already on grabbing the bullet', async () => {
    renderTree();
    const data = transfer();
    await start('e', data, { shiftKey: true });
    expect(ghost.started).toEqual([true]);
    await over('br', data, { shiftKey: true });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('0');
    await drop('br', data);
    expect(moves).toEqual([['e', { beforeId: 'br' }, 0, true]]);
  });

  it('keeps Shift from grabbing when drag events never report the key (Wayland)', async () => {
    renderTree();
    const data = transfer();
    await start('e', data, { shiftKey: true });
    // Under Wayland every dragover says Shift is not held
    await over('br', data);
    expect(ghost.single).not.toContain(false);
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('0');
    await drop('br', data);
    expect(moves).toEqual([['e', { beforeId: 'br' }, 0, true]]);
  });

  it('follows a release once drag events have reported Shift', async () => {
    renderTree();
    const data = transfer();
    await start('a', data, { shiftKey: true });
    await over('u', data, { shiftKey: true });
    await over('u', data);
    expect(lastGhost()).toBe(false);
    await drop('u', data);
    expect(moves).toEqual([['a', { beforeId: 'u' }, 0, false]]);
  });

  it('ignores Ctrl and Alt (Option): only Shift moves the bullet alone', async () => {
    renderTree();
    const data = transfer();
    await start('a', data, { ctrlKey: true });
    expect(ghost.started).toEqual([false]);
    await over('u', data, { ctrlKey: true });
    expect(lastGhost()).toBe(false);
    await over('u', data, { altKey: true });
    expect(lastGhost()).toBe(false);
    expect(data.dropEffect).toBe('move');
    await drop('u', data);
    expect(moves).toEqual([['a', { beforeId: 'u' }, 0, false]]);
  });

  // jsdom: one level is 22px (DEFAULT_INDENT); the level counts from where the pointer was on grabbing
  it('goes deeper as the pointer moves right of where it grabbed, up to a child of the bullet above', async () => {
    renderTree();
    const data = transfer();
    await start('u', data, { clientX: 100 });
    // In front of Einkaufen (level 0) below Folien (level 1): levels 0 to 2
    await over('e', data, { clientX: 100 });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('0');
    // Less than half a step: still on Einkaufen's level
    await over('e', data, { clientX: 110 });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('0');
    await over('e', data, { clientX: 112 });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('1');
    await over('e', data, { clientX: 144 });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('2');
    await over('e', data, { clientX: 400 });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('2');
    // Back left of the start: the level of Einkaufen again
    await over('e', data, { clientX: 20 });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('0');
    // The last child of Arbeit, after Folien
    await over('e', data, { clientX: 122 });
    await drop('e', data);
    expect(moves).toEqual([['u', { beforeId: 'e' }, 1, false]]);
  });

  it('stays on the level of the row below without moving sideways, wherever the bullet was grabbed', async () => {
    renderTree();
    const data = transfer();
    // A deeper bullet grabbed far right, then straight down in front of Urlaub: Urlaub's level
    await start('br', data, { clientX: 300 });
    await over('u', data, { clientX: 300 });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('0');
    await drop('u', data);
    expect(moves).toEqual([['br', { beforeId: 'u' }, 0, false]]);
  });

  it('never goes shallower than the bullet it lands in front of', async () => {
    renderTree();
    const data = transfer();
    await start('u', data, { clientX: 100 });
    // In front of Folien (level 1) below Bericht (level 1): levels 1 and 2
    await over('f', data, { clientX: 0 });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('1');
    await over('f', data, { clientX: 122 });
    expect(dropLine()?.getAttribute('data-drop-line')).toBe('2');
    await drop('f', data);
    expect(moves).toEqual([['u', { beforeId: 'f' }, 2, false]]);
  });

  it('below the last bullet: on the top level, or under the last bullet when moved right', async () => {
    renderTree();
    const data = transfer();
    await start('b', data, { clientX: 100 });
    const tail = rowOf('u').nextElementSibling as HTMLElement;
    await fire('dragOver', tail, data, { clientX: 100 });
    expect(tail.querySelector('[data-drop-line]')?.getAttribute('data-drop-line')).toBe('0');
    await fire('dragOver', tail, data, { clientX: 125 });
    expect(tail.querySelector('[data-drop-line]')?.getAttribute('data-drop-line')).toBe('1');
    await fire('drop', tail, data);
    expect(moves).toEqual([['b', { afterId: 'u' }, 1, false]]);
    expect(dropLine()).toBeNull();
  });

  it('puts a bullet dropped below the last one at the end, on the top level', async () => {
    renderTree();
    const data = transfer();
    await start('b', data);
    const tail = rowOf('u').nextElementSibling as HTMLElement;
    await fire('dragOver', tail, data);
    await fire('drop', tail, data);
    expect(moves).toEqual([['b', { afterId: 'u' }, 0, false]]);
  });

  it('is not started while someone else types in a child that would move up', async () => {
    renderTree(new Map([['f', { userId: 'u2', name: 'Bea' }]]));
    const data = transfer();
    // With its children the branch moves as a whole: Folien keeps its parent
    await start('a', data);
    await over('u', data);
    await drop('u', data);
    expect(moves).toEqual([['a', { beforeId: 'u' }, 0, false]]);
    // Alone, Folien would get a new parent
    await start('a', data, { shiftKey: true });
    await over('u', data, { shiftKey: true });
    await drop('u', data);
    expect(refused).toEqual(['Bea']);
    expect(moves).toHaveLength(1);
  });
});
