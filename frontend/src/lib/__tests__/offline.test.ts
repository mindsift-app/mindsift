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
