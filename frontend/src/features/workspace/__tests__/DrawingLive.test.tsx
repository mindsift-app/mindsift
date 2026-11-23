import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { emitRealtimeMessage, emitRealtimeStatus } from '../../../lib/realtimeBus';

// What the editor sends (always an event with its payload)
type SentMessage = { event: string; payload: { els?: unknown[] } & Record<string, unknown> };

// The realtime connection: messages from the server are fed in by hand (lib/realtimeBus.ts), sent ones collected
const realtime = vi.hoisted(() => ({
  ws: true,
  sent: [] as SentMessage[],
}));
vi.mock('../../../lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...orig,
    isWebSocketConnected: () => realtime.ws,
    // A fresh attempt before opening a drawing (realtime.tryWebSocket); here it fails without one
    tryWebSocket: async () => realtime.ws,
    getSSEId: () => null,
    sendWebSocketMessage: (msg: SentMessage) => realtime.sent.push(msg),
  };
});

import { DrawingBlock } from '../drawing/DrawingBlock';
import { NoteSharedContext } from '../drawing/noteShared';
import { DrawingEditor } from '../drawing/DrawingEditor';
import { actAsDesktopApp, actAsServer } from '../../../test/desktop';
import { parseDrawing } from '../../../lib/drawing/model';
import { useDismiss } from '../../../lib/useDismiss';

const CONTENT = JSON.stringify({ v: 1, els: [{ id: 'a', ver: 1, t: 'rect', x: 0, y: 0, w: 120, h: 60, s: 'main', f: 'none', sw: 2, txt: 'Kasten' }] });
const live = [
  { userId: 'u_anna', name: 'Anna' },
  { userId: 'u_ben', name: 'Ben' },
];
const emit = (event: string, payload: Record<string, unknown>) =>
  act(() => {
    emitRealtimeMessage({ event, payload: { docId: 'd1', blockId: 'b1', ...payload }, timestamp: '' });
  });

