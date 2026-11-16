import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = { outbox: 0, notes: 0, storing: false };
const flushOfflineQueue = vi.fn(async () => {
  state.outbox = 0;
  return 1;
});
const syncOpenNotes = vi.fn(async () => {});
const flushClosedNotes = vi.fn(async () => 0);

vi.mock('../../version', () => ({ APP_VERSION: 'v1.0.0', APP_BUILD: 'build-alt' }));
vi.mock('../api', () => ({ api: { flushOfflineQueue: () => flushOfflineQueue() } }));
vi.mock('../offline', () => ({ outboxCount: () => state.outbox }));
vi.mock('../docSync/persist', () => ({ unsentNoteCount: () => state.notes }));
vi.mock('../docSync/engine', () => ({ syncOpenNotes: () => syncOpenNotes(), notesStoring: () => state.storing }));
vi.mock('../docSync/flushClosed', () => ({ flushClosedNotes: () => flushClosedNotes() }));

import { CACHE_BUST_PARAM, FLUSH_TIMEOUT_MS, flushBeforeReload, noteReloadAttempt, reloadAttempts, settleReload } from '../appReload';

describe('flushBeforeReload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.outbox = 2;
    state.notes = 1;
    state.storing = false;
    flushOfflineQueue.mockClear();
    syncOpenNotes.mockClear();
    flushClosedNotes.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands over typed text, sends every queue and waits until the notes are confirmed', async () => {
    const typed = vi.fn();
    window.addEventListener('mindsift:flush-edits', typed);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    let done = false;
    void flushBeforeReload().then(() => (done = true));
    expect(typed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
    await vi.advanceTimersByTimeAsync(1000);
    expect(syncOpenNotes).toHaveBeenCalled();
    expect(flushOfflineQueue).toHaveBeenCalled();
    expect(flushClosedNotes).toHaveBeenCalled();
    // The note's answer is still out
    expect(done).toBe(false);
    state.notes = 0;
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);

    window.removeEventListener('mindsift:flush-edits', typed);
    input.remove();
  });

  it('gives up waiting for the server after the time limit, but not before the notes are stored', async () => {
    state.storing = true;
    let done = false;
    void flushBeforeReload().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS + 500);
    expect(done).toBe(false);
    state.storing = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    // Still unsent: it stays stored and goes out after the reload
    expect(state.notes).toBe(1);
  });
});

describe('reload attempts', () => {
  beforeEach(() => sessionStorage.clear());

  it('counts reloads per build and starts over once the new build runs', () => {
    expect(noteReloadAttempt('build-neu')).toBe(0);
    expect(noteReloadAttempt('build-neu')).toBe(1);
    expect(reloadAttempts('build-neu')).toBe(2);
    expect(reloadAttempts('build-anders')).toBe(0);
    settleReload();
    expect(reloadAttempts('build-neu')).toBe(2);

    noteReloadAttempt('build-alt');
    settleReload();
    expect(reloadAttempts('build-alt')).toBe(0);
  });

  it('removes the cache-busting part of the address', () => {
    window.history.replaceState(null, '', `/?note=abc&${CACHE_BUST_PARAM}=123`);
    settleReload();
    expect(window.location.search).toBe('?note=abc');
  });
});
