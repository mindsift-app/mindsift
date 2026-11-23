import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Thought } from '../../../lib/types';
import { isTaskThought, tasksAfterCreate, tasksAfterDelete, tasksAfterReorder, tasksAfterUpdate, useTaskRealtime } from '../useTaskRealtime';
import { createMoveTracker } from '../taskMoves';
import { RELOAD_SHARED_DELAY_MS } from '../../../lib/realtimeReload';
import { makeTask } from '../../../test/fixtures';
import { emitRealtimeMessage } from '../../../lib/realtimeBus';
import type { WSMessage } from '../../../lib/types';

const mocks = vi.hoisted(() => ({ getTaskLists: vi.fn() }));
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<typeof import('../../../lib/api')>()),
  api: { getTaskLists: mocks.getTaskLists },
  getCurrentUserId: () => 'usr_anna',
}));

const ids = (list: Thought[]) => list.map((t) => t.id);

const task = (id: string, t: Partial<Thought> = {}) => makeTask(id, { taskListId: 'l1', ...t });

describe('task realtime updates', () => {
  it('counts kept and converted-to-task thoughts as tasks, not fresh Quick Dumps', () => {
    expect(isTaskThought(task('a'))).toBe(true);
    expect(isTaskThought(task('b', { status: 'converted', convertedType: 'task' }))).toBe(true);
    expect(isTaskThought(task('c', { status: 'inbox' }))).toBe(false);
  });

  it('adds a created task once, only to its own list or "all"', () => {
    const prev = [task('a')];
    expect(ids(tasksAfterCreate(prev, task('n'), 'l1'))).toEqual(['n', 'a']);
    expect(tasksAfterCreate(prev, task('a'), 'l1')).toBe(prev);
    expect(tasksAfterCreate(prev, task('n', { taskListId: 'l2' }), 'l1')).toBe(prev);
    expect(ids(tasksAfterCreate(prev, task('n', { taskListId: 'l2' }), 'all'))).toEqual(['n', 'a']);
  });

  it('updates, adds or removes a changed task depending on list and status', () => {
    const prev = [task('a'), task('b')];
    expect(tasksAfterUpdate(prev, task('a', { content: 'neu' }), 'l1')[0].content).toBe('neu');
    expect(ids(tasksAfterUpdate(prev, task('a', { taskListId: 'l2' }), 'l1'))).toEqual(['b']); // moved away
    expect(ids(tasksAfterUpdate(prev, task('a', { status: 'inbox' }), 'all'))).toEqual(['b']); // back to the Quick Dump
    expect(ids(tasksAfterUpdate(prev, task('c'), 'l1'))).toEqual(['c', 'a', 'b']); // moved in
    expect(tasksAfterUpdate(prev, task('c', { taskListId: 'l2' }), 'l1')).toBe(prev);
    // A change by anyone does not end watching (the broadcast carries no isWatching)
    const watched = [task('a', { isWatching: true })];
    expect(tasksAfterUpdate(watched, task('a', { priority: 'high' }), 'l1')[0].isWatching).toBe(true);
  });

  it('keeps the assignees when an update comes without them, takes an empty list as a change', () => {
    const prev = [task('a', { assignees: ['usr_anna', 'usr_ben'], isWatching: true })];
    // ticked in a linked note: the event used to come with assignees null
    const ticked = tasksAfterUpdate(prev, task('a', { isCompleted: true, assignees: null as unknown as string[] }), 'l1')[0];
    expect(ticked.isCompleted).toBe(true);
    expect(ticked.assignees).toEqual(['usr_anna', 'usr_ben']);
    expect(ticked.isWatching).toBe(true);
    expect(tasksAfterUpdate(prev, task('a', { content: 'neu' }), 'l1')[0].assignees).toEqual(['usr_anna', 'usr_ben']);
    expect(tasksAfterUpdate(prev, task('a', { assignees: [] }), 'l1')[0].assignees).toEqual([]);
    expect(tasksAfterUpdate(prev, task('a', { assignees: ['usr_ben'] }), 'l1')[0].assignees).toEqual(['usr_ben']);
  });

  it('removes a deleted task', () => {
    expect(ids(tasksAfterDelete([task('a'), task('b')], 'a'))).toEqual(['b']);
  });

  it('takes place, column and done state of a move without loading again', () => {
    const prev = [task('a', { sortOrder: 0, kanbanStatus: 'todo', isCompleted: false }), task('b', { sortOrder: 1, kanbanStatus: 'todo', isCompleted: false })];
    const next = tasksAfterReorder(prev, [
      { id: 'a', sortOrder: 1, kanbanStatus: 'erledigt', isCompleted: true },
      { id: 'b', sortOrder: 1, kanbanStatus: 'todo', isCompleted: false },
      { id: 'unbekannt', sortOrder: 0 },
    ]);
    expect(next[0]).toMatchObject({ id: 'a', sortOrder: 1, kanbanStatus: 'erledigt', isCompleted: true });
    expect(next[1]).toBe(prev[1]); // unchanged task keeps its object
    // The same move again changes nothing
    expect(tasksAfterReorder(next, [{ id: 'a', sortOrder: 1, kanbanStatus: 'erledigt', isCompleted: true }])).toBe(next);
  });

  it('drops the tasks the server skipped when answering the own move', () => {
    const prev = [task('a', { sortOrder: 0 }), task('b', { sortOrder: 1 })];
    expect(ids(tasksAfterReorder(prev, [{ id: 'a', sortOrder: 0 }], ['b']))).toEqual(['a']);
    expect(tasksAfterReorder(prev, undefined)).toBe(prev);
  });
});