beforeEach(() => {
  realtime.ws = true;
  // Connected (a drawing joins at once)
  emitRealtimeStatus(true, 'ws');
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

  it('a double-click on a drawing someone else draws in alone says so instead of doing nothing', () => {
    const onLocked = vi.fn();
    render(<DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit={false} onLocked={onLocked} onChange={() => {}} />);
    fireEvent.doubleClick(screen.getByRole('img'));
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Zusehen' })).toBeNull();
  });

  // The editor loads on demand (its own chunk): its messages go out once it has mounted
  it('readers only watch', async () => {
    render(<DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit={false} live={[live[0]]} onChange={() => {}} />);
    fireEvent.doubleClick(screen.getByRole('img'));
    expect(screen.queryByRole('button', { name: 'Mitzeichnen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zusehen' }));
    await vi.waitFor(() => expect(realtime.sent.map((m) => m.event)).toContain('DRAW_WATCH'));
  });

  it('joining from the question only joins the running session', async () => {
    render(<DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit live={[live[0]]} onChange={() => {}} />);
    fireEvent.doubleClick(screen.getByRole('img'));
    fireEvent.click(await screen.findByRole('button', { name: 'Mitzeichnen' }));
    const join = await vi.waitFor(() => {
      const sent = realtime.sent.find((m) => m.event === 'DRAW_JOIN');
      expect(sent).toBeTruthy();
      return sent;
    });
    expect(join?.payload).toMatchObject({ docId: 'd1', blockId: 'b1', join: true });
    // It ended meanwhile: the editor says so, no new session starts
    emit('DRAW_ERROR', { code: 'ended' });
    expect(screen.getByText('Die Live-Zeichnung ist beendet.')).toBeTruthy();
  });

  it('the question goes away when the session ends meanwhile, and the drawing opens', async () => {
    const { rerender } = render(<DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit live={[live[0]]} onChange={() => {}} />);
    fireEvent.doubleClick(screen.getByRole('img'));
    expect(await screen.findByText('Anna zeichnet gerade.')).toBeTruthy();
    rerender(<DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit onChange={() => {}} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Zeichnung bearbeiten' })).toBeTruthy();
    expect(realtime.sent).toEqual([]);
  });
});

describe('Drawing alone, and starting to draw together', () => {
  const openBlock = (shared: boolean, onChange = () => {}) =>
    render(
      <NoteSharedContext.Provider value={shared}>
        <DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit onChange={onChange} />
      </NoteSharedContext.Provider>
    );
  const editorOpen = () => screen.findByRole('dialog', { name: 'Zeichnung bearbeiten' });

  it('opening a drawing draws alone, without a live session', async () => {
    openBlock(true);
    fireEvent.doubleClick(screen.getByRole('img'));
    await editorOpen();
    expect(realtime.sent).toEqual([]);
    expect(document.querySelector('[data-live-people]')).toBeNull();
  });

  it('offers "Gemeinsam zeichnen" only in a shared note', async () => {
    openBlock(false);
    fireEvent.doubleClick(screen.getByRole('img'));
    await editorOpen();
    expect(screen.queryByRole('button', { name: 'Gemeinsam zeichnen' })).toBeNull();
  });

  it('does not offer "Gemeinsam zeichnen" in the desktop app, even in a shared note', async () => {
    actAsDesktopApp();
    try {
      openBlock(true);
      fireEvent.doubleClick(screen.getByRole('img'));
      await editorOpen();
      expect(screen.queryByRole('button', { name: 'Gemeinsam zeichnen' })).toBeNull();
    } finally {
      actAsServer();
    }
  });

  it('"Gemeinsam zeichnen" starts a session with the drawing so far', async () => {
    openBlock(true);
    fireEvent.doubleClick(screen.getByRole('img'));
    await editorOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Gemeinsam zeichnen' }));
    const join = await vi.waitFor(() => {
      const sent = realtime.sent.find((m) => m.event === 'DRAW_JOIN');
      expect(sent).toBeTruthy();
      return sent;
    });
    expect(join?.payload).toMatchObject({ docId: 'd1', blockId: 'b1', base: CONTENT });
    expect(join?.payload.join).toBeUndefined();
    expect(join?.payload.els).toEqual([expect.objectContaining({ id: 'a', ver: 1, nonce: 0 })]);
    expect(screen.queryByRole('button', { name: 'Gemeinsam zeichnen' })).toBeNull();
  });

  it('the starter is host from the first answer on, alone too, and sees who joins, also the own other tab', async () => {
    openBlock(true);
    fireEvent.doubleClick(screen.getByRole('img'));
    await editorOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Gemeinsam zeichnen' }));
    await vi.waitFor(() => expect(realtime.sent.map((m) => m.event)).toContain('DRAW_JOIN'));
    // Not answered yet: no plain "Live" flashes, and the buttons stay those of the host
    expect(document.querySelector('[data-live-people]')).toBeNull();
    expect(screen.getByRole('button', { name: /^Fertig/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Verlassen/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Schließen ohne zu speichern' })).toBeTruthy();
    const anna = { id: 'c_anna', userId: 'u_anna', name: 'Anna' };
    emit('DRAW_STATE', { active: true, host: 'c_anna', participants: [anna], watchers: [], you: 'c_anna', els: [], order: [], seq: 0 });
    // Answered: still alone, but in the session and its host
    expect(document.querySelector('[data-live-people]')?.getAttribute('data-live-people')).toBe('Anna');
    expect(screen.getByText('Du bist Gastgeber')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Fertig/ })).toBeTruthy();
    // Anna's other tab draws along: the same person once in the pictures
    emit('DRAW_PEOPLE', { active: true, host: 'c_anna', participants: [anna, { id: 'c_anna2', userId: 'u_anna', name: 'Anna' }], watchers: [] });
    expect(document.querySelector('[data-live-people]')?.getAttribute('data-live-people')).toBe('Anna');
    expect(screen.getByText('Du bist Gastgeber')).toBeTruthy();
    emit('DRAW_PEOPLE', { active: true, host: 'c_anna', participants: [anna, { id: 'c_ben', userId: 'u_ben', name: 'Ben' }], watchers: [] });
    expect(document.querySelector('[data-live-people]')?.getAttribute('data-live-people')).toBe('Anna,Ben');
  });

  it('without a WebSocket it says so and goes on alone', async () => {
    realtime.ws = false;
    openBlock(true);
    fireEvent.doubleClick(screen.getByRole('img'));
    await editorOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Gemeinsam zeichnen' }));
    expect(await screen.findByText(/Gemeinsam zeichnen geht nur mit einer WebSocket-Verbindung/)).toBeTruthy();
    expect(realtime.sent).toEqual([]);
  });

  it('a refused start goes back to drawing alone', async () => {
    openBlock(true);
    fireEvent.doubleClick(screen.getByRole('img'));
    await editorOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Gemeinsam zeichnen' }));
    await vi.waitFor(() => expect(realtime.sent.map((m) => m.event)).toContain('DRAW_JOIN'));
    emit('DRAW_ERROR', { code: 'busy' });
    expect(screen.getByText(/Gerade laufen zu viele Live-Zeichnungen/)).toBeTruthy();
    // Alone again: the tools are there and the button too
    expect(screen.getByRole('button', { name: 'Gemeinsam zeichnen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fertig/ })).toBeTruthy();
  });
});

describe('Closing without saving', () => {
  const onClose = vi.fn();
  beforeEach(() => onClose.mockReset());
  const openEditor = (live?: { docId: string; blockId: string; mode: 'draw' | null; canDraw: boolean; canStart?: boolean }) =>
    render(<DrawingEditor initial={parseDrawing(CONTENT)!} baseContent={CONTENT} draftKey="b1" live={live} onClose={onClose} />);
  const closeButton = () => screen.getByRole('button', { name: 'Schließen ohne zu speichern' });

  it('closes right away when nothing changed', () => {
    openEditor({ docId: 'd1', blockId: 'b1', mode: null, canDraw: true, canStart: true });
    fireEvent.click(closeButton());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).toHaveBeenCalledWith(null);
  });

  it('asks when something changed, without speaking of live', () => {
    openEditor({ docId: 'd1', blockId: 'b1', mode: null, canDraw: true, canStart: true });
    fireEvent.click(screen.getByRole('button', { name: /^Gitter/ }));
    fireEvent.click(closeButton());
    const ask = screen.getByRole('alertdialog');
    expect(ask.textContent).toContain('Ungespeicherte Änderungen verwerfen?');
    expect(ask.textContent).not.toMatch(/Live/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('alone in a live session without changes: ends it without asking', () => {
    openEditor({ docId: 'd1', blockId: 'b1', mode: 'draw', canDraw: true });
    emit('DRAW_STATE', { active: true, host: 'c_ben', participants: [{ id: 'c_ben', userId: 'u_ben', name: 'Ben' }], watchers: [], you: 'c_ben', els: [], order: [], seq: 0 });
    fireEvent.click(closeButton());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(realtime.sent.map((m) => m.event)).toContain('DRAW_DISCARD');
  });

  it('the host with others drawing along just leaves, without asking; they go on', () => {
    openEditor({ docId: 'd1', blockId: 'b1', mode: 'draw', canDraw: true });
    emit('DRAW_STATE', {
      active: true,
      host: 'c_ben',
      participants: [
        { id: 'c_ben', userId: 'u_ben', name: 'Ben' },
        { id: 'c_anna', userId: 'u_anna', name: 'Anna' },
      ],
      watchers: [],
      you: 'c_ben',
      els: [],
      order: [],
      seq: 0,
    });
    fireEvent.click(screen.getByRole('button', { name: /^Gitter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Live-Zeichnung verlassen – die anderen zeichnen weiter' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const events = realtime.sent.map((m) => m.event);
    expect(events).toContain('DRAW_LEAVE');
    expect(events).not.toContain('DRAW_DISCARD');
    expect(onClose).toHaveBeenCalledWith(null);
  });

  it('the last one with changes is asked, and the discard can be undone', () => {
    openEditor({ docId: 'd1', blockId: 'b1', mode: 'draw', canDraw: true });
    emit('DRAW_STATE', { active: true, host: 'c_ben', participants: [{ id: 'c_ben', userId: 'u_ben', name: 'Ben' }], watchers: [], you: 'c_ben', els: [], order: [], seq: 0 });
    fireEvent.click(screen.getByRole('button', { name: /^Gitter/ }));
    fireEvent.click(closeButton());
    const ask = screen.getByRole('alertdialog');
    expect(ask.textContent).toContain('Ungespeicherte Änderungen verwerfen?');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }));
    expect(realtime.sent.map((m) => m.event)).toContain('DRAW_DISCARD');
    emit('DRAW_END', { reason: 'discard', you: 'c_ben', by: 'Ben' });
    expect(onClose).toHaveBeenCalledWith(null, true, true);
  });
});

describe('Undoing a discarded live drawing', () => {
  const start = async (beforeEnd?: () => void) => {
    render(
      <NoteSharedContext.Provider value>
        <DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit onChange={() => {}} />
      </NoteSharedContext.Provider>
    );
    fireEvent.doubleClick(screen.getByRole('img'));
    await screen.findByRole('dialog', { name: 'Zeichnung bearbeiten' });
    fireEvent.click(screen.getByRole('button', { name: 'Gemeinsam zeichnen' }));
    await vi.waitFor(() => expect(realtime.sent.map((m) => m.event)).toContain('DRAW_JOIN'));
    emit('DRAW_STATE', { active: true, host: 'c_ben', participants: [{ id: 'c_ben', userId: 'u_ben', name: 'Ben' }], watchers: [], you: 'c_ben', els: [], order: [], seq: 0 });
    fireEvent.click(screen.getByRole('button', { name: /^Gitter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Schließen ohne zu speichern' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }));
    beforeEnd?.();
    emit('DRAW_END', { reason: 'discard', you: 'c_ben', by: 'Ben' });
    realtime.sent = [];
  };

  it('"Zeichnung verworfen · Rückgängig" brings the session back as host', async () => {
    await start();
    expect(screen.queryByRole('dialog', { name: 'Zeichnung bearbeiten' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Zeichnung verworfen');
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    await screen.findByRole('dialog', { name: 'Zeichnung bearbeiten' });
    const join = await vi.waitFor(() => {
      const sent = realtime.sent.find((m) => m.event === 'DRAW_JOIN');
      expect(sent).toBeTruthy();
      return sent;
    });
    expect(join?.payload).toMatchObject({ resume: true, base: CONTENT });
    expect(join?.payload.join).toBeUndefined();
    emit('DRAW_STATE', {
      active: true, host: 'c_ben2', participants: [{ id: 'c_ben2', userId: 'u_ben', name: 'Ben' }], watchers: [], you: 'c_ben2',
      els: [{ id: 'a', ver: 1, nonce: 0, t: 'rect', x: 0, y: 0, w: 120, h: 60, s: 'main', f: 'none', sw: 2, txt: 'Kasten' }], order: ['a'], grid: true, seq: 1,
    });
    expect(screen.getByRole('button', { name: /Fertig/ })).toBeTruthy();
  });

  it('too late (after the window): the editor says the session is over', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    await screen.findByRole('dialog', { name: 'Zeichnung bearbeiten' });
    await vi.waitFor(() => expect(realtime.sent.map((m) => m.event)).toContain('DRAW_JOIN'));
    emit('DRAW_ERROR', { code: 'ended' });
    expect(screen.getByText('Die Live-Zeichnung ist beendet.')).toBeTruthy();
  });

  it('the undo hint goes after 10 s', async () => {
    await start(() => vi.useFakeTimers());
    try {
      expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeTruthy();
      act(() => vi.advanceTimersByTime(10_001));
      expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it('joining: not host until the server says so, and no "Live" before it answered', () => {
    open();
    expect(document.querySelector('[data-live-people]')).toBeNull();
    expect(screen.getByRole('button', { name: /Verlassen/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Fertig/ })).toBeNull();
  });

  it('after the hand-over the new host sees it, also when the others are all gone', () => {
    open();
    emit('DRAW_STATE', { ...people, watchers: [], you: 'c_ben', els: [], order: [], seq: 0 });
    expect(screen.getByText('Gastgeber: Anna')).toBeTruthy();
    // Anna leaves: Ben is host, alone in the session now
    emit('DRAW_PEOPLE', { active: true, host: 'c_ben', participants: [people.participants[1]], watchers: [] });
    expect(screen.getByText('Du bist Gastgeber')).toBeTruthy();
    expect(document.querySelector('[data-live-people]')?.getAttribute('data-live-people')).toBe('Ben');
    expect(document.querySelector('[data-live-host]')?.getAttribute('data-live-host')).toBe('Ben');
    expect(screen.getByRole('button', { name: /^Fertig/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Verlassen/ })).toBeNull();
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

  it('shows the bundled pointers of the others', () => {
    open();
    emit('DRAW_STATE', { ...people, you: 'c_ben', els: [], order: [], seq: 0 });
    emit('DRAW_POINTERS', { pointers: [{ from: 'c_anna', x: 10, y: 20, sel: ['a'] }] });
    expect(document.querySelector('[data-live-cursor="Anna"]')).toBeTruthy();
    expect(document.querySelector('[data-live-selection="Anna"]')).toBeTruthy();
  });

  it('a change the server refuses mid-session stays: a clear hint, still drawing, kept as a draft at the end', async () => {
    localStorage.removeItem('mindsift_drawing_draft:b1');
    open();
    emit('DRAW_STATE', { ...people, you: 'c_ben', els: [], order: [], seq: 0 });
    fireEvent.click(screen.getByRole('button', { name: /^Gitter/ }));
    await vi.waitFor(() => expect(realtime.sent.map((m) => m.event)).toContain('DRAW_OPS'));
    emit('DRAW_ERROR', { code: 'busy' });
    expect(screen.getByText(/Deine Änderungen bleiben hier erhalten/)).toBeTruthy();
    // Not read-only: the tools are still there
    expect((screen.getByRole('button', { name: /^Gitter/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /Verlassen/ })).toBeTruthy();
    // Anna saves before the server took it: the hint says the change stays as a draft, and closing keeps it
    emit('DRAW_END', { reason: 'done', by: 'Anna' });
    expect(screen.getByText(/bleiben in diesem Browser als Entwurf/)).toBeTruthy();
    fireEvent.click(within(document.querySelector('[data-live-notice]') as HTMLElement).getByRole('button', { name: 'Schließen' }));
    expect(JSON.parse(localStorage.getItem('mindsift_drawing_draft:b1') || '{}').content).toContain('"grid":true');
  });
});

// A popover opened while the drawing is focused (it lies above it on the stack of lib/useDismiss.ts)
function PopoverAbove({ onClose }: { onClose: () => void }) {
  useDismiss(null, onClose);
  return null;
}

describe('Focus of a drawing in the note', () => {
  const focusedNow = () => screen.getByRole('img').className.includes('border-accent');

  it('Escape and a press beside it hand the page back; a popover above closes first', () => {
    const onClose = vi.fn();
    const daneben = vi.fn();
    const block = <DrawingBlock docId="d1" blockId="b1" content={CONTENT} canEdit onChange={() => {}} />;
    const outside = (
      <button type="button" onClick={daneben}>
        Daneben
      </button>
    );
    const { rerender } = render(
      <>
        {block}
        {outside}
      </>
    );
    fireEvent.pointerDown(screen.getByRole('img'));
    expect(focusedNow()).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(focusedNow()).toBe(false);

    fireEvent.pointerDown(screen.getByRole('img'));
    rerender(
      <>
        {block}
        {outside}
        <PopoverAbove onClose={onClose} />
      </>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(focusedNow()).toBe(true);
    rerender(
      <>
        {block}
        {outside}
      </>
    );

    const button = screen.getByRole('button', { name: 'Daneben' });
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(focusedNow()).toBe(false);
    expect(daneben).toHaveBeenCalledTimes(1);
  });
});
