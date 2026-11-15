import { describe, it, expect, beforeEach } from 'vitest';
import { enqueue, flushOutbox, getOutbox, isCacheablePath } from '../offline';

const res = (status: number) => ({ status, ok: status >= 200 && status < 300 }) as Response;

describe('outbox', () => {
  beforeEach(() => localStorage.clear());

  it('keeps only the last state of repeated toggles', () => {
    enqueue('PATCH', '/api/v1/thoughts/t1', { isCompleted: true });
    enqueue('POST', '/api/v1/inbox', { content: 'Milch' });
    enqueue('PATCH', '/api/v1/thoughts/t1', { isCompleted: false });
    const box = getOutbox();
    expect(box).toHaveLength(2);
    expect(box[0].body).toEqual({ isCompleted: false });
  });

  it('takes over thoughts captured offline by older versions', () => {
    localStorage.setItem(
      'mindsift_offline_capture_queue',
      JSON.stringify([{ id: 'th_offline_1', content: 'Alt', priority: 'normal', source: 'manual', createdAt: '2026-10-29T08:00:00Z' }])
    );
    const box = getOutbox();
    expect(box).toHaveLength(1);
    expect(box[0].path).toBe('/api/v1/inbox');
    expect(localStorage.getItem('mindsift_offline_capture_queue')).toBeNull();
  });

  it('sends in order, drops rejected entries and stops while offline', async () => {
    enqueue('POST', '/api/v1/inbox', { content: 'a' });
    enqueue('PATCH', '/api/v1/lists/l/items/i', { isCompleted: true });
    enqueue('POST', '/api/v1/inbox', { content: 'c' });
    const answers = [res(201), res(404)];
    const synced = await flushOutbox(async () => {
      const next = answers.shift();
      if (!next) throw new TypeError('offline');
      return next;
    });
    expect(synced).toBe(1);
    expect(getOutbox().map((e) => e.body.content)).toEqual(['c']);
  });

  it('does not cache streams, note sync or downloads', () => {
    expect(isCacheablePath('/api/v1/thoughts?status=all')).toBe(true);
    expect(isCacheablePath('/api/v1/events')).toBe(false);
    expect(isCacheablePath('/api/v1/docs/d1/changes?since=3')).toBe(false);
    expect(isCacheablePath('/api/v1/export/markdown')).toBe(false);
    expect(isCacheablePath('/api/v1/documents/d1/secrets/sec1')).toBe(false);
  });
});

