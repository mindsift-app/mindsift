import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

vi.mock('../../version', () => ({ APP_VERSION: 'v1.0.0', APP_BUILD: 'build-alt' }));
// appReload's own sending is tested in appReload.test.ts; here the hook gets its flush and reload passed in
vi.mock('../api', () => ({ api: { flushOfflineQueue: vi.fn(async () => 0) } }));
vi.mock('../docSync/engine', () => ({ syncOpenNotes: vi.fn(async () => {}), notesStoring: () => false }));
vi.mock('../docSync/flushClosed', () => ({ flushClosedNotes: vi.fn(async () => 0) }));

import { useUpdateCheck, UPDATE_IDLE_MS, UPDATE_MAX_WAIT_MS, UPDATE_NOTICE_MS } from '../useUpdateCheck';
import { reloadAttempts } from '../appReload';
import { UpdateReloadNotice } from '../../components/UpdateReloadNotice';
import { reloadHeld, useHoldReload } from '../reloadHold';
import { DictationQueue } from '../../features/capture/dictationQueue';

// One step of the hook's clock and a little more
const TICK = 300;

let liveBuild = 'build-alt';
let serverAnswers = true;
const fetchMock = vi.fn(async () => {
  if (!serverAnswers) throw new TypeError('Failed to fetch');
  return { json: async () => ({ version: 'v1.1.0', build: liveBuild }) } as Response;
});

const calls: string[] = [];
const flush = vi.fn(async () => {
  calls.push('flush');
});
const reload = vi.fn((bypassCache: boolean) => {
  calls.push(bypassCache ? 'reload-bypass' : 'reload');
});

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const start = () => renderHook(() => useUpdateCheck({ flush, reload }));

// A key press in a text field every second for `ms`
async function typeFor(ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    fireEvent.keyDown(window, { key: 'a' });
    await wait(1000);
  }
}

