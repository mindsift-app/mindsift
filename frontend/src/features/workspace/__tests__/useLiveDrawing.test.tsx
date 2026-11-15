import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { WSMessage } from '../../../lib/types';

type SentMessage = { event: string; payload: { els?: { id: string }[] } & Record<string, unknown> };

// The realtime connection: messages from the server are fed in by hand, sent ones collected
const realtime = vi.hoisted(() => ({
  listeners: [] as ((msg: WSMessage) => void)[],
  sent: [] as SentMessage[],
}));
vi.mock('../../../lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...orig,
    isWebSocketConnected: () => true,
    getSSEId: () => null,
    sendWebSocketMessage: (msg: SentMessage) => realtime.sent.push(msg),
    onWebSocketMessage: (cb: (msg: WSMessage) => void) => {
      realtime.listeners.push(cb);
      return () => {
        realtime.listeners = realtime.listeners.filter((f) => f !== cb);
      };
    },
    onRealtimeStatus: (cb: (connected: boolean, transport: string) => void) => {
      cb(true, 'ws');
      return () => {};
    },
  };
});

import { useLiveDrawing, LiveOptions } from '../drawing/useLiveDrawing';
import { Drawing, DrawElement } from '../../../lib/drawing/model';

const rect = (id: string, x = 0): DrawElement => ({ id, ver: 1, t: 'rect', x, y: 0, w: 10, h: 10, s: 'main', f: 'none', sw: 2 }) as DrawElement;
const emit = (event: string, payload: Record<string, unknown>) =>
  act(() => {
    realtime.listeners.forEach((f) => f({ event, payload: { docId: 'd1', blockId: 'b1', ...payload }, timestamp: '' }));
  });
const people = {
  active: true,
  host: 'c_ben',
  participants: [
    { id: 'c_ben', userId: 'u_ben', name: 'Ben' },
    { id: 'c_anna', userId: 'u_anna', name: 'Anna' },
    { id: 'c_cleo', userId: 'u_cleo', name: 'Cleo' },
  ],
  watchers: [],
};

function setup() {
  let doc: Drawing = { v: 1, els: [rect('a')] } as Drawing;
  const onSaved = vi.fn();
  const opts: LiveOptions = {
    docId: 'd1',
    blockId: 'b1',
    mode: 'draw',
    baseContent: '',
    initial: doc,
    getDoc: () => doc,
    held: () => new Set(),
    selected: () => [],
    apply: (next) => {
      doc = next;
    },
    onSaved,
    onDiscarded: () => {},
  };
  const hook = renderHook(() => useLiveDrawing(opts));
  emit('DRAW_STATE', { ...people, you: 'c_ben', els: [{ ...rect('a'), nonce: 0 }], order: ['a'], seq: 0 });
  return {
    hook,
    onSaved,
    draw: (el: DrawElement) => {
      doc = { ...doc, els: [...doc.els, el] };
      hook.result.current!.changed();
    },
  };
}

const sentOps = () => realtime.sent.filter((m) => m.event === 'DRAW_OPS');

beforeEach(() => {
  realtime.listeners = [];
  realtime.sent = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useLiveDrawing', () => {
  it('takes the bundled pointers of the others, never its own, names from the participants', () => {
    const { hook } = setup();
    emit('DRAW_POINTERS', {
      pointers: [
        { from: 'c_anna', x: 10, y: 20, sel: ['a'] },
        { from: 'c_ben', x: 1, y: 1 },
        { from: 'c_gone', x: 5, y: 5 },
      ],
    });
    const cursors = hook.result.current!.cursors;
    expect([...cursors.keys()]).toEqual(['c_anna']);
    expect(cursors.get('c_anna')).toEqual({ id: 'c_anna', userId: 'u_anna', name: 'Anna', at: [10, 20], sel: ['a'], touch: false });
    // A later bundle with Cleo only keeps Anna where she was; a lifted finger has no position
    emit('DRAW_POINTERS', { pointers: [{ from: 'c_cleo', x: 3, y: 4, touch: true, gone: true }] });
    const next = hook.result.current!.cursors;
    expect(next.get('c_anna')?.at).toEqual([10, 20]);
    expect(next.get('c_cleo')).toMatchObject({ name: 'Cleo', at: undefined, touch: true });
  });

  it('still takes a single pointer of an older server', () => {
    const { hook } = setup();
    emit('DRAW_PRESENCE', { from: 'c_anna', userId: 'u_anna', name: 'Anna', x: 7, y: 8, sel: [], touch: false, gone: false });
    expect(hook.result.current!.cursors.get('c_anna')?.at).toEqual([7, 8]);
  });

  it('keeps changes the server refused as busy and sends them again once it takes them', () => {
    const { hook, draw } = setup();
    draw(rect('n1', 50));
    act(() => vi.advanceTimersByTime(60));
    expect(sentOps().map((m) => m.payload.els?.map((e) => e.id))).toEqual([['n1']]);

    emit('DRAW_ERROR', { code: 'busy' });
    expect(hook.result.current!.error).toBe('busy_live');
    expect(hook.result.current!.unsent).toBe(true);
    // More drawing meanwhile goes nowhere yet
    draw(rect('n2', 80));
    act(() => vi.advanceTimersByTime(1000));
    expect(sentOps()).toHaveLength(1);

    // After a while the session's state comes again; what it lacks goes out
    act(() => vi.advanceTimersByTime(5000));
    expect(realtime.sent[realtime.sent.length - 1]?.event).toBe('DRAW_SYNC');
    emit('DRAW_STATE', { ...people, you: 'c_ben', els: [{ ...rect('a'), nonce: 0 }], order: ['a'], seq: 0 });
    act(() => vi.advanceTimersByTime(60));
    expect(sentOps()).toHaveLength(2);
    expect(sentOps()[1].payload.els?.map((e) => e.id).sort()).toEqual(['n1', 'n2']);
    expect(hook.result.current!.error).toBe('busy_live');
    emit('DRAW_ACK', { seq: 1 });
    expect(hook.result.current!.error).toBeNull();
    expect(hook.result.current!.unsent).toBe(false);
  });

  it('refused again: tries again later, and the host saves its refused changes with the final state', () => {
    const { hook, draw, onSaved } = setup();
    draw(rect('n1', 50));
    act(() => vi.advanceTimersByTime(60));
    emit('DRAW_ERROR', { code: 'busy' });
    act(() => vi.advanceTimersByTime(5000));
    emit('DRAW_STATE', { ...people, you: 'c_ben', els: [{ ...rect('a'), nonce: 0 }], order: ['a'], seq: 0 });
    act(() => vi.advanceTimersByTime(60));
    emit('DRAW_ERROR', { code: 'busy' });
    expect(hook.result.current!.unsent).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(realtime.sent.filter((m) => m.event === 'DRAW_SYNC')).toHaveLength(2);

    // "Fertig" while the server still lacks n1: the saved drawing has it, beside Anna's change
    emit('DRAW_END', {
      reason: 'done',
      you: 'c_ben',
      by: 'Ben',
      els: [{ ...rect('a'), nonce: 0 }, { ...rect('x', 90), nonce: 3 }],
      order: ['a', 'x'],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect((onSaved.mock.calls[0][0] as Drawing).els.map((e) => e.id).sort()).toEqual(['a', 'n1', 'x']);
  });
});