describe('list items changed offline', () => {
  beforeEach(() => localStorage.clear());
  const path = '/api/v1/lists/lst_1/items/itm_1';

  it('ticked and un-ticked again: nothing left to send', () => {
    enqueue('PATCH', path, { isCompleted: true, changedAt: 1 }, { isCompleted: false });
    enqueue('PATCH', path, { isCompleted: false, changedAt: 2 }, { isCompleted: true });
    expect(getOutbox()).toHaveLength(0);
    // ... and ticked a third time: the tick goes out, with the time of the last tap
    enqueue('PATCH', path, { isCompleted: true, changedAt: 3 }, { isCompleted: false });
    expect(getOutbox().map((e) => e.body)).toEqual([{ isCompleted: true, changedAt: 3 }]);
  });

  it('a task checked off and on again from its column is not sent either', () => {
    const task = '/api/v1/thoughts/t1';
    enqueue('PATCH', task, { isCompleted: true, kanbanStatus: 'done' }, { isCompleted: false, kanbanStatus: 'todo' });
    enqueue('PATCH', task, { isCompleted: false, kanbanStatus: 'todo' }, { isCompleted: true, kanbanStatus: 'done' });
    expect(getOutbox()).toHaveLength(0);
    // Moved to another column and checked off: both go out
    enqueue('PATCH', task, { isCompleted: false, kanbanStatus: 'doing' }, { isCompleted: false, kanbanStatus: 'todo' });
    enqueue('PATCH', task, { isCompleted: true, kanbanStatus: 'done' }, { isCompleted: false, kanbanStatus: 'doing' });
    expect(getOutbox().map((e) => e.body)).toEqual([{ isCompleted: true, kanbanStatus: 'done' }]);
  });

  it('edits keep only the last value per field, a deletion drops the queued changes', async () => {
    const { pendingListChanges } = await import('../offline');
    enqueue('PATCH', path, { isCompleted: true, changedAt: 1 }, { isCompleted: false });
    enqueue('PUT', path, { quantity: '2' });
    enqueue('PUT', path, { content: 'Hafermilch (Barista)' });
    enqueue('PUT', path, { quantity: '3' });
    enqueue('PATCH', '/api/v1/lists/lst_1/items/itm_2', { isCompleted: true, changedAt: 1 }, { isCompleted: false });
    expect(getOutbox().map((e) => [e.method, e.body])).toEqual([
      ['PATCH', { isCompleted: true, changedAt: 1 }],
      ['PUT', { quantity: '3', content: 'Hafermilch (Barista)' }],
      ['PATCH', { isCompleted: true, changedAt: 1 }],
    ]);
    expect(pendingListChanges().get('itm_1')).toEqual({ isCompleted: true, quantity: '3', content: 'Hafermilch (Barista)' });

    enqueue('DELETE', path, {});
    expect(getOutbox().map((e) => [e.method, e.path])).toEqual([
      ['PATCH', '/api/v1/lists/lst_1/items/itm_2'],
      ['DELETE', path],
    ]);
    expect(pendingListChanges().get('itm_1')).toEqual({ deleted: true });
    expect(pendingListChanges().get('itm_2')).toEqual({ isCompleted: true });
  });

  it('a change sent late says when it was sent, on the same clock as when it was made', async () => {
    const { sendOutboxEntry } = await import('../api/client');
    const calls: { method: string; body: unknown }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined });
      return res(200);
    }) as typeof fetch;
    try {
      const before = Date.now();
      await sendOutboxEntry({ method: 'PATCH', path, body: { isCompleted: true, changedAt: 5 } });
      await sendOutboxEntry({ method: 'POST', path: '/api/v1/inbox', body: { content: 'Milch' } });
      await sendOutboxEntry({ method: 'DELETE', path, body: {} });
      const sent = calls[0].body as { isCompleted: boolean; changedAt: number; sentAt: number };
      expect(sent.isCompleted).toBe(true);
      expect(sent.changedAt).toBe(5);
      expect(sent.sentAt).toBeGreaterThanOrEqual(before);
      expect(calls[1].body).toEqual({ content: 'Milch' });
      expect(calls[2]).toEqual({ method: 'DELETE', body: undefined });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('list items added offline', () => {
  beforeEach(() => localStorage.clear());

  it('show up as stand-ins and follow edits until they are sent', async () => {
    const { pendingListItems, updateQueued, dropQueued, OFFLINE_ITEM_PREFIX } = await import('../offline');
    const milk = enqueue('POST', '/api/v1/lists/lst_1/items', { content: 'Hafermilch', category: 'Kühlregal', quantity: '' });
    const bread = enqueue('POST', '/api/v1/lists/lst_2/items', { content: 'Brot', category: '', quantity: '1' });
    enqueue('POST', '/api/v1/inbox', { content: 'kein Listeneintrag' });

    let items = pendingListItems();
    expect(items.map((i) => [i.listId, i.content])).toEqual([
      ['lst_1', 'Hafermilch'],
      ['lst_2', 'Brot'],
    ]);
    expect(items[0].id).toBe(OFFLINE_ITEM_PREFIX + milk.id);

    updateQueued(milk.id, { quantity: '2' });
    dropQueued(bread.id);
    items = pendingListItems();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe('2');
    expect(getOutbox()).toHaveLength(2); // the inbox entry stays
  });
});