describe('useUpdateCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    flush.mockClear();
    reload.mockClear();
    calls.length = 0;
    liveBuild = 'build-alt';
    serverAnswers = true;
    setOnline(true);
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // Every test gives back what it held
    expect(reloadHeld()).toBe(false);
  });

  it('does not reload while the server runs the same build, also after a reconnect (demo reset, restart)', async () => {
    const { result } = start();
    await wait(0);
    act(() => {
      window.dispatchEvent(new CustomEvent('mindsift:ws:status', { detail: { connected: true, transport: 'ws' } }));
    });
    await wait(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.update).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('counts down after a server update, then sends what is waiting and reloads', async () => {
    liveBuild = 'build-neu';
    const { result } = start();
    await wait(0);
    expect(result.current.update).toMatchObject({ build: 'build-neu', phase: 'countdown', secondsLeft: 5 });
    await wait(UPDATE_NOTICE_MS - 1000);
    expect(result.current.update?.secondsLeft).toBe(1);
    expect(reload).not.toHaveBeenCalled();
    await wait(1000);
    expect(calls).toEqual(['flush', 'reload']);
    expect(reloadAttempts('build-neu')).toBe(1);
  });

  it('shows the countdown in German with a button that reloads at once', async () => {
    liveBuild = 'build-neu';
    const { result } = start();
    await wait(0);
    render(<UpdateReloadNotice update={result.current.update!} onReloadNow={result.current.reloadNow} />);
    expect(screen.getByText('MindSift wurde aktualisiert')).toBeTruthy();
    expect(screen.getByText('Lädt in 5 s neu.')).toBeTruthy();
    expect(screen.queryByText('Später')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt neu laden' }));
    await wait(0);
    expect(calls).toEqual(['flush', 'reload']);
  });

  it('waits for a pause while the user is typing', async () => {
    liveBuild = 'build-neu';
    const { result } = start();
    await wait(0);
    await typeFor(10_000);
    expect(result.current.update?.phase).toBe('waiting');
    expect(reload).not.toHaveBeenCalled();
    await wait(UPDATE_IDLE_MS + 500);
    expect(calls).toEqual(['flush', 'reload']);
  });

  it('reloads after at most 30 s of typing', async () => {
    liveBuild = 'build-neu';
    start();
    await wait(0);
    await typeFor(UPDATE_MAX_WAIT_MS - 2000);
    expect(reload).not.toHaveBeenCalled();
    await typeFor(3000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload by itself while a field outside a note holds unsaved text, and counts down again once it is empty', async () => {
    liveBuild = 'build-neu';
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.value = 'Milch kaufen';
    input.focus();
    const { result } = start();
    await wait(0);
    await wait(5 * 60_000);
    expect(reload).not.toHaveBeenCalled();
    expect(result.current.update?.phase).toBe('held');
    render(<UpdateReloadNotice update={result.current.update!} onReloadNow={result.current.reloadNow} />);
    expect(screen.getByText('Lädt neu, sobald du fertig bist: Eingaben oder Diktate sind noch nicht gespeichert.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Jetzt neu laden' })).toBeTruthy();

    input.value = '';
    await wait(TICK);
    expect(result.current.update).toMatchObject({ phase: 'countdown', secondsLeft: 5 });
    await wait(UPDATE_NOTICE_MS - 1000);
    expect(reload).not.toHaveBeenCalled();
    await wait(1000);
    expect(calls).toEqual(['flush', 'reload']);
    input.remove();
  });

  it('holds back while unsaved work is registered (open task draft, capture text), the button still reloads', async () => {
    liveBuild = 'build-neu';
    const draft = renderHook(({ active }) => useHoldReload(active), { initialProps: { active: true } });
    const { result } = start();
    await wait(UPDATE_MAX_WAIT_MS * 2);
    expect(result.current.update?.phase).toBe('held');
    expect(reload).not.toHaveBeenCalled();

    draft.rerender({ active: false });
    await wait(UPDATE_NOTICE_MS + TICK);
    expect(calls).toEqual(['flush', 'reload']);
    draft.unmount();

    // With a draft open, a click on the button reloads all the same
    calls.length = 0;
    const again = renderHook(() => useHoldReload(true));
    const second = start();
    await wait(TICK);
    act(() => second.result.current.reloadNow());
    await wait(0);
    expect(calls).toEqual(['flush', 'reload-bypass']);
    again.unmount();
  });

  it('waits for a running dictation and the dictation queue', async () => {
    liveBuild = 'build-neu';
    let answer: (text: string) => void = () => {};
    const saved: string[] = [];
    const queue = new DictationQueue<void>({
      save: (text) => {
        saved.push(text);
      },
      onChange: () => {},
      fallbackMessage: () => 'Fehler',
    });
    queue.add({ text: () => new Promise<string>((resolve) => (answer = resolve)) });
    const { result } = start();
    await wait(UPDATE_MAX_WAIT_MS * 2);
    expect(result.current.update?.phase).toBe('held');
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      answer('Zahnarzt anrufen');
    });
    expect(saved).toEqual(['Zahnarzt anrufen']);
    await wait(UPDATE_NOTICE_MS + TICK);
    expect(calls).toEqual(['flush', 'reload']);
  });

  it('does not wait for a failed dictation (a reload may lose it)', async () => {
    liveBuild = 'build-neu';
    const queue = new DictationQueue<void>({ save: () => {}, onChange: () => {}, fallbackMessage: () => 'Fehler' });
    queue.add({ text: () => Promise.reject(new Error('Server nicht erreichbar')) });
    start();
    await wait(UPDATE_MAX_WAIT_MS + UPDATE_NOTICE_MS + TICK);
    expect(queue.items()[0].state).toBe('failed');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads while offline, and does once back online', async () => {
    setOnline(false);
    liveBuild = 'build-neu';
    const { result } = start();
    await wait(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await wait(0);
    expect(result.current.update?.phase).toBe('countdown');
    // Gone again during the countdown: the notice waits for the connection
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.update?.phase).toBe('offline');
    await wait(60_000);
    expect(reload).not.toHaveBeenCalled();

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await wait(UPDATE_NOTICE_MS + 100);
    expect(calls).toEqual(['flush', 'reload']);
  });

  it('does not reload when the server cannot be reached right before', async () => {
    liveBuild = 'build-neu';
    const { result } = start();
    await wait(0);
    serverAnswers = false;
    await wait(UPDATE_NOTICE_MS + 100);
    expect(result.current.update?.phase).toBe('offline');
    expect(flush).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('forgets the update when the server went back to this build', async () => {
    liveBuild = 'build-neu';
    const { result } = start();
    await wait(0);
    liveBuild = 'build-alt';
    await wait(UPDATE_NOTICE_MS + 100);
    expect(result.current.update).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('tries once more past caches, then shows a lasting notice instead of reloading again', async () => {
    liveBuild = 'build-neu';
    // The first reload brought the old build again
    sessionStorage.setItem('mindsift:update-reload', JSON.stringify({ build: 'build-neu', attempts: 1 }));
    const first = start();
    await wait(UPDATE_NOTICE_MS + 100);
    expect(calls).toEqual(['flush', 'reload-bypass']);
    first.unmount();

    // ...and so did the second
    calls.length = 0;
    const { result } = start();
    await wait(0);
    expect(result.current.update?.phase).toBe('stuck');
    await wait(5 * 60_000);
    expect(reload).toHaveBeenCalledTimes(1);

    render(<UpdateReloadNotice update={result.current.update!} onReloadNow={result.current.reloadNow} />);
    expect(screen.getByText('Neue Version lädt nicht')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt neu laden' }));
    await wait(0);
    expect(calls).toEqual(['flush', 'reload-bypass']);
  });

  it('starts counting again once the new build is running', async () => {
    sessionStorage.setItem('mindsift:update-reload', JSON.stringify({ build: 'build-alt', attempts: 1 }));
    start();
    await wait(0);
    expect(sessionStorage.getItem('mindsift:update-reload')).toBeNull();
  });
});
