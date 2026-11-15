import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STATS_SHARED_DELAY_MS,
  STATS_SHARED_INTERVAL_MS,
  STATS_SOON_MS,
  createStatsScheduler,
  eventChangesDeck,
  eventChangesStats,
} from '../realtimeCounters';
import { WSMessage } from '../../lib/types';

const msg = (event: string, payload: unknown): WSMessage => ({ event, payload, timestamp: '' });

describe('which events change the counters', () => {
  it('reacts to tasks, notes and lists', () => {
    for (const e of ['TASK_UPDATED', 'TASK_CREATED', 'TASK_LIST_UPDATED', 'DOC_COUNTS', 'DOC_DELETED', 'ITEM_TOGGLED', 'ITEM_CREATED', 'LIST_SHARED']) {
      expect(eventChangesStats(e)).toBe(true);
    }
  });

  it('ignores edits inside a note, reordered list entries and unrelated events', () => {
    for (const e of ['DOC_SEQ', 'ITEM_REORDERED', 'NOTIFICATION', 'DRAW_OPS', 'WORKSPACE_FOLDERS_UPDATED', undefined]) {
      expect(eventChangesStats(e)).toBe(false);
    }
  });
});

describe('which events change the triage deck', () => {
  const deck = new Set(['th_inbox']);

  it('reloads for a new thought in the inbox and for one sent back to it', () => {
    expect(eventChangesDeck(msg('TASK_CREATED', { id: 'th_new', status: 'inbox' }), deck)).toBe(true);
    expect(eventChangesDeck(msg('TASK_UPDATED', { id: 'th_back', status: 'inbox' }), deck)).toBe(true);
  });

  it('reloads when a thought of the deck was sorted or deleted elsewhere', () => {
    expect(eventChangesDeck(msg('TASK_UPDATED', { id: 'th_inbox', status: 'kept' }), deck)).toBe(true);
    expect(eventChangesDeck(msg('TASK_DELETED', { id: 'th_inbox' }), deck)).toBe(true);
  });

  it('leaves the deck alone for task changes in a task list', () => {
    expect(eventChangesDeck(msg('TASK_UPDATED', { id: 'th_task', status: 'kept', isCompleted: true }), deck)).toBe(false);
    expect(eventChangesDeck(msg('TASK_CREATED', { id: 'th_task', status: 'kept' }), deck)).toBe(false);
    expect(eventChangesDeck(msg('TASK_DELETED', { id: 'th_task' }), deck)).toBe(false);
    expect(eventChangesDeck(msg('TASK_REORDERED', { listId: 'tl_1', ids: ['th_task'] }), deck)).toBe(false);
    expect(eventChangesDeck(msg('TASK_LIST_UPDATED', { id: 'tl_1' }), deck)).toBe(false);
    expect(eventChangesDeck(msg('ITEM_TOGGLED', { id: 'it_1' }), deck)).toBe(false);
  });

  it('reloads once too often rather than never for a payload it does not know', () => {
    expect(eventChangesDeck(msg('TASK_UPDATED', null), deck)).toBe(true);
  });
});

describe('stats scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('loads shortly after an own change, once for a burst', () => {
    const load = vi.fn();
    const s = createStatsScheduler(load);
    s.soon();
    s.soon();
    vi.advanceTimersByTime(STATS_SOON_MS - 1);
    expect(load).not.toHaveBeenCalled();
    s.soon();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('makes one request for a burst of other people’s changes', () => {
    const load = vi.fn();
    const s = createStatsScheduler(load);
    for (let i = 0; i < 50; i++) {
      s.shared();
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersByTime(STATS_SHARED_DELAY_MS);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads at most once per interval while events keep coming, and after the last one', () => {
    const load = vi.fn();
    const s = createStatsScheduler(load);
    // One event every 100 ms for 20 s
    for (let t = 0; t < 20_000; t += 100) {
      s.shared();
      vi.advanceTimersByTime(100);
    }
    const during = load.mock.calls.length;
    expect(during).toBeLessThanOrEqual(Math.ceil(20_000 / STATS_SHARED_INTERVAL_MS));
    expect(during).toBeGreaterThanOrEqual(3);
    // The last event is followed by a load too (counts stay correct in the end)
    vi.advanceTimersByTime(STATS_SHARED_INTERVAL_MS);
    expect(load.mock.calls.length).toBe(during + 1);
    vi.advanceTimersByTime(60_000);
    expect(load.mock.calls.length).toBe(during + 1);
  });

  it('an own change moves a pending shared reload forward', () => {
    const load = vi.fn();
    const s = createStatsScheduler(load);
    s.shared();
    s.soon();
    vi.advanceTimersByTime(STATS_SOON_MS);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STATS_SHARED_INTERVAL_MS * 2);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the pending reload', () => {
    const load = vi.fn();
    const s = createStatsScheduler(load);
    s.shared();
    s.cancel();
    vi.advanceTimersByTime(STATS_SHARED_INTERVAL_MS * 2);
    expect(load).not.toHaveBeenCalled();
  });
});
