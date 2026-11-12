import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// The realtime connection: messages from the server are fed in by hand, sent ones collected
const realtime = vi.hoisted(() => ({
  ws: true,
  listeners: [] as ((msg: any) => void)[],
  sent: [] as any[],
}));
vi.mock('../../../lib/api', async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    isWebSocketConnected: () => realtime.ws,
    // A fresh attempt before opening a drawing (realtime.tryWebSocket); here it fails without one
    tryWebSocket: async () => realtime.ws,
    getSSEId: () => null,
    sendWebSocketMessage: (msg: any) => realtime.sent.push(msg),
    onWebSocketMessage: (cb: (msg: any) => void) => {
      realtime.listeners.push(cb);
      return () => {
        realtime.listeners = realtime.listeners.filter((f) => f !== cb);
      };
    },
    onRealtimeStatus: (cb: (connected: boolean, transport: string) => void) => {
      cb(true, realtime.ws ? 'ws' : 'sse');
      return () => {};
    },
  };
});

import { DrawingBlock } from '../drawing/DrawingBlock';
import { DrawingEditor } from '../drawing/DrawingEditor';
import { parseDrawing } from '../../../lib/drawing/model';

const CONTENT = JSON.stringify({ v: 1, els: [{ id: 'a', ver: 1, t: 'rect', x: 0, y: 0, w: 120, h: 60, s: 'main', f: 'none', sw: 2, txt: 'Kasten' }] });
const live = [
  { userId: 'u_anna', name: 'Anna' },
  { userId: 'u_ben', name: 'Ben' },
];
const emit = (event: string, payload: any) =>
  act(() => {
    realtime.listeners.forEach((f) => f({ event, payload: { docId: 'd1', blockId: 'b1', ...payload } }));
  });

beforeEach(() => {
  realtime.ws = true;
  realtime.listeners = [];
  realtime.sent = [];
});

describe('Live drawing in the note', () => {
  it('shows who draws and asks to draw along or watch', () => {
    render(<DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit live={live} onChange={() => {}} />);
    expect(screen.getByText('Live-Zeichnung: Anna, Ben')).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole('img'));
    expect(screen.getByText('Anna, Ben zeichnen gerade.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mitzeichnen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zusehen' })).toBeTruthy();
  });

  it('offers only watching without WebSocket, and says why', async () => {
    realtime.ws = false;
    render(<DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit live={[live[0]]} onChange={() => {}} />);
    fireEvent.doubleClick(screen.getByRole('img'));
    expect(await screen.findByText('Anna zeichnet gerade.')).toBeTruthy();
    expect(screen.getByText(/Mitzeichnen geht nur mit einer WebSocket-Verbindung/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mitzeichnen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Zusehen' })).toBeTruthy();
  });

  it('readers only watch', () => {
    render(<DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit={false} live={[live[0]]} onChange={() => {}} />);
    fireEvent.doubleClick(screen.getByRole('img'));
    expect(screen.queryByRole('button', { name: 'Mitzeichnen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zusehen' }));
    expect(realtime.sent.map((m) => m.event)).toContain('DRAW_WATCH');
  });

  it('starts a live session when opened with a WebSocket', () => {
    render(<DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit onChange={() => {}} />);
    fireEvent.doubleClick(screen.getByRole('img'));
    const join = realtime.sent.find((m) => m.event === 'DRAW_JOIN');
    expect(join?.payload).toMatchObject({ docId: 'd1', blockId: 'b1', base: CONTENT });
    expect(join?.payload.els).toEqual([expect.objectContaining({ id: 'a', ver: 1, nonce: 0 })]);
  });
});

describe('Live drawing in the editor', () => {
  const people = {
    active: true,
    host: 'c_anna',
    participants: [
      { id: 'c_anna', userId: 'u_anna', name: 'Anna' },
      { id: 'c_ben', userId: 'u_ben', name: 'Ben' },
    ],
    watchers: [{ id: 'c_cleo', userId: 'u_cleo', name: 'Cleo' }],
  };
  const open = () =>
    render(
      <DrawingEditor
        initial={parseDrawing(CONTENT)!}
        baseContent={CONTENT}
        draftKey="b1"
        live={{ docId: 'd1', blockId: 'b1', mode: 'draw', canDraw: true }}
        onClose={() => {}}
      />
    );

  it('shows the host, everyone in it, the others\' pointers and the end', () => {
    open();
    emit('DRAW_STATE', { ...people, you: 'c_ben', els: [], order: [], seq: 0 });
    expect(screen.getByText('Gastgeber: Anna')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Verlassen/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Fertig/ })).toBeNull();
    const bar = document.querySelector('[data-live-people]')!;
    expect(bar.getAttribute('title')).toBe('Zeichnen: Anna, Ben · Sehen zu: Cleo');

    emit('DRAW_PRESENCE', { from: 'c_anna', userId: 'u_anna', name: 'Anna', x: 10, y: 20, sel: ['a'], touch: false, gone: false });
    expect(document.querySelector('[data-live-cursor="Anna"]')).toBeTruthy();
    expect(document.querySelector('[data-live-selection="Anna"]')).toBeTruthy();

    // Anna goes: Ben is host now and saves
    emit('DRAW_PEOPLE', { ...people, host: 'c_ben', participants: [people.participants[1]] });
    expect(screen.getByText('Du bist Gastgeber')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fertig/ })).toBeTruthy();
    expect(document.querySelector('[data-live-cursor="Anna"]')).toBeNull();
  });

  it('takes in changes of others and shows when the host saved', () => {
    open();
    emit('DRAW_STATE', { ...people, you: 'c_ben', els: [], order: [], seq: 0 });
    emit('DRAW_OPS', {
      from: 'c_anna',
      seq: 1,
      els: [{ id: 'n1', ver: 1, nonce: 5, t: 'ellipse', x: 200, y: 0, w: 80, h: 40, s: 'main', f: 'none', sw: 2 }],
    });
    expect(document.querySelectorAll('[role="dialog"] svg ellipse').length).toBe(1);
    emit('DRAW_END', { reason: 'done', by: 'Anna' });
    expect(screen.getByText('Anna hat die Zeichnung gespeichert.')).toBeTruthy();
  });
});