describe('task realtime events in the view', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getTaskLists.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  const ws = (detail: unknown) => emitRealtimeMessage(detail as WSMessage);
  const setup = () => {
    const setTasks = vi.fn();
    const loadData = vi.fn(async () => {});
    const moveTracker = createMoveTracker();
    const hook = renderHook(() =>
      useTaskRealtime({ setTasks, setTaskLists: vi.fn(), listIdRef: { current: 'l1' }, loadDataRef: { current: loadData }, moveTracker })
    );
    return { setTasks, loadData, moveTracker, hook };
  };

  it('loads the task lists once for a burst of list events', () => {
    const { hook } = setup();
    for (let i = 0; i < 10; i++) ws({ event: 'TASK_LIST_UPDATED', payload: { id: 'l1' } });
    vi.advanceTimersByTime(RELOAD_SHARED_DELAY_MS);
    expect(mocks.getTaskLists).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('drops the echo of an own move and waits with other moves while own ones are on their way', () => {
    const { setTasks, loadData, moveTracker, hook } = setup();
    const seq = moveTracker.begin([{ id: 'a', sortOrder: 0 }]);
    ws({ event: 'TASK_REORDERED', payload: { userId: 'usr_anna', items: [{ id: 'a', sortOrder: 0 }] } });
    ws({ event: 'TASK_REORDERED', payload: { userId: 'usr_ben', items: [{ id: 'b', sortOrder: 4 }] } });
    expect(setTasks).not.toHaveBeenCalled();
    expect(moveTracker.settle(seq, false).reload).toBe(true);
    // Nothing on its way any more: someone else's move is applied from the event
    ws({ event: 'TASK_REORDERED', payload: { userId: 'usr_ben', items: [{ id: 'b', sortOrder: 5 }] } });
    expect(setTasks).toHaveBeenCalledTimes(1);
    // A move that made a new task loads once, in the shared rhythm
    ws({ event: 'TASK_REORDERED', payload: { userId: 'usr_ben', items: [], reload: true } });
    ws({ event: 'TASK_REORDERED', payload: { userId: 'usr_ben', items: [], reload: true } });
    vi.advanceTimersByTime(RELOAD_SHARED_DELAY_MS);
    expect(loadData).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});
