import { describe, it, expect, vi } from 'vitest';
import { DictationQueue, type DictationItem } from '../dictationQueue';

// A transcription the test answers by hand
function deferred() {
  let resolve!: (text: string) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(save = vi.fn(async (text: string) => text)) {
  const changes: DictationItem[][] = [];
  const onSaved = vi.fn();
  const onNothing = vi.fn();
  const onFailed = vi.fn();
  const queue = new DictationQueue<string>({
    save,
    onChange: (items) => changes.push(items),
    onSaved,
    onNothing,
    onFailed,
    fallbackMessage: () => 'Spracherkennung fehlgeschlagen',
  });
  return { queue, save, changes, onSaved, onNothing, onFailed };
}

describe('DictationQueue', () => {
  it('saves in recording order even when a later recording is recognised first', async () => {
    const { queue, save } = setup();
    const first = deferred();
    const second = deferred();
    queue.add({ text: () => first.promise });
    queue.add({ text: () => second.promise });
    expect(queue.items().map((i) => i.state)).toEqual(['transcribing', 'transcribing']);

    second.resolve('Zweites Diktat');
    await flush();
    expect(save).not.toHaveBeenCalled();

    first.resolve('Erstes Diktat');
    await flush();
    expect(save.mock.calls.map((c) => c[0])).toEqual(['Erstes Diktat', 'Zweites Diktat']);
    expect(queue.items()).toEqual([]);
  });

  it('starts every transcription at once, a new recording does not wait for the one before', () => {
    const { queue } = setup();
    const first = vi.fn(() => new Promise<string>(() => {}));
    const second = vi.fn(() => Promise.resolve('Brot kaufen'));
    queue.add({ text: first });
    queue.add({ text: second });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed recording, saves the ones after it and saves it on retry', async () => {
    const { queue, save, onFailed } = setup();
    const retry = vi.fn(() => Promise.resolve('Zahnarzt anrufen'));
    queue.add({ text: () => Promise.reject(new Error('Spracherkennung hat zu lange gedauert')), retry });
    queue.add({ text: () => Promise.resolve('Milch kaufen') });
    await flush();

    expect(onFailed).toHaveBeenCalledWith('Spracherkennung hat zu lange gedauert');
    expect(save.mock.calls.map((c) => c[0])).toEqual(['Milch kaufen']);
    expect(queue.items()).toEqual([{ id: 1, state: 'failed', error: 'Spracherkennung hat zu lange gedauert' }]);

    queue.retryFailed();
    expect(queue.items()[0].state).toBe('transcribing');
    await flush();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(save.mock.calls.map((c) => c[0])).toEqual(['Milch kaufen', 'Zahnarzt anrufen']);
    expect(queue.items()).toEqual([]);
  });

  it('tries a failed save again without transcribing again', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue('ok');
    const { queue, onSaved } = setup(save);
    const text = vi.fn(() => Promise.resolve('Paket abholen'));
    queue.add({ text });
    await flush();
    expect(queue.items()[0]).toMatchObject({ state: 'failed', error: 'Offline' });

    queue.retry(1);
    await flush();
    expect(text).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('Paket abholen');
    expect(onSaved).toHaveBeenCalledWith('ok', 'Paket abholen');
    expect(queue.items()).toEqual([]);
  });

  it('saves nothing for a recording without words, and the next one still follows', async () => {
    const { queue, save, onNothing } = setup();
    queue.add({ text: () => Promise.resolve('   ') });
    queue.add({ text: () => Promise.resolve('Blumen gießen') });
    await flush();
    expect(onNothing).toHaveBeenCalledTimes(1);
    expect(save.mock.calls.map((c) => c[0])).toEqual(['Blumen gießen']);
  });

  it('throws a failed recording away only when asked', async () => {
    const { queue, save } = setup();
    const discard = vi.fn();
    queue.add({ text: () => Promise.reject(new Error()), discard });
    await flush();
    expect(queue.items()).toEqual([{ id: 1, state: 'failed', error: 'Spracherkennung fehlgeschlagen' }]);
    queue.discardFailed();
    expect(discard).toHaveBeenCalledTimes(1);
    expect(queue.items()).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });
});
